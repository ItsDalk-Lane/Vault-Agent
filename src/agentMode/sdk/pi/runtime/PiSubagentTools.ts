import { withToolOutcome, failedToolOutcome } from "@/agentMode/sdk/pi/tools/ToolResultOutcome";
import {
  compileHostToolDefinition,
  type HostToolDefinition,
} from "@/agentMode/sdk/pi/tools/HostToolDefinition";
import type { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import type { Context } from "@earendil-works/chord";
import type {
  Conversation,
  ConversationId,
  ConversationDocToken,
  EntryId,
  EntryRecord,
  Extension,
  Harness,
  JsonObject,
  TaskId,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
  Tx,
  AgentEventStream,
} from "@earendil-works/pi-durable";
import type { SessionUpdate, VaultAgentMode } from "@/agentMode/session/types";
import type { PiRuntimeModels } from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";
import type { RunBudget } from "@/agentMode/sdk/pi/runtime/RunBudget";
import type { PolicyCaller } from "@/agentMode/sdk/pi/policy/PolicyEngine";
import {
  DelegateTool,
  type DelegateSessionPort,
  type DelegateToolResult,
} from "@/agentMode/sdk/pi/features/subagents/DelegateTool";
import {
  validateSubagentRequest,
  subagentProfile,
  subagentProfileSchema,
  defaultEnabledProfiles,
  type SubagentProfileId,
} from "@/agentMode/sdk/pi/features/subagents/Profiles";
import {
  computeSubagentScope,
  type SubagentScope,
} from "@/agentMode/sdk/pi/features/subagents/SubagentScope";
import { SubagentInputBuilder } from "@/agentMode/sdk/pi/features/subagents/SubagentInput";
import {
  SubagentControlTools,
  type SubagentControlPort,
  type SubagentStatusView,
} from "@/agentMode/sdk/pi/features/subagents/SubagentControlTools";
import {
  SubagentScheduler,
  type SubagentDispatchResult,
} from "@/agentMode/sdk/pi/features/subagents/SubagentScheduler";
import {
  ReportDelivery,
  type ReportDeliveryRecord,
} from "@/agentMode/sdk/pi/features/subagents/ReportDelivery";
import { PathLockPool } from "@/agentMode/sdk/pi/tools/PathLockPool";
import { EventTranslator } from "@/agentMode/sdk/pi/events/EventTranslator";
import { durableToolCallId } from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";
import {
  acknowledgeSubagentMessage,
  appendSubagentMessage,
  canSendSubagentMessage,
  type SubagentMailboxState,
  type SubagentMessageEnvelope,
} from "@/agentMode/sdk/pi/features/subagents/SubagentMessages";

const SUBAGENT_ANCHOR_TASK = "va.subagent_anchor";
const SUBAGENT_REPORTER_TASK = "va.subagent_reporter";

export interface PiSubagentRun {
  readonly id: string;
  readonly budget: RunBudget;
  readonly signal: AbortSignal;
}

export interface PiSubagentToolsOptions {
  readonly harness: Harness;
  readonly conversation: Conversation;
  readonly sessionId: string;
  readonly models: PiRuntimeModels;
  readonly getModelKey: () => string | null;
  readonly getMode: () => VaultAgentMode;
  readonly getRun: () => PiSubagentRun | null;
  readonly resolveRun?: (runId: string) => Promise<PiSubagentRun>;
  readonly deliverReportContext?: (input: {
    readonly parentRunId: string;
    readonly parentToolCallId: string;
    readonly parentToolTaskId?: string;
    readonly text: string;
    readonly entryId: string;
    readonly childConversationId: string;
    readonly answerEntryId: string;
  }) => Promise<{ readonly delivered: boolean; readonly reason?: string }>;
  readonly emit: (update: SessionUpdate) => void;
  readonly isPathInScope?: (path: string) => boolean;
  readonly enabledProfiles?: () => readonly string[];
  readonly capabilities?: CapabilityCatalog;
  readonly canCommunicate?: (senderTaskId: string, recipientTaskId: string) => boolean;
}

export interface PiChildTask {
  readonly taskId: string;
  readonly parentRunId: string;
  readonly modelKey: string;
  readonly depth: number;
  readonly status: string;
}

export interface PiSubagentChild extends PiChildTask {
  readonly kind?: "subagent" | "fanout";
  readonly conversationId: string;
  readonly profileId: SubagentProfileId;
  readonly ownerTaskId: string;
  readonly parentConversationId: string;
  readonly parentToolCallId: string;
  readonly parentToolTaskId?: string;
  readonly background: boolean;
  readonly content: string;
  readonly roleInstructions?: string;
  readonly cwd?: string;
  readonly latestContent?: string;
  readonly latestRequestId?: string;
  readonly description: string;
  readonly scope: SubagentScope;
  readonly pathScope: readonly string[] | null;
  readonly outputPaths?: readonly string[];
  readonly startedAtMs: number;
  readonly answer?: string;
  readonly answerEntryId?: string;
  readonly reporterTaskId?: string;
  readonly reporterIds: readonly string[];
  readonly endedAtMs?: number;
}

export interface PiSubagentTools {
  readonly extension: Extension;
  readonly registrations: readonly ToolRegistration[];
  getModeForConversation(conversationId: string): VaultAgentMode;
  getCaller(conversationId: string): PolicyCaller;
  isReadOnly(conversationId: string): boolean;
  isPathInScope(path: string, conversationId?: string, access?: "read" | "write"): boolean;
  getInstructionContextForConversation(conversationId: string): {
    readonly roleInstructions: string;
    readonly profileId: string;
    readonly readOnly: boolean;
    readonly pathScope: readonly string[] | null;
    readonly outputPaths: readonly string[];
    readonly cwd?: string;
  } | null;
  getModelKeyForConversation(conversationId: string): string | null;
  getParentRunIdForConversation(conversationId: string): string | null;
  getChildTaskForConversation(conversationId: string): PiChildTask | null;
  readChildHistory(conversationId: string): Promise<readonly EntryRecord[]>;
  list(): Promise<readonly PiSubagentChild[]>;
  messages(): Promise<readonly SubagentMessageEnvelope[]>;
  sendMessage(input: {
    readonly senderConversationId: string;
    readonly recipientTaskId: string;
    readonly message: string;
    readonly messageId: string;
    readonly wake?: boolean;
  }): Promise<SubagentMessageEnvelope>;
  createReadOnlyCandidate(input: {
    readonly sessionId: string;
    readonly parentRunId: string;
    readonly modelKey: string;
    readonly cwd: string;
    readonly instructions?: string;
  }): Promise<{ readonly conversationId: string; readonly ownerTaskId: string }>;
  beginCandidateGroup(input: {
    readonly runId: string;
    readonly budget: RunBudget;
    readonly signal?: AbortSignal;
    readonly resume?: boolean;
  }): Promise<void>;
  stopCandidateGroup(runId: string): Promise<void>;
  setCandidateState(
    conversationId: string,
    status: "queued" | "running" | "completed" | "failed" | "cancelled",
    result?: { readonly answer?: string; readonly answerEntryId?: string }
  ): Promise<void>;
  runCandidate<T>(
    conversationId: string,
    action: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T>;
  wait(
    input: {
      readonly conversationId: string;
      readonly taskIds?: readonly string[];
      readonly afterSequence?: number;
      readonly timeoutMs?: number;
    },
    signal?: AbortSignal
  ): Promise<SubagentWaitResult>;
  stop(taskId: string): Promise<void>;
  beginRun(run: PiSubagentRun): Promise<void>;
  resume(taskId: string, options?: { readonly deferScheduling?: boolean }): Promise<void>;
  waitForBackground(): Promise<void>;
  stopAll(): Promise<void>;
  dispose(options?: { readonly preservePending?: boolean }): Promise<void>;
}

export interface SubagentWaitResult {
  readonly reason: "message" | "task" | "timeout" | "cancelled";
  readonly messages: readonly SubagentMessageEnvelope[];
  readonly tasks: readonly PiSubagentChild[];
}

interface SubagentState extends JsonObject {
  revision: number;
  children: JsonObject;
  commands: JsonObject;
  reports: JsonObject;
}

interface MailboxDocument extends JsonObject {
  messages: JsonObject;
  sequences: JsonObject;
  stoppedRuns: JsonObject;
  epoch: number;
  deliveries: JsonObject;
  stoppedTasks: JsonObject;
  groups: JsonObject;
}

interface ReporterInput extends JsonObject {
  childId: string;
  content: string;
  requestId: string;
  parentRunId: string;
  messageId: string | null;
}

interface MessageDeliveryInput extends JsonObject {
  messageId: string;
  conversationId: string;
  parentRunId: string;
}

type ReporterCheckpoint =
  | { phase: "deliver" }
  | { phase: "report"; answer: string; answerEntryId: string };

interface ScheduledWork {
  readonly execute: (signal: AbortSignal) => Promise<SubagentDispatchResult>;
}

const EMPTY_PATHS: readonly string[] = Object.freeze([]);
const EMPTY_CHILDREN: readonly PiSubagentChild[] = Object.freeze([]);

// 子会话和报告使用真实 Durable 任务保存拥有关系与检查点，重开只恢复状态，不能靠悬空 Promise 继续工作：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function createPiSubagentTools(
  options: PiSubagentToolsOptions
): Promise<PiSubagentTools> {
  const [
    {
      defineDoc,
      defineTask,
      defineExtension,
      configure,
      GenerationTask,
      hook,
      watchEvents,
      SessionFailed,
    },
    { BACKGROUND_CONTEXT, withAbortSignal },
  ] = await Promise.all([
    import("@earendil-works/pi-durable"),
    import("@earendil-works/chord/context"),
  ]);
  const rootId = String(options.conversation.id);
  const rootTaskId = `root:${rootId}`;
  const mailboxToken = defineDoc<MailboxDocument>({
    kind: "va.subagent.mailbox",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "initial",
    initial: () => ({
      messages: {},
      sequences: {},
      stoppedRuns: {},
      epoch: 0,
      deliveries: {},
      stoppedTasks: {},
      groups: {},
    }),
  });
  const token: ConversationDocToken<SubagentState> = defineDoc<SubagentState>({
    kind: "va.subagents",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "initial",
    initial: () => ({ revision: 0, children: {}, commands: {}, reports: {} }),
  });
  let children = new Map<string, PiSubagentChild>();
  let closed = false;
  const stoppedRuns = new Set<string>();
  const reportWaiters = new Map<string, number>();
  const stoppedTasks = new Set<string>();
  const runs = new Map<string, PiSubagentRun>();
  const candidateGroups = new Map<string, AbortController>();
  const openingCandidateGroups = new Map<string, Promise<void>>();
  const watches = new Map<string, AgentEventStream>();
  const work = new Map<string, ScheduledWork>();
  const childExecutions = new PathLockPool();
  const waits = new Set<() => void>();
  const encode = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject;
  const mailboxInTx = async (
    tx: Tx
  ): Promise<SubagentMailboxState & { stoppedTasks: Record<string, number> }> =>
    (await tx.doc(mailboxToken, options.conversation.id)) as unknown as SubagentMailboxState & {
      stoppedTasks: Record<string, number>;
    };
  const logicalTaskId = (conversationId: string): string =>
    conversationId === rootId ? rootTaskId : (children.get(conversationId)?.taskId ?? "");
  const messageForRun = async (
    child: PiSubagentChild,
    content: string,
    requestId: string,
    messageId = `${child.taskId}:${requestId}`
  ): Promise<SubagentMessageEnvelope> =>
    options.conversation.commit(async (tx) => {
      const mailbox = await mailboxInTx(tx);
      const existing = mailbox.messages[messageId];
      // 持久草稿只在事务内有效，重放已有消息时必须返回独立值，不能把已结束的草稿带入执行。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (existing) return encode(existing) as unknown as SubagentMessageEnvelope;
      return appendSubagentMessage(mailbox, {
        messageId,
        parentTaskId: logicalTaskId(child.parentConversationId),
        sender: logicalTaskId(child.parentConversationId),
        recipient: child.taskId,
        causationId: child.parentToolCallId,
        type: "instruction",
        payload: { text: content },
      }).message;
    }, BACKGROUND_CONTEXT);
  const refresh = async (): Promise<void> => {
    const state = await options.harness.snapshot(
      token,
      options.conversation.id,
      BACKGROUND_CONTEXT
    );
    children = new Map(
      Object.entries(state?.children ?? {}).map(([id, value]) => [
        id,
        value as unknown as PiSubagentChild,
      ])
    );
    const mailbox = await options.harness.snapshot(
      mailboxToken,
      options.conversation.id,
      BACKGROUND_CONTEXT
    );
    stoppedRuns.clear();
    for (const runId of Object.keys(mailbox?.stoppedRuns ?? {})) stoppedRuns.add(runId);
    stoppedTasks.clear();
    for (const taskId of Object.keys(mailbox?.stoppedTasks ?? {})) stoppedTasks.add(taskId);
  };
  const saveInTx = async (
    tx: Tx,
    child: PiSubagentChild,
    update?: SessionUpdate,
    advanceMessage = false
  ): Promise<void> => {
    const state = await tx.doc(token, options.conversation.id);
    const current = state.children[child.conversationId] as unknown as PiSubagentChild | undefined;
    // 运行中的旧消息也会更新状态，不能覆盖后来排队的消息或丢掉其持久化任务引用：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    state.children[child.conversationId] = encode({
      ...child,
      latestContent: advanceMessage
        ? child.latestContent
        : (current?.latestContent ?? child.latestContent),
      latestRequestId: advanceMessage
        ? child.latestRequestId
        : (current?.latestRequestId ?? child.latestRequestId),
      reporterIds: [...new Set([...(current?.reporterIds ?? []), ...child.reporterIds])],
    });
    state.revision += 1;
    await tx.appendEntry(options.conversation.id, {
      kind: "va.state",
      data: encode({
        docKind: "va.subagents",
        revision: state.revision,
        change: "updated",
        atMs: Date.now(),
        ...(update ? { update } : {}),
      }),
    });
  };
  const save = async (
    child: PiSubagentChild,
    update?: SessionUpdate,
    expectedRequestId?: string
  ): Promise<void> => {
    let applied = true;
    await options.conversation.commit(async (tx) => {
      if (expectedRequestId !== undefined) {
        const state = await tx.doc(token, options.conversation.id);
        const current = state.children[child.conversationId] as unknown as
          | PiSubagentChild
          | undefined;
        // 同一子助手的后续消息已排队时，旧请求只能保存自己的报告，不能把新请求的状态与答案标成完成。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (
          (current?.latestRequestId !== undefined &&
            current.latestRequestId !== expectedRequestId) ||
          current?.status === "cancelled" ||
          (closed && child.status !== "interrupted")
        ) {
          applied = false;
          return;
        }
      }
      await saveInTx(tx, child, update);
    }, BACKGROUND_CONTEXT);
    await refresh();
    if (
      update &&
      applied &&
      (expectedRequestId === undefined ||
        children.get(child.conversationId)?.latestRequestId === expectedRequestId)
    )
      options.emit(update);
  };
  await refresh();
  for (const child of children.values())
    if (child.status === "running" || child.status === "queued")
      await save({ ...child, status: "interrupted", endedAtMs: Date.now() });
  const requireRun = (): PiSubagentRun => {
    const run = options.getRun();
    if (closed || !run || run.signal.aborted || stoppedRuns.has(run.id))
      throw new Error("子任务需要一个仍有效的用户请求。");
    runs.set(run.id, run);
    return run;
  };
  // 后台子任务继续期间可能已有新的父请求，嵌套委派仍只能沿用原父请求，不能借用新请求的权限和预算：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const requireConversationRun = (id: string): PiSubagentRun => {
    if (id === rootId) return requireRun();
    const child = children.get(id);
    const run = child ? runs.get(child.parentRunId) : undefined;
    if (
      closed ||
      !run ||
      run.signal.aborted ||
      stoppedRuns.has(run.id) ||
      (child && stoppedTasks.has(child.taskId))
    )
      throw new Error("父请求已停止；需要用户明确继续。");
    return run;
  };
  const childByTask = (taskId: string): PiSubagentChild | undefined =>
    [...children.values()].find(
      (child) => child.taskId === taskId || child.conversationId === taskId
    );
  // 嵌套工具的编号属于父子会话的命名空间，状态更新必须指向同一张父工具卡：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const parentCardId = (child: PiSubagentChild): string =>
    durableToolCallId(
      child.parentConversationId === rootId
        ? options.sessionId
        : `${options.sessionId}:${child.parentConversationId}`,
      child.parentToolTaskId,
      child.parentToolCallId
    );
  const lifecycle = (child: PiSubagentChild): SessionUpdate => ({
    sessionUpdate: "tool_call_update",
    toolCallId: parentCardId(child),
    vendorToolName: "Agent",
    status:
      child.status === "completed"
        ? "completed"
        : child.status === "failed"
          ? "failed"
          : child.status === "cancelled" || child.status === "interrupted"
            ? "interrupted"
            : "in_progress",
    rawInput: {
      subagent_type: child.profileId,
      profileId: child.profileId,
      description: child.description,
      prompt: child.content,
      childConversationId: child.conversationId,
    },
    ...(child.answer
      ? { content: [{ type: "content", content: { type: "text", text: child.answer } }] }
      : {}),
  });
  const getReadOnly = (id: string): boolean => {
    if (id === rootId) return options.getMode() === "plan";
    const child = children.get(id);
    // 已创建任务不能保留被撤销的写作资格；下一模型快照与最终宿主入口都读取同一实时角色上限。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (
      !child ||
      !(options.enabledProfiles?.() ?? defaultEnabledProfiles()).includes(child.profileId)
    )
      return true;
    return !child.scope.effects.some(
      (effect) =>
        effect === "write" || effect === "create" || effect === "delete" || effect === "rename"
    );
  };
  const getMode = (id: string): VaultAgentMode =>
    id === rootId ? options.getMode() : getReadOnly(id) ? "plan" : options.getMode();
  const watchChild = async (child: PiSubagentChild): Promise<void> => {
    if (watches.has(child.conversationId)) return;
    const stream = await watchEvents(
      options.harness,
      Number(child.conversationId) as ConversationId,
      BACKGROUND_CONTEXT
    );
    watches.set(child.conversationId, stream);
    const parentToolCallId = parentCardId(child);
    const translator = new EventTranslator({
      sessionId: `${options.sessionId}:${child.conversationId}`,
      emit: (event) => {
        if (event.kind === "tool_call")
          options.emit({ sessionUpdate: "tool_call", ...event.tool, parentToolCallId });
        else if (event.kind === "tool_call_update")
          options.emit({ sessionUpdate: "tool_call_update", ...event.delta, parentToolCallId });
        else if (event.kind === "tool_call_end")
          options.emit({
            sessionUpdate: "tool_call_update",
            toolCallId: event.toolCallId,
            status: event.status,
            parentToolCallId,
          });
      },
    });
    stream.start(async (events) => {
      for (const event of events) translator.translate(event);
    });
  };
  const stopWatch = async (id: string): Promise<void> => {
    const stream = watches.get(id);
    watches.delete(id);
    await stream?.stop();
  };
  const scheduler = new SubagentScheduler({
    isPermissionRevoked: () => closed,
    dispatch: async ({ taskId, signal }) => {
      const operation = work.get(taskId);
      if (!operation) return { status: "failed" };
      return operation.execute(signal);
    },
  });
  const activeExecutions = new Map<string, string>();
  const scheduled = async <T>(
    taskId: string,
    child: PiSubagentChild,
    action: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    let finished = false;
    const abort = (): void => {
      void scheduler.cancel(taskId).then(() => {
        if (!finished) reject(new Error("子任务已取消。"));
      }, reject);
    };
    signal?.addEventListener("abort", abort, { once: true });
    work.set(taskId, {
      execute: async (scheduledSignal) => {
        try {
          activeExecutions.set(child.conversationId, taskId);
          const answer = await action(scheduledSignal);
          finished = true;
          resolve(answer);
          return { status: scheduledSignal.aborted || signal?.aborted ? "cancelled" : "completed" };
        } catch (error) {
          finished = true;
          reject(error);
          return { status: scheduledSignal.aborted || signal?.aborted ? "cancelled" : "failed" };
        } finally {
          if (activeExecutions.get(child.conversationId) === taskId)
            activeExecutions.delete(child.conversationId);
          work.delete(taskId);
        }
      },
    });
    const record = await scheduler.schedule({
      taskId,
      rootId,
      profileId: child.profileId,
      depth: child.depth,
    });
    if (record.state === "blocked" || record.state === "failed")
      reject(new Error("子任务未能进入执行，请核对权限和任务状态。"));
    else if (record.state === "cancelled" || signal?.aborted) abort();
    try {
      return await result;
    } finally {
      signal?.removeEventListener("abort", abort);
      work.delete(taskId);
    }
  };
  const modelEntry = (key: string) => {
    const model = options.models.catalog.readyModels.find(
      (entry) => entry.configuredModelId === key
    );
    // 模型不能靠猜配置键重试，未知选择需同时返回当前真实目录且不静默替换。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (!model)
      throw new Error(
        `所选子模型未配置或不可用。当前可选 modelKey：${options.models.catalog.readyModels.map((entry) => entry.configuredModelId).join(", ") || "无"}。`
      );
    return model;
  };
  const answerFrom = async (id: string): Promise<{ text: string; entryId: string }> => {
    const entry = await options.harness.commit(
      (tx) => tx.entry(Number(id) as EntryId),
      BACKGROUND_CONTEXT
    );
    const text = (entry?.model ?? [])
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        typeof message.content === "string"
          ? [message.content]
          : message.content
              .filter((block) => block.type === "text")
              .map((block) => (block.type === "text" ? block.text : ""))
      )
      .join("\n");
    return { text, entryId: id };
  };
  const runChild = async (
    child: PiSubagentChild,
    content: string,
    requestId: string,
    context: Context,
    messageId?: string
  ): Promise<{ text: string; entryId: string }> => {
    const run = runs.get(child.parentRunId);
    if (
      !run ||
      run.signal.aborted ||
      closed ||
      stoppedRuns.has(run.id) ||
      stoppedTasks.has(child.taskId)
    )
      throw new Error("父请求已停止；需要用户明确继续。");
    const message = await messageForRun(child, content, requestId, messageId);
    const running = { ...child, status: "running" };
    await save(running, lifecycle(running), requestId);
    await watchChild(running);
    const conversation = await options.harness.conversation(
      Number(child.conversationId) as ConversationId,
      context
    );
    if (!conversation) throw new Error("子会话不存在。");
    try {
      const submission = await conversation.submit(
        { type: "input", requestId, content, whenBusy: "followUp" },
        context
      );
      await options.conversation.commit(async (tx) => {
        acknowledgeSubagentMessage(await mailboxInTx(tx), message.messageId, {
          ack: "accepted",
          submissionId: String(submission.id),
        });
      }, context);
      const settled = await submission.wait(context);
      if (settled.type !== "input" || settled.status !== "done")
        throw new Error("子代理没有产生实际答案。");
      const answer = await answerFrom(String(settled.answer));
      if (!answer.text.trim()) throw new Error("子代理没有产生实际答案。");
      await options.conversation.commit(async (tx) => {
        acknowledgeSubagentMessage(await mailboxInTx(tx), message.messageId, {
          ack: "answered",
          answerEntryId: answer.entryId,
        });
      }, context);
      const latest = children.get(child.conversationId) ?? running;
      const completed = {
        ...latest,
        status: "completed",
        answer: answer.text,
        answerEntryId: answer.entryId,
        endedAtMs: Date.now(),
      };
      await save(completed, lifecycle(completed), requestId);
      return answer;
    } catch (error) {
      // 子请求失败也要保存终态，不能让实际已结束的任务永远显示为正在运行：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const latest = children.get(child.conversationId) ?? running;
      const failed = {
        ...latest,
        status: closed
          ? "interrupted"
          : context.abortSignal?.aborted || run.signal.aborted
            ? "cancelled"
            : "failed",
        endedAtMs: Date.now(),
      };
      await save(failed, lifecycle(failed), requestId);
      throw error;
    } finally {
      await stopWatch(child.conversationId);
    }
  };
  const makeContent = async (
    args: Record<string, unknown>,
    api: ToolExecutionApi,
    context: Context,
    modelKey: string
  ): Promise<string> => {
    const inputFiles = Array.isArray(args.inputFiles) ? (args.inputFiles as string[]) : [];
    const bundle = await new SubagentInputBuilder({
      contextWindowTokens: modelEntry(modelKey).contextWindow ?? 32_000,
      reader: {
        readFile: async ({ path: file }) => {
          let content = "";
          let startLine = 1;
          let cursor: string | undefined;
          for (;;) {
            const result = await api.executeTool(
              "vault_read",
              cursor ? { path: file, cursor } : { path: file, startLine, lineCount: 400 },
              context
            );
            if (result.isError || typeof result.structuredOutput !== "string") return undefined;
            const parsed = JSON.parse(result.structuredOutput) as {
              ok: boolean;
              value?: {
                content: string;
                truncated: boolean;
                nextStartLine?: number;
                nextCursor?: string;
              };
            };
            if (!parsed.ok || !parsed.value) return undefined;
            content += (content && !cursor ? "\n" : "") + parsed.value.content;
            if (new TextEncoder().encode(content).byteLength > 128 * 1024)
              throw new Error("子任务输入文件超过 128 KiB。");
            if (!parsed.value.truncated) break;
            if (parsed.value.nextCursor) cursor = parsed.value.nextCursor;
            else if (parsed.value.nextStartLine) {
              cursor = undefined;
              startLine = parsed.value.nextStartLine;
            } else throw new Error("子任务资料被截断，但没有可继续读取的位置。");
          }
          return {
            content,
            rootId,
            scope: "vault",
            authorized: options.isPathInScope?.(file) ?? true,
          };
        },
      },
    }).build({ paths: inputFiles, signal: context.abortSignal });
    return JSON.stringify({
      task: args.task,
      description: args.description,
      inputFiles: bundle.items,
    });
  };
  const createChild = async (
    api: ToolExecutionApi,
    context: Context,
    args: Record<string, unknown>,
    background: boolean,
    backgroundCommandId?: string
  ): Promise<PiSubagentChild> => {
    const run = requireConversationRun(String(api.conversationId));
    const validated = validateSubagentRequest({
      profileId: String(args.profileId),
      ...(typeof args.modelKey === "string" ? { modelKey: args.modelKey } : {}),
      knownModels: options.models.catalog.readyModels.map((entry) => entry.configuredModelId),
      ...(options.enabledProfiles ? { enabledProfiles: options.enabledProfiles() } : {}),
    });
    const parent = children.get(String(api.conversationId));
    const modelKey = validated.modelKey ?? parent?.modelKey ?? options.getModelKey();
    if (!modelKey) throw new Error("请选择已配置的子模型。");
    const model = modelEntry(modelKey);
    const agent = await api.agent(context);
    const scope = computeSubagentScope({
      parent: {
        callableTools: agent.tools.map((tool) => tool.name),
        effects: getReadOnly(String(api.conversationId))
          ? ["read", "state", "network"]
          : ["read", "write", "create", "state", "network", "ui"],
        modelKey,
        depth: parent?.depth ?? 0,
        maxDepth: 2,
      },
      profile: validated.profile,
      toolAllowlist: validated.toolAllowlist,
      ...(options.capabilities
        ? {
            policy: {
              allowedTools: agent.tools
                .filter((tool) =>
                  options.capabilities!.filter(tool.name, {
                    caller: "subagent",
                    mode: getMode(String(api.conversationId)),
                    readOnly: !validated.profile.writeCapable,
                    allowedToolNames: validated.toolAllowlist,
                  })
                )
                .map((tool) => tool.name),
            },
          }
        : {}),
    });
    // 输入资料只授予读取；新文件的输出授权独立记录，并继续受父级范围和实际写入审批约束：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const outputPaths = validated.profile.writeCapable
      ? [
          ...new Set(
            (Array.isArray(args.outputPaths) ? args.outputPaths : []).map((file) => {
              if (typeof file !== "string" || !file.trim())
                throw new Error("输出路径必须为非空字符串。");
              const target = normalizedSubagentPath(file);
              if (
                target.split("/").includes("..") ||
                /^(?:[A-Za-z]:|\/)/.test(file.trim()) ||
                !(options.isPathInScope?.(target) ?? true)
              )
                throw new Error("输出路径不在父任务授权的笔记范围内。");
              return target;
            })
          ),
        ].filter(
          (file) => parent === undefined || (parent.outputPaths ?? parent.pathScope)?.includes(file)
        )
      : [];
    const requestedPaths = validated.profile.writeCapable
      ? [
          ...(Array.isArray(args.inputFiles)
            ? args.inputFiles.filter((item): item is string => typeof item === "string")
            : []
          ).map((file) => normalizedSubagentPath(file)),
          ...outputPaths,
        ]
      : null;
    const inheritedPaths = parent?.pathScope ?? null;
    const pathScope =
      requestedPaths === null
        ? inheritedPaths
        : requestedPaths.filter((file) => inheritedPaths === null || inheritedPaths.includes(file));
    const content = await makeContent(args, api, context, modelKey);
    const childId = await api.commit(async (tx) => {
      const mailbox = await mailboxInTx(tx);
      // 停止与资料读取可以交错，创建必须在同一事务内再次检查持久停止标记。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (
        run.signal.aborted ||
        mailbox.stoppedRuns[run.id] !== undefined ||
        (parent && mailbox.stoppedTasks[parent.taskId] !== undefined)
      )
        throw new Error("父任务已停止，不能创建子任务。");
      let ownerTaskId = api.taskId;
      if (background) {
        const state = await tx.doc(token, options.conversation.id);
        const key = `anchor:${backgroundCommandId}`;
        const known = state.commands[key];
        if (typeof known === "string") {
          const existing = (await tx.scanConversations({ ownerTaskId: Number(known) as TaskId }, 1))
            .items[0];
          if (existing) return existing.id;
        }
        // Anchor 和子会话必须同批提交，否则输入读取期间 Anchor 可先结束；旧失败只留下 Anchor 时重新创建有效归属。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        ownerTaskId = await tx.createTask(
          Anchor,
          {},
          {
            ownership: { kind: "conversation" },
            conversationId: options.conversation.id,
            background: true,
          }
        );
        state.commands[key] = String(ownerTaskId);
      } else {
        const existing = (await tx.scanConversations({ ownerTaskId }, 1)).items[0];
        if (existing) return existing.id;
      }
      const child = await tx.createConversation({
        ownership: { kind: "task", taskId: ownerTaskId },
      });
      const tools = agent.tools.filter((tool) => scope.tools.includes(tool.name));
      await configure(tx, child.id, {
        model: { provider: model.providerInstanceId, modelId: model.upstreamModelId },
        tools,
        modelTools: tools,
        instructions: validated.instructions,
      });
      const record: PiSubagentChild = {
        taskId: String(ownerTaskId),
        parentRunId: run.id,
        modelKey,
        depth: scope.depth,
        status: "queued",
        conversationId: String(child.id),
        profileId: validated.profile.profileId,
        ownerTaskId: String(ownerTaskId),
        parentConversationId: String(api.conversationId),
        parentToolCallId: api.callId,
        parentToolTaskId: String(api.taskId),
        background,
        content,
        roleInstructions: validated.instructions,
        latestContent: content,
        ...(!background ? { latestRequestId: `delegate:${ownerTaskId}` } : {}),
        description: typeof args.description === "string" ? args.description : "",
        scope,
        pathScope,
        outputPaths,
        startedAtMs: Date.now(),
        reporterIds: [],
      };
      await saveInTx(tx, record, lifecycle(record));
      return child.id;
    }, context);
    await refresh();
    const child = children.get(String(childId));
    if (!child) throw new Error("子会话映射丢失；已停止执行。");
    return child;
  };
  const reportService = new ReportDelivery({
    entries: {
      append: async (entry) => {
        const result = await options.conversation.submit(
          {
            type: "write",
            requestId: `subagent-report:${entry.data.answerEntryId}`,
            entry: {
              kind: entry.kind,
              data: encode({ ...entry.data, source: entry.source, text: entry.text }),
            },
          },
          BACKGROUND_CONTEXT
        );
        const placed = await result.wait(BACKGROUND_CONTEXT);
        if (placed.status !== "done") throw new Error("后台报告未能保存。");
        return { entryId: String(placed.entry) };
      },
      findByAnswer: async (answerEntryId) => {
        let cursor;
        do {
          const page = await options.conversation.entries(
            { order: "ascending" },
            200,
            cursor,
            BACKGROUND_CONTEXT
          );
          const entry = page.items.find(
            (entry) =>
              entry.kind === "va.subagent.report" &&
              entry.data &&
              typeof entry.data === "object" &&
              !Array.isArray(entry.data) &&
              entry.data.answerEntryId === answerEntryId
          );
          if (entry) return { entryId: String(entry.id) };
          cursor = page.next;
        } while (cursor);
        return undefined;
      },
    },
    roots: {
      cancelEpoch: async (_id, parentRunId) => (runs.get(parentRunId)?.signal.aborted ? 1 : 0),
      isAborted: (_id, parentRunId) => closed || runs.get(parentRunId)?.signal.aborted === true,
      budgetAllows: async (_id, parentRunId) => {
        const run = runs.get(parentRunId);
        if (!run || run.signal.aborted) return false;
        const { modelAttempts, spentUsd, limits } = run.budget.snapshot;
        return (
          modelAttempts < limits.maxModelAttempts &&
          (limits.maxBudgetUsd === null || spentUsd < limits.maxBudgetUsd)
        );
      },
      deliverContext: async (input) => {
        const child = children.get(input.childConversationId);
        const mailbox = await options.harness.snapshot(
          mailboxToken,
          options.conversation.id,
          BACKGROUND_CONTEXT
        );
        const message = (child
          ? mailbox?.messages[`report:${child.taskId}:${input.answerEntryId}`]
          : undefined) as unknown as SubagentMessageEnvelope | undefined;
        // 等待工具已经接纳或正在领取同一报告时，只交付原工具结果，不能额外排一个模型输入。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (child && (message?.ack === "accepted" || reportWaiters.has(child.parentConversationId)))
          return { delivered: true, reason: "delivered_to_wait" };
        return (
          options.deliverReportContext?.({
            ...input,
            parentToolTaskId: child?.parentToolTaskId,
          }) ?? {
            delivered: false,
            reason: "requires_user_continue",
          }
        );
      },
    },
    cards: {
      updateParentCard: async ({ childConversationId }) => {
        const child = children.get(childConversationId);
        if (child) options.emit(lifecycle(child));
      },
    },
    host: { isOpen: () => !closed },
    checkpoints: {
      save: async (record) => {
        await options.conversation.commit(async (tx) => {
          const state = await tx.doc(token, options.conversation.id);
          state.reports[record.parentToolCallId] = encode(record);
        }, BACKGROUND_CONTEXT);
      },
      list: async () => {
        const state = await options.harness.snapshot(
          token,
          options.conversation.id,
          BACKGROUND_CONTEXT
        );
        return Object.values(state?.reports ?? {}) as unknown as ReportDeliveryRecord[];
      },
    },
  });
  const Anchor = defineTask<JsonObject, { phase: "terminal" }, JsonObject>({
    name: SUBAGENT_ANCHOR_TASK,
    version: 1,
    initial: () => ({ phase: "terminal" }),
    phases: {
      terminal: async (_task, runtime, context) => {
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: {} } }),
          context
        );
      },
    },
    abort: async (_task, runtime, context) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });
  const Reporter = defineTask<ReporterInput, ReporterCheckpoint, JsonObject>({
    name: SUBAGENT_REPORTER_TASK,
    version: 1,
    initial: () => ({ phase: "deliver" }),
    phases: {
      deliver: async (task, runtime, context) => {
        await refresh();
        const child = children.get(task.input.childId);
        if (!child) throw new Error("后台子会话不存在。");
        const lease = await childExecutions.acquire([child.conversationId]);
        try {
          const answer = await scheduled(
            String(runtime.taskId),
            child,
            async (signal) => {
              if (signal.aborted) throw new Error("子任务已取消。");
              await refresh();
              return runChild(
                {
                  ...(children.get(child.conversationId) ?? child),
                  parentRunId: task.input.parentRunId,
                },
                task.input.content,
                task.input.requestId,
                withAbortSignal(signal, context),
                task.input.messageId ?? undefined
              );
            },
            runtime.signal
          );
          await runtime.commit(
            () => ({
              status: "running",
              checkpoint: { phase: "report", answer: answer.text, answerEntryId: answer.entryId },
            }),
            context
          );
        } finally {
          lease.release();
        }
      },
      report: async (task, runtime, context) => {
        await refresh();
        const child = children.get(task.input.childId);
        if (!child) throw new Error("后台子会话不存在。");
        const restored = options.getRun();
        if (restored?.id === task.input.parentRunId) runs.set(restored.id, restored);
        const parentRun = runs.get(task.input.parentRunId);
        await runtime.commit(async (tx) => {
          appendSubagentMessage(await mailboxInTx(tx), {
            messageId: `report:${child.taskId}:${task.state.checkpoint.answerEntryId}`,
            parentTaskId: logicalTaskId(child.parentConversationId),
            sender: child.taskId,
            recipient: logicalTaskId(child.parentConversationId),
            causationId: task.input.messageId ?? task.input.requestId,
            type: "report",
            payload: {
              text: task.state.checkpoint.answer,
              answerEntryId: task.state.checkpoint.answerEntryId,
            },
          });
          return undefined;
        }, context);
        await reportService.deliver({
          rootId,
          parentRunId: task.input.parentRunId,
          parentToolCallId: parentCardId(child),
          childConversationId: child.conversationId,
          answerEntryId: task.state.checkpoint.answerEntryId,
          text: task.state.checkpoint.answer,
          epochAtStart: !parentRun || parentRun.signal.aborted ? 1 : 0,
          status: "completed",
        });
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: {
              status: "completed",
              result: { answerEntryId: task.state.checkpoint.answerEntryId },
            },
          }),
          context
        );
      },
    },
    abort: async (task, runtime, context) => {
      const child = children.get(task.input.childId);
      const conversation = await options.harness.conversation(
        Number(task.input.childId) as ConversationId,
        context
      );
      await conversation?.abort(context, { background: true });
      if (child) {
        const stopped = {
          ...child,
          status: closed ? "interrupted" : "cancelled",
          endedAtMs: Date.now(),
        };
        await save(stopped, lifecycle(stopped));
      }
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });
  const MessageDelivery = defineTask<MessageDeliveryInput, { phase: "deliver" }, JsonObject>({
    name: "va.subagent.message_delivery",
    version: 1,
    initial: () => ({ phase: "deliver" }),
    phases: {
      deliver: async (task, runtime, context) => {
        const snapshot = await options.harness.snapshot(
          mailboxToken,
          options.conversation.id,
          context
        );
        const message = (
          snapshot?.messages as unknown as SubagentMailboxState["messages"] | undefined
        )?.[task.input.messageId];
        if (!message) throw new Error("待送达的子任务消息不存在。");
        let run = runs.get(task.input.parentRunId);
        const active = options.getRun();
        // 冷重开后的被动消息沿原任务授权接续，不因内存映射尚未重建就丢弃待送达记录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (!run && active && !active.signal.aborted && !stoppedRuns.has(task.input.parentRunId)) {
          run =
            active.id === task.input.parentRunId
              ? active
              : await options.resolveRun?.(task.input.parentRunId);
          if (run?.id === task.input.parentRunId) runs.set(run.id, run);
          else run = undefined;
        }
        if (run && !run.signal.aborted && !closed && !stoppedRuns.has(run.id)) {
          const conversation = await options.harness.conversation(
            Number(task.input.conversationId) as ConversationId,
            context
          );
          if (!conversation) throw new Error("消息接收会话不存在。");
          // 被动消息只写入下一处上下文边界，不把报告伪装成新的用户请求或唤醒已结束的任务。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const submission = await conversation.submit(
            {
              type: "write",
              requestId: `mailbox:${message.messageId}`,
              entry: {
                kind: "va.subagent.message",
                data: encode(message),
                model: [
                  {
                    role: "user",
                    content: JSON.stringify({
                      origin: "subagent",
                      sender: message.sender,
                      messageId: message.messageId,
                      text: message.payload.text,
                    }),
                    timestamp: Date.now(),
                  },
                ],
              },
            },
            context
          );
          await runtime.commit(async (tx) => {
            acknowledgeSubagentMessage(await mailboxInTx(tx), message.messageId, {
              ack: "accepted",
              submissionId: String(submission.id),
            });
            return {
              status: "terminal",
              outcome: { status: "completed", result: { messageId: message.messageId } },
            };
          }, context);
          return;
        }
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: {
              status: "completed",
              result: { messageId: message.messageId, storedOnly: true },
            },
          }),
          context
        );
      },
    },
    abort: async (_task, runtime, context) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });
  const addReporter = async (
    child: PiSubagentChild,
    content: string,
    commandId: string,
    commit: ToolExecutionApi["commit"] | Harness["commit"],
    context: Context,
    message?: Omit<SubagentMessageEnvelope, "sequence" | "ack" | "submissionId" | "answerEntryId">,
    authorizedRun?: PiSubagentRun
  ): Promise<PiSubagentChild> => {
    const run = authorizedRun ?? requireRun();
    await commit(async (tx) => {
      const mailbox = await mailboxInTx(tx);
      // 等待中的后续消息不能在停止之后复活任务。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (
        run.signal.aborted ||
        mailbox.stoppedRuns[run.id] !== undefined ||
        mailbox.stoppedTasks[child.taskId] !== undefined
      )
        throw new Error("子任务已停止；需要明确继续。");
      if (message) appendSubagentMessage(await mailboxInTx(tx), message);
      const state = await tx.doc(token, options.conversation.id);
      if (state.commands[commandId]) return;
      const current = state.children[child.conversationId] as unknown as
        | PiSubagentChild
        | undefined;
      const active = current?.status === "running" || current?.status === "queued";
      const taskId = await tx.createTask(
        Reporter,
        {
          childId: child.conversationId,
          content,
          requestId: `subagent:${commandId}`,
          parentRunId: run.id,
          messageId: message?.messageId ?? null,
        },
        {
          ownership: { kind: "conversation" },
          conversationId: options.conversation.id,
          background: true,
        }
      );
      const next = {
        ...(current ?? child),
        parentRunId: active ? current.parentRunId : run.id,
        status: active ? current.status : "queued",
        reporterTaskId: String(taskId),
        reporterIds: [...child.reporterIds, String(taskId)],
        latestContent: content,
        latestRequestId: `subagent:${commandId}`,
        answer: undefined,
        answerEntryId: undefined,
        endedAtMs: undefined,
      };
      await saveInTx(tx, next, lifecycle(next), true);
      state.commands[commandId] = child.conversationId;
    }, context);
    await refresh();
    return children.get(child.conversationId)!;
  };
  const sendMessage: PiSubagentTools["sendMessage"] = async (input) => {
    await refresh();
    const run = requireConversationRun(input.senderConversationId);
    if (!input.message.trim() || !input.messageId.trim())
      throw new Error("消息和消息编号不能为空。");
    const sender = logicalTaskId(input.senderConversationId);
    const callerChild = children.get(input.senderConversationId);
    const parentConversationId = callerChild?.parentConversationId;
    const child =
      input.recipientTaskId === "parent"
        ? parentConversationId
          ? children.get(parentConversationId)
          : undefined
        : childByTask(input.recipientTaskId);
    const recipientConversationId =
      child?.conversationId ??
      (input.recipientTaskId === "root" ||
      input.recipientTaskId === rootTaskId ||
      (input.recipientTaskId === "parent" && parentConversationId === rootId)
        ? rootId
        : undefined);
    if (!recipientConversationId) throw new Error("未知的消息接收任务。");
    const recipient = logicalTaskId(recipientConversationId);
    const parents = Object.fromEntries(
      [...children.values()].map((entry) => [
        entry.taskId,
        logicalTaskId(entry.parentConversationId),
      ])
    );
    if (
      !canSendSubagentMessage(
        sender,
        recipient,
        rootTaskId,
        parents,
        options.canCommunicate?.(sender, recipient)
      )
    )
      throw new Error("当前任务没有向该任务发送消息的授权。");
    const message = {
      messageId: `${sender}:${input.messageId}`,
      parentTaskId: callerChild
        ? logicalTaskId(callerChild.parentConversationId)
        : child
          ? logicalTaskId(child.parentConversationId)
          : rootTaskId,
      sender,
      recipient,
      causationId: input.messageId,
      type: "message" as const,
      payload: { text: input.message },
    };
    if (input.wake && child) {
      await addReporter(
        child,
        input.message,
        `message:${message.messageId}`,
        (change, context) => options.harness.commit(change, context),
        BACKGROUND_CONTEXT,
        message,
        run
      );
    } else {
      await options.conversation.commit(async (tx) => {
        const queued = appendSubagentMessage(await mailboxInTx(tx), message);
        if (!queued.created) return;
        const taskId = await tx.createTask(
          MessageDelivery,
          {
            messageId: message.messageId,
            conversationId: recipientConversationId,
            parentRunId: run.id,
          },
          {
            ownership: { kind: "conversation" },
            conversationId: options.conversation.id,
            background: true,
          }
        );
        const mailbox = await tx.doc(mailboxToken, options.conversation.id);
        (mailbox.deliveries ??= {})[message.messageId] = String(taskId);
      }, BACKGROUND_CONTEXT);
      options.harness.resume();
    }
    const stored = await options.harness.snapshot(
      mailboxToken,
      options.conversation.id,
      BACKGROUND_CONTEXT
    );
    return stored!.messages[message.messageId] as unknown as SubagentMessageEnvelope;
  };
  const wait: PiSubagentTools["wait"] = async (input, signal) => {
    const timeoutMs = input.timeoutMs ?? 30_000;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > 60_000 ||
      !Number.isSafeInteger(input.afterSequence ?? 0) ||
      (input.afterSequence ?? 0) < 0
    )
      throw new Error("等待时间和消息序号无效。");
    reportWaiters.set(input.conversationId, (reportWaiters.get(input.conversationId) ?? 0) + 1);
    let notify = () => {};
    let changed = false;
    let timedOut = timeoutMs === 0;
    const wake = () => {
      changed = true;
      notify();
    };
    const unsubscribe = options.harness.subscribeCommits(wake);
    const timer = window.setTimeout(() => {
      timedOut = true;
      wake();
    }, timeoutMs);
    waits.add(wake);
    signal?.addEventListener("abort", wake, { once: true });
    try {
      for (;;) {
        changed = false;
        const notification = new Promise<void>((resolve) => {
          notify = resolve;
        });
        await refresh();
        const recipient = logicalTaskId(input.conversationId);
        if (!recipient) throw new Error("未知的等待任务。");
        const parents = Object.fromEntries(
          [...children.values()].map((child) => [
            child.taskId,
            logicalTaskId(child.parentConversationId),
          ])
        );
        const tasks = (input.taskIds ?? []).map((id) => {
          const child = childByTask(id);
          if (
            !child ||
            !canSendSubagentMessage(
              recipient,
              child.taskId,
              rootTaskId,
              parents,
              options.canCommunicate?.(recipient, child.taskId)
            )
          )
            throw new Error("无权等待该任务。");
          return child;
        });
        const mailbox = await options.harness.snapshot(
          mailboxToken,
          options.conversation.id,
          BACKGROUND_CONTEXT
        );
        const messages = (
          Object.values(mailbox?.messages ?? {}) as unknown as SubagentMessageEnvelope[]
        )
          .filter(
            (message) =>
              message.recipient === recipient &&
              message.sequence > (input.afterSequence ?? 0) &&
              message.type !== "instruction"
          )
          .sort((left, right) => left.sequence - right.sequence);
        if (signal?.aborted || closed) return { reason: "cancelled", messages: [], tasks: [] };
        if (messages.length) {
          await options.conversation.commit(async (tx) => {
            const stored = await mailboxInTx(tx);
            for (const message of messages)
              acknowledgeSubagentMessage(stored, message.messageId, { ack: "accepted" });
          }, BACKGROUND_CONTEXT);
          return { reason: "message", messages, tasks };
        }
        if (
          tasks.some((child) =>
            ["completed", "failed", "cancelled", "interrupted"].includes(child.status)
          )
        )
          return { reason: "task", messages, tasks };
        if (timedOut) return { reason: "timeout", messages, tasks };
        // 先订阅再读取持久游标；并发提交只触发重新检查，不靠轮询或计数微任务等待。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (!changed) await notification;
      }
    } finally {
      window.clearTimeout(timer);
      unsubscribe();
      waits.delete(wake);
      const remaining = (reportWaiters.get(input.conversationId) ?? 1) - 1;
      if (remaining) reportWaiters.set(input.conversationId, remaining);
      else reportWaiters.delete(input.conversationId);
      signal?.removeEventListener("abort", wake);
    }
  };
  const statusView = (child: PiSubagentChild): SubagentStatusView => ({
    taskId: child.taskId,
    rootId,
    profileId: child.profileId,
    status:
      child.status === "queued" ? "queued" : child.status === "running" ? "running" : "terminal",
    childConversationId: child.conversationId,
    startedAtMs: child.startedAtMs,
    ...(child.endedAtMs ? { endedAtMs: child.endedAtMs } : {}),
    ...(child.answerEntryId ? { resultRef: child.answerEntryId } : {}),
  });
  const foreground = async (
    args: Record<string, unknown>,
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult> => {
    let prepared: PiSubagentChild | undefined;
    let answer: { text: string; entryId: string } | undefined;
    const port: DelegateSessionPort = {
      findChild: async (ownerTaskId) => {
        await refresh();
        prepared = [...children.values()].find(
          (child) => child.ownerTaskId === ownerTaskId && !child.background
        );
        return prepared
          ? {
              conversationId: prepared.conversationId,
              ownerTaskId,
              profileId: prepared.profileId,
              createdAtMs: prepared.startedAtMs,
            }
          : undefined;
      },
      createChild: async () => {
        prepared = await createChild(api, context, args, false);
        return {
          conversationId: prepared.conversationId,
          ownerTaskId: prepared.ownerTaskId,
          profileId: prepared.profileId,
          createdAtMs: prepared.startedAtMs,
        };
      },
      writeChildMapping: async () => undefined,
      submit: async ({ requestId }) => {
        if (!prepared) throw new Error("Missing child.");
        const run = requireConversationRun(String(api.conversationId));
        prepared = { ...prepared, parentRunId: run.id };
        await save(prepared);
        answer = await scheduled(
          String(api.taskId),
          prepared,
          (signal) =>
            runChild(prepared!, prepared!.content, requestId, withAbortSignal(signal, context)),
          context.abortSignal
        );
      },
      wait: async () => (answer ? "completed" : "failed"),
      readAnswer: async () => ({
        answered: !!answer?.text,
        text: answer?.text ?? "",
        ...(answer ? { entryId: answer.entryId } : {}),
      }),
      cancel: async ({ conversationId }) => {
        const child = await options.harness.conversation(
          Number(conversationId) as ConversationId,
          BACKGROUND_CONTEXT
        );
        await child?.abort(BACKGROUND_CONTEXT, { background: true });
      },
    };
    const agent = await api.agent(context);
    const parent = children.get(String(api.conversationId));
    const delegate = new DelegateTool({
      session: port,
      parent: {
        conversationId: String(api.conversationId),
        taskId: String(api.taskId),
        callableTools: agent.tools.map((tool) => tool.name),
        effects: ["read", "state", "network", "write", "create"],
        modelKey: parent?.modelKey ?? options.getModelKey() ?? "",
        depth: parent?.depth ?? 0,
        maxDepth: 2,
      },
      knownModels: options.models.catalog.readyModels.map((entry) => entry.configuredModelId),
      ...(options.enabledProfiles ? { enabledProfiles: options.enabledProfiles() } : {}),
    });
    const result: DelegateToolResult = await delegate.executeTool({
      profileId: String(args.profileId),
      task: String(args.task),
      description: typeof args.description === "string" ? args.description : "",
      ...(typeof args.modelKey === "string" ? { modelKey: args.modelKey } : {}),
      inputFiles: Array.isArray(args.inputFiles) ? (args.inputFiles as string[]) : [],
      signal: context.abortSignal,
    });
    return { output: [...result.output], isError: result.isError, details: encode(result.details) };
  };
  const stopTree = async (taskId?: string, groupId?: string): Promise<void> => {
    await refresh();
    const target = taskId === undefined ? undefined : childByTask(taskId);
    if (taskId !== undefined && !target) throw new Error("未知的子任务。");
    const affected = new Set<string>(
      target
        ? [target.conversationId]
        : [...children.values()]
            .filter((child) => groupId === undefined || child.parentRunId === groupId)
            .map((child) => child.conversationId)
    );
    for (let size = -1; size !== affected.size; ) {
      size = affected.size;
      for (const child of children.values())
        if (affected.has(child.parentConversationId)) affected.add(child.conversationId);
    }
    const selected = [...children.values()].filter((child) => affected.has(child.conversationId));
    // 先持久关闭创建和请求入口，再跨后台边界停止全部后代，防止取消途中生成新的后台任务。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    await options.conversation.commit(async (tx) => {
      const mailbox = await tx.doc(mailboxToken, options.conversation.id);
      mailbox.epoch += 1;
      mailbox.stoppedTasks ??= {};
      if (!target) {
        const run = options.getRun();
        for (const id of new Set([
          ...(groupId ? [groupId] : run ? [run.id] : []),
          ...selected
            .filter((child) => ["running", "queued", "interrupted"].includes(child.status))
            .map((child) => child.parentRunId),
          ...(groupId ? [] : candidateGroups.keys()),
        ])) {
          mailbox.stoppedRuns[id] = mailbox.epoch;
          stoppedRuns.add(id);
          if (mailbox.groups?.[id])
            mailbox.groups[id] = encode({ status: "stopped", epoch: mailbox.epoch });
        }
      }
      for (const child of selected) {
        if (!closed || ["running", "queued", "interrupted"].includes(child.status)) {
          mailbox.stoppedTasks[child.taskId] = mailbox.epoch;
          stoppedTasks.add(child.taskId);
        }
        if (
          child.status === "running" ||
          child.status === "queued" ||
          child.status === "interrupted"
        )
          await saveInTx(tx, {
            ...child,
            status: closed ? "interrupted" : "cancelled",
            endedAtMs: Date.now(),
          });
      }
    }, BACKGROUND_CONTEXT);
    if (!target)
      for (const [id, controller] of candidateGroups)
        if (groupId === undefined || groupId === id) controller.abort();
    for (const child of selected.sort((left, right) => right.depth - left.depth)) {
      const conversation = await options.harness.conversation(
        Number(child.conversationId) as ConversationId,
        BACKGROUND_CONTEXT
      );
      await conversation?.abort(BACKGROUND_CONTEXT, { background: true });
      for (const reporterId of child.reporterIds)
        await options.harness.abortTask(Number(reporterId) as TaskId, BACKGROUND_CONTEXT);
    }
    if (!target && groupId === undefined)
      await options.conversation.abort(BACKGROUND_CONTEXT, { background: true });
    await refresh();
  };
  const controlPort = (api: ToolExecutionApi, context: Context): SubagentControlPort => ({
    start: async (input) => {
      const state = await options.harness.snapshot(token, options.conversation.id, context);
      const priorId = state?.commands[`start:${input.commandId}`];
      if (typeof priorId === "string" && children.has(priorId))
        return statusView(children.get(priorId)!);
      const child = await createChild(api, context, { ...input }, true, input.commandId);
      await options.harness.waitForTask(Number(child.ownerTaskId) as TaskId, context);
      return statusView(
        await addReporter(
          child,
          child.content,
          `start:${input.commandId}`,
          (change, executionContext) => api.commit(change, executionContext),
          context
        )
      );
    },
    status: async (taskId) => {
      await refresh();
      const child = childByTask(taskId);
      return child ? statusView(child) : undefined;
    },
    list: async () => {
      await refresh();
      return [...children.values()].filter((child) => child.background).map(statusView);
    },
    stop: async (taskId) => {
      const child = childByTask(taskId);
      if (!child) throw new Error("Unknown child.");
      await stopTree(taskId);
      return statusView(children.get(child.conversationId)!);
    },
    result: async (taskId) => {
      const child = childByTask(taskId);
      return child?.answer
        ? { answered: true, text: child.answer, entryId: child.answerEntryId }
        : undefined;
    },
  });
  const controls = (api: ToolExecutionApi, context: Context) =>
    new SubagentControlTools({
      port: controlPort(api, context),
      rootId,
    });
  const knownModels = options.models.catalog.readyModels.map((model) => ({
    modelKey: model.configuredModelId,
    displayName: model.displayName ?? model.upstreamModelId,
    providerDisplayName: model.providerDisplayName ?? model.providerInstanceId,
  }));
  const enabledProfiles = options.enabledProfiles?.();
  const profileDescription = subagentProfileSchema(enabledProfiles).description;
  const schemaControls = new SubagentControlTools({
    port: {} as SubagentControlPort,
    rootId,
    enabledProfiles,
    knownModels,
  });
  const delegateSchema = new DelegateTool({
    enabledProfiles,
    knownModels,
    session: {} as DelegateSessionPort,
    parent: {
      conversationId: rootId,
      taskId: "schema",
      callableTools: [],
      effects: [],
      modelKey: "",
      depth: 0,
      maxDepth: 2,
    },
  }).registration();
  const definitions: Readonly<
    Record<
      string,
      Pick<HostToolDefinition, "description" | "effects" | "allowedCallers" | "callers">
    >
  > = {
    delegate_task: {
      description: `Run a bounded child task and wait for its actual answer. inputFiles provide reading material; outputPaths separately authorize exact writable vault targets. Child permissions never exceed the parent. ${profileDescription}`,
      effects: ["state"],
      allowedCallers: ["root", "subagent"],
      callers: ["model", "tools"],
    },
    start_background_task: {
      description: `Start a child task in the background using the same task tree, permissions and execution slots as foreground delegation. Return its real task identifier before its answer is ready. ${profileDescription}`,
      effects: ["state"],
      allowedCallers: ["root"],
      callers: ["model"],
    },
    send_subagent_message: {
      description:
        "Store a deduplicated message for an authorized parent or child (taskId accepts parent/root). Sibling communication requires host authorization. A message alone never starts a model request; wake:true explicitly authorizes an idle child follow-up.",
      effects: ["state"],
      allowedCallers: ["root", "subagent"],
      callers: ["model"],
    },
    wait_subagent: {
      description:
        "Wait for a new incoming message after a sequence cursor or a selected task to finish. This observes events without starting a model request; returns message, task, timeout or cancelled.",
      effects: ["read"],
      allowedCallers: ["root", "subagent"],
      callers: ["model"],
    },
    stop_subagent: {
      description:
        "Stop an owned child and every descendant, including background work. Completed answers are preserved and stopped tasks require explicit continuation.",
      effects: ["state"],
      allowedCallers: ["root"],
      callers: ["model"],
    },
    get_subagent_result: {
      description:
        "Read an owned child's persisted answer; returns an error if no actual answer exists yet.",
      effects: ["read"],
      allowedCallers: ["root"],
      callers: ["model"],
    },
    list_subagents: {
      description:
        "List child tasks in this root task tree with their persisted state and conversation references.",
      effects: ["read"],
      allowedCallers: ["root"],
      callers: ["model"],
    },
  };
  const register = (
    name: string,
    parameters: Record<string, unknown>,
    action: (
      args: Record<string, unknown>,
      api: ToolExecutionApi,
      context: Context
    ) => Promise<ToolExecutionResult>,
    replay: "safe" | "unsafe" = "safe"
  ): ToolRegistration => {
    const definition = definitions[name];
    return compileHostToolDefinition(
      {
        ...definition,
        toolId: name,
        family: "control",
        parameters,
        replay,
        outputLimits: { maxBytes: 32 * 1024 },
        // SDK 的通用 enum 错误不列合法值；通过公开的无副作用参数检查返回同一角色目录，执行时仍重验实时启用状态。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        ...(["delegate_task", "start_background_task"].includes(name)
          ? {
              prepareArguments: (args: unknown) => {
                const input =
                  args && typeof args === "object" && !Array.isArray(args)
                    ? (args as Record<string, unknown>)
                    : {};
                if (typeof input.profileId === "string")
                  validateSubagentRequest({ profileId: input.profileId, enabledProfiles });
                return args;
              },
            }
          : {}),
        execute: async (args, api, context) => {
          const identity = {
            operationId: `subagent:${options.sessionId}:${api.conversationId}:${api.taskId ?? api.callId}`,
            toolId: name,
            caller:
              String(api.conversationId) === rootId
                ? "root"
                : children.get(String(api.conversationId))?.kind === "fanout"
                  ? "fanout"
                  : "subagent",
          };
          const mayMutate = definition.effects.some((effect) => effect !== "read");
          let invoked = false;
          try {
            if (closed) throw new Error("子代理服务已关闭。");
            if (String(api.conversationId) !== rootId && !children.has(String(api.conversationId)))
              throw new Error("该会话不属于当前任务。");
            if (!definition.allowedCallers.includes(identity.caller as PolicyCaller))
              throw new Error("后台控制只允许父会话调用。");
            invoked = true;
            const activeTask = activeExecutions.get(String(api.conversationId));
            const execute = () => action(args as Record<string, unknown>, api, context);
            // 等待后代不占模型执行名额，返回模型前仍须重新排队，不能用拒绝委派掩盖父子互等。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            const value =
              activeTask && (name === "delegate_task" || name === "wait_subagent")
                ? await scheduler.yieldWhile(activeTask, execute)
                : await execute();
            const details =
              value.details && typeof value.details === "object" && !Array.isArray(value.details)
                ? value.details
                : undefined;
            const childCreated =
              typeof details?.childConversationId === "string" &&
              details.childConversationId.length > 0;
            return withToolOutcome(value, {
              ...identity,
              effect: mayMutate && (!value.isError || childCreated) ? "applied" : "not_applied",
            });
          } catch (error) {
            return failedToolOutcome(error, { ...identity, invoked, mayMutate });
          }
        },
      },
      options.capabilities
    );
  };
  const registrations: ToolRegistration[] = [
    register("delegate_task", delegateSchema.parameters, foreground),
    register(
      "wait_subagent",
      {
        type: "object",
        properties: {
          taskIds: { type: "array", items: { type: "string" } },
          afterSequence: { type: "integer", minimum: 0 },
          timeoutMs: { type: "integer", minimum: 0, maximum: 60_000 },
        },
        additionalProperties: false,
      },
      async (args, api, context) => {
        const outcome = await wait(
          {
            conversationId: String(api.conversationId),
            taskIds: args.taskIds as string[] | undefined,
            afterSequence: args.afterSequence as number | undefined,
            timeoutMs: args.timeoutMs as number | undefined,
          },
          context.abortSignal
        );
        return {
          output: [{ type: "text", text: JSON.stringify(outcome) }],
          details: encode(outcome),
        };
      }
    ),
  ];
  const beginCandidateGroup: PiSubagentTools["beginCandidateGroup"] = async (input) => {
    const pending = openingCandidateGroups.get(input.runId);
    if (pending) return pending;
    const operation = (async () => {
      if (closed || input.signal?.aborted) throw new Error("候选组已停止。");
      const known = candidateGroups.get(input.runId);
      if (known && !known.signal.aborted && !stoppedRuns.has(input.runId)) return;
      const controller = new AbortController();
      await options.conversation.commit(async (tx) => {
        const mailbox = await tx.doc(mailboxToken, options.conversation.id);
        mailbox.groups ??= {};
        // 重开只读取旧组；缺失候选不能借一次 openSession 自动重新授权已存在的执行组。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (
          (mailbox.groups[input.runId] || mailbox.stoppedRuns[input.runId] !== undefined) &&
          !input.resume
        )
          throw new Error("候选组需要用户明确继续后才能恢复。");
        delete mailbox.stoppedRuns[input.runId];
        if (input.resume) {
          const state = await tx.doc(token, options.conversation.id);
          for (const value of Object.values(state.children)) {
            const child = value as unknown as PiSubagentChild;
            if (child.parentRunId === input.runId) delete mailbox.stoppedTasks[child.taskId];
          }
        }
        mailbox.groups[input.runId] = encode({ status: "active", epoch: mailbox.epoch });
      }, BACKGROUND_CONTEXT);
      if (input.signal) {
        const abort = () => controller.abort();
        input.signal.addEventListener("abort", abort, { once: true });
        controller.signal.addEventListener(
          "abort",
          () => input.signal?.removeEventListener("abort", abort),
          { once: true }
        );
        if (input.signal.aborted) controller.abort();
      }
      candidateGroups.set(input.runId, controller);
      await refresh();
      // 授权事务之后也可能紧接着发生停止；不能用内存缓存覆盖持久停止结果。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (closed || controller.signal.aborted || stoppedRuns.has(input.runId)) {
        controller.abort();
        throw new Error("候选组已停止。");
      }
      runs.set(input.runId, { id: input.runId, budget: input.budget, signal: controller.signal });
    })();
    openingCandidateGroups.set(input.runId, operation);
    try {
      await operation;
    } finally {
      openingCandidateGroups.delete(input.runId);
    }
  };
  const createReadOnlyCandidate: PiSubagentTools["createReadOnlyCandidate"] = async (input) => {
    const run = runs.get(input.parentRunId);
    if (!run || run.signal.aborted || stoppedRuns.has(run.id) || !candidateGroups.has(run.id))
      throw new Error("候选必须绑定已获授权且仍有效的候选组。");
    const model = modelEntry(input.modelKey);
    const agent = await options.conversation.agent(BACKGROUND_CONTEXT);
    const tools = agent.tools.filter(
      (tool) =>
        options.capabilities?.filter(tool.name, {
          caller: "fanout",
          mode: "plan",
          readOnly: true,
        }) === true
    );
    const record = await options.conversation.commit(async (tx) => {
      const state = await tx.doc(token, options.conversation.id);
      const key = `fanout:${input.sessionId}`;
      const existing = state.commands[key];
      if (typeof existing === "string")
        return encode(state.children[existing]) as unknown as PiSubagentChild;
      if ((await mailboxInTx(tx)).stoppedRuns[run.id] !== undefined)
        throw new Error("父请求已停止，不能创建候选。");
      const ownerTaskId = await tx.createTask(
        Anchor,
        {},
        {
          ownership: { kind: "conversation" },
          conversationId: options.conversation.id,
          background: true,
        }
      );
      const conversation = await tx.createConversation({
        ownership: { kind: "task", taskId: ownerTaskId },
      });
      await configure(tx, conversation.id, {
        model: { provider: model.providerInstanceId, modelId: model.upstreamModelId },
        tools,
        modelTools: tools,
        cwd: input.cwd,
        instructions: input.instructions,
      });
      const child: PiSubagentChild = {
        kind: "fanout",
        cwd: input.cwd,
        taskId: String(ownerTaskId),
        ownerTaskId: String(ownerTaskId),
        conversationId: String(conversation.id),
        parentConversationId: rootId,
        parentRunId: run.id,
        parentToolCallId: key,
        profileId: "researcher",
        modelKey: input.modelKey,
        depth: 1,
        status: "queued",
        background: true,
        content: "",
        description: input.sessionId,
        scope: {
          scopeId: key,
          profileId: "researcher",
          tools: tools.map((tool) => tool.name),
          effects: ["read", "network"],
          modelKey: input.modelKey,
          depth: 1,
          maxDepth: 1,
          delegationAllowed: false,
        },
        pathScope: null,
        outputPaths: [],
        startedAtMs: Date.now(),
        reporterIds: [],
      };
      await saveInTx(tx, child);
      state.commands[key] = child.conversationId;
      return child;
    }, BACKGROUND_CONTEXT);
    await refresh();
    return { conversationId: record.conversationId, ownerTaskId: record.ownerTaskId };
  };
  for (const definition of schemaControls.registrations())
    registrations.push(
      register(
        definition.toolId,
        definition.parameters,
        async (args, api, context) => {
          const tool = controls(api, context);
          const result =
            definition.toolId === "start_background_task"
              ? await controlPort(api, context)
                  .start({
                    profileId: String(args.profileId),
                    task: String(args.task),
                    description: typeof args.description === "string" ? args.description : "",
                    inputFiles: Array.isArray(args.inputFiles) ? (args.inputFiles as string[]) : [],
                    outputPaths: Array.isArray(args.outputPaths)
                      ? (args.outputPaths as string[])
                      : [],
                    ...(typeof args.modelKey === "string" ? { modelKey: args.modelKey } : {}),
                    commandId: String(args.commandId),
                    rootId,
                    ownerTaskId: String(api.taskId),
                    parentRunId: requireRun().id,
                  })
                  .then((view) => ({
                    output: [{ type: "text" as const, text: JSON.stringify(view) }],
                    isError: false,
                    details: encode(view),
                  }))
              : definition.toolId === "get_subagent_result"
                ? await tool.getSubagentResult({ taskId: String(args.taskId) })
                : definition.toolId === "send_subagent_message"
                  ? await sendMessage({
                      senderConversationId: String(api.conversationId),
                      recipientTaskId: String(args.taskId),
                      message: String(args.message),
                      messageId: String(args.commandId),
                      wake: args.wake === true,
                    }).then((message) => ({
                      output: [{ type: "text" as const, text: JSON.stringify(message) }],
                      isError: false,
                      details: encode(message),
                    }))
                  : definition.toolId === "stop_subagent"
                    ? await tool.stopSubagent({ taskId: String(args.taskId) })
                    : await tool.listSubagents();
          return {
            output: [...result.output],
            isError: result.isError,
            details: encode(result.details),
          };
        },
        definition.replayPolicy === "unsafe" ? "unsafe" : "safe"
      )
    );
  const extension = defineExtension({
    name: "vault-agent-subagents",
    tools: registrations,
    tasks: [Anchor, Reporter, MessageDelivery],
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async (_request, api, context) => {
          const id = String(api.conversationId);
          if (id === rootId) return undefined;
          await refresh();
          const child = children.get(id);
          if (!child || closed) throw new Error("未知或已关闭的子会话不能发起模型请求。");
          const run = runs.get(child.parentRunId);
          if (
            !run ||
            run.signal.aborted ||
            stoppedRuns.has(run.id) ||
            stoppedTasks.has(child.taskId)
          )
            throw new Error("父请求已停止；需要用户明确继续。");
          modelEntry(child.modelKey);
          void context;
          return undefined;
        },
      }),
    ],
  });
  const stopAll = async (): Promise<void> => stopTree();

  return {
    extension,
    registrations: Object.freeze(registrations),
    getModeForConversation: getMode,
    getCaller: (id) =>
      id === rootId ? "root" : children.get(id)?.kind === "fanout" ? "fanout" : "subagent",
    isReadOnly: getReadOnly,
    isPathInScope: (target, id, access = "read") => {
      if (!(options.isPathInScope?.(target) ?? true)) return false;
      if (id === undefined || id === rootId) return true;
      const child = children.get(id);
      if (!child || (access === "write" && getReadOnly(id))) return false;
      const pathScope = child.pathScope;
      if (pathScope === undefined && !getReadOnly(id)) return false;
      // 旧会话保留原授权，新创建任务只接受显式 outputPaths，不能把输入文件重新当作写入许可。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (access === "write" && child.outputPaths !== undefined)
        return child.outputPaths.includes(normalizedSubagentPath(target));
      return pathScope == null || pathScope.includes(normalizedSubagentPath(target));
    },
    getInstructionContextForConversation: (id) => {
      const child = children.get(id);
      if (!child) return null;
      return {
        roleInstructions:
          child.kind === "fanout"
            ? ""
            : (child.roleInstructions ?? subagentProfile(child.profileId)?.instructions ?? ""),
        profileId: child.profileId,
        readOnly: getReadOnly(id),
        pathScope: child.pathScope,
        outputPaths: child.outputPaths ?? EMPTY_PATHS,
        ...(child.cwd ? { cwd: child.cwd } : {}),
      };
    },
    getModelKeyForConversation: (id) =>
      id === rootId ? options.getModelKey() : (children.get(id)?.modelKey ?? null),
    getParentRunIdForConversation: (id) =>
      id === rootId ? (options.getRun()?.id ?? null) : (children.get(id)?.parentRunId ?? null),
    getChildTaskForConversation: (id) => children.get(id) ?? null,
    readChildHistory: async (id) => {
      if (!children.has(id)) throw new Error("该子会话不属于当前任务。");
      const conversation = await options.harness.conversation(
        Number(id) as ConversationId,
        BACKGROUND_CONTEXT
      );
      if (!conversation) throw new Error("子会话不存在。");
      const entries: EntryRecord[] = [];
      let cursor;
      do {
        const page = await conversation.entries(
          { order: "ascending" },
          200,
          cursor,
          BACKGROUND_CONTEXT
        );
        entries.push(...page.items);
        cursor = page.next;
      } while (cursor);
      return Object.freeze(entries);
    },
    list: async () => {
      await refresh();
      return children.size ? Object.freeze([...children.values()]) : EMPTY_CHILDREN;
    },
    messages: async () => {
      const state = await options.harness.snapshot(
        mailboxToken,
        options.conversation.id,
        BACKGROUND_CONTEXT
      );
      return Object.freeze(
        Object.values(state?.messages ?? {}) as unknown as SubagentMessageEnvelope[]
      );
    },
    sendMessage,
    wait,
    stop: stopTree,
    createReadOnlyCandidate,
    beginCandidateGroup,
    stopCandidateGroup: (runId) => stopTree(undefined, runId),
    setCandidateState: async (conversationId, status, result) => {
      await refresh();
      const child = children.get(conversationId);
      if (child?.kind !== "fanout") throw new Error("未知的只读候选任务。");
      if (status === "running") requireConversationRun(conversationId);
      // 停止后才返回的结果可以保存，但不能把已停止的任务重新标成成功。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const effectiveStatus =
        stoppedTasks.has(child.taskId) && !["completed", "failed"].includes(child.status)
          ? child.status
          : status;
      await save({
        ...child,
        status: effectiveStatus,
        ...result,
        ...(["completed", "failed", "cancelled"].includes(status) ? { endedAtMs: Date.now() } : {}),
      });
    },
    runCandidate: async (conversationId, action, signal) => {
      await refresh();
      const child = children.get(conversationId);
      if (child?.kind !== "fanout") throw new Error("未知的只读候选任务。");
      const run = requireConversationRun(conversationId);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      run.signal.addEventListener("abort", abort, { once: true });
      if (signal?.aborted || run.signal.aborted) controller.abort();
      try {
        return await scheduled(`candidate:${child.taskId}`, child, action, controller.signal);
      } finally {
        signal?.removeEventListener("abort", abort);
        run.signal.removeEventListener("abort", abort);
      }
    },
    beginRun: async (run) => {
      if (closed || run.signal.aborted) throw new Error("新执行段需要仍有效的用户请求。");
      // 明确的新用户输入可续用 WorkItem，但不能继承旧执行段的根 Stop；旧子任务停止标记继续保留。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      await options.conversation.commit(async (tx) => {
        const mailbox = await tx.doc(mailboxToken, options.conversation.id);
        delete mailbox.stoppedRuns[run.id];
      }, BACKGROUND_CONTEXT);
      stoppedRuns.delete(run.id);
      runs.set(run.id, run);
      const saved = await options.harness.snapshot(
        token,
        options.conversation.id,
        BACKGROUND_CONTEXT
      );
      // 只有明确的新执行段交付同任务的待处理报告；打开历史只展示，报告本身不增加模型请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      for (const value of Object.values(saved?.reports ?? {})) {
        const record = value as unknown as ReportDeliveryRecord;
        if (record.parentRunId === run.id && !record.consumed)
          await reportService.deliver({ ...record, epochAtStart: 0, status: "completed" });
      }
    },
    resume: async (taskId, resumeOptions) => {
      await refresh();
      const child = childByTask(taskId);
      if (!child) throw new Error("子会话不存在。");
      const active = options.getRun();
      if (closed || !active || active.signal.aborted)
        throw new Error("恢复子任务需要用户明确继续当前请求。");
      const run = options.resolveRun ? await options.resolveRun(child.parentRunId) : active;
      if (run.id !== child.parentRunId || run.signal.aborted)
        throw new Error("恢复子任务必须使用原任务的授权和额度。");
      await options.conversation.commit(async (tx) => {
        const mailbox = await tx.doc(mailboxToken, options.conversation.id);
        delete mailbox.stoppedRuns[run.id];
        if (mailbox.stoppedTasks) delete mailbox.stoppedTasks[child.taskId];
      }, BACKGROUND_CONTEXT);
      stoppedRuns.delete(run.id);
      stoppedTasks.delete(child.taskId);
      runs.set(run.id, run);

      // 答案可能已经落库、但进程尚未保存产品映射就退出；恢复时先读真实提交，不能让用户再付一次模型费用：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const settled = child.latestRequestId
        ? await options.harness.commit(
            (tx) =>
              tx.submissionByRequest(
                Number(child.conversationId) as ConversationId,
                child.latestRequestId!
              ),
            BACKGROUND_CONTEXT
          )
        : undefined;
      if (settled?.type === "input" && settled.status === "done") {
        const answer = await answerFrom(String(settled.answer));
        if (!answer.text.trim()) throw new Error("子任务已结束但没有可恢复的实际答案。");
        const completed = {
          ...child,
          status: "completed",
          answer: answer.text,
          answerEntryId: answer.entryId,
          endedAtMs: child.endedAtMs ?? Date.now(),
        };
        await save(completed, lifecycle(completed));
        if (child.background)
          await reportService.deliver({
            rootId,
            parentRunId: run.id,
            parentToolCallId: parentCardId(child),
            childConversationId: child.conversationId,
            answerEntryId: answer.entryId,
            text: answer.text,
            epochAtStart: 0,
            status: "completed",
          });
        return;
      }
      const inspection = await options.harness.inspect(BACKGROUND_CONTEXT);
      const live = inspection.tasks.some(
        (task) =>
          child.reporterIds.includes(String(task.record.id)) ||
          String(task.record.conversationId) === child.conversationId ||
          String(task.record.id) === child.parentToolTaskId
      );
      if (live || settled?.status === "queued" || settled?.status === "placed") {
        // 未完成的写作任务恢复原 SDK 输入和 Reporter；重发任务正文会以新工具身份重复已经保存的修改。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        await save({ ...child, status: "queued" });
        if (!resumeOptions?.deferScheduling) options.harness.resume();
        return;
      }
      if (!child.background) return;
      await addReporter(
        child,
        child.latestContent ?? child.content,
        `resume:${child.taskId}:${run.id}:${child.reporterIds.length}`,
        (change, executionContext) => options.harness.commit(change, executionContext),
        BACKGROUND_CONTEXT,
        undefined,
        run
      );
      if (!resumeOptions?.deferScheduling) options.harness.resume();
    },
    waitForBackground: async () => {
      await refresh();
      const ids = [...children.values()].flatMap((child) => child.reporterIds);
      const mailbox = await options.harness.snapshot(
        mailboxToken,
        options.conversation.id,
        BACKGROUND_CONTEXT
      );
      ids.push(
        ...Object.values(mailbox?.deliveries ?? {}).filter(
          (id): id is string => typeof id === "string"
        )
      );
      await Promise.all(
        ids.map((id) => options.harness.waitForTask(Number(id) as TaskId, BACKGROUND_CONTEXT))
      );
      await scheduler.drain();
      await refresh();
    },
    stopAll,
    dispose: async (disposeOptions) => {
      if (closed) return;
      closed = true;
      for (const wake of waits) wake();
      reportService.onHostClosed();
      for (const controller of candidateGroups.values()) controller.abort();
      try {
        if (!disposeOptions?.preservePending) await stopAll();
      } catch (error) {
        // 存储失败后 SDK 已关闭任务，不能因再次读失败而漏掉观察者和宿主资源清理：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (!(error instanceof SessionFailed)) throw error;
      } finally {
        for (const watch of watches.values()) await watch.stop();
        watches.clear();
        runs.clear();
      }
    },
  };
}

function normalizedSubagentPath(target: string): string {
  return target
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}
