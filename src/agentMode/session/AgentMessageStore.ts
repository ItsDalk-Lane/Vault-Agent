import { logInfo } from "@/logger";
import {
  parseFanoutComposite,
  serializeFanoutComposite,
  snapshotFanoutTurn,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import {
  AgentChatMessage,
  AgentMessagePart,
  AgentToolCallOutput,
  NewAgentChatMessage,
  StopReason,
  TurnFileChange,
  TurnUsageSummary,
} from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";
import { FormattedDateTime, MessageContext } from "@/types/message";
import { formatDateTime } from "@/utils";

interface StoredAgentMessage {
  id: string;
  displayText: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  isErrorMessage?: boolean;
  isAuxiliary?: boolean;
  parts?: AgentMessagePart[];
  context?: MessageContext;
  content?: unknown[];
  turnStopReason?: StopReason;
  turnDurationMs?: number;
  turnUsage?: TurnUsageSummary;
  turnEndEntryId?: string;
  fanout?: FanoutTurn;
  fileChanges?: TurnFileChange[];
  version: number;
}

const MAX_COMPARE_JSON_CHARS = 8_000;
const MAX_COMPARE_EDGE_CHARS = 512;
const MAX_COMPARE_TEXT_EDGE_CHARS = 128;

function agentPartId(part: AgentMessagePart): string | undefined {
  if (part.kind === "tool_call") return `tool:${part.id}`;
  if (part.kind === "plan") return "plan";
  if (part.kind === "compaction") return `compaction:${part.id}`;
  return undefined;
}

function partsEqual(a: AgentMessagePart, b: AgentMessagePart): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case "text":
      if (b.kind !== "text") return false;
      return a.text === b.text;
    case "thought":
      if (b.kind !== "thought") return false;
      return a.text === b.text && a.startedAtMs === b.startedAtMs && a.durationMs === b.durationMs;
    case "plan":
      if (b.kind !== "plan") return false;
      return planEntriesEqual(a.entries, b.entries);
    case "compaction":
      if (b.kind !== "compaction") return false;
      return (
        a.status === b.status &&
        a.trigger === b.trigger &&
        a.error === b.error &&
        a.preTokens === b.preTokens &&
        a.postTokens === b.postTokens &&
        a.startedAtMs === b.startedAtMs
      );
    case "tool_call":
      if (b.kind !== "tool_call") return false;
      return (
        a.id === b.id &&
        a.title === b.title &&
        a.toolKind === b.toolKind &&
        a.status === b.status &&
        a.userResponse === b.userResponse &&
        a.vendorToolName === b.vendorToolName &&
        a.parentToolCallId === b.parentToolCallId &&
        toolProgressEqual(a.progress, b.progress) &&
        boundedValueEqual(a.input, b.input) &&
        locationsEqual(a.locations, b.locations) &&
        toolOutputsEqual(a.output, b.output)
      );
  }
}

function toolProgressEqual(
  a: Extract<AgentMessagePart, { kind: "tool_call" }>["progress"],
  b: Extract<AgentMessagePart, { kind: "tool_call" }>["progress"]
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    a.description === b.description &&
    a.toolName === b.toolName &&
    a.toolUses === b.toolUses &&
    a.durationMs === b.durationMs &&
    a.totalTokens === b.totalTokens
  );
}

function planEntriesEqual(
  a: Extract<AgentMessagePart, { kind: "plan" }>["entries"],
  b: Extract<AgentMessagePart, { kind: "plan" }>["entries"]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (entry, index) =>
      entry.content === b[index].content &&
      entry.priority === b[index].priority &&
      entry.status === b[index].status
  );
}

function locationsEqual(
  a: Extract<AgentMessagePart, { kind: "tool_call" }>["locations"],
  b: Extract<AgentMessagePart, { kind: "tool_call" }>["locations"]
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  return a.every((loc, index) => loc.path === b[index].path && loc.line === b[index].line);
}

function toolOutputsEqual(
  a: AgentToolCallOutput[] | undefined,
  b: AgentToolCallOutput[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;

  return a.every((output, index) => {
    const other = b[index];
    if (output.type !== other.type) return false;
    if (output.type === "diff" && other.type === "diff") {
      return (
        output.path === other.path &&
        output.oldText === other.oldText &&
        output.newText === other.newText
      );
    }
    if (output.type === "text" && other.type === "text") {
      return textFingerprint(output.text) === textFingerprint(other.text);
    }
    return false;
  });
}

function boundedValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return valueFingerprint(a) === valueFingerprint(b);
}

function valueFingerprint(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  if (json.length <= MAX_COMPARE_JSON_CHARS) return json;
  return `${json.length}:${json.slice(0, MAX_COMPARE_EDGE_CHARS)}:${json.slice(
    -MAX_COMPARE_EDGE_CHARS
  )}`;
}

function textFingerprint(text: string): string {
  if (text.length <= MAX_COMPARE_TEXT_EDGE_CHARS * 2) return text;
  return `${text.length}:${text.slice(0, MAX_COMPARE_TEXT_EDGE_CHARS)}:${text.slice(
    -MAX_COMPARE_TEXT_EDGE_CHARS
  )}`;
}

function nonEmptyArray<T>(value: T[] | undefined): T[] | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

// An absent field leaves the displayed UI-only value alone; an explicitly empty list means the
// projection removed it, so the stored value must not survive as a ghost part:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function projectedArray<T>(projected: T[] | undefined, existing: T[] | undefined): T[] | undefined {
  return projected === undefined ? existing : nonEmptyArray(projected);
}

function sameStoredMessage(a: StoredAgentMessage, b: StoredAgentMessage): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.displayText === b.displayText &&
    a.sender === b.sender &&
    a.isVisible === b.isVisible &&
    a.isErrorMessage === b.isErrorMessage &&
    a.isAuxiliary === b.isAuxiliary &&
    a.turnStopReason === b.turnStopReason &&
    a.turnDurationMs === b.turnDurationMs &&
    a.turnEndEntryId === b.turnEndEntryId &&
    sameValue(a.turnUsage, b.turnUsage) &&
    sameTimestamp(a.timestamp, b.timestamp) &&
    sameParts(a.parts, b.parts) &&
    sameValue(a.content, b.content) &&
    sameValue(a.context, b.context) &&
    sameValue(a.fanout, b.fanout) &&
    sameValue(a.fileChanges, b.fileChanges)
  );
}

function sameTimestamp(a: FormattedDateTime | null, b: FormattedDateTime | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.epoch === b.epoch && a.display === b.display && a.fileName === b.fileName;
}

function sameParts(
  a: readonly AgentMessagePart[] | undefined,
  b: readonly AgentMessagePart[] | undefined
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((part, index) => partsEqual(part, b[index]));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  return valueFingerprint(a) === valueFingerprint(b);
}

export class AgentMessageStore {
  private messages: StoredAgentMessage[] = [];
  private displayCache = new Map<string, { version: number; view: AgentChatMessage }>();
  private lastDisplay: AgentChatMessage[] | null = null;

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private touch(msg: StoredAgentMessage): void {
    msg.version += 1;
    this.lastDisplay = null;
  }

  /**
   * Freeze the latest reasoning block at the event that ended it. React can
   * batch over this transition, so render-time clocks cannot recover it later.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/336
   */
  private finishTrailingThought(msg: StoredAgentMessage): boolean {
    const last = msg.parts?.[msg.parts.length - 1];
    if (
      !last ||
      last.kind !== "thought" ||
      last.startedAtMs === undefined ||
      (last.durationMs !== undefined && msg.turnStopReason === undefined)
    ) {
      return false;
    }
    const durationMs = Math.max(last.durationMs ?? 0, Date.now() - last.startedAtMs);
    if (last.durationMs === durationMs) return false;
    last.durationMs = durationMs;
    return true;
  }

  addMessage(message: NewAgentChatMessage): string {
    const id = message.id || this.generateId();
    const timestamp =
      message.timestamp === null ? null : message.timestamp || formatDateTime(new Date());
    this.messages.push({
      id,
      displayText: message.message,
      sender: message.sender,
      timestamp,
      context: message.context,
      isVisible: message.isVisible !== false,
      isErrorMessage: message.isErrorMessage,
      isAuxiliary: message.isAuxiliary,
      content: message.content,
      parts: message.parts,
      turnStopReason: message.turnStopReason,
      turnDurationMs: message.turnDurationMs,
      version: 0,
    });
    this.lastDisplay = null;
    return id;
  }

  markTurnComplete(id: string, stopReason: StopReason, durationMs: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (msg.turnStopReason !== undefined) return false;
    this.finishTrailingThought(msg);
    msg.turnStopReason = stopReason;
    msg.turnDurationMs = Math.max(0, durationMs);
    this.touch(msg);
    return true;
  }

  extendTurnDuration(id: string, durationMs: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg || msg.turnDurationMs === undefined) return false;
    const nextDurationMs = Math.max(0, durationMs);
    if (nextDurationMs <= msg.turnDurationMs) return false;
    msg.turnDurationMs = nextDurationMs;
    this.touch(msg);
    return true;
  }

  setFanout(id: string, turn: FanoutTurn): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.fanout = turn;
    this.touch(msg);
    return true;
  }

  setFileChanges(id: string, changes: TurnFileChange[]): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.fileChanges = changes;
    this.touch(msg);
    return true;
  }

  appendDisplayText(id: string, chunk: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.displayText += chunk;
    this.touch(msg);
    return true;
  }

  appendAgentText(id: string, text: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.displayText += text;
    if (!msg.parts) msg.parts = [];
    this.finishTrailingThought(msg);
    const last = msg.parts[msg.parts.length - 1];
    if (last && last.kind === "text") {
      last.text += text;
    } else {
      msg.parts.push({ kind: "text", text });
    }
    this.touch(msg);
    return true;
  }

  appendAgentThought(id: string, text: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.parts) msg.parts = [];
    const last = msg.parts[msg.parts.length - 1];
    // A completed message can receive its final thought chunks after the
    // prompt result. Extend a trailing span when possible; otherwise start a
    // frozen span because another event may never arrive to finish it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
    if (
      last &&
      last.kind === "thought" &&
      (last.durationMs === undefined || msg.turnStopReason !== undefined)
    ) {
      last.text += text;
      if (msg.turnStopReason !== undefined && last.startedAtMs !== undefined) {
        last.durationMs = Math.max(0, Date.now() - last.startedAtMs);
      }
    } else {
      const startedAtMs = Date.now();
      msg.parts.push({
        kind: "thought",
        text,
        startedAtMs,
        ...(msg.turnStopReason !== undefined ? { durationMs: 0 } : {}),
      });
    }
    this.touch(msg);
    return true;
  }

  upsertAgentPart(id: string, part: AgentMessagePart): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.parts) msg.parts = [];
    const partId = agentPartId(part);
    if (partId !== undefined) {
      const idx = msg.parts.findIndex((p) => agentPartId(p) === partId);
      if (idx !== -1) {
        // A fresh plan snapshot can replace its earlier singleton while still
        // ending the reasoning block at the live edge.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
        const finishedThought = part.kind === "plan" && this.finishTrailingThought(msg);
        if (partsEqual(msg.parts[idx], part)) {
          if (finishedThought) this.touch(msg);
          return finishedThought;
        }
        msg.parts[idx] = part;
        this.touch(msg);
        return true;
      }
    }
    this.finishTrailingThought(msg);
    msg.parts.push(part);
    this.touch(msg);
    return true;
  }

  // A spinner must not outlive the turn that started it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/633
  settleOpenCompactions(id: string, status: "cancelled" | "failed" = "cancelled"): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg?.parts?.some((p) => p.kind === "compaction" && p.status === "in_progress")) {
      return false;
    }
    msg.parts = msg.parts.map((p) =>
      p.kind === "compaction" && p.status === "in_progress" ? { ...p, status } : p
    );
    this.touch(msg);
    return true;
  }

  findMessageIdWithToolCall(toolCallId: string): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.parts?.some((p) => p.kind === "tool_call" && p.id === toolCallId)) return msg.id;
    }
    return undefined;
  }

  markMessageError(id: string, errorText: string, durationMs?: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    this.finishTrailingThought(msg);
    msg.isErrorMessage = true;
    if (durationMs !== undefined) msg.turnDurationMs = Math.max(0, durationMs);
    const suffix = msg.displayText.length > 0 ? "\n\n" : "";
    msg.displayText += `${suffix}**Error:** ${errorText}`;
    this.touch(msg);
    return true;
  }

  hasAssistantActivity(id: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (msg.displayText.trim().length > 0) return true;
    return (msg.parts ?? []).some((part) => {
      if (part.kind === "text" || part.kind === "thought") {
        return part.text.trim().length > 0;
      }
      return true;
    });
  }

  deleteMessage(id: string): boolean {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.messages.splice(idx, 1);
    this.displayCache.delete(id);
    this.lastDisplay = null;
    return true;
  }

  clear(): void {
    this.messages = [];
    this.displayCache.clear();
    this.lastDisplay = null;
  }

  truncateAfterMessageId(messageId: string): void {
    const idx = this.messages.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      for (const dropped of this.messages.slice(idx + 1)) {
        this.displayCache.delete(dropped.id);
      }
      this.messages = this.messages.slice(0, idx + 1);
      this.lastDisplay = null;
    }
  }

  getDisplayMessages(): AgentChatMessage[] {
    if (this.lastDisplay !== null) return this.lastDisplay;
    const display = this.messages.filter((m) => m.isVisible).map((m) => this.adaptCached(m));
    this.lastDisplay = display;
    return display;
  }

  getMessage(id: string): AgentChatMessage | undefined {
    const msg = this.messages.find((m) => m.id === id);
    return msg ? this.adaptCached(msg) : undefined;
  }

  private adaptCached(m: StoredAgentMessage): AgentChatMessage {
    const cached = this.displayCache.get(m.id);
    if (cached && cached.version === m.version) return cached.view;
    const view = this.toAgentChatMessage(m);
    this.displayCache.set(m.id, { version: m.version, view });
    return view;
  }

  loadMessages(messages: AgentChatMessage[]): void {
    this.clear();
    for (const msg of messages) {
      const fanout =
        msg.sender === USER_SENDER ? undefined : (parseFanoutComposite(msg.message) ?? undefined);
      this.messages.push({
        id: msg.id || this.generateId(),
        displayText: msg.message,
        sender: msg.sender,
        timestamp: msg.timestamp,
        context: msg.context,
        isVisible: msg.isVisible !== false,
        isErrorMessage: msg.isErrorMessage,
        isAuxiliary: msg.isAuxiliary,
        content: msg.content,
        parts: msg.parts,
        turnStopReason: msg.turnStopReason,
        turnDurationMs: msg.turnDurationMs,
        fanout,
        version: 0,
      });
    }
    logInfo(`[AgentMessageStore] Loaded ${messages.length} messages`);
  }

  // The display projection is authoritative for the loaded conversation, so one batch replaces
  // the visible window without rebuilding a view whose content did not change; a projection that
  // omits UI-only facts keeps the displayed context/timestamp instead of erasing them:
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  replaceMessages(messages: readonly AgentChatMessage[]): boolean {
    const keep = new Set<string>();
    const existingById = new Map(this.messages.map((message) => [message.id, message]));
    const next: StoredAgentMessage[] = [];
    for (const message of messages) {
      const id = message.id || this.generateId();
      keep.add(id);
      const existing = existingById.get(id);
      const candidate = this.fromProjection({ ...message, id }, existing);
      if (existing !== undefined && sameStoredMessage(existing, candidate)) {
        next.push(existing);
        continue;
      }
      if (existing !== undefined) candidate.version = existing.version + 1;
      next.push(candidate);
    }
    const changed =
      next.length !== this.messages.length ||
      next.some((message, index) => message !== this.messages[index]);
    if (!changed) return false;
    for (const id of [...this.displayCache.keys()]) {
      if (!keep.has(id)) this.displayCache.delete(id);
    }
    this.messages = next;
    this.lastDisplay = null;
    return true;
  }

  prependMessages(messages: readonly AgentChatMessage[]): boolean {
    const known = new Set(this.messages.map((message) => message.id));
    const older: StoredAgentMessage[] = [];
    for (const message of messages) {
      if (!message.id || known.has(message.id)) continue;
      known.add(message.id);
      older.push(this.fromProjection(message, undefined));
    }
    if (older.length === 0) return false;
    this.messages = [...older, ...this.messages];
    this.lastDisplay = null;
    return true;
  }

  private fromProjection(
    message: AgentChatMessage,
    existing: StoredAgentMessage | undefined
  ): StoredAgentMessage {
    const fanout =
      message.fanout ??
      (message.sender === USER_SENDER
        ? undefined
        : (parseFanoutComposite(message.message) ?? undefined));
    return {
      id: message.id || this.generateId(),
      displayText: message.message,
      sender: message.sender,
      timestamp: message.timestamp ?? existing?.timestamp ?? null,
      isVisible: message.isVisible !== false,
      isErrorMessage: message.isErrorMessage,
      isAuxiliary: message.isAuxiliary,
      content: projectedArray(message.content, existing?.content),
      parts: projectedArray(message.parts, existing?.parts),
      context: message.context ?? existing?.context,
      turnStopReason: message.turnStopReason ?? existing?.turnStopReason,
      turnDurationMs: message.turnDurationMs ?? existing?.turnDurationMs,
      turnUsage: message.turnUsage ?? existing?.turnUsage,
      turnEndEntryId: message.turnEndEntryId ?? existing?.turnEndEntryId,
      fanout: fanout ?? existing?.fanout,
      fileChanges: projectedArray(message.fileChanges, existing?.fileChanges),
      version: existing?.version ?? 0,
    };
  }

  private toAgentChatMessage(m: StoredAgentMessage): AgentChatMessage {
    return {
      id: m.id,
      // 实时保存恢复检查点，避免退出前仅正文终态尚未写入。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      message: m.fanout?.checkpoint
        ? serializeFanoutComposite(m.fanout, (id) => id)
        : m.displayText,
      sender: m.sender,
      timestamp: m.timestamp,
      isVisible: m.isVisible,
      context: m.context,
      isErrorMessage: m.isErrorMessage,
      isAuxiliary: m.isAuxiliary,
      content: m.content,
      parts: m.parts,
      turnStopReason: m.turnStopReason,
      turnDurationMs: m.turnDurationMs,
      turnUsage: m.turnUsage,
      turnEndEntryId: m.turnEndEntryId,
      fileChanges: m.fileChanges,
      ...(m.fanout ? { fanout: snapshotFanoutTurn(m.fanout) } : {}),
    };
  }
}
