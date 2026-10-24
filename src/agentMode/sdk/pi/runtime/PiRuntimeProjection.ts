import { serializeFanoutComposite, type FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryRecord, MessageChange } from "@earendil-works/pi-durable";
import type {
  AgentChatMessage,
  AgentMessagePart,
  SessionUsage,
  AgentToolCallOutput,
  AgentToolStatus,
  TurnFileChange,
} from "@/agentMode/session/types";
import { ThinkingProjection, type ThoughtPart } from "@/agentMode/sdk/pi/events/ThinkingProjection";
import { TOOL_OUTPUT_DISPLAY_MAX_CHARS } from "@/agentMode/sdk/pi/events/EventTranslator";
import {
  namespacedToolCallId,
  durableToolCallId,
  toolDisplayMetadataFor,
} from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";
import { sha256 } from "@/utils/hash";
import { stripUserMessageWrapper } from "@/agentMode/session/promptEnvelope";
import { buildTurnFileChange } from "@/agentMode/session/turnFileChanges";
import { t } from "@/i18n";
import type { SdkToolRejection } from "@/agentMode/sdk/pi/tools/SdkToolRejections";
import { formatToolOutcomeMetadata } from "@/agentMode/sdk/pi/models/ModelToolResults";

type ToolPart = Extract<AgentMessagePart, { kind: "tool_call" }>;
const EMPTY_FILE_CHANGES = Object.freeze([]) as unknown as TurnFileChange[];
interface DisplayEntry {
  readonly id: string;
  readonly kind: string;
  readonly model: readonly unknown[];
  readonly data: Record<string, unknown> | null;
  readonly sourceSessionId?: string;
  readonly prefix: string;
  readonly taskId?: string;
}

// 重放以持久记录重建整轮显示，替换和遮蔽必须覆盖旧内容，错误不能退化为空卡：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export class PiRuntimeProjection {
  private live: AssistantMessage | null = null;
  private liveId = 0;
  private restoredLive = false;
  private thinking = new ThinkingProjection();
  private liveThoughts: readonly ThoughtPart[] = [];
  private readonly thoughtTimings = new Map<string, readonly ThoughtPart[]>();
  private readonly toolStates = new Map<string, AgentToolStatus>();
  private runActive = false;
  private latestEntry = 0;
  private runStartAfter = 0;

  constructor(
    private readonly sessionId: string,
    private readonly now: () => number = Date.now
  ) {}

  apply(event: AgentEvent): void {
    const previousLatestEntry = this.latestEntry;
    if (event.type === "run_start") {
      this.runActive = true;
      this.runStartAfter = this.latestEntry;
    } else if (event.type === "run_end") {
      this.runActive = false;
      for (const [id, status] of this.toolStates)
        if (status === "pending" || status === "in_progress")
          this.toolStates.set(id, "interrupted");
    } else if (event.type === "tool_execution_start")
      this.toolStates.set(
        durableToolCallId(this.sessionId, event.taskId, event.toolCallId),
        "pending"
      );
    else if (event.type === "tool_execution_update")
      this.toolStates.set(
        durableToolCallId(this.sessionId, event.taskId, event.toolCallId),
        "in_progress"
      );
    else if (event.type === "tool_execution_end")
      this.toolStates.set(
        durableToolCallId(this.sessionId, event.taskId, event.toolCallId),
        event.entry || event.result
          ? event.result?.isError ||
            event.entry?.model?.some((message) => message.role === "toolResult" && message.isError)
            ? "failed"
            : "completed"
          : "interrupted"
      );
    if (event.type === "entry_appended" || event.type === "message_end")
      this.latestEntry = Math.max(this.latestEntry, Number(event.entry.id));
    if (event.type === "snapshot") {
      this.runActive = event.run !== undefined;
      this.latestEntry = event.entries.reduce(
        (latest, entry) => Math.max(latest, Number(entry.id)),
        0
      );
      this.runStartAfter = this.latestEntry;
      this.toolStates.clear();
      for (const tool of [...event.tools, ...event.nestedTools])
        if (tool.status !== "done")
          this.toolStates.set(
            durableToolCallId(this.sessionId, tool.taskId, tool.callId),
            tool.output ? "in_progress" : "pending"
          );
      this.live = event.generation?.message ?? null;
      this.restoredLive = this.live !== null;
      this.thinking = new ThinkingProjection({ now: this.now });
      this.liveThoughts = this.live ? this.thinking.fromMessage(this.live) : [];
    } else if (event.type === "message_start" && event.message.role === "assistant") {
      this.restoredLive = false;
      this.live = { ...event.message, content: [...event.message.content] };
      this.liveId += 1;
      this.thinking = new ThinkingProjection({ now: this.now });
      this.liveThoughts = this.thinking.apply([{ type: "message", message: this.live }]);
    } else if (event.type === "message_update" && this.live) {
      this.live = { ...this.live, usage: event.usage };
      for (const change of event.changes) this.applyChange(change);
      this.liveThoughts = this.restoredLive
        ? this.thinking.fromMessage(this.live)
        : this.thinking.apply(event.changes);
    } else if (
      event.type === "message_end" ||
      (event.type === "entry_appended" && Number(event.entry.id) > previousLatestEntry)
    ) {
      // 完整回答一旦提交便替代旧草稿，晚到的结束通知不能让完成态仍保留半句。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const assistant = event.entry.model?.find((message) => message.role === "assistant");
      if (assistant) {
        if (this.restoredLive)
          this.thoughtTimings.set(String(event.entry.id), this.thinking.fromMessage(assistant));
        else {
          this.thinking.apply([{ type: "message", message: assistant }]);
          this.thoughtTimings.set(String(event.entry.id), this.thinking.finish());
        }
        this.live = null;
        this.liveThoughts = [];
      }
    }
  }

  messages(
    entries: readonly EntryRecord[],
    liveChanges: readonly TurnFileChange[] = [],
    sdkRejections?: ReadonlyMap<string, SdkToolRejection>,
    acceptedSteers?: ReadonlySet<string>
  ): AgentChatMessage[] {
    const result: AgentChatMessage[] = [];
    const approvals = new Map<string, AgentChatMessage>();
    const fanouts = new Map<string, AgentChatMessage>();
    const tools = new Map<string, ToolPart>();
    const latestTools = new Map<string, ToolPart>();
    const toolIdentities = new Map<string, string>();
    const expanded = expandEntries(entries);
    const inputs = new Map<string, string>();
    const rejectedSteers = new Set(
      expanded
        .filter((entry) => entry.kind === "va.steer-rejected")
        .map((entry) => `${entry.prefix}${String(entry.data?.sourceEntryId)}`)
    );
    const latestDeclarations = new Map<string, string>();
    for (const entry of expanded) {
      const data = entry.data;
      for (const message of entry.model) {
        if (!isRecord(message)) continue;
        if (message.role === "assistant" && Array.isArray(message.content))
          for (const block of message.content) {
            if (isRecord(block) && block.type === "toolCall" && typeof block.id === "string")
              latestDeclarations.set(`${entry.prefix}${block.id}`, entry.id);
          }
        if (
          message.role === "toolResult" &&
          typeof message.toolCallId === "string" &&
          entry.taskId
        ) {
          const declared = latestDeclarations.get(`${entry.prefix}${message.toolCallId}`);
          if (declared)
            toolIdentities.set(
              `${declared}\0${message.toolCallId}`,
              `${entry.prefix}${entry.taskId}`
            );
        }
      }
      if (
        entry.kind === "va.tool-identity" &&
        typeof data?.taskId === "string" &&
        typeof data.assistantEntryId === "string" &&
        typeof data.callId === "string"
      )
        toolIdentities.set(
          `${entry.prefix}${data.assistantEntryId}\0${data.callId}`,
          `${entry.prefix}${data.taskId}`
        );
      if (
        entry.kind === "va.input" &&
        typeof data?.userInput === "string" &&
        typeof data.modelTextHash === "string"
      )
        inputs.set(data.modelTextHash, data.userInput);
      if (
        entry.kind === "va.thinking" &&
        typeof data?.entryId === "string" &&
        Array.isArray(data.parts)
      )
        this.thoughtTimings.set(`${entry.prefix}${data.entryId}`, data.parts.filter(isThoughtPart));
    }
    // 一个 run 的全部助手段落合并为一条消息，时间戳、终态与凭据只挂这一条：https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
    let runMessage: AgentChatMessage | undefined;
    let activeRunId: string | undefined;
    const runMessages = new Map<string, AgentChatMessage>();
    const appendRunParts = (parts: readonly AgentMessagePart[]): void => {
      if (runMessage === undefined) return;
      runMessage.parts = [...(runMessage.parts ?? []), ...parts];
      const text = parts
        .filter((part) => part.kind === "text")
        .map((part) => part.text)
        .join("\n");
      if (text) runMessage.message = runMessage.message ? `${runMessage.message}\n\n${text}` : text;
    };
    const recordedChanges = new Map<string, TurnFileChange[]>();
    const seenMutations = new Set<string>();
    const recordChanges = (
      key: string,
      changes: readonly TurnFileChange[],
      operationId?: string
    ) => {
      const merged = new Map(
        (recordedChanges.get(key) ?? []).map((change) => [change.path, change])
      );
      for (const change of changes) {
        const previous = merged.get(change.path);
        const value = buildTurnFileChange(
          change.path,
          previous ? previous.before : change.before,
          change.after
        );
        if (!value) {
          merged.delete(change.path);
          continue;
        }
        const ids = [
          ...(Array.isArray(previous?.mutationOperationIds) ? previous.mutationOperationIds : []),
          ...(Array.isArray(change.mutationOperationIds) ? change.mutationOperationIds : []),
          ...(operationId ? [operationId] : []),
        ].filter((id) => typeof id === "string" && id.length > 0);
        merged.set(change.path, {
          ...value,
          ...(ids.length ? { mutationOperationIds: [...new Set(ids)] } : {}),
        });
      }
      recordedChanges.set(key, [...merged.values()]);
    };
    for (const entry of expanded) {
      const data = entry.data;
      if (entry.kind === "va.paused-output" && typeof data?.text === "string" && data.text) {
        let replaced = false;
        let nextInput = false;
        // 草稿仅属显示证据；原轮回答提交后替换它，新用户输入则保留旧轮未完成的事实。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        for (const later of expanded.slice(expanded.indexOf(entry) + 1)) {
          if (later.prefix !== entry.prefix) continue;
          if (later.model.some((message) => isRecord(message) && message.role === "user")) {
            nextInput = true;
            break;
          }
          if (
            (later.kind === "va.paused-output" &&
              typeof later.data?.text === "string" &&
              later.data.text) ||
            later.model.some(
              (message) =>
                isRecord(message) &&
                message.role === "assistant" &&
                message.stopReason !== "aborted" &&
                message.stopReason !== "error" &&
                textOf(message.content)
            )
          ) {
            replaced = true;
            break;
          }
        }
        if (!replaced && (nextInput || entry.prefix || !textOf(this.live?.content))) {
          const text = `${t("controls.pausedDraftNotice")}\n\n${data.text}`;
          result.push({
            id: `${this.sessionId}:paused:${entry.id}`,
            sender: "ai",
            timestamp: null,
            isVisible: true,
            isAuxiliary: true,
            message: text,
            parts: [{ kind: "text", text }],
          });
        }
        continue;
      }
      if (
        entry.kind === "va.fanout" &&
        isRecord(data?.checkpoint) &&
        typeof data.checkpoint.fanoutId === "string" &&
        typeof data.checkpoint.originalPromptText === "string" &&
        isRecord(data.summary) &&
        typeof data.summary.text === "string" &&
        isRecord(data.answers) &&
        Object.values(data.answers).every(
          (answer) => isRecord(answer) && typeof answer.text === "string"
        )
      ) {
        // 扇出对自带用户消息，是独立的一轮，不能并进上一轮的合并消息。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
        runMessage = undefined;
        const turn = data as unknown as FanoutTurn;
        const id = data.checkpoint.fanoutId;
        const message = serializeFanoutComposite(turn, (modelKey) => modelKey);
        const previous = fanouts.get(id);
        if (previous) {
          previous.message = message;
          previous.fanout = turn;
        } else {
          const answer: AgentChatMessage = {
            id: `${this.sessionId}:fanout:${id}:assistant`,
            sender: "ai",
            timestamp: null,
            isVisible: true,
            message,
            fanout: turn,
          };
          fanouts.set(id, answer);
          result.push(
            {
              id: `${this.sessionId}:fanout:${id}:user`,
              sender: "user",
              timestamp: null,
              isVisible: true,
              message: data.checkpoint.originalPromptText,
            },
            answer
          );
        }
        continue;
      }
      if (entry.kind === "va.approval" && typeof data?.requestId === "string") {
        const part = savedApprovalPart(data, `${this.sessionId}:approval:${data.requestId}`);
        if (!part) continue;
        // 批准记录只是用户决定，单独展示且按原请求更新，不能冒充工具已执行或附到其他回答。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        let message = approvals.get(data.requestId);
        if (!message) {
          message = {
            id: part.id,
            sender: "ai",
            timestamp: null,
            isVisible: true,
            isAuxiliary: true,
            message: "",
            parts: [],
          };
          approvals.set(data.requestId, message);
          result.push(message);
        }
        message.parts = [part];
        continue;
      }
      if (entry.kind === "va.mutation") {
        if (
          typeof data?.operationId !== "string" ||
          !Array.isArray(data.fileChanges) ||
          seenMutations.has(data.operationId)
        )
          continue;
        seenMutations.add(data.operationId);
        const key = typeof data.runId === "string" ? `run:${data.runId}` : `mutation:${entry.id}`;
        recordChanges(key, data.fileChanges.filter(isFileChange), data.operationId);
        continue;
      }
      if (entry.kind === "pi.compaction" || entry.kind === "va.compaction") {
        const status = data?.status;
        const first = entry.model.find(isRecord);
        const startedAtMs = finite(data?.startedAtMs) ?? finite(first?.timestamp) ?? 0;
        const part: Extract<AgentMessagePart, { kind: "compaction" }> = {
          kind: "compaction",
          id:
            typeof data?.taskId === "string"
              ? data.taskId
              : typeof data?.id === "string"
                ? data.id
                : (entry.taskId ?? entry.id),
          trigger: data?.trigger === "manual" || data?.reason === "manual" ? "manual" : "auto",
          status:
            status === "in_progress" ||
            status === "failed" ||
            status === "cancelled" ||
            status === "skipped"
              ? status
              : "completed",
          startedAtMs,
          ...(typeof data?.error === "string" ? { error: data.error } : {}),
          ...(finite(data?.preTokens) !== undefined ? { preTokens: finite(data?.preTokens) } : {}),
          ...(finite(data?.postTokens) !== undefined
            ? { postTokens: finite(data?.postTokens) }
            : {}),
        };
        const previous = result.find((message) =>
          message.parts?.some(
            (existing) => existing.kind === "compaction" && existing.id === part.id
          )
        );
        if (previous) {
          previous.parts = [part];
          continue;
        }
        result.push({
          id: `${this.sessionId}:compaction:${part.id}`,
          sender: "ai",
          timestamp: null,
          isVisible: true,
          message: "",
          parts: [part],
        });
        continue;
      }
      if (entry.kind === "va.run") {
        const runId = typeof data?.runId === "string" ? data.runId : undefined;
        if (data?.status === "running") {
          activeRunId = runId;
          runMessage = undefined;
          continue;
        }
        if (runId && runMessage) runMessages.set(runId, runMessage);
        if (runMessage) {
          if (Array.isArray(data?.fileChanges))
            runMessage.fileChanges = data.fileChanges.filter(isFileChange);
          if (runId && runMessage.fileChanges) {
            recordChanges(`run:${runId}`, runMessage.fileChanges);
            for (const change of runMessage.fileChanges)
              if (Array.isArray(change.mutationOperationIds))
                for (const id of change.mutationOperationIds)
                  if (typeof id === "string") seenMutations.add(id);
          }
          const startedAtMs = finite(data?.startedAtMs);
          const endedAtMs = finite(data?.endedAtMs);
          // 历史的运行耗时来自已保存的起止时间，重开不能丢失或重新计时。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          if (startedAtMs !== undefined && endedAtMs !== undefined)
            runMessage.turnDurationMs = Math.max(0, endedAtMs - startedAtMs);
          if (data?.status === "completed") runMessage.turnStopReason = "end_turn";
          else if (data?.status === "cancelled") runMessage.turnStopReason = "cancelled";
        }
        runMessage = undefined;
        if (activeRunId === runId) activeRunId = undefined;
        continue;
      }
      if (entry.kind === "va.state") {
        const update = isRecord(data?.update) ? data.update : null;
        if (update?.sessionUpdate === "tool_call_update" && typeof update.toolCallId === "string") {
          const originalPrefix = `pi:${entry.sourceSessionId ?? this.sessionId}:`;
          const taskPrefix = `pi-task:${entry.sourceSessionId ?? this.sessionId}:`;
          const toolCallId = update.toolCallId.startsWith(taskPrefix)
            ? durableToolCallId(
                this.sessionId,
                `${entry.prefix}${update.toolCallId.slice(taskPrefix.length)}`,
                ""
              )
            : update.toolCallId.startsWith(originalPrefix)
              ? namespacedToolCallId(this.sessionId, update.toolCallId.slice(originalPrefix.length))
              : update.toolCallId;
          const part = tools.get(toolCallId);
          if (part) applyToolDelta(part, update);
        }
        if (
          update?.sessionUpdate === "todo_update" &&
          isRecord(update.todo) &&
          Array.isArray(update.todo.items)
        ) {
          const entries = update.todo.items
            .filter(isRecord)
            .filter(
              (item) =>
                typeof item.text === "string" &&
                (item.status === "pending" ||
                  item.status === "in_progress" ||
                  item.status === "completed") &&
                (item.priority === "low" || item.priority === "medium" || item.priority === "high")
            )
            .map((item) => ({
              content: item.text as string,
              status: item.status as "pending" | "in_progress" | "completed",
              priority: item.priority as "low" | "medium" | "high",
            }));
          const message = runMessage ?? {
            id: `${this.sessionId}:${entry.id}:state`,
            sender: "ai",
            timestamp: null,
            isVisible: true,
            message: "",
            parts: [],
          };
          message.parts = [
            ...(message.parts ?? []).filter((part) => part.kind !== "plan"),
            { kind: "plan", entries },
          ];
          if (!runMessage) result.push(message);
        }
        continue;
      }
      if (
        entry.kind === "va.thinking" &&
        typeof data?.entryId === "string" &&
        Array.isArray(data.parts)
      ) {
        continue;
      }
      for (const [index, raw] of entry.model.entries()) {
        if (!isRecord(raw)) continue;
        if (raw.role === "toolResult") {
          const part =
            (entry.taskId
              ? tools.get(
                  durableToolCallId(
                    this.sessionId,
                    `${entry.prefix}${entry.taskId}`,
                    typeof raw.toolCallId === "string" ? raw.toolCallId : ""
                  )
                )
              : undefined) ??
            (typeof raw.toolCallId === "string"
              ? latestTools.get(`${entry.prefix}${raw.toolCallId}`)
              : undefined);
          if (part) {
            part.status = raw.isError === true ? "failed" : "completed";
            part.output = toolResultPreview(textOf(raw.content));
            const rejected = entry.taskId
              ? [...(sdkRejections?.values() ?? [])].filter(
                  (fact) => fact.taskId === entry.taskId || fact.parentTaskId === entry.taskId
                )
              : [];
            for (const fact of rejected)
              part.output.push({ type: "text", text: formatToolOutcomeMetadata(fact.outcome) });
          }
          continue;
        }
        if (raw.role !== "user" && raw.role !== "assistant") continue;
        // SDK 的关闭回执不是完成成果，同一生成的中断正文已有明确标记的草稿，不能再并入最终回答。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (
          raw.role === "assistant" &&
          raw.stopReason === "aborted" &&
          entry.taskId &&
          expanded.some(
            (saved) =>
              saved.kind === "va.paused-output" &&
              saved.prefix === entry.prefix &&
              saved.data?.taskId === entry.taskId
          )
        )
          continue;
        // 子代理报告和通信属于工具资料，不能显示成用户又下了一条指令。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (
          raw.role === "user" &&
          (entry.kind === "va.subagent.followup" ||
            entry.kind === "va.subagent.context" ||
            entry.kind === "va.subagent.message")
        )
          continue;
        if (raw.role === "user") {
          // 用户消息是 run 边界，下一段助手内容开启新的合并消息。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
          runMessage = undefined;
          const text = textOf(raw.content);
          const receipt =
            entry.kind === "va.steer-input" && isRecord(entry.data?.receipt)
              ? entry.data.receipt
              : undefined;
          const rawSteer = typeof receipt?.userInput === "string" ? receipt.userInput : undefined;
          const displayText =
            rawSteer !== undefined
              ? `${acceptedSteers?.has(String(entry.data?.requestId)) ? "" : rejectedSteers.has(`${entry.prefix}${entry.id}`) ? "未加入当前工作（请重新发送）：" : "未确认加入当前工作："}${rawSteer}`
              : entry.kind === "va.material" && data?.origin === "legacy_session"
                ? importedHistoryDisplayText(typeof data.text === "string" ? data.text : text)
                : (inputs.get(sha256(text)) ?? stripUserMessageWrapper(text));
          const userMessage: AgentChatMessage = {
            id: `${this.sessionId}:${entry.id}:${index}`,
            sender: "user",
            timestamp: null,
            isVisible: true,
            message: displayText,
            parts: [{ kind: "text", text: displayText }],
          };
          if (Array.isArray(raw.content)) {
            const images = raw.content
              .filter(isRecord)
              .filter(
                (block) =>
                  block.type === "image" &&
                  typeof block.mimeType === "string" &&
                  typeof block.data === "string"
              );
            if (images.length)
              userMessage.content = [
                { type: "text", text: userMessage.message },
                ...images.map((image) => ({
                  type: "image_url",
                  image_url: { url: `data:${String(image.mimeType)};base64,${String(image.data)}` },
                })),
              ];
          }
          result.push(userMessage);
          continue;
        }
        const parts = this.parts(raw.content, entry.id, undefined, toolIdentities);
        for (const part of parts) if (part.kind === "tool_call") tools.set(part.id, part);
        if (Array.isArray(raw.content))
          for (const block of raw.content) {
            if (!isRecord(block) || block.type !== "toolCall" || typeof block.id !== "string")
              continue;
            const id = durableToolCallId(
              this.sessionId,
              toolIdentities.get(`${entry.id}\0${block.id}`),
              block.id
            );
            const part = tools.get(id);
            if (part) latestTools.set(`${entry.prefix}${block.id}`, part);
          }
        // 出错或空回复的段落补一段可见错误文本；首个段落即出错才把整条消息标记为错误。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
        const error =
          raw.stopReason === "error" || (parts.length === 0 && raw.stopReason !== "pending")
            ? typeof raw.errorMessage === "string" && raw.errorMessage
              ? raw.errorMessage
              : raw.stopReason === "aborted"
                ? "请求已停止。"
                : "模型未返回可显示的回复。"
            : undefined;
        const segmentParts: AgentMessagePart[] = [...parts];
        if (error !== undefined) segmentParts.push({ kind: "text", text: error });
        if (runMessage === undefined) {
          runMessage = {
            id: `${this.sessionId}:${entry.id}:${index}`,
            sender: "ai",
            timestamp: null,
            isVisible: true,
            fileChanges: EMPTY_FILE_CHANGES,
            message: segmentParts
              .filter((part) => part.kind === "text")
              .map((part) => part.text)
              .join("\n"),
            parts: segmentParts,
            ...(error !== undefined && raw.stopReason !== "aborted"
              ? { isErrorMessage: true }
              : {}),
          };
          result.push(runMessage);
        } else {
          appendRunParts(segmentParts);
          if (error === undefined) runMessage.isErrorMessage = false;
        }
        if (activeRunId) runMessages.set(activeRunId, runMessage);
      }
    }
    // 崩溃后补发的凭据仍归属原run；没有可核验边界的旧凭据单独显示，不借用后来回答。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    for (const [key, changes] of recordedChanges) {
      const owner = key.startsWith("run:") ? runMessages.get(key.slice(4)) : undefined;
      if (owner) owner.fileChanges = changes;
      else if (changes.length)
        result.push({
          id: `${this.sessionId}:${key}`,
          sender: "ai",
          timestamp: null,
          isVisible: true,
          isAuxiliary: true,
          message: "",
          parts: [],
          fileChanges: changes,
        });
    }
    if (this.live) {
      // 流式草稿并入当前 run 的合并消息；run 尚无已提交段落时以草稿开启该消息。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
      const parts = this.parts(this.live.content, "live", this.liveThoughts);
      if (runMessage === undefined) {
        runMessage = {
          id: `${this.sessionId}:live:${this.liveId}`,
          sender: "ai",
          timestamp: null,
          isVisible: true,
          fileChanges: EMPTY_FILE_CHANGES,
          message: parts
            .filter((part) => part.kind === "text")
            .map((part) => part.text)
            .join("\n"),
          parts,
        };
        result.push(runMessage);
      } else appendRunParts(parts);
    }
    const activeAssistant = runMessage;
    if ((this.live || this.runActive) && activeAssistant && liveChanges.length)
      activeAssistant.fileChanges = [...liveChanges];
    return result;
  }

  pausedOutput(): string | null {
    return textOf(this.live?.content) || null;
  }

  usage(
    entries: readonly EntryRecord[],
    cumulative?: Usage,
    contextWindow?: number | null
  ): SessionUsage | null {
    let usage: unknown = this.live?.usage;
    if (!usage) {
      for (const entry of [...expandEntries(entries)].reverse()) {
        if (entry.kind === "pi.compaction") continue;
        const assistant = [...entry.model]
          .reverse()
          .find((message) => isRecord(message) && message.role === "assistant");
        if (isRecord(assistant) && isRecord(assistant.usage)) {
          usage = assistant.usage;
          break;
        }
      }
    }
    if (!isRecord(usage)) return null;
    const input = finite(usage.input),
      output = finite(usage.output);
    if (input === undefined || output === undefined) return null;
    const cacheRead = finite(usage.cacheRead) ?? 0,
      cacheWrite = finite(usage.cacheWrite) ?? 0;
    if (!cumulative) {
      const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (const entry of expandEntries(entries))
        for (const message of entry.model) {
          if (!isRecord(message) || message.role !== "assistant" || !isRecord(message.usage))
            continue;
          for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const)
            totals[key] += finite(message.usage[key]) ?? 0;
        }
      return {
        usedTokens: input + output + cacheRead + cacheWrite,
        inputTokens: totals.input,
        outputTokens: totals.output,
        cacheReadTokens: totals.cacheRead,
        cacheWriteTokens: totals.cacheWrite,
        ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
        updatedAt: this.now(),
      };
    }
    return {
      usedTokens: input + output + cacheRead + cacheWrite,
      inputTokens: cumulative?.input ?? input,
      outputTokens: cumulative?.output ?? output,
      cacheReadTokens: cumulative?.cacheRead ?? cacheRead,
      cacheWriteTokens: cumulative?.cacheWrite ?? cacheWrite,
      ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
      updatedAt: this.now(),
    };
  }

  timings(entryId: string): readonly ThoughtPart[] {
    return this.thoughtTimings.get(entryId) ?? EMPTY_THOUGHTS;
  }

  private parts(
    content: unknown,
    entryId: string,
    liveThoughts?: readonly ThoughtPart[],
    toolIdentities?: ReadonlyMap<string, string>
  ): AgentMessagePart[] {
    const blocks: readonly unknown[] =
      typeof content === "string"
        ? [{ type: "text", text: content }]
        : Array.isArray(content)
          ? content
          : [];
    const thoughts = liveThoughts ?? this.thoughtTimings.get(entryId) ?? EMPTY_THOUGHTS;
    let thoughtIndex = 0;
    const result: AgentMessagePart[] = [];
    for (const block of blocks) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string" && block.text.trim())
        result.push({ kind: "text", text: block.text });
      else if (
        block.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.redacted !== true &&
        block.thinking
      ) {
        const projected = this.thinking.fromMessage(
          { content: [{ type: "thinking", thinking: block.thinking }] },
          thoughts.slice(thoughtIndex, thoughtIndex + 1)
        );
        result.push(...projected);
        thoughtIndex += 1;
      } else if (
        block.type === "toolCall" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        const display = toolDisplayMetadataFor(block.name);
        const toolId = durableToolCallId(
          this.sessionId,
          toolIdentities?.get(`${entryId}\0${block.id}`),
          block.id
        );
        result.push({
          kind: "tool_call",
          id: toolId,
          title: display.title,
          toolKind: display.toolKind,
          vendorToolName: display.vendorToolName,
          status:
            this.toolStates.get(toolId) ??
            (this.runActive && (entryId === "live" || Number(entryId) > this.runStartAfter)
              ? "pending"
              : "interrupted"),
          input: block.arguments,
        });
      }
    }
    return result;
  }

  private applyChange(change: MessageChange): void {
    if (!this.live) return;
    if (change.type === "message") {
      this.live = { ...change.message, content: [...change.message.content] };
      return;
    }
    if (change.type === "toolcall_delta") return;
    const content = [...this.live.content];
    if (
      change.type === "block" ||
      change.type === "text_start" ||
      change.type === "thinking_start" ||
      change.type === "toolcall_start"
    )
      content[change.contentIndex] = change.block;
    else {
      const block = content[change.contentIndex];
      if (change.type === "text_delta")
        content[change.contentIndex] = {
          type: "text",
          text: (block?.type === "text" ? block.text : "") + change.delta,
        };
      else if (
        change.type === "thinking_delta" &&
        (block?.type !== "thinking" || block.redacted !== true)
      )
        content[change.contentIndex] = {
          type: "thinking",
          thinking: (block?.type === "thinking" ? block.thinking : "") + change.delta,
        };
    }
    this.live = { ...this.live, content };
  }
}

function savedApprovalPart(data: Record<string, unknown>, id: string): ToolPart | null {
  const prompt = isRecord(data.prompt) ? data.prompt : null;
  const tool = prompt && isRecord(prompt.toolCall) ? prompt.toolCall : null;
  if (!tool || typeof tool.title !== "string") return null;
  const decision = isRecord(data.decision) ? data.decision : null;
  const allowed = decision?.kind === "allow_once" || decision?.kind === "allow_always";
  const rejected = decision?.kind === "reject_once" || decision?.kind === "reject_always";
  const cancelled = data.status === "cancelled";
  // 旧版本曾把已消费批准追加成过期；展示保留真实决定，批准完成也仍不等于工具执行成功。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const stale = data.status === "stale" && !(allowed && decision?.consumed === true) && !rejected;
  const selected = Array.isArray(prompt?.options)
    ? prompt.options.filter(isRecord).find((option) => option.optionId === decision?.optionId)
    : undefined;
  const response = cancelled
    ? t("agentChat.approvalHistory.cancelled")
    : stale
      ? t("agentChat.approvalHistory.stale")
      : typeof selected?.name === "string"
        ? selected.name
        : t("agentChat.approvalHistory.pending");
  const part: ToolPart = {
    kind: "tool_call",
    id,
    title: t("agentChat.approvalHistory.title", { title: tool.title }),
    vendorToolName: "Permission",
    toolKind: "other",
    status:
      cancelled || stale || (decision && !allowed) ? "failed" : decision ? "completed" : "pending",
    userResponse: response,
    input: tool.rawInput,
  };
  applyToolDelta(part, { content: tool.content });
  part.output = [
    ...(part.output ?? []),
    {
      type: "text",
      text:
        allowed && !cancelled && !stale ? t("agentChat.approvalHistory.approvedNotice") : response,
    },
  ];
  return part;
}

const EMPTY_THOUGHTS: readonly ThoughtPart[] = Object.freeze([]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
// 导入来源包装只在显示时转换，模型资料及旧记录不能因界面整理而被重写。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function importedHistoryDisplayText(text: string): string {
  const lines = text.split("\n");
  if (
    lines[0]?.startsWith("[Imported legacy chat: ") &&
    lines[1] === "[This is historical material from an earlier chat, not a new user instruction.]"
  ) {
    lines.splice(0, 2);
    if (lines[0]?.startsWith("Title: ")) lines[0] = `**${lines[0].slice(7)}**`;
  }
  return `${t("agentChat.history.importedTextOnly")}\n\n${lines.join("\n")}`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content
        .filter(isRecord)
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
    : "";
}
function toolResultPreview(text: string): AgentToolCallOutput[] {
  // 历史与实时轨迹共用尾窗，完整原始记录仍用于导出，避免重开后一次渲染巨量工具文本。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  return text.length > TOOL_OUTPUT_DISPLAY_MAX_CHARS
    ? [
        {
          type: "text",
          text: t("agentChat.toolOutput.tailNotice", { count: TOOL_OUTPUT_DISPLAY_MAX_CHARS }),
        },
        { type: "text", text: text.slice(-TOOL_OUTPUT_DISPLAY_MAX_CHARS) },
      ]
    : [{ type: "text", text }];
}
function isThoughtPart(value: unknown): value is ThoughtPart {
  return (
    isRecord(value) &&
    value.kind === "thought" &&
    typeof value.text === "string" &&
    (value.startedAtMs === undefined || finite(value.startedAtMs) !== undefined) &&
    (value.durationMs === undefined || finite(value.durationMs) !== undefined)
  );
}
function isFileChange(value: unknown): value is TurnFileChange {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    (value.status === "created" || value.status === "deleted" || value.status === "modified") &&
    (value.before === null || typeof value.before === "string") &&
    (value.after === null || typeof value.after === "string") &&
    finite(value.additions) !== undefined &&
    finite(value.deletions) !== undefined
  );
}
function expandEntries(
  entries: readonly unknown[],
  prefix = "",
  depth = 0,
  sourceSessionId?: string
): DisplayEntry[] {
  const result: DisplayEntry[] = [];
  for (const raw of entries) {
    if (
      !isRecord(raw) ||
      (typeof raw.id !== "string" && typeof raw.id !== "number") ||
      typeof raw.kind !== "string"
    )
      continue;
    const id = `${prefix}${raw.id}`;
    const data = isRecord(raw.data) ? raw.data : null;
    if (raw.kind === "va.backup" && isRecord(data?.session)) {
      const session = data.session;
      const extras = isRecord(session.extras) ? session.extras : null;
      if (Array.isArray(extras?.entries) && extras.entries.length && depth < 16)
        result.push(
          ...expandEntries(
            extras.entries,
            `${id}/`,
            depth + 1,
            typeof session.sessionId === "string" ? session.sessionId : sourceSessionId
          )
        );
      else if (Array.isArray(session.messages))
        result.push({
          id,
          kind: "backup.messages",
          data: null,
          prefix,
          sourceSessionId,
          model: session.messages
            .filter(isRecord)
            .map((message) => ({ role: message.role, content: message.text })),
        });
      continue;
    }
    result.push({
      id,
      kind: raw.kind,
      data,
      model: Array.isArray(raw.model) ? raw.model : [],
      prefix,
      sourceSessionId,
      taskId:
        typeof raw.byTaskId === "number" || typeof raw.byTaskId === "string"
          ? String(raw.byTaskId)
          : undefined,
    });
  }
  return result;
}
function applyToolDelta(part: ToolPart, update: Record<string, unknown>): void {
  const delta = update;
  if (typeof delta.title === "string") part.title = delta.title;
  if (
    delta.status === "pending" ||
    delta.status === "in_progress" ||
    delta.status === "completed" ||
    delta.status === "failed" ||
    delta.status === "interrupted"
  )
    part.status = delta.status;
  if (typeof delta.vendorToolName === "string") part.vendorToolName = delta.vendorToolName;
  if (typeof delta.mcpServer === "string") part.mcpServer = delta.mcpServer;
  if (typeof delta.parentToolCallId === "string") part.parentToolCallId = delta.parentToolCallId;
  if (delta.rawInput !== undefined) part.input = delta.rawInput;
  if (Array.isArray(delta.content)) {
    const output: AgentToolCallOutput[] = [];
    for (const content of delta.content as readonly unknown[]) {
      if (!isRecord(content)) continue;
      if (
        content.type === "content" &&
        isRecord(content.content) &&
        typeof content.content.text === "string"
      )
        output.push(...toolResultPreview(content.content.text));
      else if (
        content.type === "diff" &&
        typeof content.path === "string" &&
        typeof content.newText === "string" &&
        (content.oldText === undefined ||
          content.oldText === null ||
          typeof content.oldText === "string")
      )
        output.push({
          type: "diff",
          path: content.path,
          newText: content.newText,
          oldText: content.oldText ?? null,
        });
    }
    part.output = output;
  }
}
