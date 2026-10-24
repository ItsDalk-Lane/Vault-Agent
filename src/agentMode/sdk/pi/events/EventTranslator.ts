import type {
  AgentEvent,
  MessageChange,
  NestedToolExecutionResult,
  SnapshotEvent,
  ToolDiagnostic,
} from "@earendil-works/pi-durable";
import type { AssistantMessage, Message, ToolCall, Usage } from "@earendil-works/pi-ai";

import type { AgentToolStatus, ToolCallDelta, ToolCallSnapshot } from "@/agentMode/session/types";
import {
  namespacedToolCallId,
  durableToolCallId,
  toolDisplayMetadataFor,
} from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";
import { t } from "@/i18n";

export const TOOL_OUTPUT_DISPLAY_MAX_CHARS = 256_000;

// The translator turns the real Durable AgentEvent union into normalized domain events and is
// the single producer for that stream: exhaustive over every event type, contentIndex blocks
// distinguish append from replacement, tool ids are session-namespaced with child ownership,
// and a tool end without an entry/result is interrupted, never completed:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type TranslatedEvent =
  | { readonly kind: "message_text"; readonly delta: string }
  | { readonly kind: "message_text_replace"; readonly text: string }
  | { readonly kind: "message_thinking"; readonly delta: string }
  | { readonly kind: "message_thinking_replace"; readonly text: string }
  | { readonly kind: "tool_call"; readonly tool: ToolCallSnapshot }
  | { readonly kind: "tool_call_update"; readonly delta: ToolCallDelta }
  | {
      readonly kind: "tool_call_end";
      readonly toolCallId: string;
      readonly status: Extract<AgentToolStatus, "completed" | "failed" | "interrupted">;
      readonly errorMessage?: string;
    }
  | {
      readonly kind: "run";
      readonly status: "running" | "completed" | "failed";
      readonly inputs: readonly string[];
    }
  | { readonly kind: "turn"; readonly phase: "start" | "end" }
  | {
      readonly kind: "retry";
      readonly phase: "start" | "end";
      readonly attempt: number;
      readonly errorMessage?: string;
    }
  | { readonly kind: "usage"; readonly usage: Usage }
  | {
      readonly kind: "submission";
      readonly id: string;
      readonly status: string;
      readonly reason?: string;
    }
  | { readonly kind: "inbox"; readonly count: number }
  | {
      readonly kind: "snapshot";
      readonly entries: number;
      readonly tools: number;
      readonly running: boolean;
    }
  | { readonly kind: "entry"; readonly entryId: string; readonly entryKind: string }
  | {
      readonly kind: "agent_changed";
      readonly modelId: string | null;
      readonly thinkingLevel: string | null;
    }
  | {
      readonly kind: "compaction";
      readonly phase: "start" | "end";
      readonly taskId: string;
      readonly reason: string;
      readonly error?: string;
    }
  | { readonly kind: "task_failed"; readonly kindName: string; readonly message: string }
  | { readonly kind: "deferred"; readonly pollAt: number };

export type EventTranslatorErrorCode = "UNKNOWN_EVENT";

export class EventTranslatorError extends Error {
  readonly code: EventTranslatorErrorCode;

  constructor(code: EventTranslatorErrorCode, message: string) {
    super(message);
    this.name = "EventTranslatorError";
    this.code = code;
  }
}

export interface EventTranslatorOptions {
  readonly sessionId: string;
  readonly emit: (event: TranslatedEvent) => void;
  readonly now?: () => number;
  /** Resolves MCP attribution so an MCP tool named "Agent" is not rendered as a subagent.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  readonly mcpServerFor?: (toolName: string) => string | undefined;
}

interface TextBlockState {
  readonly kind: "text" | "thinking";
  text: string;
}

interface ToolCallState {
  readonly kind: "tool";
  readonly toolCallId: string;
  readonly parentToolCallId?: string;
  readonly toolName: string;
  readonly rawInput: Record<string, unknown>;
  readonly partialByPath: Map<string, string>;
  status: AgentToolStatus;
  output: string;
  outputDropped: number;
}

type BlockState = TextBlockState | ToolCallState;

export function assertNeverAgentEvent(event: never): never {
  throw new EventTranslatorError(
    "UNKNOWN_EVENT",
    `The Durable agent event is not part of the known union: ${JSON.stringify(event)}`
  );
}

function isAssistantMessage(message: Message | undefined): message is AssistantMessage {
  return message?.role === "assistant";
}

function isTextBlock(
  block: AssistantMessage["content"][number]
): block is { type: "text"; text: string } {
  return block.type === "text";
}

function isThinkingBlock(
  block: AssistantMessage["content"][number]
): block is { type: "thinking"; thinking: string } {
  return block.type === "thinking";
}

function isToolCallBlock(block: AssistantMessage["content"][number]): block is ToolCall {
  return block.type === "toolCall";
}

function errorDiagnostic(diagnostics: readonly ToolDiagnostic[] | undefined): string | undefined {
  return diagnostics?.find((diagnostic) => diagnostic.severity === "error")?.message;
}

export class EventTranslator {
  private readonly sessionId: string;
  private readonly emitEvent: (event: TranslatedEvent) => void;
  private readonly mcpServerFor: ((toolName: string) => string | undefined) | undefined;
  private readonly blocks = new Map<number, BlockState>();
  private readonly tools = new Map<string, ToolCallState>();
  private runInputs: readonly string[] = Object.freeze([]);
  private runFailed = false;
  private message: AssistantMessage | null = null;

  constructor(options: EventTranslatorOptions) {
    this.sessionId = options.sessionId;
    this.emitEvent = options.emit;
    this.mcpServerFor = options.mcpServerFor;
    void options.now;
  }

  translate(event: AgentEvent): void {
    switch (event.type) {
      case "snapshot":
        this.applySnapshot(event);
        return;
      case "run_start":
        this.runInputs = event.inputs.map(String);
        this.runFailed = false;
        this.emit({ kind: "run", status: "running", inputs: this.runInputs });
        return;
      case "run_end":
        this.emit({
          kind: "run",
          status: this.runFailed ? "failed" : "completed",
          inputs: this.runInputs,
        });
        this.runFailed = false;
        return;
      case "turn_start":
        this.emit({ kind: "turn", phase: "start" });
        return;
      case "turn_end":
        this.emit({ kind: "turn", phase: "end" });
        return;
      case "message_start":
        this.startMessage(event.message);
        return;
      case "message_update":
        this.applyChanges(event.changes);
        return;
      case "message_end":
        this.endMessage(String(event.entry.id), event.entry.kind, event.entry.model);
        return;
      case "tool_execution_start":
        this.startTool(event);
        return;
      case "tool_execution_update":
        this.updateTool(event);
        return;
      case "tool_execution_end":
        this.endTool(event);
        return;
      case "inbox_update":
        this.emit({ kind: "inbox", count: event.items.length });
        return;
      case "submission":
        this.emit({
          kind: "submission",
          id: String(event.record.id),
          status: event.record.status,
          reason: event.record.status === "unanswered" ? event.record.reason : undefined,
        });
        return;
      case "auto_retry_start":
        this.emit({
          kind: "retry",
          phase: "start",
          attempt: event.attempt,
          errorMessage: event.errorMessage,
        });
        return;
      case "auto_retry_end":
        this.emit({ kind: "retry", phase: "end", attempt: event.attempt });
        return;
      case "deferred_poll":
        this.emit({ kind: "deferred", pollAt: event.pollAt });
        return;
      case "entry_appended":
        this.emit({ kind: "entry", entryId: String(event.entry.id), entryKind: event.entry.kind });
        return;
      case "agent_changed":
        this.emit({
          kind: "agent_changed",
          modelId: event.agent.model?.modelId ?? null,
          thinkingLevel: event.agent.thinkingLevel ?? null,
        });
        return;
      case "usage_changed":
        this.emit({ kind: "usage", usage: aggregateUsageState(event.usage) });
        return;
      case "task_failed":
        this.runFailed = true;
        this.emit({ kind: "task_failed", kindName: event.kind, message: event.message });
        return;
      case "compaction_start":
        this.emit({
          kind: "compaction",
          phase: "start",
          taskId: String(event.taskId),
          reason: event.reason,
        });
        return;
      case "compaction_end":
        this.emit({
          kind: "compaction",
          phase: "end",
          taskId: String(event.taskId),
          reason: event.reason,
          error: event.error,
        });
        return;
      default:
        return assertNeverAgentEvent(event);
    }
  }

  currentText(): string {
    return [...this.blocks.values()]
      .filter((block): block is TextBlockState => block.kind === "text")
      .map((block) => block.text)
      .join("");
  }

  currentThinking(): string {
    return [...this.blocks.values()]
      .filter((block): block is TextBlockState => block.kind === "thinking")
      .map((block) => block.text)
      .join("");
  }

  toolStatus(toolCallId: string): AgentToolStatus | null {
    return this.tools.get(toolCallId)?.status ?? null;
  }

  private startMessage(message: Message): void {
    this.blocks.clear();
    this.tools.clear();
    if (!isAssistantMessage(message)) {
      this.message = null;
      return;
    }
    this.message = message;
    message.content.forEach((block, index) => {
      this.initializeBlock(index, block);
    });
  }

  private initializeBlock(index: number, block: AssistantMessage["content"][number]): void {
    if (isTextBlock(block)) {
      this.blocks.set(index, { kind: "text", text: block.text });
      if (block.text.length > 0) this.emit({ kind: "message_text_replace", text: block.text });
      return;
    }
    if (isThinkingBlock(block)) {
      this.blocks.set(index, { kind: "thinking", text: block.thinking });
      if (block.thinking.length > 0) {
        this.emit({ kind: "message_thinking_replace", text: block.thinking });
      }
      return;
    }
    if (isToolCallBlock(block)) {
      this.registerToolCall(block.id, block.name, undefined, block.arguments);
    }
  }

  private applyChanges(changes: readonly MessageChange[]): void {
    for (const change of changes) {
      switch (change.type) {
        case "text_start":
          if (isTextBlock(change.block)) {
            this.blocks.set(change.contentIndex, { kind: "text", text: change.block.text });
          }
          break;
        case "thinking_start":
          if (isThinkingBlock(change.block)) {
            this.blocks.set(change.contentIndex, {
              kind: "thinking",
              text: change.block.thinking,
            });
          }
          break;
        case "toolcall_start":
          if (isToolCallBlock(change.block)) {
            this.blocks.set(
              change.contentIndex,
              this.registerToolCall(
                change.block.id,
                change.block.name,
                undefined,
                change.block.arguments
              )
            );
          }
          break;
        case "text_delta":
          this.appendText(change.contentIndex, change.delta);
          break;
        case "thinking_delta":
          this.appendThinking(change.contentIndex, change.delta);
          break;
        case "toolcall_delta":
          this.appendToolArguments(change.contentIndex, change.path, change.delta);
          break;
        case "block":
          this.replaceBlock(change.contentIndex, change.block);
          break;
        case "message":
          this.replaceWholeMessage(change.message);
          break;
        default:
          return assertNeverMessageChange(change);
      }
    }
  }

  private appendText(index: number, delta: string): void {
    const current = this.blocks.get(index);
    if (current?.kind === "text") {
      current.text += delta;
    } else {
      this.blocks.set(index, { kind: "text", text: delta });
    }
    this.emit({ kind: "message_text", delta });
  }

  private appendThinking(index: number, delta: string): void {
    const current = this.blocks.get(index);
    if (current?.kind === "thinking") {
      current.text += delta;
    } else {
      this.blocks.set(index, { kind: "thinking", text: delta });
    }
    this.emit({ kind: "message_thinking", delta });
  }

  private replaceBlock(index: number, block: AssistantMessage["content"][number]): void {
    if (isTextBlock(block)) {
      this.blocks.set(index, { kind: "text", text: block.text });
      this.emit({ kind: "message_text_replace", text: block.text });
      return;
    }
    if (isThinkingBlock(block)) {
      this.blocks.set(index, { kind: "thinking", text: block.thinking });
      this.emit({ kind: "message_thinking_replace", text: block.thinking });
      return;
    }
    if (isToolCallBlock(block)) {
      const registered = this.registerToolCall(block.id, block.name, undefined, block.arguments);
      this.emit({
        kind: "tool_call_update",
        delta: {
          toolCallId: registered.toolCallId,
          rawInput: block.arguments,
        },
      });
    }
  }

  private replaceWholeMessage(message: AssistantMessage): void {
    this.blocks.clear();
    this.message = message;
    const texts: string[] = [];
    const thinking: string[] = [];
    message.content.forEach((block, index) => {
      if (isTextBlock(block)) {
        this.blocks.set(index, { kind: "text", text: block.text });
        texts.push(block.text);
      }
      if (isThinkingBlock(block)) {
        this.blocks.set(index, { kind: "thinking", text: block.thinking });
        thinking.push(block.thinking);
      }
      if (isToolCallBlock(block)) {
        this.blocks.set(
          index,
          this.registerToolCall(block.id, block.name, undefined, block.arguments)
        );
        this.emit({
          kind: "tool_call_update",
          delta: {
            toolCallId: namespacedToolCallId(this.sessionId, block.id),
            rawInput: block.arguments,
          },
        });
      }
    });
    if (texts.length > 0) this.emit({ kind: "message_text_replace", text: texts.join("") });
    if (thinking.length > 0) {
      this.emit({ kind: "message_thinking_replace", text: thinking.join("") });
    }
  }

  private endMessage(
    entryId: string,
    entryKind: string,
    model: readonly Message[] | undefined
  ): void {
    const assistant = model?.find(isAssistantMessage);
    if (assistant) this.replaceWholeMessage(assistant);
    this.emit({ kind: "entry", entryId, entryKind });
  }

  private applySnapshot(snapshot: SnapshotEvent): void {
    this.blocks.clear();
    this.tools.clear();
    this.message = null;
    const generation = snapshot.generation?.message;
    if (generation) {
      this.message = generation;
      generation.content.forEach((block, index) => this.initializeBlock(index, block));
    }
    this.emit({
      kind: "snapshot",
      entries: snapshot.entries.length,
      tools: snapshot.tools.length,
      running: snapshot.run !== undefined,
    });
  }

  private registerToolCall(
    toolCallId: string,
    toolName: string,
    parentToolCallId: string | undefined,
    rawInput: Record<string, unknown>,
    taskId?: string | number,
    parentTaskId?: string | number
  ): ToolCallState {
    const namespaced = durableToolCallId(this.sessionId, taskId, toolCallId);
    const existing = this.tools.get(namespaced);
    if (existing) {
      Object.assign(existing.rawInput, rawInput);
      return existing;
    }
    const state: ToolCallState = {
      kind: "tool",
      toolCallId: namespaced,
      parentToolCallId: parentToolCallId
        ? durableToolCallId(this.sessionId, parentTaskId, parentToolCallId)
        : undefined,
      toolName,
      rawInput: { ...rawInput },
      partialByPath: new Map(),
      status: "pending",
      output: "",
      outputDropped: 0,
    };
    this.tools.set(namespaced, state);
    const display = toolDisplayMetadataFor(toolName, {
      mcpServer: this.mcpServerFor?.(toolName),
    });
    this.emit({
      kind: "tool_call",
      tool: {
        toolCallId: namespaced,
        title: display.title,
        kind: display.toolKind,
        status: "pending",
        rawInput: state.rawInput,
        vendorToolName: display.vendorToolName,
        ...(display.mcpServer !== undefined ? { mcpServer: display.mcpServer } : {}),
        parentToolCallId: state.parentToolCallId,
      },
    });
    return state;
  }

  private appendToolArguments(
    index: number,
    path: readonly (string | number)[],
    delta: string
  ): void {
    const block = this.blocks.get(index);
    if (!block || block.kind !== "tool") return;
    const key = path.map(String).join(".");
    const buffer = (block.partialByPath.get(key) ?? "") + delta;
    block.partialByPath.set(key, buffer);
    try {
      const value: unknown = JSON.parse(buffer);
      setByPath(block.rawInput, path, value);
      this.emit({
        kind: "tool_call_update",
        delta: { toolCallId: block.toolCallId, rawInput: cloneRecord(block.rawInput) },
      });
    } catch {
      // Partial JSON never becomes executable input; that boundary is recorded in https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    }
  }

  private startTool(event: Extract<AgentEvent, { type: "tool_execution_start" }>): void {
    const state = this.registerToolCall(
      event.toolCallId,
      event.toolName,
      event.parentToolCallId,
      event.args,
      event.taskId,
      event.parentTaskId
    );
    const block = [...this.blocks.values()].find(
      (candidate): candidate is ToolCallState =>
        candidate.kind === "tool" && candidate.toolCallId === state.toolCallId
    );
    if (block) Object.assign(block.rawInput, event.args);
  }

  private updateTool(event: Extract<AgentEvent, { type: "tool_execution_update" }>): void {
    const namespaced = durableToolCallId(this.sessionId, event.taskId, event.toolCallId);
    const state = this.tools.get(namespaced);
    if (!state || (state.status !== "pending" && state.status !== "in_progress")) return;
    if (event.output) {
      if ("set" in event.output) {
        state.output = event.output.set;
        state.outputDropped = 0;
      } else {
        if (event.output.trimStart !== undefined) {
          // SDK 的裁剪量包含本地已省略前缀，不能再从可见尾部重复扣除。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const visibleTrim = Math.max(0, event.output.trimStart - state.outputDropped);
          state.outputDropped = Math.max(0, state.outputDropped - event.output.trimStart);
          state.output = state.output.slice(visibleTrim);
        }
        if (event.output.append !== undefined) {
          state.output += event.output.append;
        }
      }
    }
    const excess = state.output.length - TOOL_OUTPUT_DISPLAY_MAX_CHARS;
    if (excess > 0) {
      state.output = state.output.slice(excess);
      state.outputDropped += excess;
    }
    state.status = "in_progress";
    this.emit({
      kind: "tool_call_update",
      delta: {
        toolCallId: namespaced,
        status: "in_progress",
        content: [
          ...(state.outputDropped > 0
            ? [
                {
                  type: "content" as const,
                  content: {
                    type: "text" as const,
                    text: t("agentChat.toolOutput.tailNotice", {
                      count: TOOL_OUTPUT_DISPLAY_MAX_CHARS,
                    }),
                  },
                },
              ]
            : []),
          { type: "content", content: { type: "text", text: state.output } },
        ],
      },
    });
  }

  private endTool(event: Extract<AgentEvent, { type: "tool_execution_end" }>): void {
    const namespaced = durableToolCallId(this.sessionId, event.taskId, event.toolCallId);
    const state = this.tools.get(namespaced);
    const result: NestedToolExecutionResult | undefined = event.result;
    const hasResult = event.entry !== undefined || result !== undefined;
    const resultIsError =
      result?.isError ??
      (event.entry?.model ?? []).some(
        (message) => message.role === "toolResult" && message.isError === true
      );
    const status: Extract<AgentToolStatus, "completed" | "failed" | "interrupted"> = hasResult
      ? resultIsError
        ? "failed"
        : "completed"
      : "interrupted";
    if (state) state.status = status;
    const diagnostics = result?.diagnostics;
    this.emit({
      kind: "tool_call_end",
      toolCallId: namespaced,
      status,
      errorMessage: status === "completed" ? undefined : errorDiagnostic(diagnostics),
    });
  }

  private emit(event: TranslatedEvent): void {
    this.emitEvent(event);
  }
}

function aggregateUsageState(state: {
  readonly models: Readonly<Record<string, unknown>>;
  readonly tools: Readonly<Record<string, unknown>>;
}): Usage {
  const total = emptyUsage();
  for (const bucket of [state.models, state.tools]) {
    for (const raw of Object.values(bucket)) {
      const usage = raw as Usage;
      total.input += usage.input;
      total.output += usage.output;
      total.cacheRead = (total.cacheRead ?? 0) + (usage.cacheRead ?? 0);
      total.cacheWrite = (total.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
      total.totalTokens += usage.totalTokens;
      total.cost.input += usage.cost.input;
      total.cost.output += usage.cost.output;
      total.cost.cacheRead += usage.cost.cacheRead ?? 0;
      total.cost.cacheWrite += usage.cost.cacheWrite ?? 0;
      total.cost.total += usage.cost.total;
    }
  }
  return total;
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

function setByPath(
  target: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown
): void {
  if (path.length === 0) return;
  let current: Record<string, unknown> = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = String(path[index]);
    const next = current[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (last !== undefined) current[String(last)] = value;
}

function assertNeverMessageChange(change: never): never {
  throw new EventTranslatorError(
    "UNKNOWN_EVENT",
    `The Durable message change is not part of the known union: ${JSON.stringify(change)}`
  );
}
