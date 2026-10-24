import { assertSteerText, submitSteerInput } from "@/agentMode/sdk/pi/runtime/SteerInput";
import {
  restoreUnsentRootInput,
  storeUnsentRootInput,
  type UnsentRootInput,
} from "@/agentMode/sdk/pi/runtime/UnsentRootInput";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { formatDateTime } from "@/utils";
import { applyRequestCapabilities } from "@/agentMode/sdk/pi/runtime/RequestCapabilities";
import {
  deriveSdkToolRejection,
  readSdkToolRejections,
  type SdkToolRejection,
} from "@/agentMode/sdk/pi/tools/SdkToolRejections";
import { formatToolOutcomeMetadata } from "@/agentMode/sdk/pi/models/ModelToolResults";
import type { ToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";
import {
  recordToolProgress,
  type ProgressGuardState,
} from "@/agentMode/sdk/pi/runtime/ProgressGuard";
import {
  CapabilityCatalog,
  type CapabilityContext,
} from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import {
  createWorkItemStore,
  type WorkItemStore,
  type WorkItem,
} from "@/agentMode/sdk/pi/storage/WorkItemStore";
import {
  getMutationJournalDoc,
  type MutationDocState,
  createDurableMutationJournal,
  createDurableNativeMutationJournal,
} from "@/agentMode/sdk/pi/storage/DurableMutationJournal";
import {
  buildPriorFanoutContextBlock,
  renderFanoutComposite,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import {
  preparePiRuntimeInput,
  dispatchPiRuntimeCommand,
} from "@/agentMode/sdk/pi/runtime/PiRuntimeInput";
import { buildTurnFileChange } from "@/agentMode/session/turnFileChanges";
import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import type {
  AgentEvent,
  AgentEventStream,
  Conversation,
  ConversationId,
  Cursor,
  EntryRecord,
  Harness as DurableHarness,
  Storage,
  JsonObject,
  ConversationDocToken,
  CompactionResult,
  TaskId,
  TaskRecord,
} from "@earendil-works/pi-durable";
import type { ModelThinkingLevel, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { VaultAgentSettings } from "@/settings/model";
import type {
  AgentChatMessage,
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  BackendState,
  OpenSessionInput,
  PermissionDecision,
  PermissionPrompt,
  PromptInput,
  PromptOutput,
  SessionUpdate,
  SessionUpdateHandler,
  VaultAgentMode,
  TurnFileChange,
  RecoveryStateUpdate,
  FileChangeRevertResult,
} from "@/agentMode/session/types";
import type { KeychainPort } from "@/agentMode/sdk/pi/models/KeychainCredentialStore";
import type { ProviderStreamsFactory } from "@/agentMode/sdk/pi/models/ProviderFactory";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { StoreLocator, assertHostRootId } from "@/agentMode/sdk/pi/storage/StoreLocator";
import { StoreLease } from "@/agentMode/sdk/pi/storage/StoreLease";
import { DurableStore, type DurableStoreHandle } from "@/agentMode/sdk/pi/storage/DurableStore";
import {
  createPiModels,
  type PiRuntimeModels,
  type PiProviderDispatch,
  type PiProviderStream,
  type PiModelContextPreparation,
} from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";
import { ProviderGuard } from "@/agentMode/sdk/pi/models/ProviderGuard";
import { AuditLog } from "@/agentMode/sdk/pi/policy/AuditLog";
import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";
import { configuredPiCatalog } from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";
import {
  modelEntriesFromCatalog,
  resolveModelEntry,
  validateEffort,
  transitionMode,
} from "@/agentMode/sdk/pi/models/ModelSelection";
import { EventTranslator, type TranslatedEvent } from "@/agentMode/sdk/pi/events/EventTranslator";
import { createVaultHostTools } from "@/agentMode/sdk/pi/tools/VaultHostTools";
import { RunBudget, type BudgetReserveRecord } from "@/agentMode/sdk/pi/runtime/RunBudget";
import { projectBudget } from "@/agentMode/sdk/pi/features/BudgetProjection";
import { sha256 } from "@/utils/hash";
import {
  createPiFeatureTools,
  type PiFeatureTools,
} from "@/agentMode/sdk/pi/runtime/PiFeatureTools";
import type { SkillCatalogSourcePort } from "@/agentMode/sdk/pi/features/SkillsCatalog";
import type { ContextBuilderInput } from "@/agentMode/sdk/pi/features/ContextBuilder";
import { createPiMcpTools, type PiMcpTools } from "@/agentMode/sdk/pi/mcp/createPiMcpTools";
import {
  createPiSubagentTools,
  type PiSubagentTools,
} from "@/agentMode/sdk/pi/runtime/PiSubagentTools";
import type { LegacyChatEntry } from "@/agentMode/session/legacy/LegacyHistoryReader";
import { LegacyImport, type LegacyImportMapping } from "@/agentMode/sdk/pi/storage/LegacyImport";
import { SessionExport, type SessionExportInput } from "@/agentMode/sdk/pi/storage/SessionExport";
import { PiRuntimeProjection } from "@/agentMode/sdk/pi/runtime/PiRuntimeProjection";
import { PiRuntimeEventBarrier } from "@/agentMode/sdk/pi/runtime/PiRuntimeEventBarrier";
import {
  createPiNativeHostTools,
  type PiNativeHostTools,
} from "@/agentMode/sdk/pi/tools/PiNativeHostTools";
import { RuntimePool } from "@/agentMode/sdk/pi/runtime/RuntimePool";
import {
  createPiRuntimeApprovals,
  type PiRuntimeApprovals,
} from "@/agentMode/sdk/pi/runtime/PiRuntimeApprovals";
import {
  StoreSizePolicy,
  STORE_SIZE_PAUSE_BYTES,
} from "@/agentMode/sdk/pi/storage/StoreSizePolicy";
import { logError, logWarn } from "@/logger";
import { defaultEnabledProfiles } from "@/agentMode/sdk/pi/features/subagents/Profiles";
import {
  createPiRuntimeRecovery,
  readPiRecoverySnapshot,
  type PiRuntimeRecovery,
  type PiRecoverySnapshot,
} from "@/agentMode/sdk/pi/runtime/PiRuntimeRecovery";
import {
  compactionPolicyForWindow,
  requireModelContextWindow,
  MIN_MODEL_CONTEXT_WINDOW,
} from "@/agentMode/sdk/pi/models/ModelWindowPolicy";

export interface PiHostOptions {
  readonly app: App;
  readonly keychain: KeychainPort;
  readonly getSettings: () => VaultAgentSettings;
  readonly privateRoot?: string;
  readonly streamsFactory?: ProviderStreamsFactory;
  readonly fetch?: typeof window.fetch;
  readonly webSearch?: (
    query: string,
    signal?: AbortSignal
  ) => Promise<{ content: string; citations: string[] }>;
  readonly skillsSource?: SkillCatalogSourcePort;
  readonly getProjectContext?: (
    projectId: string
  ) => NonNullable<PromptInput["context"]>["project"] | null;
  readonly subscribeSettings?: (listener: () => void) => () => void;
  readonly getInstructions?: () => string;
  readonly getInstructionSections?: () => Pick<
    ContextBuilderInput,
    "base" | "toolGuidance" | "userSystem"
  >;
  readonly isVaultPathAllowed?: (path: string) => boolean;
  readonly isInstructionPathAllowed?: (path: string) => boolean;
  readonly notify?: (message: string) => void;
}

export interface PiRuntimeCallbacks {
  readonly emit: SessionUpdateHandler;
  readonly permission: (request: PermissionPrompt) => Promise<PermissionDecision>;
  readonly ask: (request: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;
  readonly readOnly: (sessionId: string) => boolean;
}

interface SessionMetadata {
  readonly sessionId: string;
  readonly cwd: string;
  readonly createdAt: string;
  readonly title: string | null;
  modelId: string | null;
  effort: string | null;
  mode: VaultAgentMode;
  readOnly?: boolean;
  archivedAtMs?: number;
  sourceSessionId?: string;
  sourceEntryId?: string;
  continuationWorkItemId?: string;
  readonly parentSessionId?: string;
  readonly parentRunId?: string;
  readonly projectId?: string;
  conversationId?: string;
  unsentInput?: UnsentRootInput;
}

interface OpenRoot {
  readonly audit: Pick<AuditLog, "record">;
  readonly capabilities: CapabilityCatalog;
  readonly capabilityContext: (conversationId: string) => CapabilityContext;
  readonly metadata: SessionMetadata;
  readonly models: PiRuntimeModels;
  readonly harness: DurableHarness;
  readonly conversation: Conversation;
  readonly store: DurableStoreHandle;
  readonly watch: AgentEventStream;
  readonly translator: EventTranslator;
  readonly vaultTools: Awaited<ReturnType<typeof createVaultHostTools>>;
  readonly entries: Map<string, EntryRecord>;
  readonly streamEpoch: string;
  readonly privateDir: string;
  readonly features: PiFeatureTools;
  readonly ownerSessionId: string;
  readonly mcp: PiMcpTools;
  readonly subagents: PiSubagentTools;
  readonly native: PiNativeHostTools;
  readonly runs: Map<string, NonNullable<OpenRoot["run"]>>;
  readonly sdkToolRejections: Map<string, SdkToolRejection>;
  sdkToolRejectionChain: Promise<void>;
  steerSourceChain: Promise<void>;
  steerAdmission: Promise<void> | null;
  steerRequestId?: string;
  steerRejected: boolean;
  readonly acceptedSteers: Set<string>;
  recovery: PiRuntimeRecovery | null;
  approvals: PiRuntimeApprovals | null;
  activeBackgroundTaskIds: readonly string[];
  pendingQuestions: readonly AskUserQuestionPrompt[];
  pendingPlan: import("@/agentMode/session/types").CurrentPlan | null;
  storageFailed: boolean;
  readonly mutationDoc: ConversationDocToken<MutationDocState>;
  readonly workItems: WorkItemStore;
  pauseRequested: boolean;
  stalledRunId?: string;
  frameIndex: number;
  busy: boolean;
  work: Promise<unknown> | null;
  pending: AbortController | null;
  run: {
    readonly id: string;
    readonly requestId: string;
    readonly controller: AbortController;
    readonly startedAt: number;
    readonly budget: RunBudget;
    status: "active" | "cancelled" | "finished";
    purpose: "root" | "compaction" | "fanout" | "subagent";
  } | null;
  fileChanges: readonly TurnFileChange[];
}

const EMPTY_BACKGROUND_TASK_IDS: readonly string[] = Object.freeze([]);
const EMPTY_PERMISSIONS: readonly PermissionPrompt[] = Object.freeze([]);
const EMPTY_QUESTIONS: readonly AskUserQuestionPrompt[] = Object.freeze([]);

export class PiRuntime {
  private readonly fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  private readonly path = requireNodeModule<typeof import("node:path")>("node:path");
  private readonly crypto = requireNodeModule<typeof import("node:crypto")>("node:crypto");
  private readonly roots = new Map<string, OpenRoot>();
  private readonly projections = new WeakMap<OpenRoot, PiRuntimeProjection>();
  private readonly eventBarriers = new WeakMap<OpenRoot, PiRuntimeEventBarrier>();
  private readonly pendingCompactions = new WeakMap<OpenRoot, Set<string>>();
  private readonly opening = new Map<string, Promise<OpenRoot>>();
  private readonly pausingRoots = new Set<string>();
  private readonly pauseOperations = new Map<string, Promise<void>>();
  private readonly checkpointChains = new Map<string, Promise<void>>();
  private readonly budgets = new Map<string, Promise<RunBudget>>();
  private readonly locator: StoreLocator;
  private readonly vaultRoot: string;
  private readonly pool: RuntimePool;
  private readonly openRequests = new Map<
    string,
    { cwd: string; create: boolean; input?: OpenSessionInput }
  >();
  private readonly observedSessions = new Set<string>();
  private readonly observedOwners = new Set<string>();
  private readonly closingRoots = new Set<string>();
  private readonly resourceClosures = new Map<string, Promise<void>>();
  private readonly sessionOperations = new Map<string, number>();
  private readonly operationOwners = new Map<string, string>();
  private readonly rollovers = new Map<string, AbortController>();
  private readonly readOnlyRoots = new Map<
    string,
    { readonly snapshot: PiRecoverySnapshot; readonly recovery: RecoveryStateUpdate }
  >();
  private closed = false;
  private readonly metadataWrites = new Map<string, Promise<unknown>>();
  private readonly writerRoots = new Set<string>();
  private readonly unsentAdmissions = new Map<
    string,
    { controller: AbortController; saved: Promise<void> }
  >();
  private readonly unsentInputs = new Map<string, UnsentRootInput>();

  constructor(
    private readonly host: PiHostOptions,
    private readonly callbacks: PiRuntimeCallbacks
  ) {
    const os = requireNodeModule<typeof import("node:os")>("node:os");
    const adapter = host.app.vault.adapter;
    const vaultRoot =
      adapter instanceof FileSystemAdapter
        ? adapter.getBasePath()
        : "getBasePath" in adapter && typeof adapter.getBasePath === "function"
          ? String(adapter.getBasePath())
          : null;
    if (!vaultRoot) throw new Error("Pi requires a local desktop vault.");
    this.vaultRoot = vaultRoot;
    this.locator = new StoreLocator({
      platform: process.platform,
      homeDir: host.privateRoot ?? os.homedir(),
      env: host.privateRoot ? {} : process.env,
      vaultRoot,
      vaultId: host.keychain.getVaultId(),
    });
    this.pool = new RuntimePool({
      openRuntime: async (rootKey) => {
        const request = this.openRequests.get(rootKey);
        if (!request) throw new Error("The Pi session has no pending open request.");
        return {
          rootKey,
          handle: await this.openRoot(rootKey, request.cwd, request.create, request.input),
        };
      },
      closeRuntime: async (runtime, reason) => {
        if (reason === "close") return this.closeResources(runtime.rootKey);
        // 回收执行资源要保留待恢复事实，不能把仍可见的闲聊当作用户点击了 Stop。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const alreadyPausing = this.pausingRoots.has(runtime.rootKey);
        this.pausingRoots.add(runtime.rootKey);
        const closing = this.closeResources(runtime.rootKey);
        this.resourceClosures.set(runtime.rootKey, closing);
        try {
          await closing;
        } finally {
          this.resourceClosures.delete(runtime.rootKey);
          if (!alreadyPausing) this.pausingRoots.delete(runtime.rootKey);
        }
      },
      isInUse: (rootKey) => this.hasSessionOperation(rootKey),
      cancelRuntime: async (runtime) => {
        if (!this.closed && !this.pausingRoots.has(runtime.rootKey))
          await this.cancel(runtime.rootKey, true);
      },
      archiveRuntime: async (runtime) => this.archiveRoot(runtime.handle as OpenRoot),
      sizePolicy: new StoreSizePolicy({
        measureBytes: (rootKey) =>
          this.measureStoreBytes(this.locator.sessionStorePaths(rootKey).storeDir),
      }),
      activity: async (rootKey) => {
        const owner = this.roots.get(rootKey);
        const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
        // 关闭中的执行者只保留占位等收尾，不能由最后一个任务的资源归还再次读取已关闭 SDK。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        // 冷开只投影未完记录；真实执行过的 owner 留有 run，不能把仍在运行的后台树当冷恢复回收。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const dormant =
          owner?.recovery?.blocked === true &&
          ![...this.roots.values()].some(
            (root) => root.ownerSessionId === rootKey && (root.busy || root.run !== null)
          ) &&
          !this.hasSessionOperation(rootKey);
        const live =
          owner &&
          !dormant &&
          !owner.pauseRequested &&
          !this.closed &&
          !this.closingRoots.has(rootKey)
            ? await owner.harness.inspect(BACKGROUND_CONTEXT)
            : null;
        return {
          activeForegroundTasks:
            [...this.roots.values()].filter(
              (root) =>
                root.ownerSessionId === rootKey && (root.busy || root.run?.status === "active")
            ).length +
            (dormant ? 0 : (owner?.approvals?.recoveryApprovals().length ?? 0)) +
            (dormant ? 0 : (owner?.pendingQuestions.length ?? 0)) +
            (dormant ? 0 : owner?.pendingPlan ? 1 : 0) +
            (live?.tasks.filter((task) => !task.record.background).length ?? 0) +
            (live?.submissions.length ?? 0),
          activeBackgroundTasks: live?.tasks.filter((task) => task.record.background).length ?? 0,
        };
      },
    });
  }

  async open(input: OpenSessionInput): Promise<{ sessionId: string; state: BackendState }> {
    const sessionId = input.sessionId ?? `root-${this.crypto.randomUUID()}`;
    return this.withSessionOperation(sessionId, async () => {
      input.signal?.throwIfAborted();
      let closing: Promise<void> | undefined;
      const abort = () => {
        closing ??= this.close(sessionId);
        void closing.catch((error) =>
          logWarn("[PiRuntime] queued initialization close failed", error)
        );
      };
      input.signal?.addEventListener("abort", abort, { once: true });
      try {
        const root = await this.getRoot(sessionId, input.cwd, true, input);
        input.signal?.throwIfAborted();
        return { sessionId, state: this.stateOf(root) };
      } finally {
        input.signal?.removeEventListener("abort", abort);
        await closing;
      }
    });
  }

  async load(sessionId: string, cwd: string): Promise<{ sessionId: string; state: BackendState }> {
    return this.withSessionOperation(sessionId, async () => {
      try {
        const root = await this.getRoot(sessionId, cwd, false, undefined, false, false);
        this.readOnlyRoots.delete(sessionId);
        await this.reconcileUnsentInput(root);
        await this.replay(sessionId);
        return { sessionId, state: this.stateOf(root) };
      } catch (error: unknown) {
        const { SessionFailed } = await import("@earendil-works/pi-durable");
        if (error instanceof SessionFailed)
          return this.loadReadOnlySnapshot(
            sessionId,
            Object.assign(new Error(error.message), { code: "STORAGE_FAILED", cause: error })
          );
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          (error.code !== "STORE_VERSION_UNSUPPORTED" &&
            error.code !== "STORAGE_FAILED" &&
            error.code !== "SESSION_ARCHIVED" &&
            error.code !== "RUNTIME_BUSY")
        )
          throw error;
        return this.loadReadOnlySnapshot(sessionId, error);
      }
    });
  }

  async recoverSession(input: {
    sessionId: string;
    action: "continue" | "abort" | "reconcile";
  }): Promise<void> {
    return this.withSessionOperation(input.sessionId, async () => {
      const draft =
        this.unsentInputs.get(input.sessionId) ??
        (await this.readMetadata(input.sessionId))?.unsentInput;
      if (draft?.kind === "prompt" && !this.unsentAdmissions.has(input.sessionId)) {
        if (input.action === "abort") {
          await this.saveUnsentInput(input.sessionId, null);
          const root = this.roots.get(input.sessionId);
          if (root) {
            await root.recovery?.safeBoundary();
            this.emitProjection(root);
          }
          return;
        }
        if (input.action === "continue") {
          if (this.readOnlyRoots.has(input.sessionId))
            throw new Error("当前只读历史尚无执行位置，请先重新载入。");
          if (!this.roots.has(input.sessionId)) {
            const directory = this.path.dirname(
              this.locator.sessionStorePaths(input.sessionId).metaPath
            );
            const restored = await restoreUnsentRootInput(draft, directory);
            if (restored.kind === "prompt") await this.prompt(restored.input);
            return;
          }
          const root = await this.activeRoot(input.sessionId);
          root.recovery?.assertCanStartWork();
          const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
          const previous = draft.input.requestId
            ? await root.harness.commit(
                (tx) => tx.submissionByRequest(root.conversation.id, draft.input.requestId!),
                BACKGROUND_CONTEXT
              )
            : undefined;
          if (previous) {
            await this.saveUnsentInput(input.sessionId, null);
            await root.recovery?.safeBoundary();
            if (previous.type === "input" && previous.status !== "done")
              await root.recovery?.recover("continue");
            await this.replay(input.sessionId);
            return;
          }
          const restored = await restoreUnsentRootInput(draft, root.privateDir);
          if (restored.kind !== "prompt") throw new Error("待发请求类型不匹配。");
          await this.prompt(restored.input);
          return;
        }
      }
      const readOnly = this.readOnlyRoots.get(input.sessionId);
      if (readOnly?.recovery.reloadAvailable && input.action === "reconcile") {
        const metadata = await this.readMetadata(input.sessionId);
        if (!metadata) throw new Error("没有可核对的会话信息；原始记录已保留，请修复后重新载入。");
        const loaded = await this.load(input.sessionId, metadata.cwd);
        this.emit(input.sessionId, { sessionUpdate: "state_changed", state: loaded.state });
        return;
      }
      if (readOnly) throw new Error("这份记录需要兼容版本或修复原始数据；当前只允许读取和导出。");
      const root = await this.activeRoot(input.sessionId);
      if (!root.recovery?.state) return;
      if (root.busy) throw new Error("请等待当前工作结束后再恢复。");
      root.busy = true;
      try {
        if (input.action === "continue") {
          const latest = [...root.entries.values()]
            .filter((entry) => entry.kind === "va.run")
            .at(-1)?.data;
          if (
            latest &&
            typeof latest === "object" &&
            !Array.isArray(latest) &&
            typeof latest.runId === "string"
          ) {
            let item = await root.workItems.read(latest.runId);
            if (item?.status === "paused_storage")
              throw new Error("这段记录接近容量上限，请选择“总结并新建会话”保留进度并续段。");
            if (item?.status === "active" && root.recovery.state.status === "available") {
              const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
              const unfinished = await root.harness.inspect(BACKGROUND_CONTEXT);
              if (unfinished.tasks.length || unfinished.submissions.length) {
                // 退出进程保留 active 检查点；用户明确继续同样只授予一个新执行段。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
                await root.workItems.checkpoint(
                  item.id,
                  { ...item.checkpoint, reason: "user_continued_interrupted_work" },
                  "paused_user"
                );
                item = await root.workItems.read(item.id);
              }
            }
            if (
              item?.status === "paused_budget" ||
              item?.status === "paused_stalled" ||
              item?.status === "paused_user"
            ) {
              await root.workItems.authorizeNextSegment(item.id);
              this.budgets.delete(`${root.ownerSessionId}:${item.id}`);
            }
          }
        }
        await root.recovery.recover(input.action);
        if (input.action === "abort") await this.settlePausedRunAfterAbort(root);
      } finally {
        root.busy = false;
      }
      await this.replay(input.sessionId);
      this.emit(input.sessionId, { sessionUpdate: "state_changed", state: this.stateOf(root) });
    });
  }

  async rolloverSession(input: {
    sessionId: string;
  }): Promise<{ sessionId: string; state: BackendState }> {
    return this.withSessionOperation(input.sessionId, async () => {
      const source = await this.activeRoot(input.sessionId);
      if (this.rollovers.has(input.sessionId)) throw new Error("这段聊天正在整理，请等待完成。");
      const controller = new AbortController();
      this.rollovers.set(input.sessionId, controller);
      let provisionalId: string | undefined;
      let activated = false;
      try {
        let carriedWork: WorkItem | null = null;
        const paused = source.recovery?.state?.interruptedRun;
        if (paused?.status === "paused_storage") {
          carriedWork = await source.workItems.read(paused.runId);
          await source.recovery?.recover("reconcile");
          if (source.recovery?.state?.pendingMutationIds.length)
            throw new Error("请先核对实际文件结果，再整理到新聊天。");
          await source.recovery?.recover("abort");
          await this.settlePausedRunAfterAbort(source);
        }
        await this.assertArchiveBoundary(source);
        if (carriedWork) {
          await this.checkpointWorkItem(
            source,
            carriedWork.id,
            "rollover_authorized",
            [],
            0,
            "paused_budget"
          );
          await source.workItems.authorizeNextSegment(carriedWork.id);
          this.budgets.delete(`${source.ownerSessionId}:${carriedWork.id}`);
          source.metadata.continuationWorkItemId = carriedWork.id;
        }
        source.busy = true;
        source.pending = controller;
        const previousSummaries = new Set(
          [...source.entries.values()]
            .filter((entry) => entry.kind === "pi.compaction")
            .map((entry) => String(entry.id))
        );
        // 总结是用户明确选择的收尾动作，超出存储上限时仍允许它完成，但不接纳新的用户任务：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const requestId = `rollover-${this.crypto.randomUUID()}`;
        const summaryWork = this.runPrompt(
          source,
          { sessionId: input.sessionId, requestId, prompt: [{ type: "text", text: "/compact" }] },
          requestId
        );
        source.work = summaryWork;
        const result = await summaryWork;
        source.work = null;
        source.busy = false;
        if (controller.signal.aborted || result.stopReason === "cancelled")
          throw new Error("已停止总结，原聊天没有归档。");
        const summary = [...source.entries.values()]
          .filter(
            (entry) => entry.kind === "pi.compaction" && !previousSummaries.has(String(entry.id))
          )
          .at(-1);
        if (!summary?.model?.length && !carriedWork)
          throw new Error("当前内容尚不足以生成实际摘要；原聊天已保留。");
        const summaryText =
          summary?.model
            ?.flatMap((message) =>
              typeof message.content === "string"
                ? [message.content]
                : message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
            )
            .join("\n") ??
          (carriedWork
            ? [
                carriedWork.checkpoint.goal,
                ...carriedWork.checkpoint.remainingItems,
                carriedWork.checkpoint.nextStep,
              ].join("\n")
            : "");
        if (!summaryText.trim()) throw new Error("模型没有提供可保存的摘要，原聊天没有归档。");
        const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
        const compactedContext = await source.conversation.context(BACKGROUND_CONTEXT);
        if (summary && compactedContext.head?.id !== summary.id)
          throw new Error("摘要已不再是当前有效上下文；原聊天没有归档。");
        const sourceEntryId = summary?.id ?? compactedContext.entries.at(-1)?.id;
        if (sourceEntryId === undefined) throw new Error("没有可核对的原始记录可用于续段。");
        // 官方压缩只替换旧前缀，最近对话仍在摘要后；滚动必须完整携带它们，当前宿主系统规则由新根重新生成。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const carriedContext = compactedContext.messages.filter(
          (message) => message.role !== "system"
        );
        await this.assertArchiveBoundary(source);
        // 先关闭空闲写入者再准备只读新根，双窗口时也不突破两个打开 store 的上限：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (carriedWork) carriedWork = (await source.workItems.read(carriedWork.id)) ?? carriedWork;
        await this.pool.close(input.sessionId);
        provisionalId = `root-${this.crypto.randomUUID()}`;
        const nextId = provisionalId;
        return await this.withSessionOperation(nextId, async () => {
          const next = await this.getRoot(nextId, source.metadata.cwd, true, {
            cwd: source.metadata.cwd,
            projectId: source.metadata.projectId,
            readOnly: true,
          });
          if (source.metadata.modelId) await this.setModel(nextId, source.metadata.modelId);
          Object.assign(next.metadata, {
            mode: source.metadata.mode,
            sourceSessionId: input.sessionId,
            sourceEntryId: String(sourceEntryId),
          });
          const { defineDoc } = await import("@earendil-works/pi-durable");
          const sessionDoc = defineDoc<JsonObject>({
            kind: "va.session",
            version: 1,
            scope: "conversation",
            history: "rewindable",
            fork: "initial",
            initial: () => ({ rootId: nextId, source: null, selectedModelKey: null }),
          });
          await next.conversation.commit(async (tx) => {
            const state = await tx.doc(sessionDoc, next.conversation.id);
            state.source = {
              backendId: "pi",
              sessionId: input.sessionId,
              summaryEntryId: String(sourceEntryId),
            };
            state.selectedModelKey = next.metadata.modelId;
            await tx.appendEntry(next.conversation.id, {
              kind: "va.material",
              data: {
                origin: {
                  backendId: "pi",
                  sourceSessionId: input.sessionId,
                  sourceEntryId: String(sourceEntryId),
                },
                sourcePath: `pi:${input.sessionId}`,
                importMode: summary ? "summary" : "checkpoint",
                truncated: false,
                contentHash: sha256(JSON.stringify(carriedContext)),
                text: summaryText,
              },
              model: JSON.parse(JSON.stringify(carriedContext)) as NonNullable<
                EntryRecord["model"]
              >,
            });
            await tx.appendEntry(next.conversation.id, {
              kind: "va.session",
              data: JSON.parse(JSON.stringify(state)) as JsonObject,
            });
          }, BACKGROUND_CONTEXT);
          if (carriedWork) {
            await next.workItems.importWorkItem({ ...carriedWork, status: "active" });
            next.metadata.continuationWorkItemId = carriedWork.id;
          }
          await this.replay(nextId);
          await next.recovery?.saveSnapshot(this.recoverySnapshot(next));
          await this.saveMetadata(next.metadata);
          await this.pool.close(nextId);
          if (controller.signal.aborted)
            throw new Error("已停止整理；原聊天未归档，新摘要仅作只读保留。");
          const reopenedSource = await this.getRoot(
            input.sessionId,
            source.metadata.cwd,
            false,
            undefined,
            true
          );
          await this.assertArchiveBoundary(reopenedSource);
          const archive = await this.pool.requestArchive(input.sessionId);
          if (archive.kind !== "archived") throw new Error("仍有未结束的工作，原聊天没有归档。");
          await this.pool.close(input.sessionId);
          if (controller.signal.aborted)
            throw new Error("已停止整理；现有聊天和摘要均已保留为只读。");
          const ready = await this.getRoot(nextId, source.metadata.cwd, false);
          ready.metadata.readOnly = false;
          try {
            await this.saveMetadata(ready.metadata);
          } catch (error) {
            ready.metadata.readOnly = true;
            throw error;
          }
          activated = true;
          this.emit(nextId, { sessionUpdate: "state_changed", state: this.stateOf(ready) });
          return { sessionId: nextId, state: this.stateOf(ready) };
        });
      } finally {
        source.busy = false;
        source.work = null;
        source.pending = null;
        try {
          if (provisionalId && !activated) {
            const next = this.roots.get(provisionalId);
            if (next) {
              next.metadata.readOnly = true;
              await this.saveMetadata(next.metadata);
              await this.pool.close(provisionalId);
            }
          }
        } finally {
          this.rollovers.delete(input.sessionId);
        }
      }
    });
  }

  async decidePermission(input: {
    sessionId: string;
    requestId: string;
    decision: PermissionDecision;
  }): Promise<void> {
    return this.withSessionOperation(input.sessionId, async () => {
      const root = await this.activeRoot(input.sessionId);
      if (root.storageFailed || !root.approvals) throw new Error("无法保存批准决定。");
      await root.approvals.decide(input.requestId, input.decision);
      this.emitProjection(root);
    });
  }

  async answerPendingQuestion(input: {
    sessionId: string;
    requestId: string;
    answers: AgentQuestionAnswers;
  }): Promise<void> {
    return this.withSessionOperation(input.sessionId, async () => {
      const root = await this.activeRoot(input.sessionId);
      await root.features.answerPendingQuestion(input.requestId, input.answers);
      await this.refreshPending(root);
      this.emitProjection(root);
    });
  }

  async decidePendingPlan(input: {
    sessionId: string;
    planId: string;
    revision: number;
    action: "approve" | "reject" | "feedback";
    feedback?: string;
  }): Promise<void> {
    return this.withSessionOperation(input.sessionId, async () => {
      const root = await this.activeRoot(input.sessionId);
      await root.features.decidePendingPlan(input);
      await this.refreshPending(root);
      this.emitProjection(root);
    });
  }

  async revertFileChange(input: {
    sessionId: string;
    operationIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<FileChangeRevertResult> {
    return this.withSessionOperation(input.sessionId, async () => {
      const root = await this.activeRoot(input.sessionId);
      root.recovery?.assertCanStartWork();
      if (this.isReadOnly(root)) throw new Error("只读历史不能回退文件。");
      await this.ensureStoreCapacity(root);
      if (root.busy || root.pending) throw new Error("请等待当前工作结束后再回退。");
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) controller.abort();
      root.pending = controller;
      root.busy = true;
      const work = (async () => {
        try {
          const result = await root.vaultTools.revertOperations(
            input.operationIds,
            controller.signal
          );
          await this.replay(input.sessionId);
          return result.ok
            ? { ok: true }
            : { ok: false, code: result.code, message: result.message };
        } finally {
          input.signal?.removeEventListener("abort", abort);
          if (root.pending === controller) root.pending = null;
          root.busy = false;
        }
      })();
      root.work = work;
      try {
        return await work;
      } finally {
        if (root.work === work) root.work = null;
      }
    });
  }

  async list(cwd?: string) {
    const parent = this.path.join(this.locator.vaultStoreRoot, "sessions");
    const names = await this.fs.readdir(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const result = [];
    for (const id of names) {
      const metadata = await this.readMetadata(id);
      if (metadata && (cwd === undefined || metadata.cwd === cwd))
        result.push({
          sessionId: id,
          cwd: metadata.cwd,
          title: metadata.title,
          updatedAt: metadata.createdAt,
        });
    }
    return result;
  }

  async exists(sessionId: string): Promise<boolean> {
    return (await this.readMetadata(sessionId)) !== null;
  }

  async importLegacySession(input: {
    cwd: string;
    entry: LegacyChatEntry;
  }): Promise<{ sessionId: string; state: BackendState; notices: readonly string[] }> {
    if (!/^[a-f0-9]{64}$/.test(input.entry.sourceHash))
      throw new Error("The history source has no valid content hash.");
    return this.withSessionOperation(`root-import-${input.entry.sourceHash}`, async () => {
      const mappings = this.path.join(this.locator.vaultStoreRoot, "imports");
      await this.fs.mkdir(mappings, { recursive: true, mode: 0o700 });
      const importer = new LegacyImport({
        ports: {
          findMapping: async (hash) => {
            try {
              return JSON.parse(
                await this.fs.readFile(this.path.join(mappings, `${hash}.json`), "utf8")
              ) as LegacyImportMapping;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
              throw error;
            }
          },
          createRoot: async ({ sourceHash }) => {
            const sessionId = `root-import-${sourceHash}`;
            await this.open({ sessionId, cwd: input.cwd });
            return { rootId: sessionId, sessionId };
          },
          saveMapping: async (mapping) => {
            const target = this.path.join(mappings, `${mapping.sourceHash}.json`);
            const temporary = `${target}.${this.crypto.randomUUID()}.tmp`;
            await this.fs.writeFile(temporary, JSON.stringify(mapping), { mode: 0o600 });
            await this.fs.rename(temporary, target);
          },
          appendMaterial: async (material) => {
            const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
            const { defineDoc } = await import("@earendil-works/pi-durable");
            const root = await this.getRoot(material.sessionId, input.cwd, false);
            const imports = defineDoc<{ entries: Record<string, string> }>({
              kind: "va.legacy_imports",
              version: 1,
              scope: "conversation",
              history: "rewindable",
              fork: "initial",
              initial: () => ({ entries: {} }),
            });
            let messageId = "";
            await root.conversation.commit(async (tx) => {
              const state = await tx.doc(imports, root.conversation.id);
              const previous = state.entries[material.contentHash];
              if (previous) {
                messageId = previous;
                return;
              }
              const entry = await tx.appendEntry(root.conversation.id, {
                kind: "va.material",
                data: {
                  origin: material.origin,
                  sourcePath: material.sourcePath,
                  contentHash: material.contentHash,
                  importMode: material.importMode,
                  truncated: material.truncated,
                  text: material.text,
                },
                model: [
                  {
                    role: "user",
                    content: [{ type: "text", text: material.text }],
                    timestamp: Date.now(),
                  },
                ],
              });
              messageId = String(entry.id);
              state.entries[material.contentHash] = messageId;
            }, BACKGROUND_CONTEXT);
            await this.replay(material.sessionId);
            return { messageId };
          },
        },
      });
      const imported = await importer.importEntry(input.entry);
      const root = await this.getRoot(imported.sessionId, input.cwd, false);
      return {
        sessionId: imported.sessionId,
        state: this.stateOf(root),
        notices: imported.notices,
      };
    });
  }

  async exportSession(input: {
    sessionId: string;
    format: "json" | "markdown";
    legacy?: LegacyChatEntry;
  }): Promise<{ suggestedName: string; content: string }> {
    return this.withSessionOperation(input.sessionId, async () => {
      let session: SessionExportInput;
      if (input.legacy) {
        const legacy = input.legacy;
        session = {
          sessionId: legacy.sessionId,
          backendId: legacy.backendId,
          title: legacy.title,
          projectId: legacy.projectId,
          createdAtMs: legacy.createdAtMs,
          lastAccessedAtMs: legacy.lastAccessedAtMs,
          messages: legacy.messages,
          extras: {
            sourcePath: legacy.sourcePath,
            sourceHash: legacy.sourceHash,
            importMode: legacy.importMode,
          },
        };
      } else {
        const metadata = await this.readMetadata(input.sessionId);
        if (!metadata) throw new Error("The session to export does not exist.");
        if (!this.readOnlyRoots.has(input.sessionId)) {
          try {
            await this.getRoot(input.sessionId, metadata.cwd, false);
          } catch (error: unknown) {
            if (
              error &&
              typeof error === "object" &&
              "code" in error &&
              (error.code === "STORE_VERSION_UNSUPPORTED" ||
                error.code === "STORAGE_FAILED" ||
                error.code === "SESSION_ARCHIVED")
            )
              await this.loadReadOnlySnapshot(input.sessionId, error);
            else throw error;
          }
        }
        const readOnly = this.readOnlyRoots.get(input.sessionId);
        if (readOnly) {
          session = {
            ...readOnly.snapshot.session,
            extras: {
              ...readOnly.snapshot.session.extras,
              recoveryNotice: readOnly.recovery.message,
            },
          };
        } else {
          const root = await this.getRoot(input.sessionId, metadata.cwd, false);
          await this.replay(input.sessionId);
          const attachments = new Map<
            string,
            import("@/agentMode/sdk/pi/storage/SessionExport").SessionExportAttachment
          >();
          for (const item of root.entries.values()) {
            if (
              item.kind !== "va.input" ||
              !item.data ||
              typeof item.data !== "object" ||
              Array.isArray(item.data) ||
              !Array.isArray(item.data.attachments)
            )
              continue;
            for (const attachment of item.data.attachments)
              if (
                attachment &&
                typeof attachment === "object" &&
                !Array.isArray(attachment) &&
                typeof attachment.attachmentId === "string" &&
                typeof attachment.mime === "string" &&
                typeof attachment.bytes === "number" &&
                typeof attachment.contentHash === "string"
              )
                attachments.set(attachment.attachmentId, {
                  attachmentId: attachment.attachmentId,
                  mime: attachment.mime,
                  bytes: attachment.bytes,
                  contentHash: attachment.contentHash,
                  ...(typeof attachment.blobRef === "string"
                    ? { blobRef: attachment.blobRef }
                    : {}),
                  ...(typeof attachment.vaultPath === "string"
                    ? { vaultPath: attachment.vaultPath }
                    : {}),
                });
          }
          session = {
            sessionId: input.sessionId,
            backendId: "pi",
            title: metadata.title,
            projectId: metadata.projectId,
            createdAtMs: Date.parse(metadata.createdAt),
            lastAccessedAtMs: Date.now(),
            attachments: [...attachments.values()],
            messages: this.messages(root).map((message) => ({
              role: message.sender === "user" ? "user" : "assistant",
              text: message.message,
            })),
            extras: {
              entries: [...root.entries.values()],
              modelId: metadata.modelId,
              mode: metadata.mode,
            },
          };
        }
      }
      let content = "";
      const exporter = new SessionExport({
        ports: {
          writeFile: async (_path, text) => {
            content = text;
          },
          readFile: async () => content,
        },
      });
      if (input.format === "markdown") content = exporter.toMarkdown(session);
      else {
        const result = await exporter.exportSession(session);
        if (!result.ok) throw new Error(result.message);
      }
      return {
        suggestedName: `${input.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.${input.format === "markdown" ? "md" : "json"}`,
        content,
      };
    });
  }

  async importSessionBackup(input: {
    cwd: string;
    content: string;
  }): Promise<{ sessionId: string; state: BackendState; notices: readonly string[] }> {
    const exporter = new SessionExport({
      ports: {
        readFile: async () => input.content,
        writeFile: async () => {
          throw new Error("Importing a backup cannot write its source.");
        },
      },
    });
    const imported = await exporter.importDocument("backup.json");
    if (!imported.ok) throw new Error(imported.message);
    const document = imported.document;
    const sessionId = `root-backup-${document.contentHash}`;
    return this.withSessionOperation(sessionId, async () => {
      const opened = await this.open({ sessionId, cwd: input.cwd, readOnly: true });
      const root = await this.activeRoot(sessionId);
      if (!root.metadata.readOnly) throw new Error("An imported backup must remain read-only.");
      const [{ defineDoc }, { BACKGROUND_CONTEXT }] = await Promise.all([
        import("@earendil-works/pi-durable"),
        import("@earendil-works/chord/context"),
      ]);
      const token = defineDoc<{ imports: Record<string, boolean> }>({
        kind: "va.backup_imports",
        version: 1,
        scope: "conversation",
        history: "rewindable",
        fork: "initial",
        initial: () => ({ imports: {} }),
      });
      await root.conversation.commit(async (tx) => {
        const state = await tx.doc(token, root.conversation.id);
        if (state.imports[document.contentHash]) return;
        await tx.appendEntry(root.conversation.id, {
          kind: "va.backup",
          data: JSON.parse(JSON.stringify(document)),
          model: document.session.messages.map((message) => ({
            role: "user" as const,
            content: [{ type: "text" as const, text: message.text }],
            timestamp: message.timestampMs ?? document.session.createdAtMs,
          })),
        });
        state.imports[document.contentHash] = true;
      }, BACKGROUND_CONTEXT);
      await this.replay(sessionId);
      return { ...opened, notices: imported.notices };
    });
  }

  async steer(input: { sessionId: string; requestId: string; text: string }): Promise<void> {
    return this.withSessionOperation(input.sessionId, async () => {
      assertSteerText(input.text);
      const root = this.requireRoot(input.sessionId);
      root.recovery?.assertCanStartWork();
      const run = root.run;
      if (
        this.isReadOnly(root) ||
        root.metadata.parentSessionId ||
        !root.busy ||
        !run ||
        run.status !== "active" ||
        run.purpose !== "root" ||
        run.controller.signal.aborted ||
        root.pauseRequested ||
        root.steerRejected ||
        root.steerAdmission
      )
        throw new Error("未补充：当前工作不能接收补充，请重新发送。");
      const model = root.models.catalog.readyModels.find(
        (entry) => entry.configuredModelId === root.metadata.modelId
      );
      if (!model) throw new Error("当前模型不可用。");
      const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
      const selected = await root.features.prepareContext(undefined, { refreshInstructions: true });
      const agent = await root.conversation.agent(BACKGROUND_CONTEXT);
      const prepared = await preparePiRuntimeInput({
        input: {
          sessionId: input.sessionId,
          requestId: input.requestId,
          prompt: [{ type: "text", text: input.text }],
          context: { project: selected.project, materials: [] },
        },
        environment: {
          scope: { vaultRoot: this.vaultRoot, workspaceRoot: root.metadata.cwd },
          mode: root.metadata.mode,
          offeredTools: root.capabilities.snapshot(
            agent.tools.map((tool) => tool.name),
            root.capabilityContext(String(root.conversation.id))
          ).offeredTools,
        },
        instructionContext: {
          ...(this.host.getInstructionSections?.() ?? {
            base: this.host.getInstructions?.() ?? "",
          }),
          skills: selected.skills,
        },
        modelKey: model.configuredModelId,
        acceptsImages: model.capabilities.supportsImages,
        contextWindowTokens: model.contextWindow,
        privateDir: root.privateDir,
        app: this.host.app,
        vaultRoot: this.vaultRoot,
        isInstructionPathAllowed: this.host.isInstructionPathAllowed,
        isPathAllowed: (path) =>
          this.pathInScope(path, root.metadata.cwd) &&
          this.host.isVaultPathAllowed?.(path) === true,
      });
      if (
        root.run !== run ||
        run.status !== "active" ||
        run.controller.signal.aborted ||
        root.pauseRequested ||
        root.steerRejected ||
        root.steerAdmission
      )
        throw new Error("未补充：当前工作已结束，请重新发送。");
      let release!: () => void;
      const admission = new Promise<void>((resolve) => (release = resolve));
      root.steerAdmission = admission;
      root.steerRequestId = input.requestId;
      try {
        await submitSteerInput({
          harness: root.harness,
          conversation: root.conversation,
          requestId: input.requestId,
          content: prepared.content,
          entry: {
            kind: "va.steer-input",
            data: JSON.parse(
              JSON.stringify({
                runId: run.id,
                requestId: input.requestId,
                receipt: prepared.receipt,
              })
            ),
          },
          context: BACKGROUND_CONTEXT,
          rejectNewRun: async (sourceEntryId) => {
            root.steerRejected = true;
            if (sourceEntryId) {
              try {
                await this.rejectSteerSource(root, sourceEntryId, input.requestId);
              } catch (error) {
                root.storageFailed = true;
                await root.recovery?.storageFailed(error);
                throw error;
              }
            }
          },
          release,
          accepted: async (sourceEntryId) => {
            try {
              await root.steerSourceChain;
              if (!root.acceptedSteers.has(input.requestId))
                await this.recordSteerSource(
                  root,
                  run.id,
                  input.requestId,
                  prepared.receipt,
                  sourceEntryId
                );
            } catch (error) {
              root.storageFailed = true;
              await root.recovery?.storageFailed(error);
              throw error;
            }
          },
        });
        this.emitProjection(root);
      } finally {
        release();
        if (root.steerAdmission === admission) {
          root.steerAdmission = null;
          root.steerRequestId = undefined;
        }
        root.steerRejected = false;
      }
    });
  }

  private async waitForSteerBoundary(root: OpenRoot, conversationId: string): Promise<void> {
    if (conversationId === String(root.conversation.id)) await root.steerSourceChain;
    if (root.steerRejected && conversationId === String(root.conversation.id))
      throw new Error("未补充：当前工作已结束，请重新发送。");
    if (
      conversationId !== String(root.conversation.id) ||
      !root.steerAdmission ||
      !root.steerRequestId
    )
      return;
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const requestId = root.steerRequestId;
    const source = await root.harness.commit(
      (tx) => tx.submissionByRequest(root.conversation.id, requestId),
      BACKGROUND_CONTEXT
    );
    // 仍在原轮队列中的补充不能堵住原请求或当前工具，只有实际放置后才等待来源保存。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (!source || source.status === "queued") return;
    await root.steerAdmission;
    if (root.steerRejected) throw new Error("未补充：当前工作已结束，请重新发送。");
  }

  private async recordSteerSource(
    root: OpenRoot,
    runId: string,
    requestId: string,
    receipt: Awaited<ReturnType<typeof preparePiRuntimeInput>>["receipt"],
    sourceEntryId: string
  ): Promise<void> {
    await root.workItems.recordInput(runId, {
      requestId,
      text: receipt.userInput,
      instructionSources: receipt.context.sectionDigests
        .filter(
          (section) =>
            section.injectedAsSystem &&
            !section.untrusted &&
            (section.kind === "user_system" || section.kind === "project")
        )
        .map(({ sourceId, revision, kind, scope }) => ({
          sourceId,
          revision,
          kind,
          ...(scope ? { scope } : {}),
        })),
    });
    root.acceptedSteers.add(requestId);
    await this.checkpointWorkItem(root, runId, "user_adjustment", [sourceEntryId], 0);
  }

  private async rejectSteerSource(
    root: OpenRoot,
    sourceEntryId: string,
    requestId: string
  ): Promise<void> {
    if (
      [...root.entries.values()].some(
        (entry) =>
          entry.kind === "va.steer-rejected" &&
          (entry.data as { sourceEntryId?: string } | undefined)?.sourceEntryId === sourceEntryId
      )
    )
      return;
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    // 未接受输入保留原始记录，但不能留在未来的模型要求中；按真实 entryId 排除而非按文字匹配。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    await root.conversation.commit(
      (tx) =>
        tx.appendEntry(root.conversation.id, {
          kind: "va.steer-rejected",
          data: { requestId, sourceEntryId, disposition: "rejected" },
          edits: [
            {
              target: Number(sourceEntryId) as import("@earendil-works/pi-durable").EntryId,
              action: "omit",
            },
          ],
        }),
      BACKGROUND_CONTEXT
    );
  }

  private async restoreSteerSources(
    root: OpenRoot,
    entries: readonly EntryRecord[] = [...root.entries.values()]
  ): Promise<void> {
    const [{ LiveDoc }, { BACKGROUND_CONTEXT }] = await Promise.all([
      import("@earendil-works/pi-durable"),
      import("@earendil-works/chord/context"),
    ]);
    const live = await root.harness.snapshot(LiveDoc, root.conversation.id, BACKGROUND_CONTEXT);
    for (const entry of entries) {
      if (entry.kind !== "va.steer-input") continue;
      const data = entry.data as
        | {
            runId?: string;
            requestId?: string;
            steerAnchor?: number;
            receipt?: Awaited<ReturnType<typeof preparePiRuntimeInput>>["receipt"];
          }
        | undefined;
      if (!data?.runId || !data.requestId || !data.receipt || typeof data.steerAnchor !== "number")
        continue;
      const item = await root.workItems.read(data.runId);
      if (!item) continue;
      if (item.checkpoint.userRequests?.some((request) => request.requestId === data.requestId)) {
        root.acceptedSteers.add(data.requestId);
        if (!item.checkpoint.evidenceEntryIds.includes(String(entry.id)))
          await this.checkpointWorkItem(root, data.runId, "user_adjustment", [String(entry.id)], 0);
        continue;
      }
      const original = await root.harness.submission(
        data.steerAnchor as import("@earendil-works/pi-durable").SubmissionId,
        BACKGROUND_CONTEXT
      );
      const submitted = await root.harness.commit(
        (tx) => tx.submissionByRequest(root.conversation.id, data.requestId!),
        BACKGROUND_CONTEXT
      );
      const anchor = await original?.status(BACKGROUND_CONTEXT);
      const accepted =
        submitted &&
        ((submitted.status === "placed" &&
          live?.run?.inputs.includes(submitted.id) &&
          live.run.inputs.includes(
            data.steerAnchor as import("@earendil-works/pi-durable").SubmissionId
          )) ||
          (submitted.status === "done" &&
            anchor?.status === "done" &&
            submitted.answer === anchor.answer));
      if (accepted)
        await this.recordSteerSource(
          root,
          data.runId,
          data.requestId,
          data.receipt,
          String(entry.id)
        );
      else if (submitted?.status === "unanswered" && submitted.entry === entry.id)
        await this.rejectSteerSource(root, String(entry.id), data.requestId);
      else if (
        !root.steerAdmission &&
        submitted?.status === "placed" &&
        live?.run?.inputs.includes(submitted.id) &&
        !live.run.inputs.includes(
          data.steerAnchor as import("@earendil-works/pi-durable").SubmissionId
        )
      ) {
        root.steerRejected = true;
        await this.rejectSteerSource(root, String(entry.id), data.requestId);
        // 重开后原页面已不存在；终答边界才放置的旧补充仍不能独自启动新轮。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        void root.harness.abortTask(live.run.taskId, BACKGROUND_CONTEXT).then(
          () => {
            root.steerRejected = false;
          },
          (error) => {
            root.storageFailed = true;
            return root.recovery?.storageFailed(error);
          }
        );
      }
    }
  }

  async prompt(input: PromptInput): Promise<PromptOutput> {
    return this.withSessionOperation(input.sessionId, async () => {
      const requestId = input.requestId ?? `request-${this.crypto.randomUUID()}`;
      const savedDraft = this.unsentInputs.get(input.sessionId);
      // 等待空位时也要保存原输入并能立即关闭，不能只把尚未提交的请求留在页面。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const admission =
        (!this.roots.has(input.sessionId) ||
          this.resourceClosures.has(
            this.roots.get(input.sessionId)?.ownerSessionId ?? input.sessionId
          ) ||
          (savedDraft?.kind === "prompt" && savedDraft.input.requestId === requestId)) &&
        !this.readOnlyRoots.has(input.sessionId)
          ? this.stageUnsentInput(input.sessionId, {
              kind: "prompt",
              input: { ...input, requestId },
              savedAtMs: savedDraft?.savedAtMs ?? Date.now(),
            })
          : undefined;
      try {
        await admission?.saved;
        admission?.controller.signal.throwIfAborted();
        const result = await this.promptAccepted({ ...input, requestId });
        return result;
      } catch (error) {
        if (
          admission?.controller.signal.aborted &&
          (error === admission.controller.signal.reason ||
            (error as { code?: string })?.code === "RUNTIME_CLOSING")
        )
          return {
            handledLocally: true,
            stopReason:
              (admission.controller.signal.reason as { code?: string })?.code === "CANCELLED"
                ? "cancelled"
                : "max_turn_requests",
          };
        throw error;
      } finally {
        if (admission && this.unsentAdmissions.get(input.sessionId) === admission)
          this.unsentAdmissions.delete(input.sessionId);
      }
    });
  }

  private async promptAccepted(input: PromptInput): Promise<PromptOutput> {
    if (this.readOnlyRoots.has(input.sessionId))
      throw new Error("这段聊天处于只读恢复模式，可以读取和导出。");
    const root = await this.activeRoot(input.sessionId);
    this.unsentAdmissions.get(input.sessionId)?.controller.signal.throwIfAborted();
    if (this.rollovers.has(root.ownerSessionId)) throw new Error("这段聊天正在整理，请等待完成。");
    const requestId = input.requestId ?? `request-${this.crypto.randomUUID()}`;
    const draft = this.unsentInputs.get(input.sessionId);
    if (draft?.kind === "prompt" && draft.input.requestId !== requestId)
      throw new Error("原请求尚未发送，请先继续或放弃已保存的请求。");
    if (input.requestId) {
      const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
      const committed = await root.harness.commit(
        (tx) => tx.submissionByRequest(root.conversation.id, requestId),
        BACKGROUND_CONTEXT
      );
      // 先读已提交的答复，恢复候选卡片不应重新授权旧任务或再次收费。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (committed?.type === "input") {
        await this.saveUnsentInput(input.sessionId, null);
        await this.replay(input.sessionId);
        if (committed.status === "done") return { stopReason: "end_turn" };
        throw new Error("这条请求已交给原任务，请使用继续或停止处理原进度。");
      }
    }
    const stopRequested =
      input.prompt
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim() === "/stop";
    if (!stopRequested) root.recovery?.assertCanStartWork();
    if (
      root.metadata.readOnly &&
      !root.metadata.parentSessionId &&
      input.prompt
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim() !== "/stop"
    )
      throw new Error(
        "This imported backup is read-only. Import its visible history into a new chat before continuing."
      );
    const command = await dispatchPiRuntimeCommand(input, {
      compact: async () => ({ ok: false }),
      stop: async () => this.cancel(input.sessionId),
      switchModel: async ({ modelKey }) => {
        await this.setModel(input.sessionId, modelKey);
        return { ok: true };
      },
      loadSkill: async ({ skillId }) => {
        if (root.busy)
          return { ok: false, error: "Wait for the current answer before loading a skill." };
        return root.features.loadSkill(skillId, requestId);
      },
    });
    if (command.handled) {
      if (!command.ok) throw new Error(command.message ?? "The command failed.");
      if (this.unsentInputs.has(input.sessionId)) await this.saveUnsentInput(input.sessionId, null);
      return { stopReason: "end_turn", handledLocally: true };
    }
    if (root.metadata.readOnly && !root.metadata.parentSessionId)
      throw new Error(
        "This imported backup is read-only. Import its visible history into a new chat before continuing."
      );
    if (root.busy) throw new Error("This Pi session is already answering.");
    root.busy = true;
    root.pending = this.unsentAdmissions.get(input.sessionId)?.controller ?? new AbortController();
    const work = (async () => {
      let admitted = false;
      try {
        const admission = await this.pool.admitRun(root.ownerSessionId);
        if (admission.kind === "blocked")
          throw new Error(
            "这段聊天已达到存储上限。可在更多菜单选择“总结并新建会话”；原历史将完整保留为只读。"
          );
        if (admission.warning)
          this.host.notify?.(
            "这段聊天保存的内容较多，可在更多菜单选择“总结并新建会话”；当前消息仍可继续。"
          );
        admitted = true;
        return await this.runPrompt(root, { ...input, requestId }, requestId);
      } finally {
        root.busy = false;
        root.pending = null;
        if (admitted && !root.pauseRequested) await this.pool.finishRun(root.ownerSessionId);
      }
    })();
    root.work = work;
    try {
      return await work;
    } finally {
      if (root.work === work) root.work = null;
    }
  }

  async pause(sessionId: string): Promise<void> {
    return this.withSessionOperation(sessionId, async () => {
      if (await this.pauseUnsentInput(sessionId)) return;
      await this.pauseOpenRoot(await this.activeRoot(sessionId));
    });
  }

  private async pauseOpenRoot(session: OpenRoot): Promise<void> {
    const owner = this.requireRoot(session.ownerSessionId);
    const active = [...this.roots.values()].find(
      (candidate) =>
        candidate.ownerSessionId === owner.metadata.sessionId && candidate.run?.status === "active"
    );
    if (!active?.run) return;
    try {
      await this.pauseAtBoundary(owner, active.run, active.run.controller.signal, "user");
    } catch (error) {
      if (!owner.pauseRequested) throw error;
    }
    await this.pauseOperations.get(owner.metadata.sessionId);
  }

  async cancel(sessionId: string, closing = false, preserveRollover = false): Promise<void> {
    return this.withSessionOperation(sessionId, async () => {
      if (await this.pauseUnsentInput(sessionId, !closing)) return;
      if (
        !closing &&
        (this.unsentInputs.has(sessionId) || (await this.readMetadata(sessionId))?.unsentInput)
      ) {
        await this.saveUnsentInput(sessionId, null);
        const savedRoot = this.roots.get(sessionId);
        if (savedRoot) this.emitProjection(savedRoot);
        return;
      }
      const root = this.roots.get(sessionId);
      if (!preserveRollover && (!closing || root?.run?.status === "active"))
        this.rollovers.get(sessionId)?.abort();
      if (!root) return;
      if (root.metadata.archivedAtMs) return;
      // 滚动时关闭已结束的旧写入者只是释放名额，不能误当成用户停止；真正 Stop 仍取消整个整理：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (closing && this.rollovers.has(sessionId) && root.run?.status !== "active") return;
      const cancellingPermissions = [...(root.approvals?.pending ?? [])];
      root.pending?.abort();
      root.run?.controller.abort();
      if (root.run) root.run.status = "cancelled";
      if (root.storageFailed) {
        root.vaultTools.dispose();
        root.approvals?.dispose();
        await root.native.dispose();
        await root.work?.catch(() => undefined);
        return;
      }
      if (root.ownerSessionId === sessionId) {
        await root.approvals?.cancelAll();
        for (const prompt of cancellingPermissions)
          await root.audit.record({
            operationId: prompt.toolCall.toolCallId,
            actor: "root",
            toolId: prompt.binding?.toolId ?? prompt.toolCall.title ?? "unknown",
            arguments: prompt.toolCall.rawInput,
            targets: prompt.binding?.targets ?? [],
            effects: [],
            decision: "cancelled",
            status: "cancelled",
            requestId: root.run?.requestId,
          });
        await root.features.cancelPendingInteractions();
        await root.subagents.stopAll();
      }
      for (const child of [...this.roots.values()])
        if (child.metadata.parentSessionId === sessionId)
          await this.cancel(child.metadata.sessionId);
      await root.conversation.abort(
        (await import("@earendil-works/chord/context")).BACKGROUND_CONTEXT,
        { background: true }
      );
      await root.work?.catch(() => undefined);
      if (!root.storageFailed) {
        const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
        // 摘要任务结束时可能才排入写入；停止必须等实际任务收尾后撤销这些排队记录，不能冷开后误判为待执行工作。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const remaining = await root.harness.inspect(BACKGROUND_CONTEXT);
        for (const submission of remaining.submissions)
          await root.harness.abortSubmission(
            submission.id,
            BACKGROUND_CONTEXT,
            submission.conversationId
          );
      }
      if (!root.storageFailed && root.ownerSessionId === sessionId)
        await this.settlePausedRunAfterAbort(root);
      if (root.recovery && !root.storageFailed) {
        await root.vaultTools.reconcile();
        await root.recovery.safeBoundary();
      }
    });
  }

  async close(sessionId: string): Promise<void> {
    if (await this.pauseUnsentInput(sessionId)) return;
    this.closingRoots.add(sessionId);
    let preserveOwner = false;
    const alreadyPreserving = this.pausingRoots.has(sessionId);
    try {
      const root = this.roots.get(sessionId);
      if (!root || root.ownerSessionId === sessionId) {
        if (
          root &&
          [...this.roots.values()].some(
            (candidate) =>
              candidate.ownerSessionId === sessionId && candidate.run?.status === "active"
          )
        )
          await this.pauseOpenRoot(root);
        // 释放聊天与 Stop 分工不同：整个 owner 只关闭宿主保留 SDK 检查点，已暂停任务也不能再次取消。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        this.pausingRoots.add(sessionId);
        preserveOwner = true;
      }
      if (root && root.ownerSessionId !== sessionId) {
        await this.closeResources(sessionId);
        this.syncObservation(root.ownerSessionId);
        return;
      }
      await this.pool.close(sessionId);
      const pending = this.opening.get(sessionId);
      if (pending) {
        const opened = await pending.catch(() => undefined);
        if (opened && this.roots.has(sessionId)) await this.closeResources(sessionId);
      }
    } finally {
      if (preserveOwner && !alreadyPreserving) this.pausingRoots.delete(sessionId);
      this.closingRoots.delete(sessionId);
    }
  }

  private async closeResources(sessionId: string): Promise<void> {
    const root = this.roots.get(sessionId);
    if (!root) return;
    const pendingWork =
      root.ownerSessionId === sessionId
        ? [...this.roots.values()]
            .filter((candidate) => candidate.ownerSessionId === sessionId)
            .flatMap((candidate) => (candidate.work ? [candidate.work] : []))
        : [];
    const alreadyClosing = this.closingRoots.has(sessionId);
    this.closingRoots.add(sessionId);
    try {
      try {
        // 退出、暂停及显式释放聊天保留检查点；只有明确 Stop 才终结任务。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (!this.closed && !this.pausingRoots.has(root.ownerSessionId))
          await this.cancel(sessionId, true);
      } catch (error) {
        const end = await root.harness.closed;
        if (end.reason !== "failed") throw error;
        root.storageFailed = true;
        await root.recovery?.storageFailed(error).catch(() => undefined);
      }
      for (const child of [...this.roots.values()])
        if (child.metadata.parentSessionId === sessionId)
          await this.closeResources(child.metadata.sessionId);
      await root.sdkToolRejectionChain;
      await root.watch.stop();
      if (root.ownerSessionId !== sessionId) {
        this.roots.delete(sessionId);
        this.operationOwners.delete(sessionId);
        return;
      }
      await root.features.dispose({
        preservePending: this.closed || this.pausingRoots.has(root.ownerSessionId),
      });
      await root.mcp.dispose();
      await root.subagents.dispose({
        preservePending: this.closed || this.pausingRoots.has(root.ownerSessionId),
      });
      await root.native.dispose();
      root.vaultTools.dispose();
      root.approvals?.dispose({
        preservePending: this.closed || this.pausingRoots.has(root.ownerSessionId),
      });
      try {
        await root.recovery?.flush();
        await root.harness.close(
          (await import("@earendil-works/chord/context")).BACKGROUND_CONTEXT
        );
        // SDK 关闭只终止当前执行段；宿主整轮仍须完成暂停收尾后才能释放持久存储。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const settled = await Promise.allSettled(pendingWork);
        for (const result of settled) if (result.status === "rejected") throw result.reason;
      } finally {
        await root.features.dispose();
        root.approvals?.dispose();
        try {
          await root.store.close();
        } finally {
          this.writerRoots.delete(sessionId);
        }
        this.roots.delete(sessionId);
        this.checkpointChains.delete(sessionId);
        this.observedOwners.delete(sessionId);
        for (const key of this.budgets.keys())
          if (key.startsWith(`${sessionId}:`)) this.budgets.delete(key);
      }
    } finally {
      // 内层关闭只能撤自己的门，外层释放仍在保存/重建检查点时不能开放新调用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (!alreadyClosing) this.closingRoots.delete(sessionId);
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled(
      [...this.unsentAdmissions.keys()].map((id) => this.pauseUnsentInput(id))
    );
    // 卸载也必须先保存活动执行段，不能让 SDK 已关闭后的宿主收尾继续写完成状态。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    results.push(
      ...(await Promise.allSettled(
        [...this.roots.values()]
          .filter((root) => root.ownerSessionId === root.metadata.sessionId)
          .map((root) => this.pauseOpenRoot(root))
      ))
    );
    results.push(...(await Promise.allSettled([this.pool.shutdown()])));
    await Promise.all([...this.opening.values()].map((work) => work.catch(() => undefined)));
    this.observedSessions.clear();
    this.observedOwners.clear();
    this.readOnlyRoots.clear();
    // 一条待发输入保存失败不能阻止其它写入者释放；完成全部清理后仍报告原始失败。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : []
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "Some sessions could not finish saving before shutdown.");
  }

  observe(sessionId: string, observed: boolean): void {
    if (observed) this.observedSessions.add(sessionId);
    else this.observedSessions.delete(sessionId);
    const root = this.roots.get(sessionId);
    if (root) this.syncObservation(root.ownerSessionId);
  }

  async setModel(sessionId: string, modelId: string): Promise<BackendState> {
    return this.withSessionOperation(sessionId, async () => {
      const root = await this.activeRoot(sessionId);
      if (root.busy) throw new Error("The model cannot change while the session is answering.");
      resolveModelEntry(modelEntriesFromCatalog(root.models.catalog), modelId);
      const entry = root.models.catalog.readyModels.find(
        (entry) => entry.configuredModelId === modelId
      );
      if (!entry) throw new Error("The selected model is unavailable.");
      requireModelContextWindow(entry);
      const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
      await root.conversation.configure(
        {
          model: { provider: entry.providerInstanceId, modelId: entry.upstreamModelId },
          thinkingLevel: "off",
        },
        BACKGROUND_CONTEXT
      );
      root.metadata.modelId = modelId;
      root.metadata.effort = null;
      await this.saveMetadata(root.metadata);
      const state = this.stateOf(root);
      this.emit(sessionId, { sessionUpdate: "state_changed", state });
      return state;
    });
  }

  async setMode(sessionId: string, mode: string): Promise<BackendState> {
    return this.withSessionOperation(sessionId, async () => {
      if (mode !== "plan" && mode !== "default" && mode !== "auto")
        throw new Error("Unknown execution mode.");
      const root = await this.activeRoot(sessionId);
      if (this.isReadOnly(root) && mode !== "plan")
        throw new Error("This session is permanently read-only.");
      const transition = transitionMode(root.metadata.mode, mode, { busy: root.busy });
      if (transition.kind === "deferred")
        throw new Error("Wait for the current operation before widening permissions.");
      root.metadata.mode = mode;
      await this.saveMetadata(root.metadata);
      const state = this.stateOf(root);
      this.emit(sessionId, { sessionUpdate: "state_changed", state });
      return state;
    });
  }

  async setConfig(sessionId: string, configId: string, value: string): Promise<BackendState> {
    return this.withSessionOperation(sessionId, async () => {
      if (configId === "pi-model") return this.setModel(sessionId, value);
      if (configId === "pi-mode") return this.setMode(sessionId, value);
      const root = await this.activeRoot(sessionId);
      if (configId !== "pi-effort") throw new Error("Unknown Pi configuration option.");
      if (root.busy) throw new Error("The thinking level cannot change while answering.");
      const model = resolveModelEntry(
        modelEntriesFromCatalog(root.models.catalog),
        root.metadata.modelId ?? ""
      );
      validateEffort(value === "off" ? null : value, model.effortOptions);
      const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
      await root.conversation.configure(
        { thinkingLevel: value as ModelThinkingLevel },
        BACKGROUND_CONTEXT
      );
      root.metadata.effort = value === "off" ? null : value;
      await this.saveMetadata(root.metadata);
      const state = this.stateOf(root);
      this.emit(sessionId, { sessionUpdate: "state_changed", state });
      return state;
    });
  }

  async setFeedbackStatus(
    sessionId: string,
    offerId: string,
    status: "dismissed" | "reported"
  ): Promise<void> {
    return this.withSessionOperation(sessionId, async () => {
      const feedback = (await this.activeRoot(sessionId)).features.feedback;
      if (status === "dismissed") await feedback.dismiss(offerId);
      else await feedback.updateStatus(offerId, { status: "reported" });
      this.emit(sessionId, { sessionUpdate: "feedback_offer", offer: feedback.getActiveOffer() });
    });
  }

  async readSubagentHistory(
    sessionId: string,
    conversationId: string
  ): Promise<readonly AgentChatMessage[]> {
    return this.withSessionOperation(sessionId, async () => {
      const root = await this.activeRoot(sessionId);
      const owner = this.requireRoot(root.ownerSessionId);
      const entries = await owner.subagents.readChildHistory(conversationId);
      for (const fact of await readSdkToolRejections({
        harness: owner.harness,
        entries,
        ownerSessionId: owner.metadata.sessionId,
        caller: (id) => owner.capabilityContext(id).caller,
      }))
        owner.sdkToolRejections.set(fact.taskId, fact);
      // 读取已保存的子记录只投影显示，不能提交输入或唤醒子任务。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      return new PiRuntimeProjection(
        `${owner.metadata.sessionId}:child:${conversationId}`
      ).messages(entries, [], owner.sdkToolRejections);
    });
  }

  async setFeedbackEnabled(sessionId: string, enabled: boolean): Promise<void> {
    return this.withSessionOperation(sessionId, async () => {
      const feedback = (await this.activeRoot(sessionId)).features.feedback;
      if (enabled) await feedback.turnOn();
      else await feedback.turnOff();
      this.emit(sessionId, {
        sessionUpdate: "feedback_offer",
        offer: enabled ? feedback.getActiveOffer() : null,
      });
    });
  }

  async recordFanoutTurn(input: { sessionId: string; turn: FanoutTurn }): Promise<void> {
    return this.withSessionOperation(input.sessionId, async () => {
      const admission = !this.roots.has(input.sessionId)
        ? this.stageUnsentInput(input.sessionId, {
            kind: "fanout",
            turn: input.turn,
            savedAtMs: Date.now(),
          })
        : undefined;
      try {
        await admission?.saved;
        admission?.controller.signal.throwIfAborted();
        const root = await this.activeRoot(input.sessionId);
        admission?.controller.signal.throwIfAborted();
        if (this.isReadOnly(root)) throw new Error("只读聊天不能保存新的多模型回答。");
        const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
        // 多模型卡片是根聊天的一部分，不能依赖可选的笔记自动保存才能重开和导出。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        await root.conversation.commit(async (tx) => {
          await tx.appendEntry(root.conversation.id, {
            kind: "va.fanout",
            data: JSON.parse(JSON.stringify(input.turn)) as JsonObject,
          });
        }, BACKGROUND_CONTEXT);
        if (admission) await this.saveUnsentInput(input.sessionId, null);
        if (input.turn.summary.complete && input.turn.checkpoint) {
          const owner = this.requireRoot(root.ownerSessionId);
          await owner.subagents.stopCandidateGroup(input.turn.checkpoint.fanoutId);
          await this.checkpointWorkItem(
            owner,
            input.turn.checkpoint.fanoutId,
            "fanout_boundary",
            [],
            0,
            "waiting_user"
          );
        }
        await this.replay(input.sessionId);
      } catch (error) {
        if (
          admission?.controller.signal.aborted &&
          (error === admission.controller.signal.reason ||
            (error as { code?: string })?.code === "RUNTIME_CLOSING")
        )
          throw admission.controller.signal.reason;
        throw error;
      } finally {
        if (admission && this.unsentAdmissions.get(input.sessionId) === admission)
          this.unsentAdmissions.delete(input.sessionId);
      }
    });
  }

  async replay(sessionId: string): Promise<void> {
    return this.withSessionOperation(sessionId, async () => {
      const root = this.roots.get(sessionId);
      if (!root) return;
      // 存储失败后只显示已经确认的记录，不能再向失败的 Harness 读取而阻断只读导出。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (root.storageFailed) {
        this.emitProjection(root);
        return;
      }
      const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
      let cursor: Cursor | undefined;
      const ordered = new Map<string, EntryRecord>();
      do {
        const page = await root.conversation.entries(
          { order: "ascending" },
          100,
          cursor,
          BACKGROUND_CONTEXT
        );
        for (const entry of page.items) ordered.set(String(entry.id), entry);
        cursor = page.next;
      } while (cursor);
      await this.eventBarrier(root).waitFor(
        [...ordered.values()].reduce((latest, entry) => Math.max(latest, Number(entry.id)), 0)
      );
      for (const [id, entry] of root.entries) if (!ordered.has(id)) ordered.set(id, entry);
      root.entries.clear();
      for (const [id, entry] of ordered) root.entries.set(id, entry);
      this.emitProjection(root);
      const contextWindow = root.models.catalog.readyModels.find(
        (model) => model.configuredModelId === root.metadata.modelId
      )?.contextWindow;
      const usage = this.projection(root).usage(
        [...root.entries.values()],
        undefined,
        contextWindow
      );
      if (usage) this.emit(sessionId, { sessionUpdate: "usage_update", usage });
      const budgetView = [...root.entries.values()]
        .reverse()
        .find((entry) => entry.kind === "va.budget_view");
      if (
        budgetView?.data &&
        typeof budgetView.data === "object" &&
        !Array.isArray(budgetView.data)
      ) {
        const view = budgetView.data;
        if (view.planUsage && typeof view.planUsage === "object")
          this.emit(sessionId, {
            sessionUpdate: "plan_usage_update",
            planUsage: view.planUsage as unknown as import("@/agentMode/session/types").PlanUsage,
          });
      }
    });
  }

  private async openChild(
    id: string,
    cwd: string,
    stored: SessionMetadata | null,
    input: OpenSessionInput | undefined,
    parent: OpenRoot
  ): Promise<OpenRoot> {
    const [{ BACKGROUND_CONTEXT }, { watchEvents }] = await Promise.all([
      import("@earendil-works/chord/context"),
      import("@earendil-works/pi-durable"),
    ]);
    const metadata: SessionMetadata = stored ?? {
      sessionId: id,
      cwd,
      createdAt: new Date().toISOString(),
      title: null,
      modelId: parent.metadata.modelId,
      effort: null,
      mode: "plan",
      readOnly: true,
      parentSessionId: parent.metadata.sessionId,
      parentRunId: input?.parentRunId,
      projectId: input?.projectId,
    };
    if (!metadata.readOnly || !metadata.parentRunId)
      throw new Error("Fan-out sessions require a saved read-only parent binding.");
    if (!metadata.conversationId) {
      if (!metadata.modelId) throw new Error("请先选择候选使用的模型。");
      await parent.subagents.beginCandidateGroup({
        runId: metadata.parentRunId,
        budget: await this.budgetFor(parent, metadata.parentRunId),
      });
      const candidate = await parent.subagents.createReadOnlyCandidate({
        sessionId: id,
        parentRunId: metadata.parentRunId,
        modelKey: metadata.modelId,
        cwd,
        instructions: this.host.getInstructions?.(),
      });
      metadata.conversationId = candidate.conversationId;
    }
    const conversation = await parent.harness.conversation(
      Number(metadata.conversationId) as ConversationId,
      BACKGROUND_CONTEXT
    );
    if (!conversation) throw new Error("The saved fan-out conversation is missing.");
    metadata.conversationId = String(conversation.id);
    const privateDir = this.path.dirname(this.locator.sessionStorePaths(id).metaPath);
    await this.fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
    const watch = await watchEvents(parent.harness, conversation.id, BACKGROUND_CONTEXT);
    const translator = new EventTranslator({
      sessionId: id,
      emit: (event) => this.translate(id, event),
    });
    const child: OpenRoot = {
      ...parent,
      metadata,
      conversation,
      watch,
      translator,
      privateDir,
      streamEpoch: this.crypto.randomUUID(),
      frameIndex: 0,
      entries: new Map(),
      busy: false,
      work: null,
      pending: null,
      run: null,
      fileChanges: [],
    };
    this.roots.set(id, child);
    for (const entry of watch.snapshot.entries) child.entries.set(String(entry.id), entry);
    this.projection(child).apply(watch.snapshot);
    this.eventBarrier(child).advance(watch.snapshot.entries.map((entry) => Number(entry.id)));
    void watch.closed.then(() => this.eventBarrier(child).close());
    watch.start(async (events) => {
      for (const event of events) await this.consumeEvent(child, event);
    });
    await this.saveMetadata(metadata);
    return child;
  }

  private sessionForConversation(
    conversationId: string,
    ownerSessionId?: string
  ): OpenRoot | undefined {
    return [...this.roots.values()].find(
      (root) =>
        String(root.conversation.id) === conversationId &&
        (ownerSessionId === undefined || root.ownerSessionId === ownerSessionId)
    );
  }

  private pathInScope(target: string, cwd: string): boolean {
    const resolved = this.path.resolve(this.vaultRoot, target);
    const relative = this.path.relative(this.path.resolve(cwd), resolved);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${this.path.sep}`) &&
        !this.path.isAbsolute(relative))
    );
  }

  private async readSkillResource(input: {
    readonly dirPath: string;
    readonly sourcePath: string;
  }): Promise<string> {
    const vaultRoot = await this.fs.realpath(this.vaultRoot);
    const directory = await this.fs.realpath(this.path.resolve(this.vaultRoot, input.dirPath));
    const target = await this.fs.realpath(this.path.resolve(this.vaultRoot, input.sourcePath));
    const protectedRoots = await Promise.all(
      this.locator
        .protectedPaths()
        .map(async (root) => this.fs.realpath(root).catch(() => this.path.resolve(root)))
    );
    const inside = (base: string, value: string) => {
      const relative = this.path.relative(base, value);
      return (
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${this.path.sep}`) &&
          !this.path.isAbsolute(relative))
      );
    };
    // 资源仅能来自此技能的真实目录，符号链接、私有运行记录和超大二进制都不能借技能读取。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (
      !inside(vaultRoot, directory) ||
      !inside(directory, target) ||
      protectedRoots.some((root) => inside(root, target))
    )
      throw new Error("The requested skill resource escapes its allowed directory.");
    const file = await this.fs.open(target, "r");
    try {
      if ((await this.fs.realpath(this.path.resolve(this.vaultRoot, input.sourcePath))) !== target)
        throw new Error("The skill resource changed before reading.");
      const bytes = new Uint8Array(64 * 1024 + 1);
      const read = await file.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead > 64 * 1024) throw new Error("The skill resource exceeds 65536 bytes.");
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, read.bytesRead));
    } finally {
      await file.close();
    }
  }

  private recordFileChanges(root: OpenRoot, changes: readonly TurnFileChange[]): void {
    const merged = new Map(root.fileChanges.map((change) => [change.path, change]));
    for (const change of changes) {
      const prior = merged.get(change.path);
      const combined = buildTurnFileChange(
        change.path,
        prior ? prior.before : change.before,
        change.after
      );
      if (combined) {
        const operationIds = [
          ...new Set([
            ...(prior?.mutationOperationIds ?? []),
            ...(change.mutationOperationIds ?? []),
          ]),
        ];
        if (operationIds.length > 0) combined.mutationOperationIds = operationIds;
        merged.set(change.path, combined);
      } else merged.delete(change.path);
    }
    root.fileChanges = [...merged.values()];
  }

  private isReadOnly(root: OpenRoot): boolean {
    return (
      root.pauseRequested ||
      root.metadata.readOnly === true ||
      root.recovery?.readOnly === true ||
      this.callbacks.readOnly(root.metadata.sessionId)
    );
  }

  private async providerBinding(owner: OpenRoot, providerSessionId: string | undefined) {
    const [{ ProviderDoc }, { BACKGROUND_CONTEXT }] = await Promise.all([
      import("@earendil-works/pi-durable"),
      import("@earendil-works/chord/context"),
    ]);
    if (!providerSessionId)
      throw new Error("The provider request has no durable conversation identity.");
    let root: OpenRoot | undefined;
    let run: OpenRoot["run"] = null;
    let modelKey: string | null = null;
    let conversationId: string | undefined;
    let purpose: NonNullable<OpenRoot["run"]>["purpose"] | undefined;
    // 同模型的父任务与子任务不能互借身份；只接受SDK持久化的会话请求标识。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    for (const candidate of this.roots.values()) {
      if (candidate.ownerSessionId !== owner.metadata.sessionId) continue;
      const provider = await owner.harness.snapshot(
        ProviderDoc,
        candidate.conversation.id,
        BACKGROUND_CONTEXT
      );
      if (provider?.sessionId === providerSessionId) {
        root = candidate;
        run = candidate.run;
        modelKey = candidate.metadata.modelId;
        conversationId = String(candidate.conversation.id);
        purpose = candidate.run?.purpose;
        break;
      }
    }
    if (!conversationId) {
      for (const child of await owner.subagents.list()) {
        const provider = await owner.harness.snapshot(
          ProviderDoc,
          Number(child.conversationId) as ConversationId,
          BACKGROUND_CONTEXT
        );
        if (provider?.sessionId === providerSessionId) {
          root = owner;
          run = owner.runs.get(child.parentRunId) ?? null;
          modelKey = child.modelKey;
          conversationId = child.conversationId;
          purpose = "subagent";
          break;
        }
      }
    }
    if (!root || !run || !conversationId || !purpose)
      throw new Error("The provider request has no active conversation owner.");
    return { root, run, modelKey, conversationId, purpose };
  }

  private async prepareModelContext(
    owner: OpenRoot | undefined,
    request: PiModelContextPreparation
  ) {
    if (!owner) throw new Error("The provider request has no runtime owner.");
    await owner.sdkToolRejectionChain;
    const binding = await this.providerBinding(owner, request.providerSessionId);
    await this.waitForSteerBoundary(owner, binding.conversationId);
    if (!request.isCompaction) {
      const all = [...owner.sdkToolRejections.values()].filter(
        (fact) => fact.conversationId === binding.conversationId
      );
      const facts = all.slice(-8);
      if (!facts.length) return request.context;
      const text = `<host-sdk-tool-rejections>${JSON.stringify({
        rejections: facts.map((fact) => ({
          taskId: fact.taskId,
          entryId: fact.entryId,
          parentTaskId: fact.parentTaskId,
          metadata: formatToolOutcomeMetadata(fact.outcome),
        })),
        omitted: all.length - facts.length,
      })
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")}</host-sdk-tool-rejections>`;
      return {
        ...request.context,
        messages: [
          ...request.context.messages,
          {
            role: "user" as const,
            content: [{ type: "text" as const, text }],
            timestamp: Date.now(),
          },
        ],
      };
    }
    owner.recovery?.assertCanStartWork();
    request.signal?.throwIfAborted();
    const child = owner.subagents.getChildTaskForConversation(binding.conversationId);
    if (
      binding.run.controller.signal.aborted ||
      (child ? child.status !== "running" : binding.run.status !== "active")
    )
      throw new Error("The summary owner is no longer active.");
    await this.checkpointChains.get(owner.metadata.sessionId);
    const work = await owner.workItems.read(binding.run.id);
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const conversation = await owner.harness.conversation(
      Number(binding.conversationId) as ConversationId,
      BACKGROUND_CONTEXT
    );
    if (!conversation) throw new Error("The summary conversation is unavailable.");
    const page = await conversation.entries(
      { order: "descending" },
      100,
      undefined,
      BACKGROUND_CONTEXT
    );
    const visible = request.context.messages
      .flatMap((message) =>
        typeof message.content === "string"
          ? [message.content]
          : message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
      )
      .join("\n");
    const privateChild = binding.conversationId !== String(owner.conversation.id);
    const checkpoint = !work
      ? null
      : privateChild
        ? {
            source: "va.work-items",
            workItemId: work.id,
            status: work.status,
            checkpointSourceSeq: work.checkpoint.sourceSeq,
            taskContext: owner.subagents.getInstructionContextForConversation(
              binding.conversationId
            ),
          }
        : {
            source: "va.work-items",
            workItemId: work.id,
            status: work.status,
            ...work.checkpoint,
            ...(visible.includes(work.checkpoint.goal)
              ? { goal: undefined, goalSource: "current_summary_source" }
              : {}),
            userRequests: work.checkpoint.userRequests?.map((input) =>
              visible.includes(input.text)
                ? { requestId: input.requestId, source: "current_summary_source" }
                : input
            ),
          };
    const evidence: { entryId: string; metadata: string }[] = [];
    const byteBudget = Math.max(
      0,
      Math.min(12 * 1024, Math.floor(request.model.contextWindow * 3.5 * 0.1)) -
        new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength
    );
    let bytes = 0;
    let evidenceOmitted = 0;
    for (const entry of page.items) {
      if (entry.kind !== "pi.tool-result") continue;
      const message = entry.model?.find((message) => message.role === "toolResult");
      const details = message?.role === "toolResult" ? message.details : null;
      const outcome =
        details && typeof details === "object" && !Array.isArray(details)
          ? ((details as Record<string, unknown>).outcome as ToolOutcome | undefined)
          : undefined;
      const actualOutcome = outcome ?? owner.sdkToolRejections.get(String(entry.byTaskId))?.outcome;
      if (!actualOutcome?.operationId) continue;
      const fact = {
        entryId: String(entry.id),
        metadata: formatToolOutcomeMetadata(actualOutcome),
      };
      const size = new TextEncoder().encode(JSON.stringify(fact)).byteLength;
      if (bytes + size > byteBudget || evidence.length >= 8) {
        evidenceOmitted += 1;
        continue;
      }
      evidence.push(fact);
      bytes += size;
    }
    for (const rejection of owner.sdkToolRejections.values()) {
      if (!rejection.parentTaskId || rejection.conversationId !== binding.conversationId) continue;
      const parent = page.items.find((entry) => String(entry.byTaskId) === rejection.parentTaskId);
      if (!parent) continue;
      const fact = {
        entryId: String(parent.id),
        metadata: formatToolOutcomeMetadata(rejection.outcome),
      };
      const size = new TextEncoder().encode(JSON.stringify(fact)).byteLength;
      if (bytes + size > byteBudget || evidence.length >= 8) {
        evidenceOmitted += 1;
        continue;
      }
      evidence.push(fact);
      bytes += size;
    }
    owner.recovery?.assertCanStartWork();
    request.signal?.throwIfAborted();
    const text = `<host-summary-evidence>${JSON.stringify({ conversationId: binding.conversationId, checkpoint, evidence, evidenceOmitted }).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")}</host-summary-evidence>`;
    return {
      ...request.context,
      messages: [
        ...request.context.messages,
        {
          role: "user" as const,
          content: [{ type: "text" as const, text }],
          timestamp: Date.now(),
        },
      ],
    };
  }

  private async dispatchProvider(
    owner: OpenRoot | undefined,
    request: PiProviderDispatch
  ): Promise<PiProviderStream> {
    if (!owner) throw new Error("The provider request has no runtime owner.");
    await owner.sdkToolRejectionChain;
    owner.recovery?.assertCanStartWork();
    const resolved = await this.providerBinding(owner, request.providerSessionId);
    const { root, run, modelKey, conversationId } = resolved;
    const pendingDraft = this.unsentInputs.get(owner.metadata.sessionId);
    if (pendingDraft?.kind === "prompt" && pendingDraft.input.requestId === run.requestId) {
      await this.saveUnsentInput(owner.metadata.sessionId, null);
      this.unsentAdmissions.delete(owner.metadata.sessionId);
    }
    await this.waitForSteerBoundary(owner, conversationId);
    let purpose = resolved.purpose;
    if (owner.stalledRunId === run.id)
      return this.pauseAtBoundary(owner, run, request.signal ?? run.controller.signal, "stalled");
    const binding = run;
    const initial = owner.models.catalog.readyModels.find(
      (model) => model.configuredModelId === modelKey
    );
    const current = configuredPiCatalog(this.host.getSettings()).readyModels.find(
      (model) => model.configuredModelId === modelKey
    );
    if (
      !initial ||
      !current ||
      request.model.provider !== current.providerInstanceId ||
      request.model.id !== current.upstreamModelId ||
      JSON.stringify(initial) !== JSON.stringify(current) ||
      !(this.host.getSettings().backends.pi?.enabledModels ?? []).includes(
        current.configuredModelId
      )
    )
      throw new Error(
        "The selected model or endpoint changed; reopen the conversation before sending."
      );
    requireModelContextWindow(current);
    const provider = this.host.getSettings().providers[current.providerInstanceId];
    const fingerprint = sha256(JSON.stringify(current));
    const attemptId = `attempt-${this.crypto.randomUUID()}`;
    const isChild = purpose === "subagent";
    if (request.isCompaction) purpose = "compaction";
    const state = (): "active" | "cancelled" | "finished" => {
      if (
        binding.controller.signal.aborted ||
        request.signal?.aborted ||
        this.closed ||
        this.closingRoots.has(owner.metadata.sessionId)
      )
        return "cancelled";
      if (isChild) {
        const child = owner.subagents.getChildTaskForConversation(conversationId);
        return child?.parentRunId === binding.id && child.status === "running"
          ? "active"
          : "finished";
      }
      return root.run === binding ? binding.status : "finished";
    };
    const guard = new ProviderGuard<AssistantMessageEventStream>({
      budget: binding.budget,
      onBudgetDenied: () =>
        this.pauseAtBoundary(owner, binding, request.signal ?? binding.controller.signal),
      resolveRun: async () => ({
        rootId: owner.metadata.sessionId,
        runId: binding.id,
        conversationId,
        state: state(),
        cancelEpoch: binding.controller.signal.aborted ? 1 : 0,
        endpointFingerprint: sha256(
          JSON.stringify(
            configuredPiCatalog(this.host.getSettings()).readyModels.find(
              (model) => model.configuredModelId === modelKey
            )
          )
        ),
      }),
      credentialAvailable: async () =>
        provider.requiresApiKey === false ||
        Boolean(
          provider.apiKeyKeychainId && this.host.keychain.getSecretById(provider.apiKeyKeychainId)
        ),
      createErrorStream: (failure) => {
        throw new Error(`${failure.code}: ${failure.message}`);
      },
      beforeNetworkOpen: () => {
        // 预算提交期间另一工具也可能丢失副作用确认；必须在真正开流前重查暂停状态。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        owner.recovery?.assertCanStartWork();
        // 审批和预算提交都可能让设置发生变化，真正打开流前必须再次核对身份、目标和已解析凭据。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (state() !== "active")
          throw new Error("The request was cancelled or its conversation ended before dispatch.");
        const settings = this.host.getSettings();
        const selected = configuredPiCatalog(settings).readyModels.find(
          (model) => model.configuredModelId === modelKey
        );
        if (
          !selected ||
          sha256(JSON.stringify(selected)) !== fingerprint ||
          !(settings.backends.pi?.enabledModels ?? []).includes(selected.configuredModelId)
        )
          throw new Error(
            "ENDPOINT_MISMATCH: The configured model changed before its network stream."
          );
        const activeProvider = settings.providers[selected.providerInstanceId];
        if (activeProvider.requiresApiKey !== false) {
          const key = activeProvider.apiKeyKeychainId
            ? this.host.keychain.getSecretById(activeProvider.apiKeyKeychainId)
            : null;
          if (!key || sha256(key) !== request.credentialFingerprint)
            throw new Error(
              "CREDENTIAL_REQUIRED: The resolved credential changed before dispatch."
            );
        }
      },
      openNetworkStream: () => request.open(),
    });
    const signal = request.signal ?? binding.controller.signal;
    if (owner.pauseRequested) return this.pauseAtBoundary(owner, binding, signal);
    await this.ensureStoreCapacity(owner, signal);
    await this.checkpointChains.get(owner.metadata.sessionId);
    await this.checkpointWorkItem(owner, binding.id, "before_request");
    try {
      const stream = await guard.dispatch({
        rootId: owner.metadata.sessionId,
        runId: binding.id,
        conversationId,
        cancelEpoch: 0,
        endpointFingerprint: fingerprint,
        providerInstanceId: current.providerInstanceId,
        modelId: current.upstreamModelId,
        purpose,
        attemptId,
        signal,
      });
      return {
        stream,
        onResponse: async (message) => {
          await binding.budget.settle(attemptId, {
            kind: message.stopReason === "error" ? "failed" : "completed",
          });
          const usd =
            current.costRates && message.stopReason !== "error" ? message.usage.cost.total : null;
          await owner.workItems.recordUsage(binding.id, attemptId, usd);
          await binding.budget.recordUsage(attemptId, {
            usd:
              current.costRates && message.stopReason !== "error" ? message.usage.cost.total : null,
            usageId: attemptId,
          });
          await this.publishRunBudget(owner, binding);
        },
      };
    } catch (error) {
      await binding.budget.settle(attemptId, { kind: "failed" });
      await this.publishRunBudget(owner, binding);
      throw error;
    }
  }

  private async publishRunBudget(
    owner: OpenRoot,
    run: NonNullable<OpenRoot["run"]>
  ): Promise<void> {
    const snapshot = run.budget.snapshot;
    const view = projectBudget({
      localLimits: { requestLimit: snapshot.limits.maxModelAttempts },
      counters: { requests: snapshot.modelAttempts, tools: 0, activeMs: 0 },
    });
    const planUsage = {
      windows: view.windows.map(({ id, label, percent, source }) => ({
        id,
        label,
        percent,
        source,
      })),
      updatedAt: Date.now(),
    };
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    // 本地请求上限只描述本次任务，持久化后重开可见，不能冒充服务商订阅额度。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    await owner.conversation.commit(async (tx) => {
      await tx.appendEntry(owner.conversation.id, {
        kind: "va.budget_view",
        data: { runId: run.id, planUsage },
      });
    }, BACKGROUND_CONTEXT);
    this.emit(owner.metadata.sessionId, { sessionUpdate: "plan_usage_update", planUsage });
  }

  private async checkpointWorkItem(
    owner: OpenRoot,
    runId: string,
    reason: string,
    evidenceEntryIds: readonly string[] = [],
    sourceSeq = 0,
    status?:
      | "active"
      | "paused_budget"
      | "paused_storage"
      | "paused_stalled"
      | "paused_user"
      | "waiting_user"
  ): Promise<void> {
    const item = await owner.workItems.read(runId);
    if (!item || (reason === "committed_progress" && item.status === "waiting_user")) return;
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const page = await owner.conversation.entries(
      { order: "descending" },
      100,
      undefined,
      BACKGROUND_CONTEXT
    );
    const todo = page.items.find(
      (entry) =>
        entry.kind === "va.state" &&
        entry.data &&
        typeof entry.data === "object" &&
        !Array.isArray(entry.data) &&
        entry.data.docKind === "va.todos"
    )?.data;
    const update =
      todo && typeof todo === "object" && !Array.isArray(todo) ? todo.update : undefined;
    const state =
      update && typeof update === "object" && !Array.isArray(update) ? update.todo : undefined;
    const items =
      state && typeof state === "object" && !Array.isArray(state) && Array.isArray(state.items)
        ? state.items
        : [];
    const remaining = items
      .filter(
        (entry): entry is JsonObject =>
          !!entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          entry.status !== "completed"
      )
      .map((entry) => (typeof entry.text === "string" ? entry.text : ""));
    const inspection = await owner.harness.inspect(BACKGROUND_CONTEXT);
    const evidence = [
      ...new Set([
        ...item.checkpoint.evidenceEntryIds,
        ...page.items
          .filter((entry) =>
            [
              "pi.tool-result",
              "pi.compaction",
              "va.mutation",
              "va.subagent.report",
              "va.state",
            ].includes(entry.kind)
          )
          .map((entry) => String(entry.id)),
        ...evidenceEntryIds,
      ]),
    ].slice(-128);
    await owner.workItems.checkpoint(
      runId,
      {
        ...item.checkpoint,
        evidenceEntryIds: evidence,
        remainingItems:
          reason === "maintenance_boundary"
            ? []
            : state &&
                typeof state === "object" &&
                !Array.isArray(state) &&
                Array.isArray(state.items)
              ? remaining
              : item.checkpoint.remainingItems,
        nextStep:
          remaining[0] ??
          (inspection.tasks.length
            ? "从已保存的SDK任务继续，已完成的文件操作不重做。"
            : "等待用户下一步。"),
        sourceSeq: Math.max(sourceSeq, item.checkpoint.sourceSeq),
        reason,
        savedAtMs: Date.now(),
      },
      status ??
        ((reason === "turn_boundary" || reason === "maintenance_boundary") &&
        inspection.tasks.length === 0
          ? "waiting_user"
          : undefined)
    );
  }

  private async settlePausedRunAfterAbort(root: OpenRoot): Promise<void> {
    const entry = [...root.entries.values()].filter((item) => item.kind === "va.run").at(-1);
    const data = entry?.data;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      typeof data.status !== "string" ||
      (!data.status.startsWith("paused_") && data.status !== "completed") ||
      typeof data.runId !== "string"
    )
      return;
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const inspection = await root.harness.inspect(BACKGROUND_CONTEXT);
    if (inspection.tasks.length || inspection.submissions.length) return;
    if (data.status === "completed") {
      const item = await root.workItems.read(data.runId);
      if (item?.status !== "waiting_user" || item.checkpoint.remainingItems.length === 0) return;
    }
    const terminal = await root.conversation.commit(
      (tx) =>
        tx.appendEntry(root.conversation.id, {
          kind: "va.run",
          data: { ...data, status: "cancelled", endedAtMs: Date.now() },
        }),
      BACKGROUND_CONTEXT
    );
    root.entries.set(String(terminal.id), terminal);
    await this.checkpointWorkItem(root, data.runId, "stopped", [], 0, "waiting_user");
    await root.recovery?.safeBoundary();
  }

  private async ensureStoreCapacity(owner: OpenRoot, signal?: AbortSignal): Promise<void> {
    if (this.rollovers.has(owner.metadata.sessionId)) return;
    if ((await this.measureStoreBytes(owner.store.storeDir)) < STORE_SIZE_PAUSE_BYTES) return;
    let run = owner.run ?? [...owner.runs.values()].at(-1);
    if (!run) {
      const runId = `storage-${owner.metadata.sessionId}`;
      await owner.workItems.ensure(runId, "保留当前聊天和已完成的操作，在新记录中继续。");
      run = {
        id: runId,
        requestId: runId,
        controller: new AbortController(),
        startedAt: Date.now(),
        budget: await this.budgetFor(owner, runId),
        status: "active",
        purpose: "root",
      };
      owner.run = run;
      owner.runs.set(runId, run);
    }
    const interruption = new AbortController();
    const abort = () => interruption.abort();
    const signals = [run.controller.signal, ...(signal ? [signal] : [])];
    for (const item of signals) {
      item.addEventListener("abort", abort, { once: true });
      if (item.aborted) interruption.abort();
    }
    try {
      await this.pauseAtBoundary(owner, run, interruption.signal, "storage");
    } finally {
      for (const item of signals) item.removeEventListener("abort", abort);
    }
  }

  private pauseAtBoundary(
    owner: OpenRoot,
    run: NonNullable<OpenRoot["run"]>,
    signal: AbortSignal,
    reason: "budget" | "storage" | "stalled" | "user" = "budget"
  ): Promise<never> {
    const ownerId = owner.metadata.sessionId;
    if (!this.pauseOperations.has(ownerId)) {
      owner.pauseRequested = true;
      this.emit(ownerId, {
        sessionUpdate: "recovery_state",
        recovery: {
          status: "pausing",
          pendingPermissionIds: [],
          pendingQuestionIds: [],
          pendingMutationIds: [],
          crashLoopTripped: false,
          message: "正在保存进度并暂停，请稍候。",
        },
      });
      this.pausingRoots.add(ownerId);
      for (const root of this.roots.values())
        if (root.ownerSessionId === ownerId) root.pauseRequested = true;
      // 预算暂停关闭整个所有者以保留SDK检查点；不能在当前调用里等待自身关闭，也不能把额度耗尽写成普通失败。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const closing = (async () => {
        const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
        await this.checkpointChains.get(ownerId);
        await owner.vaultTools.drain();
        await owner.native.dispose();
        const pausedStatus: "paused_storage" | "paused_stalled" | "paused_budget" | "paused_user" =
          reason === "storage"
            ? "paused_storage"
            : reason === "user"
              ? "paused_user"
              : reason === "stalled"
                ? "paused_stalled"
                : "paused_budget";
        await this.checkpointWorkItem(owner, run.id, pausedStatus, [], 0, pausedStatus);
        const state = {
          runId: run.id,
          requestId: run.requestId,
          status: pausedStatus,
          startedAtMs: run.startedAt,
          endedAtMs: Date.now(),
          cancelEpoch: 0,
          modelAttempts: run.budget.snapshot.modelAttempts,
        };
        const pausedTasks = (await owner.harness.inspect(BACKGROUND_CONTEXT)).tasks;
        await owner.conversation.commit(async (tx) => {
          // 暂停保留用户已看到的正文草稿，不把未完成输出提交为模型回答或新增模型输入。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          for (const root of this.roots.values()) {
            if (root.ownerSessionId !== ownerId) continue;
            const text = this.projection(root).pausedOutput();
            const task = pausedTasks.find(
              (task) =>
                task.record.kind === "pi.generation" &&
                String(task.record.conversationId) === String(root.conversation.id)
            );
            if (text)
              await tx.appendEntry(root.conversation.id, {
                kind: "va.paused-output",
                data: { runId: run.id, text, ...(task ? { taskId: String(task.record.id) } : {}) },
              });
          }
          await tx.appendEntry(owner.conversation.id, { kind: "va.run", data: state });
        }, BACKGROUND_CONTEXT);
        this.emit(ownerId, { sessionUpdate: "run_state", run: state });
        await this.pool.close(ownerId);
        // 正常退出及外层关闭不再重开写入者；只有仍在使用的暂停聊天恢复只读投影。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (!this.closed && !this.closingRoots.has(ownerId)) {
          await this.getRoot(ownerId, owner.metadata.cwd, false);
          await this.replay(ownerId);
        }
      })()
        .catch(async (error) => {
          owner.storageFailed = true;
          await owner.recovery?.storageFailed(error).catch(() => undefined);
          await owner.harness
            .close((await import("@earendil-works/chord/context")).BACKGROUND_CONTEXT)
            .catch(() => undefined);
          logError("[PiRuntime] failed to preserve a paused task", error);
        })
        .finally(() => {
          this.pausingRoots.delete(ownerId);
          this.pauseOperations.delete(ownerId);
        });
      this.pauseOperations.set(ownerId, closing);
    }
    return new Promise<never>((_resolve, reject) => {
      const stopped = () =>
        reject(signal.reason instanceof Error ? signal.reason : new Error("本段工作已保存暂停。"));
      if (signal.aborted) stopped();
      else signal.addEventListener("abort", stopped, { once: true });
    });
  }

  private async budgetFor(root: OpenRoot, runId: string): Promise<RunBudget> {
    const owner = this.requireRoot(root.ownerSessionId);
    const key = `${owner.metadata.sessionId}:${runId}`;
    const existing = this.budgets.get(key);
    if (existing) return existing;
    const opening = (async () => {
      const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
      const records: BudgetReserveRecord[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await owner.conversation.entries(
          { order: "ascending" },
          100,
          cursor,
          BACKGROUND_CONTEXT
        );
        for (const entry of page.items)
          if (
            entry.kind === "va.budget" &&
            typeof entry.data === "object" &&
            entry.data !== null &&
            !Array.isArray(entry.data) &&
            entry.data.runId === runId
          )
            records.push(entry.data as unknown as BudgetReserveRecord);
        cursor = page.next;
      } while (cursor);
      const item = await owner.workItems.ensure(runId, "", records);
      return new RunBudget({
        initialReservations: item.reservations,
        initialUsage: item.usage,
        limits: { maxModelAttempts: item.grants.reduce((sum, grant) => sum + grant.requests, 0) },
        persistReserve: (reserve) => owner.workItems.reserve(reserve),
        persistRefund: (attemptId) => owner.workItems.refund(runId, attemptId),
      });
    })();
    this.budgets.set(key, opening);
    try {
      return await opening;
    } catch (error) {
      this.budgets.delete(key);
      throw error;
    }
  }

  private async getRoot(
    id: string,
    cwd: string,
    create: boolean,
    input?: OpenSessionInput,
    allowRollover = false,
    waitForCapacity = true
  ): Promise<OpenRoot> {
    await this.resourceClosures.get(id);
    if (this.closed) throw new Error("The Pi runtime is closed.");
    if (!allowRollover && this.rollovers.has(id)) throw new Error("这段聊天正在整理，请等待完成。");
    if (this.closingRoots.has(id))
      throw new Error("The Pi session is closing; reopen it after closing finishes.");
    assertHostRootId(id);
    const existing = this.roots.get(id);
    if (existing) return existing;
    const pending = this.opening.get(id);
    if (pending) {
      if (!waitForCapacity)
        throw Object.assign(new Error("这段聊天正在等待可用的执行位置，请稍后重新载入。"), {
          code: "RUNTIME_BUSY",
        });
      return pending;
    }
    const opening = (async () => {
      const stored = await this.readMetadata(id);
      if (stored?.archivedAtMs)
        throw Object.assign(new Error("这段聊天已归档，原始历史仅供读取和导出。"), {
          code: "SESSION_ARCHIVED",
        });
      const parentSessionId = stored?.parentSessionId ?? input?.parentSessionId;
      if (parentSessionId) {
        const parent = await this.getRoot(
          parentSessionId,
          cwd,
          false,
          undefined,
          false,
          waitForCapacity
        );
        this.operationOwners.set(id, parent.ownerSessionId);
        const child = await this.openChild(id, cwd, stored, input, parent);
        this.syncObservation(parent.ownerSessionId);
        return child;
      }
      this.openRequests.set(id, { cwd, create, input });
      let acquired = false;
      try {
        this.unsentAdmissions.get(id)?.controller.signal.throwIfAborted();
        input?.signal?.throwIfAborted();
        const pooled = await this.pool.acquire(id, { waitForCapacity });
        acquired = true;
        const root = pooled.handle as OpenRoot;
        this.syncObservation(id);
        return root;
      } finally {
        this.openRequests.delete(id);
        if (acquired) await this.pool.release(id);
      }
    })();
    this.opening.set(id, opening);
    try {
      return await opening;
    } finally {
      this.opening.delete(id);
    }
  }

  private async openRoot(
    id: string,
    cwd: string,
    create: boolean,
    input?: OpenSessionInput
  ): Promise<OpenRoot> {
    input?.signal?.throwIfAborted();
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const {
      Harness,
      createRegistry,
      defineExtension,
      watchEvents,
      GenerationTask,
      ToolTask,
      hook,
      defineDoc,
    } = await import("@earendil-works/pi-durable");
    const { openNodeJsonlStorage } = await import("@earendil-works/pi-durable/storage/jsonl/node");
    const paths = this.locator.sessionStorePaths(id);
    const privateDir = this.path.dirname(paths.metaPath);
    let metadata = await this.readMetadata(id);
    if (metadata?.unsentInput) this.unsentInputs.set(id, metadata.unsentInput);
    if (!metadata && !create) throw new Error("The saved Pi session does not exist.");
    const parentSessionId = metadata?.parentSessionId ?? input?.parentSessionId;
    if (parentSessionId)
      return this.openChild(
        id,
        cwd,
        metadata,
        input,
        await this.getRoot(parentSessionId, cwd, false)
      );
    let owned: OpenRoot | undefined;
    const audit: Pick<AuditLog, "record"> = {
      record: (input) =>
        new AuditLog({
          redactor: new Redactor({
            secretValues: Object.values(this.host.getSettings().providers).flatMap((provider) => {
              const value = provider.apiKeyKeychainId
                ? this.host.keychain.getSecretById(provider.apiKeyKeychainId)
                : null;
              return value ? [value] : [];
            }),
          }),
          sink: {
            write: async (record) => {
              if (!owned) throw new Error("The audit session is unavailable.");
              try {
                const saved: { entry?: EntryRecord } = {};
                await owned.conversation.commit(async (tx) => {
                  saved.entry = await tx.appendEntry(owned!.conversation.id, {
                    kind: "va.audit",
                    data: JSON.parse(JSON.stringify(record)),
                  });
                }, BACKGROUND_CONTEXT);
                if (saved.entry) owned.entries.set(String(saved.entry.id), saved.entry);
              } catch (error) {
                owned.storageFailed = true;
                owned.run?.controller.abort();
                owned.vaultTools.dispose();
                owned.approvals?.dispose();
                await owned.native.dispose();
                await owned.recovery?.storageFailed(error).catch(() => undefined);
                throw error;
              }
            },
          },
        }).record({ ...input, requestId: input.requestId ?? owned?.run?.requestId }),
    };
    const models = await createPiModels({
      settings: this.host.getSettings(),
      keychain: this.host.keychain,
      streamsFactory: this.host.streamsFactory,
      fetch: this.host.fetch,
      prepareContext: (request) => this.prepareModelContext(owned, request),
      dispatch: (request) => this.dispatchProvider(owned, request),
    });
    const configuredDefault =
      this.host.getSettings().agentMode.backends.pi?.defaultModel?.baseModelId;
    const enabled = new Set(this.host.getSettings().backends.pi?.enabledModels ?? []);
    metadata ??= {
      sessionId: id,
      cwd,
      title: null,
      createdAt: new Date().toISOString(),
      modelId:
        models.catalog.readyModels.find(
          (entry) =>
            enabled.has(entry.configuredModelId) && entry.configuredModelId === configuredDefault
        )?.configuredModelId ??
        models.catalog.readyModels.find((entry) => enabled.has(entry.configuredModelId))
          ?.configuredModelId ??
        null,
      mode: input?.readOnly
        ? "plan"
        : (this.host.getSettings().agentMode.backends.pi?.defaultMode ?? "default"),
      effort: null,
      readOnly: input?.readOnly,
      projectId: input?.projectId,
    };
    await this.fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
    let storage: Storage | undefined;
    const opened = await this.withMetadataLock(id, async () => {
      const result = await new DurableStore({
        ...paths,
        runtimeVersion: "1.3.0",
        context: BACKGROUND_CONTEXT,
        lease: new StoreLease({ leaseDir: paths.leaseDir, storePath: paths.storeDir }),
        openStorage: async (directory, context, options) => {
          storage = await openNodeJsonlStorage(directory, context, options);
          return storage;
        },
      }).open();
      if (result.kind === "open") this.writerRoots.add(id);
      return result;
    });
    if (opened.kind !== "open")
      throw Object.assign(
        new Error(
          opened.kind === "busy" ? "This Pi session already has another writer." : opened.message
        ),
        { code: opened.kind === "busy" ? "STORE_BUSY" : "STORE_VERSION_UNSUPPORTED" }
      );
    const store = opened.store;
    const cleanup: Array<() => void | Promise<unknown>> = [
      async () => {
        try {
          await store.close();
        } finally {
          this.writerRoots.delete(id);
        }
      },
    ];
    let harness: DurableHarness | undefined;
    try {
      const registry = createRegistry();
      const toolIdentityDoc = defineDoc<{ tasks: Record<string, boolean> }>({
        kind: "va.tool-identity",
        version: 1,
        scope: "conversation",
        history: "latest",
        fork: "current",
        initial: () => ({ tasks: {} }),
      });
      const progressGuardDoc = defineDoc<{ runs: Record<string, ProgressGuardState> }>({
        kind: "va.progress-guard",
        version: 1,
        scope: "conversation",
        history: "rewindable",
        fork: "initial",
        initial: () => ({ runs: {} }),
      });
      const capabilities = new CapabilityCatalog();
      const instructionRevisions = new Map<string, string>();
      const capabilityContext = (conversationId: string): CapabilityContext => {
        const session = this.sessionForConversation(conversationId, id);
        const caller = session?.metadata.parentSessionId
          ? "fanout"
          : (owned?.subagents.getCaller(conversationId) ?? "root");
        const mode =
          session?.metadata.mode ??
          owned?.subagents.getModeForConversation(conversationId) ??
          "plan";
        return {
          caller,
          mode,
          readOnly: session
            ? this.isReadOnly(session)
            : (owned?.subagents.isReadOnly(conversationId) ?? true),
          trustedHost:
            this.host.getSettings().agentMode.backends.pi?.hostExecutionMode === "trusted_host",
          scope: {
            vaultRoot: this.vaultRoot,
            externalRoots: (this.host.getSettings().agentMode.backends.pi?.externalScopes ?? [])
              .filter((scope) => scope.expiresAtMs === undefined || scope.expiresAtMs > Date.now())
              .map((scope) => scope.root),
            readOnly: false,
          },
        };
      };
      capabilities.setExecutionGate(async (name, _args, api, context) => {
        await owned?.sdkToolRejectionChain;
        // 同批次工具的提交订阅异步更新工作记录；下一次宿主操作必须先追平该记录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        await this.checkpointChains.get(id);
        const conversationId = String(api.conversationId);
        if (owned?.steerRejected && conversationId === String(owned.conversation.id))
          return {
            caller: "root",
            ownerSessionId: id,
            code: "CANCELLED",
            block: "本次补充未加入原工作，工具不会执行。",
          };
        const caller = capabilityContext(conversationId).caller;
        const identity = {
          caller,
          ownerSessionId: id,
          operationId: `tool-task:${id}:${conversationId}:${api.taskId}`,
        };
        if (context.abortSignal?.aborted)
          return { ...identity, code: "CANCELLED", block: "本次工具调用已取消。" };
        if (owned?.pauseRequested || owned?.stalledRunId)
          return {
            ...identity,
            code: "WORK_PAUSED",
            block: "当前任务正在保存暂停，工具不会执行。",
          };
        if (!owned || owned.recovery?.blocked !== false)
          return {
            ...identity,
            code: "RECOVERY_REQUIRED",
            block: "未完成的工作尚未得到用户明确恢复，工具不会执行。",
          };
        await this.ensureStoreCapacity(owned, context.abortSignal);
        const session = this.sessionForConversation(conversationId, id);
        const parentRun = session
          ? session.run
          : owned.runs.get(owned.subagents.getParentRunIdForConversation(conversationId) ?? "");
        if (
          !parentRun ||
          parentRun.controller.signal.aborted ||
          (session && parentRun.status !== "active")
        )
          return { ...identity, code: "CANCELLED", block: "本次工作已停止，工具不会执行。" };
        const capability = capabilities.evaluate(name, capabilityContext(conversationId));
        return capability.available
          ? identity
          : {
              ...identity,
              code: "CAPABILITY_UNAVAILABLE",
              block: capability.reason ?? "该工具当前不可用。",
            };
      });
      const vaultTools = await createVaultHostTools({
        capabilities,
        beforeMutation: async (signal) => {
          if (owned) await this.ensureStoreCapacity(owned, signal);
        },
        audit,
        app: this.host.app,
        vaultRoot: this.vaultRoot,
        privateDir,
        sessionId: id,
        getMode: () =>
          owned && this.isReadOnly(owned) ? "plan" : (owned?.metadata.mode ?? metadata.mode),
        getModeForConversation: (conversationId) =>
          this.sessionForConversation(conversationId, id)?.metadata.mode ??
          owned?.subagents.getModeForConversation(conversationId) ??
          "plan",
        getCaller: (conversationId) =>
          this.sessionForConversation(conversationId, id)?.metadata.parentSessionId
            ? "fanout"
            : (owned?.subagents.getCaller(conversationId) ?? "root"),
        isReadOnly: (conversationId) => {
          const session = this.sessionForConversation(conversationId, id);
          return session
            ? this.isReadOnly(session)
            : (owned?.subagents.isReadOnly(conversationId) ?? true);
        },
        isPathInScope: (path, conversationId, access) =>
          !conversationId || this.sessionForConversation(conversationId, id)
            ? this.pathInScope(path, metadata.cwd)
            : (owned?.subagents.isPathInScope(path, conversationId, access) ?? false),
        requestPermission: (prompt) =>
          owned?.approvals?.request(prompt) ??
          Promise.resolve({ outcome: { outcome: "cancelled" } }),
        onUnknownEffect: async () => {
          if (!owned?.recovery) return;
          if (owned.storageFailed)
            await owned.recovery.storageFailed(new Error("文件结果尚未确认，操作记录保存失败。"));
          else await owned.recovery.safeBoundary();
        },
        getRunId: (conversationId) => {
          const session = conversationId ? this.sessionForConversation(conversationId, id) : owned;
          if (session) return session.run?.status === "active" ? session.run.id : null;
          return conversationId
            ? (owned?.subagents.getParentRunIdForConversation(conversationId) ?? null)
            : null;
        },
        persistFileChanges: async (changes, source) =>
          owned ? this.persistMutationChanges(owned, changes, source) : false,
        onFileChanges: (changes) => {
          if (owned?.run?.status === "active") this.recordFileChanges(owned, changes);
        },
      });
      cleanup.push(() => vaultTools.dispose());
      registry.install(
        defineExtension({
          name: "vault-agent",
          tools: vaultTools.registrations,
          hooks: [
            hook(GenerationTask, {
              beforeRequest: async (request, api, context) => {
                if (owned) await this.waitForSteerBoundary(owned, String(api.conversationId));
                if (!owned || owned.recovery?.blocked !== false)
                  throw new Error("未完成的工作需要用户明确恢复。");
                const requestCapabilities = async () => {
                  const conversation = await owned!.harness.conversation(
                    api.conversationId,
                    context
                  );
                  if (!conversation)
                    throw new Error("The conversation is unavailable before its model request.");
                  const agent = await conversation.agent(context);
                  const session = this.sessionForConversation(String(api.conversationId), id);
                  const workId =
                    session?.run?.id ??
                    owned!.subagents.getParentRunIdForConversation(String(api.conversationId));
                  await this.checkpointChains.get(id);
                  if (workId)
                    await this.checkpointWorkItem(owned!, workId, "before_context_request");
                  let work = workId ? await owned!.workItems.read(workId) : null;
                  const modelKey =
                    session?.metadata.modelId ??
                    owned!.subagents.getModelKeyForConversation(String(api.conversationId));
                  const model = owned!.models.catalog.readyModels.find(
                    (entry) => entry.configuredModelId === modelKey
                  );
                  const childInstructions = owned!.subagents.getInstructionContextForConversation(
                    String(api.conversationId)
                  );
                  const selectedContext = await owned!.features.prepareContext(undefined, {
                    readOnly: true,
                    refreshInstructions: true,
                  });
                  const projectId = session?.metadata.projectId ?? owned!.metadata.projectId;
                  const project =
                    projectId && this.host.getProjectContext
                      ? (this.host.getProjectContext(projectId) ?? undefined)
                      : selectedContext.project;
                  const requestEnvironment = {
                    scope: {
                      vaultRoot: this.vaultRoot,
                      workspaceRoot:
                        session?.metadata.cwd ?? childInstructions?.cwd ?? owned!.metadata.cwd,
                    },
                    mode: capabilityContext(String(api.conversationId)).mode,
                    offeredTools: capabilities.snapshot(
                      agent.tools.map((tool) => tool.name),
                      capabilityContext(String(api.conversationId))
                    ).offeredTools,
                    deferredTools: capabilities.snapshot(
                      agent.deferred.map((tool) => tool.name),
                      capabilityContext(String(api.conversationId))
                    ).offeredTools,
                  };
                  const fresh = await preparePiRuntimeInput({
                    input: {
                      sessionId: id,
                      prompt: [],
                      context: { ...(project ? { project } : {}), materials: [] },
                    },
                    instructionContext: {
                      ...(this.host.getInstructionSections?.() ?? {
                        base: this.host.getInstructions?.() ?? "",
                      }),
                      skills: selectedContext.skills,
                    },
                    environment: requestEnvironment,
                    modelKey: model?.configuredModelId ?? "unknown",
                    acceptsImages: model?.capabilities.supportsImages ?? false,
                    contextWindowTokens: model?.contextWindow,
                    privateDir,
                    vaultRoot: this.vaultRoot,
                    app: this.host.app,
                    isInstructionPathAllowed: this.host.isInstructionPathAllowed,
                  });
                  const sources = fresh.receipt.context.sectionDigests.filter(
                    (section) => section.injectedAsSystem && section.kind !== "environment"
                  );
                  const notices = [...fresh.notices, ...(selectedContext.notices ?? [])];
                  const revision = sha256(JSON.stringify({ sources, notices }));
                  if (instructionRevisions.get(String(api.conversationId)) !== revision) {
                    await conversation.commit(
                      (tx) =>
                        tx.appendEntry(api.conversationId, {
                          kind: "va.context",
                          data: JSON.parse(JSON.stringify({ revision, sources, notices })),
                        }),
                      context
                    );
                    instructionRevisions.set(String(api.conversationId), revision);
                    if (workId) {
                      await owned!.workItems.recordInstructionSources(
                        workId,
                        sources
                          .filter(
                            (source) =>
                              source.kind === "user_system" ||
                              source.kind === "project" ||
                              source.kind === "skill"
                          )
                          .map(({ sourceId, revision, kind, scope }) => ({
                            sourceId,
                            revision,
                            kind,
                            ...(scope ? { scope } : {}),
                          }))
                      );
                      work = await owned!.workItems.read(workId);
                    }
                  }
                  return {
                    messages: await applyRequestCapabilities(
                      request.messages,
                      agent.tools,
                      capabilities,
                      capabilityContext(String(api.conversationId)),
                      Date.now(),
                      work && childInstructions
                        ? {
                            id: work.id,
                            reference: {
                              status: work.status,
                              sourceSeq: work.checkpoint.sourceSeq,
                            },
                          }
                        : work,
                      {
                        scope: {
                          vaultRoot: this.vaultRoot,
                          ...(session ? { workspaceRoot: session.metadata.cwd } : {}),
                        },
                        ...(model
                          ? {
                              model: {
                                id: model.configuredModelId,
                                acceptsImages: model.capabilities.supportsImages,
                                contextWindowTokens: model.contextWindow,
                              },
                            }
                          : {}),
                        deferredTools: capabilities.snapshot(
                          agent.deferred.map((tool) => tool.name),
                          capabilityContext(String(api.conversationId))
                        ).offeredTools,
                      },
                      {
                        text: [
                          fresh.instructions,
                          ...(notices.length
                            ? [
                                `<host-context-omissions>${JSON.stringify(notices).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")}</host-context-omissions>`,
                              ]
                            : []),
                        ].join("\n\n"),
                        childRole: childInstructions
                          ? JSON.stringify(childInstructions)
                          : undefined,
                      }
                    ),
                  };
                };
                if (owned?.subagents.getChildTaskForConversation(String(api.conversationId)))
                  return requestCapabilities();
                const currentRoot = this.sessionForConversation(String(api.conversationId), id);
                if (
                  !currentRoot?.run ||
                  currentRoot.run.status !== "active" ||
                  currentRoot.run.controller.signal.aborted ||
                  context.abortSignal?.aborted
                )
                  throw new Error("The run was cancelled before its model request.");
                const selected = currentRoot.models.catalog.readyModels.find(
                  (entry) => entry.configuredModelId === currentRoot.metadata.modelId
                );
                const current =
                  this.host.getSettings().providers[selected?.providerInstanceId ?? ""];
                const original = this.host
                  .getSettings()
                  .configuredModels.find(
                    (model) => model.configuredModelId === currentRoot.metadata.modelId
                  );
                if (
                  !selected ||
                  !current ||
                  original?.info.id !== selected.upstreamModelId ||
                  (current.baseUrl ?? null) !== selected.baseUrl
                )
                  throw new Error(
                    "The configured endpoint changed; reopen the session before sending."
                  );
                return requestCapabilities();
              },
            }),
            hook(ToolTask, {
              beforeTool: async (call, api, context) => {
                if (owned)
                  await owned.harness.commit(async (tx) => {
                    const identities = await tx.doc(toolIdentityDoc, api.conversationId);
                    const taskId = String(api.taskId);
                    if (identities.tasks[taskId]) return;
                    const task = await tx.task(api.taskId);
                    const input = task?.input;
                    const source =
                      input && typeof input === "object" && !Array.isArray(input) ? input : {};
                    await tx.appendEntry(api.conversationId, {
                      kind: "va.tool-identity",
                      data: {
                        taskId,
                        callId: call.id,
                        ...(source.kind === "model" && typeof source.assistant === "number"
                          ? { assistantEntryId: String(source.assistant) }
                          : {}),
                        ...(call.parent ? { parentTaskId: String(call.parent.taskId) } : {}),
                      },
                    });
                    identities.tasks[taskId] = true;
                  }, BACKGROUND_CONTEXT);
                return undefined;
              },
              afterTool: async (call, result, api) => {
                if (owned) {
                  const conversationId = String(api.conversationId);
                  const session = this.sessionForConversation(conversationId, id);
                  const runId =
                    session?.run?.id ??
                    owned.subagents.getParentRunIdForConversation(conversationId);
                  if (runId) {
                    let code: string | undefined;
                    if (result.isError) {
                      code = "TOOL_EXECUTION_FAILED";
                      const details = result.details as
                        | {
                            outcome?: { error?: { code?: string } };
                            error?: { code?: string };
                            code?: string;
                          }
                        | undefined;
                      code =
                        details?.outcome?.error?.code ??
                        details?.error?.code ??
                        details?.code ??
                        code;
                    }
                    const stalled = await owned.conversation.commit(async (tx) => {
                      const guard = await tx.doc(progressGuardDoc, owned!.conversation.id);
                      const state = JSON.parse(
                        JSON.stringify(
                          guard.runs[runId] ?? {
                            fingerprint: "",
                            consecutive: 0,
                            seen: {},
                          }
                        )
                      ) as ProgressGuardState;
                      const stalled = recordToolProgress(state, {
                        executionId: String(api.taskId),
                        conversationId,
                        toolId: call.name,
                        arguments: call.arguments,
                        errorCode: code,
                      });
                      guard.runs[runId] = state;
                      return stalled;
                    }, BACKGROUND_CONTEXT);
                    if (stalled) owned.stalledRunId = runId;
                  }
                }
                if (result.isError && owned)
                  await owned.features.observeError({
                    kind: "tool_error",
                    code: call.name,
                    message:
                      result.output
                        ?.filter((block) => block.type === "text")
                        .map((block) => block.text)
                        .join("\n") ?? "Tool execution failed.",
                    runId: owned.run?.id,
                  });
                return undefined;
              },
            }),
          ],
        })
      );
      cleanup.push(async () => harness?.close(BACKGROUND_CONTEXT));
      if (!storage) throw new Error("The durable store was not opened.");
      let smallestWindow = Number.POSITIVE_INFINITY;
      const host = this.host;
      harness = await Harness.open(
        storage,
        {
          models: models.models,
          registry,
          settings: {
            stream: { timeoutMs: 120_000 },
            retry: { enabled: true, maxRetries: 2, baseDelayMs: 1_000 },
            progress: { partialIntervalMs: 100, outputIntervalMs: 100 },
            toolExecution: "sequential",
            get compaction() {
              const enabled = new Set(host.getSettings().backends.pi?.enabledModels ?? []);
              const windows = models.catalog.readyModels
                .filter(
                  (model) =>
                    enabled.has(model.configuredModelId) &&
                    model.contextWindow !== null &&
                    Number.isSafeInteger(model.contextWindow) &&
                    model.contextWindow >= MIN_MODEL_CONTEXT_WINDOW
                )
                .map((model) => model.contextWindow as number);
              // 一个根内所有会话共用阈值；运行期间只收紧，扩大容量须等重新打开。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
              smallestWindow = Math.min(smallestWindow, ...windows);
              return Number.isFinite(smallestWindow)
                ? compactionPolicyForWindow(smallestWindow)
                : {
                    enabled: false,
                    reserveTokens: 0,
                    keepRecentTokens: 0,
                    backgroundTokens: 0,
                  };
            },
          },
        },
        BACKGROUND_CONTEXT
      );
      const selected = models.catalog.readyModels.find(
        (entry) => entry.configuredModelId === metadata.modelId
      );
      const conversation = await harness.root(BACKGROUND_CONTEXT, {
        agent: {
          ...(selected
            ? {
                model: { provider: selected.providerInstanceId, modelId: selected.upstreamModelId },
              }
            : {}),
          instructions: this.host.getInstructions?.(),
          cwd,
        },
      });
      const skillsSource = this.host.skillsSource;
      const features = await createPiFeatureTools({
        getCaller: (conversationId) =>
          this.sessionForConversation(conversationId, id)?.metadata.parentSessionId
            ? "fanout"
            : (owned?.subagents.getCaller(conversationId) ?? "root"),
        capabilities,
        app: this.host.app,
        webSearch: this.host.webSearch,
        harness,
        conversation,
        sessionId: id,
        privateDir,
        settings: this.host.getSettings,
        // 项目技能只属于当前工作范围，不能借全局目录读取另一个项目的私有指令。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        skillsSource: skillsSource
          ? {
              listSkills: async () =>
                (await skillsSource.listSkills()).filter(
                  (skill) =>
                    skill.location.kind === "canonical" ||
                    this.pathInScope(skill.filePath, metadata.cwd)
                ),
              readBody: (sourcePath) => skillsSource.readBody(sourcePath),
            }
          : undefined,
        runSkillHostProcess: (input, api, context) => {
          if (!owned) throw new Error("The reviewed host-process service is not ready.");
          return owned.native.runSkillHostProcess(input, api, context);
        },
        readSkillResource: (input) => this.readSkillResource(input),
        getMode: () =>
          owned && this.isReadOnly(owned) ? "plan" : (owned?.metadata.mode ?? metadata.mode),
        setMode: async (mode) => {
          if (metadata.readOnly || this.callbacks.readOnly(id))
            throw new Error("A read-only session cannot approve execution.");
          metadata.mode = mode;
          await this.saveMetadata(metadata);
          if (owned) this.emit(id, { sessionUpdate: "state_changed", state: this.stateOf(owned) });
        },
        emit: (update) => {
          if (owned && update.sessionUpdate === "plan_proposal_update")
            owned.pendingPlan = update.plan.decision === "pending" ? update.plan : null;
          this.emit(id, update);
        },
        requestPermission: (prompt) =>
          prompt.toolCall.isPlanProposal
            ? this.callbacks.permission(prompt)
            : (owned?.approvals?.request(prompt) ??
              Promise.resolve({ outcome: { outcome: "cancelled" } })),
        ask: (request) => {
          if (owned) {
            const saved: AskUserQuestionPrompt = {
              sessionId: request.sessionId,
              requestId: request.requestId,
              questions: request.questions,
            };
            owned.pendingQuestions = [
              ...owned.pendingQuestions.filter(
                (question) => question.requestId !== request.requestId
              ),
              saved,
            ];
          }
          return this.callbacks.ask(request);
        },
      });
      cleanup.push(() => features.dispose());
      registry.install(
        defineExtension({ name: "vault-agent-features", tools: features.registrations })
      );
      const mcp = await createPiMcpTools({
        onUnknownEffect: async () => {
          await owned?.recovery?.safeBoundary();
        },
        conversationId: String(conversation.id),
        capabilities,
        harness,
        fetch: this.host.fetch,
        audit,
        getCaller: (conversationId) =>
          this.sessionForConversation(conversationId, id)?.metadata.parentSessionId
            ? "fanout"
            : (owned?.subagents.getCaller(conversationId) ?? "root"),
        sessionId: id,
        vaultId: this.host.keychain.getVaultId(),
        projectId: metadata.projectId,
        keychain: this.host.keychain,
        getSettings: this.host.getSettings,
        getMode: () =>
          owned && this.isReadOnly(owned) ? "plan" : (owned?.metadata.mode ?? metadata.mode),
        requestPermission: (prompt) =>
          owned?.approvals?.request(prompt) ??
          Promise.resolve({ outcome: { outcome: "cancelled" } }),
        emit: (update) => this.emit(id, update),
        subscribeSettings: this.host.subscribeSettings,
        installTools: (tools) =>
          registry.install(
            defineExtension({ name: `vault-agent-mcp-loaded-${this.crypto.randomUUID()}`, tools })
          ),
        getModeForConversation: (conversationId) =>
          this.sessionForConversation(conversationId, id)?.metadata.mode ??
          owned?.subagents.getModeForConversation(conversationId) ??
          "plan",
        isReadOnly: (conversationId) => {
          const session = this.sessionForConversation(conversationId, id);
          return session
            ? this.isReadOnly(session)
            : (owned?.subagents.isReadOnly(conversationId) ?? true);
        },
        supportsImagesForConversation: async (conversationId) => {
          const session = this.sessionForConversation(conversationId, id);
          const modelKey =
            session?.metadata.modelId ??
            (await owned?.subagents.list())?.find(
              (child) => child.conversationId === conversationId
            )?.modelKey;
          return (
            models.catalog.readyModels.find((model) => model.configuredModelId === modelKey)
              ?.capabilities.supportsImages === true
          );
        },
      });
      cleanup.push(() => mcp.dispose());
      registry.install(defineExtension({ name: "vault-agent-mcp", tools: mcp.registrations }));
      const native = await createPiNativeHostTools({
        beforeOperation: async (signal) => {
          if (owned) await this.ensureStoreCapacity(owned, signal);
        },
        capabilities,
        audit,
        vaultRoot: this.vaultRoot,
        protectedRoots: this.locator.protectedPaths(),
        privateDir,
        sessionId: id,
        getMode: () =>
          owned && this.isReadOnly(owned) ? "plan" : (owned?.metadata.mode ?? metadata.mode),
        getModeForConversation: (conversationId) =>
          this.sessionForConversation(conversationId, id)?.metadata.mode ??
          owned?.subagents.getModeForConversation(conversationId) ??
          "plan",
        getCaller: (conversationId) =>
          this.sessionForConversation(conversationId, id)?.metadata.parentSessionId
            ? "fanout"
            : (owned?.subagents.getCaller(conversationId) ?? "root"),
        isReadOnly: (conversationId) => {
          const session = this.sessionForConversation(conversationId, id);
          return session
            ? this.isReadOnly(session)
            : (owned?.subagents.isReadOnly(conversationId) ?? true);
        },
        subscribeSettings: this.host.subscribeSettings,
        getExecutionMode: () =>
          this.host.getSettings().agentMode.backends.pi?.hostExecutionMode ?? "strict",
        getExternalScopes: () =>
          this.host.getSettings().agentMode.backends.pi?.externalScopes ?? [],
        requestPermission: (prompt) =>
          owned?.approvals?.request(prompt) ??
          Promise.resolve({ outcome: { outcome: "cancelled" } }),
        onUnknownEffect: async () => {
          await owned?.recovery?.safeBoundary();
        },
        onFileChanges: (changes) => {
          if (owned) this.recordFileChanges(owned, changes);
        },
        knownSecrets: () =>
          Object.values(this.host.getSettings().providers).flatMap((provider) => {
            const secret = provider.apiKeyKeychainId
              ? this.host.keychain.getSecretById(provider.apiKeyKeychainId)
              : null;
            return secret ? [secret] : [];
          }),
      });
      cleanup.push(() => native.dispose());
      registry.install(
        defineExtension({ name: "vault-agent-native", tools: native.registrations })
      );
      const subagents = await createPiSubagentTools({
        capabilities,
        harness,
        conversation,
        sessionId: id,
        models,
        enabledProfiles: () =>
          this.host.getSettings().agentMode.backends.pi?.enabledSubagentProfiles ??
          defaultEnabledProfiles(),
        getModelKey: () => owned?.metadata.modelId ?? metadata.modelId,
        getMode: () =>
          owned && this.isReadOnly(owned) ? "plan" : (owned?.metadata.mode ?? metadata.mode),
        isPathInScope: (path) => this.pathInScope(path, metadata.cwd),
        getRun: () =>
          owned?.run && owned.run.status === "active"
            ? { id: owned.run.id, budget: owned.run.budget, signal: owned.run.controller.signal }
            : null,
        resolveRun: async (runId) => {
          if (!owned?.run || owned.run.status !== "active" || owned.run.controller.signal.aborted)
            throw new Error("恢复子任务需要用户明确继续当前请求。");
          owned.recovery?.assertCanStartWork();
          const item = await owned.workItems.read(runId);
          const saved = [...owned.entries.values()]
            .filter(
              (entry) =>
                entry.kind === "va.run" &&
                entry.data &&
                typeof entry.data === "object" &&
                !Array.isArray(entry.data) &&
                entry.data.runId === runId
            )
            .at(-1)?.data;
          if (
            !item ||
            (saved &&
              typeof saved === "object" &&
              !Array.isArray(saved) &&
              saved.status === "cancelled")
          )
            throw new Error("原任务已停止或缺少持久授权，不能借用新请求的额度恢复。");
          // 后台任务仍属于原 WorkItem；本次继续只提供新的取消信号，额度与执行记录从原任务读取。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const restored = {
            ...(owned.runs.get(runId) ?? owned.run),
            id: runId,
            requestId:
              saved &&
              typeof saved === "object" &&
              !Array.isArray(saved) &&
              typeof saved.requestId === "string"
                ? saved.requestId
                : runId,
            budget: await this.budgetFor(owned, runId),
            controller: owned.run.controller,
            status: "active" as const,
          };
          owned.runs.set(runId, restored);
          return { id: restored.id, budget: restored.budget, signal: restored.controller.signal };
        },
        deliverReportContext: (input) =>
          owned
            ? this.deliverSubagentReportContext(owned, input)
            : Promise.resolve({ delivered: false, reason: "runtime_not_ready" }),
        emit: (update) => this.emit(id, update),
      });
      cleanup.push(() => subagents.dispose());
      registry.install(subagents.extension);
      const watch = await watchEvents(harness, conversation.id, BACKGROUND_CONTEXT);
      cleanup.push(() => watch.stop());
      const translator = new EventTranslator({
        sessionId: id,
        emit: (event) => this.translate(id, event),
      });
      metadata.conversationId = String(conversation.id);
      owned = {
        audit,
        capabilities,
        capabilityContext,
        metadata,
        models,
        harness,
        conversation,
        watch,
        translator,
        store,
        privateDir,
        streamEpoch: this.crypto.randomUUID(),
        frameIndex: 0,
        entries: new Map(),
        busy: false,
        work: null,
        pending: null,
        run: null,
        fileChanges: [],
        vaultTools,
        features,
        mcp,
        subagents,
        native,
        runs: new Map(),
        sdkToolRejections: new Map(),
        sdkToolRejectionChain: Promise.resolve(),
        steerSourceChain: Promise.resolve(),
        steerAdmission: null,
        steerRejected: false,
        acceptedSteers: new Set(),
        ownerSessionId: id,
        recovery: null,
        approvals: null,
        activeBackgroundTaskIds: EMPTY_BACKGROUND_TASK_IDS,
        pendingQuestions: EMPTY_QUESTIONS,
        pendingPlan: null,
        storageFailed: false,
        mutationDoc: await getMutationJournalDoc(),
        workItems: await createWorkItemStore({ harness, conversation }),
        pauseRequested: false,
      };
      const root = owned;
      await vaultTools.bindMutationJournal(
        await createDurableMutationJournal({ harness, conversation })
      );
      await native.bindMutationJournal(
        await createDurableNativeMutationJournal({ harness, conversation })
      );
      root.approvals = await createPiRuntimeApprovals({
        harness,
        conversation,
        sessionId: id,
        scopeId: metadata.cwd,
        getPolicyKey: () =>
          sha256(
            JSON.stringify({
              mode: metadata.mode,
              cwd: metadata.cwd,
              settings: this.host.getSettings().agentMode,
            })
          ),
        validate: (prompt) => this.validateApprovalPrompt(prompt),
        show: this.callbacks.permission,
        emit: () => this.emitProjection(root),
      });
      cleanup.push(() => root.approvals?.dispose());
      await this.refreshPending(root);
      this.roots.set(id, root);
      for (const entry of watch.snapshot.entries) root.entries.set(String(entry.id), entry);
      cleanup.push(
        root.harness.subscribeCommits((publication) => {
          const sources = publication.changes.flatMap((change) =>
            change.type === "entry" &&
            change.value.kind === "va.steer-input" &&
            change.value.conversationId === root.conversation.id
              ? [change.value]
              : []
          );
          if (!sources.length) return;
          const saving = root.steerSourceChain.then(() => this.restoreSteerSources(root, sources));
          root.steerSourceChain = saving;
          void saving.catch((error) => {
            root.storageFailed = true;
            return root.recovery?.storageFailed(error);
          });
        })
      );
      const rememberSdkRejection = async (
        task: TaskRecord<unknown, unknown, unknown>,
        entry?: EntryRecord,
        nested?: import("@/agentMode/sdk/pi/tools/SdkToolRejections").NestedRejectionReceipt
      ): Promise<void> => {
        let fact = deriveSdkToolRejection({
          ownerSessionId: id,
          caller: capabilityContext(String(task.conversationId)).caller,
          task,
          entry,
          nested,
        });
        if (!fact || root.sdkToolRejections.has(fact.taskId)) return;
        if (fact.assistantEntryId) {
          const source = task.input as { assistant: number; callId: string };
          const assistant = await root.harness.commit(
            (tx) => tx.entry(source.assistant as import("@earendil-works/pi-durable").EntryId),
            BACKGROUND_CONTEXT
          );
          const message = assistant?.model?.find((message) => message.role === "assistant");
          const call =
            message?.role === "assistant"
              ? message.content.find(
                  (part) => part.type === "toolCall" && part.id === source.callId
                )
              : undefined;
          if (call?.type === "toolCall") fact = { ...fact, arguments: call.arguments };
        }
        root.sdkToolRejections.set(fact.taskId, fact);
        const session = this.sessionForConversation(fact.conversationId, id);
        const runId =
          session?.run?.id ?? root.subagents.getParentRunIdForConversation(fact.conversationId);
        if (runId && root.runs.get(runId)?.status === "active") {
          const observed = fact;
          const stalled = await root.conversation.commit(async (tx) => {
            const guard = await tx.doc(progressGuardDoc, root.conversation.id);
            const state = JSON.parse(
              JSON.stringify(guard.runs[runId] ?? { fingerprint: "", consecutive: 0, seen: {} })
            ) as ProgressGuardState;
            const result = recordToolProgress(state, {
              executionId: observed.taskId,
              conversationId: observed.conversationId,
              toolId: observed.toolId,
              arguments: observed.arguments,
              errorCode: observed.outcome.error?.code,
            });
            guard.runs[runId] = state;
            return result;
          }, BACKGROUND_CONTEXT);
          if (stalled) root.stalledRunId = runId;
        }
      };
      for (const fact of await readSdkToolRejections({
        harness: root.harness,
        entries: watch.snapshot.entries,
        ownerSessionId: id,
        caller: (conversationId) => capabilityContext(conversationId).caller,
      }))
        root.sdkToolRejections.set(fact.taskId, fact);
      this.projection(root).apply(watch.snapshot);
      cleanup.push(
        root.harness.subscribeCommits((publication) => {
          const completed = publication.changes.filter(
            (change) =>
              change.type === "task" &&
              change.value.kind === "pi.tool" &&
              change.value.state.status === "terminal"
          );
          if (!completed.length) return;
          const previous = root.sdkToolRejectionChain;
          const observing = previous.then(async () => {
            for (const change of completed) {
              if (change.type !== "task") continue;
              const task = change.value;
              const entry = publication.changes.find(
                (value) =>
                  value.type === "entry" &&
                  value.value.byTaskId === task.id &&
                  value.value.kind === "pi.tool-result"
              );
              const input = task.input as Record<string, unknown>;
              const document =
                input.kind === "nested"
                  ? publication.changes.find(
                      (value) =>
                        value.type === "document" &&
                        value.record.kind === "pi.tool.nested-call" &&
                        value.record.scope.kind === "task" &&
                        value.record.scope.taskId === input.parent &&
                        value.record.key === input.key &&
                        value.value !== null
                    )
                  : undefined;
              await rememberSdkRejection(
                task,
                entry?.type === "entry" ? entry.value : undefined,
                document?.type === "document" && document.value
                  ? {
                      parentTaskId: String(input.parent),
                      key: String(input.key),
                      result: document.value.result,
                    }
                  : undefined
              );
            }
            this.emitProjection(root);
          });
          root.sdkToolRejectionChain = observing;
          void observing.catch((error) => {
            root.storageFailed = true;
            return root.recovery?.storageFailed(error);
          });
        })
      );
      cleanup.push(
        root.harness.subscribeCommits((publication) => {
          const evidence = publication.changes.filter(
            (change): change is Extract<typeof change, { type: "entry" }> =>
              change.type === "entry" &&
              [
                "pi.tool-result",
                "pi.compaction",
                "pi.user",
                "va.subagent.report",
                "va.state",
              ].includes(change.value.kind)
          );
          if (!evidence.length || root.pauseRequested || root.storageFailed) return;
          const byRun = new Map<string, string[]>();
          for (const change of evidence) {
            const entry = change.value;
            const data =
              entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)
                ? entry.data
                : {};
            const session = this.sessionForConversation(String(entry.conversationId), id);
            const runId =
              typeof data.parentRunId === "string"
                ? data.parentRunId
                : typeof data.runId === "string"
                  ? data.runId
                  : (root.subagents.getParentRunIdForConversation(String(entry.conversationId)) ??
                    session?.run?.id);
            if (!runId || root.runs.get(runId)?.status === "cancelled") continue;
            byRun.set(runId, [...(byRun.get(runId) ?? []), String(entry.id)]);
          }
          for (const [runId, ids] of byRun) {
            const previous = this.checkpointChains.get(id) ?? Promise.resolve();
            const saving = previous.then(() =>
              this.checkpointWorkItem(
                root,
                runId,
                "committed_progress",
                ids,
                Number(publication.seq)
              )
            );
            this.checkpointChains.set(id, saving);
            void saving.catch((error) => {
              root.storageFailed = true;
              return root.recovery?.storageFailed(error);
            });
          }
        })
      );
      root.recovery = await createPiRuntimeRecovery({
        privateDir,
        pendingMutationIds: () =>
          [
            ...root.vaultTools.recovery.decisions,
            ...root.native.recovery.decisions,
            ...root.mcp.recovery.decisions,
          ]
            .filter((entry) => !entry.canContinue)
            .map((entry) => entry.operationId),
        hasActiveWork: () =>
          [...this.roots.values()].some(
            (candidate) =>
              candidate.ownerSessionId === id &&
              (candidate.run?.status === "active" ||
                (candidate.busy &&
                  candidate.pending !== null &&
                  candidate.run?.controller !== candidate.pending))
          ),
        inspect: async () => {
          const inspection = await root.harness.inspect(BACKGROUND_CONTEXT);
          const incomplete = inspection.tasks.length > 0 || inspection.submissions.length > 0;
          const latestRun = [...root.entries.values()]
            .filter((entry) => entry.kind === "va.run")
            .at(-1)?.data;
          const runData =
            latestRun && typeof latestRun === "object" && !Array.isArray(latestRun)
              ? latestRun
              : {};
          const completedWork =
            !incomplete && runData.status === "completed" && typeof runData.runId === "string"
              ? await root.workItems.read(runData.runId)
              : null;
          const waitingForContinuation =
            completedWork?.status === "waiting_user" &&
            completedWork.checkpoint.remainingItems.length > 0;
          return {
            run:
              incomplete ||
              waitingForContinuation ||
              (typeof runData.status === "string" && runData.status.startsWith("paused_"))
                ? {
                    runId:
                      typeof runData.runId === "string"
                        ? runData.runId
                        : `recovery-${id}-${inspection.submissions[0]?.id ?? inspection.tasks[0]?.record.id}`,
                    requestId:
                      typeof runData.requestId === "string"
                        ? runData.requestId
                        : inspection.submissions.find(
                            (submission) =>
                              submission.type === "input" &&
                              submission.conversationId === root.conversation.id
                          )?.requestId,
                    status: waitingForContinuation
                      ? "waiting_user"
                      : inspection.tasks.some((task) => task.state.kind === "blocked")
                        ? "blocked"
                        : typeof runData.status === "string" && runData.status.startsWith("paused_")
                          ? runData.status
                          : "interrupted",
                    startedAtMs:
                      typeof runData.startedAtMs === "number" ? runData.startedAtMs : Date.now(),
                  }
                : null,
            pendingApprovals: root.approvals?.recoveryApprovals() ?? [],
            pendingQuestions: (await root.features.pendingQuestions()).length,
            pendingQuestionIds: (await root.features.pendingQuestions()).map(
              (question) => question.requestId
            ),
            unknownEffectMutations: [
              ...root.vaultTools.recovery.decisions,
              ...root.native.recovery.decisions,
              ...root.mcp.recovery.decisions,
            ]
              .filter((decision) => !decision.canContinue)
              .map((decision) => ({
                operationId: decision.operationId,
                status: "needs_reconciliation" as const,
              })),
          };
        },
        reloadCredentialsAndPolicy: async () => {
          // SDK 已明确标记缺失或不兼容定义，不能把“继续”变成永远等待的假恢复。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const unsupported = (await root.harness.inspect(BACKGROUND_CONTEXT)).tasks.filter(
            (task) => task.state.kind === "blocked"
          );
          if (unsupported.length)
            throw new Error(
              `任务定义缺失或版本不兼容，原记录已保留，请使用兼容版本：${unsupported.map((task) => `${task.record.kind}@${task.record.version}`).join(", ")}`
            );

          await root.mcp.prepare(String(root.conversation.id));
          const configured = root.models.catalog.readyModels.find(
            (entry) => entry.configuredModelId === root.metadata.modelId
          );
          if (!configured) throw new Error("请先选择可用的模型。");
          requireModelContextWindow(configured);
          const selected = await root.features.prepareContext(undefined, {
            refreshInstructions: true,
          });
          const agentContext = await root.conversation.agent(BACKGROUND_CONTEXT);
          // 显式继续也重验已选技能版本并恢复原项目分区，不能把持久指令替换为裸全局提示。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const prepared = await preparePiRuntimeInput({
            environment: {
              scope: { vaultRoot: this.vaultRoot, workspaceRoot: root.metadata.cwd },
              mode: this.isReadOnly(root) ? "plan" : root.metadata.mode,
              offeredTools: root.capabilities.snapshot(
                agentContext.tools.map((tool) => tool.name),
                root.capabilityContext(String(root.conversation.id))
              ).offeredTools,
              deferredTools: root.capabilities.snapshot(
                agentContext.deferred.map((tool) => tool.name),
                root.capabilityContext(String(root.conversation.id))
              ).offeredTools,
            },
            input: {
              sessionId: id,
              prompt: [],
              context: { project: selected.project, materials: [] },
            },
            instructionContext: {
              ...(this.host.getInstructionSections?.() ?? {
                base: this.host.getInstructions?.() ?? "",
              }),
              skills: selected.skills,
            },
            modelKey: configured.configuredModelId,
            acceptsImages: configured.capabilities.supportsImages,
            contextWindowTokens: configured.contextWindow,
            privateDir,
            app: this.host.app,
            vaultRoot: this.vaultRoot,
            isInstructionPathAllowed: this.host.isInstructionPathAllowed,
          });
          await root.conversation.configure(
            {
              model: {
                provider: configured.providerInstanceId,
                modelId: configured.upstreamModelId,
              },
              instructions: prepared.instructions,
            },
            BACKGROUND_CONTEXT
          );
          return root.approvals!.prepareRecovery();
        },
        reconcileUnknownEffects: async () => {
          const vault = await root.vaultTools.reconcile();
          const native = await root.native.reconcile();
          const mcp = await root.mcp.reconcile();
          return {
            reconciled: [...vault.decisions, ...native.decisions, ...mcp.decisions].every(
              (decision) => decision.canContinue
            ),
          };
        },
        resume: () => this.resumeRecoveredRoot(root),
        abort: () => this.cancel(id, false, this.rollovers.has(id)),
        emit: (recovery) => {
          this.emit(id, { sessionUpdate: "recovery_state", recovery });
          this.emit(id, { sessionUpdate: "state_changed", state: this.stateOf(root) });
        },
      });
      cleanup.push(
        root.harness.subscribeClose(() => {
          if (!this.rollovers.has(id) || root.run?.status === "active") {
            root.pending?.abort();
            root.run?.controller.abort();
          }
          root.approvals?.dispose();
          root.vaultTools.dispose();
          void root.native
            .dispose()
            .catch((error) => logWarn("[PiRuntime] failed I/O cleanup", error));
          void root.harness.closed
            .then(async (end) => {
              if (end.reason !== "failed") return;
              root.storageFailed = true;
              const recovery: RecoveryStateUpdate = {
                status: "storage_failed",
                pendingPermissionIds: [],
                pendingQuestionIds: [],
                pendingMutationIds: [],
                crashLoopTripped: false,
                message: "执行记录保存失败，已停止工作；可以导出最近可读的历史。",
              };
              this.readOnlyRoots.set(id, { snapshot: this.recoverySnapshot(root), recovery });
              await root.recovery?.storageFailed(end.error);
            })
            .catch((error) => logWarn("[PiRuntime] failure state could not persist", error));
        })
      );
      await this.restoreSteerSources(root);
      await root.recovery.inspect();
      await root.vaultTools.replayFileChanges();
      await this.discoverAutoCompactions(root);
      await this.refreshAutoCompactions(root);
      this.eventBarrier(root).advance(watch.snapshot.entries.map((entry) => Number(entry.id)));
      void watch.closed.then(() => this.eventBarrier(root).close());
      watch.start(async (events) => {
        for (const event of events) await this.consumeEvent(root, event);
      });
      await root.recovery.saveSnapshot(this.recoverySnapshot(root));
      await this.saveMetadata(metadata);
      return root;
    } catch (error) {
      // 任一启动步骤失败都要撤销已创建资源和缓存，避免下一次重开拿到已关闭的会话。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      this.roots.delete(id);
      this.observedOwners.delete(id);
      for (const dispose of cleanup.reverse()) {
        try {
          await dispose();
        } catch (cleanupError) {
          logWarn("[PiRuntime] startup cleanup failed", cleanupError);
        }
      }
      const { SessionFailed } = await import("@earendil-works/pi-durable");
      // 启动核对也可能触发真实存储失败；只能退到原快照，不能继续使用已失效的SDK或伪造新历史。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (error instanceof SessionFailed)
        throw Object.assign(new Error(error.message), { code: "STORAGE_FAILED", cause: error });
      throw error;
    }
  }

  private async runPrompt(
    root: OpenRoot,
    input: PromptInput,
    requestId: string
  ): Promise<PromptOutput> {
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const rawInput = input.prompt
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const maintenanceCompact = /^\/compact(?:\s|$)/.test(rawInput.trim());
    if (!root.metadata.modelId)
      throw new Error("Add and enable a model in Vault Agent settings before starting a chat.");
    const entry = root.models.catalog.readyModels.find(
      (entry) => entry.configuredModelId === root.metadata.modelId
    );
    if (!entry) throw new Error("The selected model is unavailable.");
    requireModelContextWindow(entry);
    await root.mcp.prepare(String(root.conversation.id));
    const selectedContext = await root.features.prepareContext(input.context?.project, {
      refreshInstructions: true,
      readOnly: root.ownerSessionId !== root.metadata.sessionId,
    });
    const fanouts = new Map<string, FanoutTurn>();
    const consumedFanouts = new Map<string, string>();
    for (const record of root.entries.values()) {
      const data = record.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      if (
        record.kind === "va.fanout" &&
        data.checkpoint &&
        typeof data.checkpoint === "object" &&
        !Array.isArray(data.checkpoint) &&
        typeof data.checkpoint.fanoutId === "string"
      )
        fanouts.set(data.checkpoint.fanoutId, data as unknown as FanoutTurn);
      if (
        record.kind === "va.fanout_consumed" &&
        typeof data.fanoutId === "string" &&
        typeof data.fingerprint === "string"
      )
        consumedFanouts.set(data.fanoutId, data.fingerprint);
    }
    const pendingFanouts = [...fanouts].filter(
      ([id, turn]) => consumedFanouts.get(id) !== sha256(JSON.stringify(turn))
    );
    const fanoutContext = buildPriorFanoutContextBlock(
      pendingFanouts.flatMap(([, turn]) => {
        const summary = turn.summary.text.trim();
        if (!summary && !Object.values(turn.answers).some((answer) => answer.text.trim()))
          return [];
        return [
          {
            question: turn.checkpoint!.originalPromptText,
            summary:
              turn.summary.complete && summary ? summary : renderFanoutComposite(turn, (id) => id),
          },
        ];
      })
    );
    const agentContext = await root.conversation.agent(BACKGROUND_CONTEXT);
    const prepared = await preparePiRuntimeInput({
      environment: {
        scope: { vaultRoot: this.vaultRoot, workspaceRoot: root.metadata.cwd },
        mode: this.isReadOnly(root) ? "plan" : root.metadata.mode,
        offeredTools: root.capabilities.snapshot(
          agentContext.tools.map((tool) => tool.name),
          root.capabilityContext(String(root.conversation.id))
        ).offeredTools,
        deferredTools: root.capabilities.snapshot(
          agentContext.deferred.map((tool) => tool.name),
          root.capabilityContext(String(root.conversation.id))
        ).offeredTools,
      },
      input: {
        ...input,
        context: {
          ...input.context,
          materials: [
            ...(input.context?.materials ?? []),
            ...(fanoutContext ? [{ origin: "subagent" as const, text: fanoutContext }] : []),
          ],
          project: selectedContext.project,
        },
      },
      instructionContext: {
        ...(this.host.getInstructionSections?.() ?? { base: this.host.getInstructions?.() ?? "" }),
        skills: selectedContext.skills,
      },
      modelKey: entry.configuredModelId,
      acceptsImages: entry.capabilities.supportsImages,
      contextWindowTokens: entry.contextWindow,
      privateDir: root.privateDir,
      app: this.host.app,
      vaultRoot: this.vaultRoot,
      isInstructionPathAllowed: this.host.isInstructionPathAllowed,
      isPathAllowed: (path) =>
        this.pathInScope(path, root.metadata.cwd) && this.host.isVaultPathAllowed?.(path) === true,
    });
    await root.conversation.configure({ instructions: prepared.instructions }, BACKGROUND_CONTEXT);
    const blocks = prepared.content;
    if (blocks.length === 0) throw new Error("The message is empty.");
    if (root.pending?.signal.aborted) return { stopReason: "cancelled" };
    const priorInput = [...root.entries.values()].some(
      (entry) =>
        entry.kind === "va.input" &&
        entry.data &&
        typeof entry.data === "object" &&
        !Array.isArray(entry.data) &&
        entry.data.requestId === requestId
    );
    if (!priorInput)
      await root.conversation.submit(
        {
          type: "write",
          entry: { kind: "va.input", data: JSON.parse(JSON.stringify(prepared.receipt)) },
        },
        BACKGROUND_CONTEXT
      );
    const preparedRun = [...root.entries.values()].find(
      (entry) =>
        entry.kind === "va.run" &&
        entry.data &&
        typeof entry.data === "object" &&
        !Array.isArray(entry.data) &&
        entry.data.requestId === requestId
    )?.data;
    const preparedRunId =
      preparedRun &&
      typeof preparedRun === "object" &&
      !Array.isArray(preparedRun) &&
      typeof preparedRun.runId === "string"
        ? preparedRun.runId
        : undefined;
    // 整理历史和用户补充都应保留未完工作的原目标与累计用量，维护命令本身不成为新目标。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const latestRun = [...root.entries.values()]
      .filter((entry) => entry.kind === "va.run")
      .at(-1)?.data;
    const reusable =
      !root.metadata.parentSessionId &&
      latestRun &&
      typeof latestRun === "object" &&
      !Array.isArray(latestRun) &&
      (latestRun.status === "completed" || latestRun.status === "failed") &&
      typeof latestRun.runId === "string"
        ? await root.workItems.read(latestRun.runId)
        : null;
    if (
      reusable?.status === "waiting_user" &&
      latestRun &&
      typeof latestRun === "object" &&
      !Array.isArray(latestRun) &&
      latestRun.status === "failed"
    ) {
      // 失败段只有在原 SDK 工作确实终结后才可续用原目标和累计额度；未结束输入仍走原检查点恢复。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const unfinished = await root.harness.inspect(BACKGROUND_CONTEXT);
      if (unfinished.tasks.length || unfinished.submissions.length)
        throw new Error("请先恢复尚未结束的原任务，再发送新的执行段。");
    }
    const previousInput =
      reusable?.status === "active" &&
      latestRun &&
      typeof latestRun === "object" &&
      !Array.isArray(latestRun) &&
      latestRun.status === "completed" &&
      typeof latestRun.requestId === "string"
        ? await root.harness.commit(
            (tx) => tx.submissionByRequest(root.conversation.id, latestRun.requestId as string),
            BACKGROUND_CONTEXT
          )
        : undefined;
    // 父输入结束而后台仍在运行时，WorkItem 保持 active；明确的新输入沿原任务额度，不能把后台遗忘或另起预算。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const carryWork =
      reusable &&
      (maintenanceCompact ||
        (reusable.checkpoint.goal.length > 0 &&
          (reusable.status === "waiting_user" ||
            (reusable.status === "active" &&
              previousInput?.type === "input" &&
              previousInput.status === "done"))))
        ? reusable
        : null;
    if (carryWork && !root.metadata.continuationWorkItemId && !preparedRunId) {
      if (maintenanceCompact)
        await root.workItems.checkpoint(carryWork.id, carryWork.checkpoint, "active");
      else await root.workItems.authorizeNextSegment(carryWork.id);
      this.budgets.delete(`${root.ownerSessionId}:${carryWork.id}`);
    }
    const runId =
      preparedRunId ??
      root.metadata.parentRunId ??
      root.metadata.continuationWorkItemId ??
      carryWork?.id ??
      (this.unsentInputs.has(root.metadata.sessionId)
        ? `run-${sha256(`${root.metadata.sessionId}\0${requestId}`)}`
        : `run-${this.crypto.randomUUID()}`);
    await this.requireRoot(root.ownerSessionId).workItems.ensure(
      runId,
      maintenanceCompact ? "" : rawInput
    );
    if (preparedRunId) {
      const existing = await this.requireRoot(root.ownerSessionId).workItems.read(runId);
      if (existing)
        await this.requireRoot(root.ownerSessionId).workItems.checkpoint(
          runId,
          existing.checkpoint,
          "active"
        );
    }
    if (!root.metadata.parentSessionId && !maintenanceCompact) {
      await this.requireRoot(root.ownerSessionId).workItems.recordInput(runId, {
        requestId,
        text: prepared.receipt.userInput,
        instructionSources: prepared.receipt.context.sectionDigests
          .filter(
            (section) =>
              section.injectedAsSystem &&
              !section.untrusted &&
              (section.kind === "user_system" || section.kind === "project")
          )
          .map(({ sourceId, revision, kind, scope }) => ({
            sourceId,
            revision,
            kind,
            ...(scope ? { scope } : {}),
          })),
      });
    }
    root.run = {
      id: runId,
      requestId,
      controller: root.pending ?? new AbortController(),
      startedAt: Date.now(),
      budget: await this.budgetFor(root, runId),
      status: "active",
      purpose: maintenanceCompact
        ? "compaction"
        : root.metadata.parentSessionId
          ? "fanout"
          : "root",
    };
    const run = root.run;
    root.runs.set(runId, run);
    if (!root.metadata.parentSessionId)
      await root.subagents.beginRun({
        id: run.id,
        budget: run.budget,
        signal: run.controller.signal,
      });
    if (!preparedRunId)
      await root.conversation.commit(async (tx) => {
        await tx.appendEntry(root.conversation.id, {
          kind: "va.run",
          data: {
            runId,
            requestId,
            status: "running",
            startedAtMs: run.startedAt,
            cancelEpoch: 0,
          },
        });
      }, BACKGROUND_CONTEXT);
    root.fileChanges = [];
    this.emit(root.metadata.sessionId, {
      sessionUpdate: "run_state",
      run: { runId, requestId, status: "running", startedAtMs: run.startedAt, cancelEpoch: 0 },
    });
    let terminal: "completed" | "failed" | "cancelled" = "failed";
    const execute = async (): Promise<PromptOutput> => {
      try {
        await this.publishRunBudget(this.requireRoot(root.ownerSessionId), run);
        const text = blocks
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        if (/^\/compact(?:\s|$)/.test(text.trim())) {
          run.purpose = "compaction";
          const startedAtMs = Date.now();
          const task = await root.conversation.compact(
            text.trim().slice(8).trim() || undefined,
            BACKGROUND_CONTEXT
          );
          if (this.unsentInputs.has(root.metadata.sessionId)) {
            await this.saveUnsentInput(root.metadata.sessionId, null);
            this.unsentAdmissions.delete(root.metadata.sessionId);
          }
          const settled = await root.harness.waitForTask(task, BACKGROUND_CONTEXT);
          let status: "completed" | "skipped" | "failed" | "cancelled" = run.controller.signal
            .aborted
            ? "cancelled"
            : "failed";
          let summaryEntryId: number | undefined;
          if (settled.state.outcome.status === "completed") {
            const result = settled.state.outcome.result;
            summaryEntryId = result.entryId;
            if (result.submissionId !== undefined) {
              const submission = await root.harness.submission(
                result.submissionId,
                BACKGROUND_CONTEXT
              );
              const placed = await submission?.wait(BACKGROUND_CONTEXT);
              if (placed?.status === "done") summaryEntryId = placed.entry;
            }
            const context = await root.conversation.context(BACKGROUND_CONTEXT);
            status = run.controller.signal.aborted
              ? "cancelled"
              : summaryEntryId !== undefined && context.head?.id === summaryEntryId
                ? "completed"
                : "skipped";
          }
          const compaction = {
            id: String(task),
            taskId: String(task),
            trigger: "manual" as const,
            status,
            startedAtMs,
            completedAtMs: Date.now(),
            ...(summaryEntryId !== undefined ? { summaryEntryId } : {}),
          };
          await root.conversation.submit(
            { type: "write", entry: { kind: "va.compaction", data: compaction } },
            BACKGROUND_CONTEXT
          );
          this.emit(root.metadata.sessionId, { sessionUpdate: "compaction", ...compaction });
          await this.replay(root.metadata.sessionId);
          if (status === "failed") throw new Error("The compaction did not complete.");
          if (status === "cancelled") {
            terminal = "cancelled";
            return { stopReason: "cancelled" };
          }
          terminal = "completed";
          return { stopReason: "end_turn" };
        }
        const submission = await root.conversation.submit(
          { type: "input", requestId, content: blocks, whenBusy: "reject" },
          BACKGROUND_CONTEXT
        );
        if (this.unsentInputs.has(root.metadata.sessionId)) {
          await this.saveUnsentInput(root.metadata.sessionId, null);
          this.unsentAdmissions.delete(root.metadata.sessionId);
        }
        const result = await submission.wait(BACKGROUND_CONTEXT);
        if (result.status === "done" && pendingFanouts.length) {
          // 根会话记住已接收的多模型版本，重开后既不遗忘结果，也不重复插入相同资料。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          await root.conversation.commit(async (tx) => {
            for (const [fanoutId, turn] of pendingFanouts)
              await tx.appendEntry(root.conversation.id, {
                kind: "va.fanout_consumed",
                data: { fanoutId, fingerprint: sha256(JSON.stringify(turn)) },
              });
          }, BACKGROUND_CONTEXT);
        }
        await this.replay(root.metadata.sessionId);
        const stopReason =
          result.status === "done"
            ? "end_turn"
            : run.controller.signal.aborted ||
                result.reason === "aborted" ||
                result.reason === "cancelled"
              ? "cancelled"
              : null;
        if (!stopReason)
          throw new Error(
            typeof result.detail === "string"
              ? result.detail
              : `Pi could not answer: ${result.reason ?? "unknown"}`
          );
        terminal = stopReason === "cancelled" ? "cancelled" : "completed";
        return { stopReason };
      } catch (error) {
        if (root.pauseRequested) return { stopReason: "max_turn_requests" };
        if (run.controller.signal.aborted) {
          terminal = "cancelled";
          return { stopReason: "cancelled" };
        }
        await root.features.observeError({
          kind: "provider_error",
          code: "provider_request_failed",
          message: error instanceof Error ? error.message : String(error),
          runId,
        });
        throw error;
      }
    };
    let outcome: { result: PromptOutput } | { error: unknown };
    try {
      outcome = {
        result: root.metadata.parentSessionId
          ? await root.subagents.runCandidate(
              String(root.conversation.id),
              async (signal) => {
                const abort = () => run.controller.abort();
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted) abort();
                try {
                  await root.subagents.setCandidateState(String(root.conversation.id), "running");
                  return await execute();
                } finally {
                  signal.removeEventListener("abort", abort);
                }
              },
              run.controller.signal
            )
          : await execute(),
      };
    } catch (error) {
      terminal = run.controller.signal.aborted ? "cancelled" : "failed";
      outcome = { error };
    }
    if (root.pauseRequested) return { stopReason: "max_turn_requests" };
    if (root.metadata.parentSessionId) {
      const answer = this.projection(root)
        .messages([...root.entries.values()])
        .filter((message) => message.sender !== "user")
        .map((message) => message.message)
        .join("\n\n");
      await root.subagents.setCandidateState(String(root.conversation.id), terminal, { answer });
    }
    await this.checkpointWorkItem(
      this.requireRoot(root.ownerSessionId),
      run.id,
      root.metadata.parentSessionId
        ? "candidate_boundary"
        : maintenanceCompact && !carryWork && !root.metadata.continuationWorkItemId
          ? "maintenance_boundary"
          : "turn_boundary"
    );
    try {
      if (run.controller.signal.aborted) terminal = "cancelled";
      run.status = terminal === "cancelled" ? "cancelled" : "finished";
      const state = {
        runId,
        requestId,
        status: terminal,
        startedAtMs: run.startedAt,
        endedAtMs: Date.now(),
        cancelEpoch: terminal === "cancelled" ? 1 : 0,
        modelAttempts: run.budget.snapshot.modelAttempts,
        fileChanges: root.fileChanges.map((change) => ({
          ...change,
          mutationOperationIds: [...(change.mutationOperationIds ?? [])],
        })),
      };
      const terminalWrite = await root.conversation.submit(
        { type: "write", entry: { kind: "va.run", data: state } },
        BACKGROUND_CONTEXT
      );
      // 入队完成仍可能晚于显示消费；整轮返回前必须确认终态已落盘并完成最终投影。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const written = await terminalWrite.wait(BACKGROUND_CONTEXT);
      if (written.status !== "done") throw new Error("The final run state was not saved.");
      await this.replay(root.metadata.sessionId);
      this.emit(root.metadata.sessionId, { sessionUpdate: "run_state", run: state });
      const remaining = await root.harness.inspect(BACKGROUND_CONTEXT);
      if (remaining.tasks.length === 0 && remaining.submissions.length === 0)
        await root.recovery?.safeBoundary();
    } catch (error) {
      // 收尾存储失败也必须可见，同时保留最初的请求错误，不能由 finally 覆盖真正原因。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if ("error" in outcome)
        throw new AggregateError(
          [outcome.error, error],
          "The request and its final state could not be completed."
        );
      throw error;
    } finally {
      root.busy = false;
    }
    if (root.metadata.continuationWorkItemId === run.id) {
      delete root.metadata.continuationWorkItemId;
      await this.saveMetadata(root.metadata);
    }
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
  }

  // 报告只作为有来源的资料进入原任务上下文，不创建新输入或重新唤醒已经结束的模型请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  private async deliverSubagentReportContext(
    root: OpenRoot,
    input: {
      readonly parentRunId: string;
      readonly parentToolCallId: string;
      readonly parentToolTaskId?: string;
      readonly text: string;
      readonly entryId: string;
      readonly childConversationId: string;
      readonly answerEntryId: string;
    }
  ): Promise<{ readonly delivered: boolean; readonly reason?: string }> {
    const run = root.runs.get(input.parentRunId);
    if (
      !run ||
      run.status !== "active" ||
      !root.busy ||
      run.purpose === "compaction" ||
      root.run !== run ||
      run.controller.signal.aborted ||
      this.closed ||
      this.closingRoots.has(root.metadata.sessionId) ||
      this.isReadOnly(root) ||
      root.recovery?.blocked !== false
    )
      return { delivered: false, reason: "requires_user_continue" };
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const report = {
      source: "tool",
      origin: "subagent",
      parentRunId: run.id,
      parentToolCallId: input.parentToolCallId,
      ...(input.parentToolTaskId ? { parentToolTaskId: input.parentToolTaskId } : {}),
      reportEntryId: input.entryId,
      childConversationId: input.childConversationId,
      answerEntryId: input.answerEntryId,
      text: input.text,
    };
    const submission = await root.conversation.submit(
      {
        type: "write",
        requestId: `subagent-context:${input.entryId}`,
        entry: {
          kind: "va.subagent.context",
          data: report,
          model: [{ role: "user", content: JSON.stringify(report), timestamp: Date.now() }],
        },
      },
      BACKGROUND_CONTEXT
    );
    const saved = await submission.wait(BACKGROUND_CONTEXT);
    if (saved.status !== "done") throw new Error("后台报告未能保存到原任务上下文。");
    return { delivered: true };
  }

  private async consumeEvent(root: OpenRoot, event: AgentEvent): Promise<void> {
    if (event.type === "entry_appended" || event.type === "message_end")
      root.entries.set(String(event.entry.id), event.entry);
    if (event.type === "snapshot")
      for (const entry of event.entries) root.entries.set(String(entry.id), entry);
    if (event.type === "entry_appended" || event.type === "snapshot")
      await this.refreshPending(root);
    const projection = this.projection(root);
    projection.apply(event);
    if (event.type === "compaction_end" && event.reason !== "manual") {
      const pending = this.pendingCompactions.get(root) ?? new Set<string>();
      pending.add(String(event.taskId));
      this.pendingCompactions.set(root, pending);
    }
    await this.refreshAutoCompactions(root);
    if (event.type === "compaction_end" && event.reason !== "manual") return;
    if (event.type === "message_end") {
      const parts = projection.timings(String(event.entry.id));
      if (parts.some((part) => part.startedAtMs !== undefined)) {
        const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
        const saved: { entry?: EntryRecord } = {};
        await root.conversation.commit(async (tx) => {
          saved.entry = await tx.appendEntry(root.conversation.id, {
            kind: "va.thinking",
            data: JSON.parse(JSON.stringify({ entryId: String(event.entry.id), parts })),
          });
        }, BACKGROUND_CONTEXT);
        if (saved.entry) root.entries.set(String(saved.entry.id), saved.entry);
      }
    }
    root.translator.translate(event);
    if (
      event.type === "entry_appended" ||
      event.type === "message_end" ||
      event.type === "snapshot"
    )
      await root.recovery?.saveSnapshot(this.recoverySnapshot(root));
    if (event.type === "entry_appended" || event.type === "message_end")
      this.eventBarrier(root).advance([Number(event.entry.id)]);
    if (event.type === "snapshot")
      this.eventBarrier(root).advance(event.entries.map((entry) => Number(entry.id)));
  }

  private async discoverAutoCompactions(root: OpenRoot): Promise<void> {
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const pending = await root.conversation.commit(async (tx) => {
      const saved = new Set<string>();
      let cursor: Cursor | undefined;
      do {
        const page = await tx.scanEntries(
          { conversationId: root.conversation.id, order: "ascending" },
          100,
          cursor
        );
        for (const entry of page.items) {
          const data = entry.data;
          if (
            entry.kind === "va.compaction" &&
            data &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            typeof data.taskId === "string"
          )
            saved.add(data.taskId);
        }
        cursor = page.next;
      } while (cursor);
      const missing = new Set<string>();
      do {
        const page = await tx.scanTasks(
          { conversationId: root.conversation.id, kind: "pi.compaction", status: "terminal" },
          100,
          cursor
        );
        for (const task of page.items) {
          const input = task.input;
          if (
            input &&
            typeof input === "object" &&
            !Array.isArray(input) &&
            input.reason !== "manual" &&
            !saved.has(String(task.id))
          )
            missing.add(String(task.id));
        }
        cursor = page.next;
      } while (cursor);
      return missing;
    }, BACKGROUND_CONTEXT);
    this.pendingCompactions.set(root, pending);
  }

  private async refreshAutoCompactions(root: OpenRoot): Promise<void> {
    const pending = this.pendingCompactions.get(root);
    if (!pending?.size) return;
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    for (const id of [...pending]) {
      const task = await root.harness.getTask(
        Number(id) as TaskId<CompactionResult>,
        BACKGROUND_CONTEXT
      );
      if (!task || task.state.status !== "terminal") continue;
      const outcome = task.state.outcome;
      let status: "completed" | "skipped" | "failed" | "cancelled" =
        outcome.status === "aborted" ? "cancelled" : "failed";
      let summaryEntryId: number | undefined;
      if (outcome.status === "completed") {
        summaryEntryId = outcome.result.entryId;
        if (outcome.result.submissionId !== undefined) {
          const submission = await root.harness.submission(
            outcome.result.submissionId,
            BACKGROUND_CONTEXT
          );
          // 观察压缩只读取放置结果，不能由历史打开或事件消费的 wait 意外唤醒旧工具和模型。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const placed = await submission?.status(BACKGROUND_CONTEXT);
          if (placed?.status === "queued" || placed?.status === "placed") continue;
          if (placed?.status === "done") summaryEntryId = placed.entry;
        }
        const context = await root.conversation.context(BACKGROUND_CONTEXT);
        status =
          summaryEntryId !== undefined && context.head?.id === summaryEntryId
            ? "completed"
            : "skipped";
      }
      const compaction = {
        id,
        taskId: id,
        trigger: "auto" as const,
        status,
        ...(task.startedAt !== undefined ? { startedAtMs: task.startedAt } : {}),
        completedAtMs: task.endedAt ?? Date.now(),
        ...(summaryEntryId !== undefined ? { summaryEntryId } : {}),
        ...(outcome.status === "failed" ? { error: outcome.error.message } : {}),
      };
      // 后台任务结束不等于摘要已生效；保存真正的 task/submission 结局，重开仍显示过期摘要已跳过。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const saved = await root.conversation.commit(
        (tx) => tx.appendEntry(root.conversation.id, { kind: "va.compaction", data: compaction }),
        BACKGROUND_CONTEXT
      );
      root.entries.set(String(saved.id), saved);
      pending.delete(id);
      this.emitProjection(root);
      await root.recovery?.saveSnapshot(this.recoverySnapshot(root));
      this.emit(root.metadata.sessionId, { sessionUpdate: "compaction", ...compaction });
    }
  }

  private eventBarrier(root: OpenRoot): PiRuntimeEventBarrier {
    let barrier = this.eventBarriers.get(root);
    if (!barrier) {
      barrier = new PiRuntimeEventBarrier();
      this.eventBarriers.set(root, barrier);
    }
    return barrier;
  }

  private translate(sessionId: string, event: TranslatedEvent): void {
    const root = this.roots.get(sessionId);
    if (!root) return;
    if (
      event.kind === "message_text" ||
      event.kind === "message_thinking" ||
      event.kind === "message_text_replace" ||
      event.kind === "message_thinking_replace" ||
      event.kind === "entry" ||
      event.kind === "snapshot"
    )
      this.emitProjection(root);
    else if (event.kind === "tool_call")
      this.emit(sessionId, { sessionUpdate: "tool_call", ...event.tool });
    else if (event.kind === "tool_call_update")
      this.emit(sessionId, { sessionUpdate: "tool_call_update", ...event.delta });
    else if (event.kind === "tool_call_end")
      this.emit(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: event.status,
      });
    else if (event.kind === "usage") {
      const contextWindow = root.models.catalog.readyModels.find(
        (model) => model.configuredModelId === root.metadata.modelId
      )?.contextWindow;
      const usage = this.projection(root).usage(
        [...root.entries.values()],
        event.usage,
        contextWindow
      );
      if (usage) this.emit(sessionId, { sessionUpdate: "usage_update", usage });
    } else if (event.kind === "compaction") {
      const placed = [...root.entries.values()].some(
        (entry) => entry.kind === "pi.compaction" && String(entry.byTaskId) === event.taskId
      );
      this.emit(sessionId, {
        sessionUpdate: "compaction",
        id: event.taskId,
        trigger: event.reason === "manual" ? "manual" : "auto",
        status:
          event.phase === "start"
            ? "in_progress"
            : event.error
              ? "failed"
              : placed
                ? "completed"
                : "skipped",
        ...(event.error ? { error: event.error } : {}),
      });
    }
  }

  private projection(root: OpenRoot): PiRuntimeProjection {
    let projection = this.projections.get(root);
    if (!projection) {
      projection = new PiRuntimeProjection(root.metadata.sessionId);
      this.projections.set(root, projection);
    }
    return projection;
  }

  private emitProjection(root: OpenRoot): void {
    const pendingMutationIds = [
      ...root.vaultTools.recovery.decisions,
      ...root.native.recovery.decisions,
      ...root.mcp.recovery.decisions,
    ]
      .filter((decision) => !decision.canContinue)
      .map((decision) => decision.operationId);
    this.emit(root.metadata.sessionId, {
      sessionUpdate: "session_projection",
      projection: {
        cursor: { streamEpoch: root.streamEpoch, frameIndex: ++root.frameIndex },
        mode: "replace",
        messages: this.messages(root),
        activeBackgroundTaskIds: root.activeBackgroundTaskIds,
        pending: {
          permissions: root.approvals?.pending ?? EMPTY_PERMISSIONS,
          questions: root.pendingQuestions,
          plan: root.pendingPlan,
          recovery:
            (this.unsentInputs.has(root.metadata.sessionId) &&
            !this.unsentAdmissions.has(root.metadata.sessionId) &&
            !pendingMutationIds.length &&
            !root.recovery?.readOnly
              ? this.unsentRecovery()
              : root.recovery?.state) ??
            (pendingMutationIds.length
              ? {
                  status: "interrupted",
                  pendingPermissionIds: [],
                  pendingQuestionIds: [],
                  pendingMutationIds,
                  crashLoopTripped: false,
                }
              : null),
        },
      },
    });
  }

  private async refreshPending(root: OpenRoot): Promise<void> {
    // 父输入结束不等于整树结束，界面停止入口只依赖现有持久子任务，冷开中断态仍走恢复门。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const backgroundIds = (await root.subagents.list())
      .filter(
        (child) => child.background && (child.status === "queued" || child.status === "running")
      )
      .map((child) => child.taskId);
    root.activeBackgroundTaskIds = backgroundIds.length ? backgroundIds : EMPTY_BACKGROUND_TASK_IDS;
    root.pendingQuestions = await root.features.pendingQuestions();
    root.pendingPlan = await root.features.pendingPlan();
  }

  private async assertArchiveBoundary(root: OpenRoot): Promise<void> {
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    await this.refreshPending(root);
    const inspection = await root.harness.inspect(BACKGROUND_CONTEXT);
    if (root.ownerSessionId !== root.metadata.sessionId || this.isReadOnly(root))
      throw new Error("只读聊天或子会话不能整理为新的根聊天。");
    if (
      root.busy ||
      this.unsentInputs.has(root.metadata.sessionId) ||
      root.run?.status === "active" ||
      root.recovery?.blocked ||
      inspection.tasks.length ||
      inspection.submissions.length ||
      root.approvals?.recoveryApprovals().length ||
      root.pendingQuestions.length ||
      root.pendingPlan
    )
      throw new Error("请先结束前台与后台工作，并处理批准、问题或计划，再总结并新建聊天。");
  }

  private async archiveRoot(root: OpenRoot): Promise<void> {
    await this.assertArchiveBoundary(root);
    await this.replay(root.metadata.sessionId);
    const metadata = { ...root.metadata, readOnly: true, archivedAtMs: Date.now() };
    const snapshot = this.recoverySnapshot(root);
    await root.recovery?.saveSnapshot({
      ...snapshot,
      state: { ...snapshot.state, readOnly: true },
    });
    await this.saveMetadata(metadata);
    Object.assign(root.metadata, metadata);
    this.emit(root.metadata.sessionId, {
      sessionUpdate: "state_changed",
      state: this.stateOf(root),
    });
  }

  private async validateApprovalPrompt(prompt: PermissionPrompt): Promise<boolean> {
    // 崩溃前的允许只适用于当时展示的原文，重新批准也不能覆盖用户后来改过的内容：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    for (const content of prompt.toolCall.content ?? []) {
      if (content.type !== "diff") continue;
      let current: string;
      try {
        if (this.path.isAbsolute(content.path))
          current = await this.fs.readFile(content.path, "utf8");
        else {
          const file = this.host.app.vault.getAbstractFileByPath(content.path);
          current =
            file && "stat" in file
              ? await this.host.app.vault.read(file as import("obsidian").TFile)
              : "";
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
        current = "";
      }
      if (current !== (content.oldText ?? "")) return false;
    }
    return true;
  }

  private messages(root: OpenRoot): AgentChatMessage[] {
    const messages = this.projection(root).messages(
      [...root.entries.values()],
      root.fileChanges,
      root.sdkToolRejections,
      root.acceptedSteers
    );
    const draft = this.unsentInputs.get(root.metadata.sessionId);
    if (draft?.kind === "prompt" && !this.unsentAdmissions.has(root.metadata.sessionId)) {
      const pending = this.unsentMessage(draft);
      if (!messages.some((message) => message.id === pending.id)) messages.push(pending);
    }
    return messages;
  }

  private unsentMessage(draft: Extract<UnsentRootInput, { kind: "prompt" }>): AgentChatMessage {
    const text = draft.input.prompt
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return {
      id: `unsent:${draft.input.requestId}`,
      sender: USER_SENDER,
      timestamp: formatDateTime(new Date(draft.savedAtMs)),
      isVisible: true,
      message: `尚未发送：\n\n${text}`,
      parts: [{ kind: "text", text }],
    };
  }

  private async reconcileUnsentInput(root: OpenRoot): Promise<void> {
    const draft = this.unsentInputs.get(root.metadata.sessionId);
    if (!draft || this.unsentAdmissions.has(root.metadata.sessionId)) return;
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    if (draft.kind === "prompt") {
      const requestId = draft.input.requestId;
      const submission = requestId
        ? await root.harness.commit(
            (tx) => tx.submissionByRequest(root.conversation.id, requestId),
            BACKGROUND_CONTEXT
          )
        : undefined;
      if (submission) await this.saveUnsentInput(root.metadata.sessionId, null);
      return;
    }
    const restored = await restoreUnsentRootInput(draft, root.privateDir);
    if (restored.kind !== "fanout") return;
    const existingEntry = [...root.entries.values()]
      .filter(
        (entry) =>
          entry.kind === "va.fanout" &&
          entry.data &&
          typeof entry.data === "object" &&
          !Array.isArray(entry.data) &&
          (entry.data.checkpoint as JsonObject | undefined)?.fanoutId ===
            restored.turn.checkpoint?.fanoutId
      )
      .at(-1);
    const existing = existingEntry?.data as unknown as FanoutTurn | undefined;
    const children = await root.subagents.list();
    if (
      existing?.summary.complete ||
      children.some(
        (child) =>
          child.kind === "fanout" && child.parentRunId === restored.turn.checkpoint?.fanoutId
      )
    ) {
      await this.saveUnsentInput(root.metadata.sessionId, null);
      return;
    }
    const turn = existing ? (JSON.parse(JSON.stringify(existing)) as FanoutTurn) : restored.turn;
    if (turn.checkpoint) turn.checkpoint.awaitingAdmission = true;
    for (const answer of Object.values(turn.answers))
      if (answer.status === "running") answer.status = "paused";
    turn.summary = { ...turn.summary, status: "paused", complete: false };
    if (JSON.stringify(existing) !== JSON.stringify(turn))
      await root.conversation.commit(
        (tx) =>
          tx.appendEntry(root.conversation.id, {
            kind: "va.fanout",
            data: JSON.parse(JSON.stringify(turn)) as JsonObject,
          }),
        BACKGROUND_CONTEXT
      );
    await this.saveUnsentInput(root.metadata.sessionId, null);
  }

  private stateOf(root: OpenRoot): BackendState {
    return {
      readOnly: this.isReadOnly(root),
      model: root.metadata.modelId
        ? {
            current: { baseModelId: root.metadata.modelId, effort: root.metadata.effort },
            availableModels: modelEntriesFromCatalog(root.models.catalog),
            apply: { kind: "setConfigOption", configId: "pi-model", effortConfigId: "pi-effort" },
          }
        : null,
      mode: {
        current: root.metadata.mode,
        options: [
          { value: "plan", label: "Plan" },
          { value: "default", label: "Default" },
          { value: "auto", label: "Auto" },
        ],
        apply: {
          plan: { kind: "setMode", nativeId: "plan" },
          default: { kind: "setMode", nativeId: "default" },
          auto: { kind: "setMode", nativeId: "auto" },
        },
      },
    };
  }

  private recoverySnapshot(root: OpenRoot): PiRecoverySnapshot {
    const messages = this.messages(root);
    return {
      version: 1,
      messages,
      state: this.stateOf(root),
      session: {
        sessionId: root.metadata.sessionId,
        backendId: "pi",
        title: root.metadata.title,
        projectId: root.metadata.projectId,
        createdAtMs: Date.parse(root.metadata.createdAt),
        lastAccessedAtMs: Date.now(),
        messages: messages.map((message) => ({
          role: message.sender === "user" ? "user" : "assistant",
          text: message.message,
        })),
      },
    };
  }

  private async persistMutationChanges(
    root: OpenRoot,
    changes: readonly TurnFileChange[],
    source: { readonly operationId: string; readonly runId?: string }
  ): Promise<boolean> {
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    await root.conversation.commit(async (tx) => {
      const doc = await tx.doc(root.mutationDoc, root.conversation.id);
      if (doc.items.some((item) => item.operationId === source.operationId)) return;
      const now = Date.now();
      doc.items.push({
        operationId: source.operationId,
        status: "committed",
        startedAtMs: now,
        endedAtMs: now,
        files: changes.map((change) => ({
          path: change.path,
          beforeHash: change.before === null ? null : sha256(change.before),
          afterHash: change.after === null ? null : sha256(change.after),
          status: change.status,
        })),
      });
      doc.revision += 1;
      doc.updatedAtMs = now;
      await tx.appendEntry(root.conversation.id, {
        kind: "va.mutation",
        data: JSON.parse(JSON.stringify({ ...source, fileChanges: changes })) as JsonObject,
      });
      await tx.appendEntry(root.conversation.id, {
        kind: "va.state",
        data: { docKind: "va.mutations", revision: doc.revision, change: "updated", atMs: now },
      });
    }, BACKGROUND_CONTEXT);
    return true;
  }

  private async loadReadOnlySnapshot(
    sessionId: string,
    error: unknown
  ): Promise<{ sessionId: string; state: BackendState }> {
    const busy = (error as { code?: string })?.code === "RUNTIME_BUSY";
    let snapshot: PiRecoverySnapshot;
    try {
      snapshot = await readPiRecoverySnapshot(
        this.path.dirname(this.locator.sessionStorePaths(sessionId).metaPath)
      );
      if (snapshot.session.sessionId !== sessionId) throw new Error("历史快照不属于这段聊天。");
      const draft = (await this.readMetadata(sessionId))?.unsentInput;
      if (draft?.kind === "prompt") {
        const message = this.unsentMessage(draft);
        snapshot = {
          ...snapshot,
          messages: [
            ...snapshot.messages.filter((existing) => existing.id !== message.id),
            message,
          ],
        };
      } else if (draft?.kind === "fanout" && draft.turn.checkpoint) {
        const turn = JSON.parse(JSON.stringify(draft.turn)) as FanoutTurn;
        const checkpoint = turn.checkpoint!;
        const id = checkpoint.fanoutId;
        if (!snapshot.messages.some((message) => message.fanout?.checkpoint?.fanoutId === id)) {
          checkpoint.awaitingAdmission = true;
          for (const answer of Object.values(turn.answers))
            if (answer.status === "running") answer.status = "paused";
          if (!turn.summary.complete) turn.summary.status = "paused";
          const question: AgentChatMessage = {
            id: `unsent:${id}:question`,
            sender: USER_SENDER,
            timestamp: formatDateTime(new Date(draft.savedAtMs)),
            isVisible: true,
            message: `尚未发送：\n\n${checkpoint.originalPromptText}`,
          };
          const card: AgentChatMessage = {
            id: `unsent:${id}:fanout`,
            sender: AI_SENDER,
            timestamp: null,
            isVisible: true,
            message: "",
            fanout: turn,
          };
          snapshot = { ...snapshot, messages: [...snapshot.messages, question, card] };
        }
      }
    } catch (failure) {
      if (!busy) throw failure;
      throw Object.assign(
        new Error(
          "其他聊天正在运行，暂时无法打开此记录，且没有可验证的历史快照。原始记录已保留；请等待空位后重新载入。"
        ),
        { code: "RUNTIME_BUSY", cause: failure }
      );
    }
    const recovery: RecoveryStateUpdate = {
      status: "read_only",
      pendingPermissionIds: [],
      pendingQuestionIds: [],
      pendingMutationIds: [],
      crashLoopTripped: false,
      ...(busy ? { reloadAvailable: true } : {}),
      message: busy
        ? "其他聊天占用了当前执行位置，现显示最近保存的只读历史。不会自动排队或继续工作；可在空位释放后点击“重新载入”，只核对并更新记录。"
        : (error as { code?: string })?.code === "SESSION_ARCHIVED"
          ? "这段聊天已归档，原始历史完整保留，可继续读取或导出；新的工作请使用已建立的新聊天。"
          : `执行记录暂时不能安全打开，现显示最近保存的可读历史，仍可导出。请使用兼容版本或修复原始数据：${error instanceof Error ? error.message : String(error)}`,
    };
    this.readOnlyRoots.set(sessionId, { snapshot, recovery });
    this.emit(sessionId, {
      sessionUpdate: "session_projection",
      projection: {
        cursor: { streamEpoch: this.crypto.randomUUID(), frameIndex: 1 },
        mode: "replace",
        messages: snapshot.messages,
        pending: { permissions: [], questions: [], plan: null, recovery },
      },
    });
    this.emit(sessionId, { sessionUpdate: "recovery_state", recovery });
    return { sessionId, state: { ...snapshot.state, readOnly: true } };
  }

  private async resumeRecoveredRoot(root: OpenRoot): Promise<void> {
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const inspection = await root.harness.inspect(BACKGROUND_CONTEXT);
    if (inspection.tasks.length === 0 && inspection.submissions.length === 0) {
      const saved = [...root.entries.values()]
        .filter((entry) => entry.kind === "va.run")
        .at(-1)?.data;
      const item =
        saved &&
        typeof saved === "object" &&
        !Array.isArray(saved) &&
        saved.status === "completed" &&
        typeof saved.runId === "string"
          ? await root.workItems.read(saved.runId)
          : null;
      if (item?.status === "waiting_user" && item.checkpoint.remainingItems.length > 0) {
        // SDK 已结束时继续必须创建新的显式执行段，不能 resume 空调度器或把检查点当成功验收：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        await root.workItems.authorizeNextSegment(item.id);
        this.budgets.delete(`${root.ownerSessionId}:${item.id}`);
        root.metadata.continuationWorkItemId = item.id;
        await this.saveMetadata(root.metadata);
        const requestId = `continue-${this.crypto.randomUUID()}`;
        root.pending = new AbortController();
        root.busy = true;
        const work = this.runPrompt(
          root,
          {
            sessionId: root.metadata.sessionId,
            requestId,
            prompt: [
              {
                type: "text",
                text: "继续已保存目标和清单中的剩余工作，遵守原有要求；依据真实工具结果核对进度。",
              },
            ],
          },
          requestId
        );
        root.work = work;
        try {
          await work;
        } finally {
          root.work = null;
          root.pending = null;
          root.busy = false;
        }
      } else await root.recovery?.safeBoundary();
      return;
    }
    const saved = [...root.entries.values()]
      .filter((entry) => entry.kind === "va.run")
      .at(-1)?.data;
    const data = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    const runId =
      typeof data.runId === "string"
        ? data.runId
        : `recovery-${root.metadata.sessionId}-${inspection.submissions[0]?.id ?? inspection.tasks[0]?.record.id}`;
    const requestId = inspection.submissions[0]?.requestId ?? runId;
    root.pending = new AbortController();
    root.busy = true;
    root.run = {
      id: runId,
      requestId,
      controller: root.pending,
      startedAt: Date.now(),
      budget: await this.budgetFor(root, runId),
      status: "active",
      purpose: "root",
    };
    root.runs.set(runId, root.run);
    this.emit(root.metadata.sessionId, {
      sessionUpdate: "run_state",
      run: { runId, requestId, status: "running", startedAtMs: root.run.startedAt, cancelEpoch: 0 },
    });
    const work = (async (): Promise<PromptOutput> => {
      let status: "completed" | "failed" | "cancelled" = "failed";
      try {
        const restoredCandidates: OpenRoot[] = [];
        const children = await root.subagents.list();
        for (const child of children) {
          if (child.kind === "fanout") {
            if (
              child.parentRunId !== runId ||
              !inspection.tasks.some(
                (task) => String(task.record.conversationId) === child.conversationId
              )
            )
              continue;
            await root.subagents.beginCandidateGroup({
              runId,
              budget: root.run!.budget,
              signal: root.run!.controller.signal,
              resume: true,
            });
            const restored = await this.getRoot(child.description, root.metadata.cwd, false);
            restored.run = { ...root.run!, purpose: "fanout" };
            await root.subagents.setCandidateState(child.conversationId, "running");
            restoredCandidates.push(restored);
          } else if (child.status === "interrupted")
            await root.subagents.resume(child.taskId, { deferScheduling: true });
        }
        root.harness.resume();
        await Promise.all(
          restoredCandidates.map((candidate) =>
            candidate.conversation.waitForIdle(BACKGROUND_CONTEXT)
          )
        );
        for (const candidate of restoredCandidates) {
          const context = await candidate.conversation.context(BACKGROUND_CONTEXT);
          const answer = [...context.messages]
            .reverse()
            .find((message) => message.role === "assistant" && message.stopReason === "stop");
          if (answer?.role === "assistant")
            await root.subagents.setCandidateState(String(candidate.conversation.id), "completed", {
              answer: answer.content
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join("\n"),
            });
        }
        await root.harness.waitForIdle(BACKGROUND_CONTEXT);
        await root.subagents.waitForBackground();
        for (const previous of inspection.submissions) {
          const submission = await root.harness.submission(previous.id, BACKGROUND_CONTEXT);
          const settled = await submission?.status(BACKGROUND_CONTEXT);
          if (
            settled?.status === "unanswered" &&
            settled.reason !== "aborted" &&
            settled.reason !== "cancelled"
          )
            throw new Error(
              typeof settled.detail === "string" ? settled.detail : `恢复未完成：${settled.reason}`
            );
        }
        if (root.pauseRequested) return { stopReason: "max_turn_requests" };
        status = root.run?.controller.signal.aborted ? "cancelled" : "completed";
        return { stopReason: status === "cancelled" ? "cancelled" : "end_turn" };
      } catch (error) {
        if (root.pauseRequested) return { stopReason: "max_turn_requests" };
        throw error;
      } finally {
        if (root.pauseRequested) {
          root.busy = false;
          root.pending = null;
        } else {
          if (root.run) root.run.status = status === "cancelled" ? "cancelled" : "finished";
          root.busy = false;
          root.pending = null;
          const terminal = {
            runId,
            requestId,
            status,
            startedAtMs: root.run?.startedAt ?? Date.now(),
            endedAtMs: Date.now(),
            cancelEpoch: status === "cancelled" ? 1 : 0,
          };
          this.emit(root.metadata.sessionId, {
            sessionUpdate: "run_state",
            run: terminal,
          });
          if (!root.storageFailed) {
            await root.conversation.commit(async (tx) => {
              await tx.appendEntry(root.conversation.id, {
                kind: "va.run",
                data: terminal,
              });
            }, BACKGROUND_CONTEXT);
            // 恢复结束不能用旧暂停快照重新显示继续；先让已保存终态成为投影读取的事实。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            await this.replay(root.metadata.sessionId);
            await root.recovery?.safeBoundary();
          }
        }
      }
    })();
    root.work = work;
    try {
      await work;
    } finally {
      root.work = null;
    }
  }

  private requireRoot(id: string): OpenRoot {
    const root = this.roots.get(id);
    if (!root) throw new Error("Open the Pi session before using it.");
    return root;
  }

  private async activeRoot(id: string): Promise<OpenRoot> {
    await this.resourceClosures.get(this.roots.get(id)?.ownerSessionId ?? id);
    await this.pauseOperations.get(this.roots.get(id)?.ownerSessionId ?? id);
    if (this.rollovers.has(id)) throw new Error("这段聊天正在整理，请等待完成。");
    if (this.closingRoots.has(id))
      throw new Error("The Pi session is closing; reopen it after closing finishes.");
    const existing = this.roots.get(id);
    if (existing && this.rollovers.has(existing.ownerSessionId))
      throw new Error("所属聊天正在整理，请等待完成。");
    if (existing) return existing;
    const metadata = await this.readMetadata(id);
    if (!metadata) throw new Error("Open the Pi session before using it.");
    // 池释放空闲写入者后，仍可从同一份记录继续操作，不能把正常回收当成会话丢失。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    return this.getRoot(id, metadata.cwd, false);
  }

  private hasSessionOperation(ownerSessionId: string): boolean {
    return (
      [...this.sessionOperations].some(
        ([id, count]) =>
          count > 0 &&
          (this.roots.get(id)?.ownerSessionId ?? this.operationOwners.get(id) ?? id) ===
            ownerSessionId
      ) || this.opening.has(ownerSessionId)
    );
  }

  private async withSessionOperation<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    // 页面观察者只是缓存；真正读取或修改 SDK 的完整异步操作才保护写入者不被中途回收。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    this.sessionOperations.set(sessionId, (this.sessionOperations.get(sessionId) ?? 0) + 1);
    try {
      await this.resourceClosures.get(this.roots.get(sessionId)?.ownerSessionId ?? sessionId);
      return await work();
    } finally {
      const remaining = (this.sessionOperations.get(sessionId) ?? 1) - 1;
      if (remaining) this.sessionOperations.set(sessionId, remaining);
      else this.sessionOperations.delete(sessionId);
      const ownerId = this.roots.get(sessionId)?.ownerSessionId;
      if (
        ownerId &&
        !this.closed &&
        !this.closingRoots.has(ownerId) &&
        !this.pausingRoots.has(ownerId)
      )
        await this.pool.notifyCapacityAvailable();
    }
  }

  private syncObservation(ownerSessionId: string): void {
    if (this.closingRoots.has(ownerSessionId)) return;
    const observed = [...this.observedSessions].some(
      (id) => this.roots.get(id)?.ownerSessionId === ownerSessionId
    );
    if (observed && !this.observedOwners.has(ownerSessionId)) {
      this.pool.observe(ownerSessionId);
      this.observedOwners.add(ownerSessionId);
    } else if (!observed && this.observedOwners.delete(ownerSessionId)) {
      void this.pool
        .release(ownerSessionId)
        .catch((error) => logWarn("[PiRuntime] observer release failed", error));
    }
  }

  private async measureStoreBytes(directory: string): Promise<number> {
    const files = await this.fs
      .readdir(directory, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    const sizes = await Promise.all(
      files.map((file) => {
        const path = this.path.join(directory, file.name);
        return file.isDirectory()
          ? this.measureStoreBytes(path)
          : this.fs.stat(path).then((stat) => stat.size);
      })
    );
    return sizes.reduce((total, size) => total + size, 0);
  }

  private async readMetadata(id: string): Promise<SessionMetadata | null> {
    assertHostRootId(id);
    try {
      return JSON.parse(
        await this.fs.readFile(
          this.path.join(
            this.path.dirname(this.locator.sessionStorePaths(id).metaPath),
            "session.json"
          ),
          "utf8"
        )
      ) as SessionMetadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async saveMetadata(metadata: SessionMetadata): Promise<void> {
    await this.updateMetadata(metadata.sessionId, (latest) => {
      const normal = { ...metadata };
      delete normal.unsentInput;
      return { ...normal, ...(latest?.unsentInput ? { unsentInput: latest.unsentInput } : {}) };
    });
  }

  private async updateMetadata(
    id: string,
    change: (latest: SessionMetadata | null) => SessionMetadata | Promise<SessionMetadata>
  ): Promise<void> {
    await this.withMetadataLock(id, async () => {
      const paths = this.locator.sessionStorePaths(id);
      // 排队会话没有本地 SDK 写入者，暂存输入仍要尊重原租约，避免覆盖其他窗口。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const lease = !this.writerRoots.has(id)
        ? new StoreLease({ leaseDir: paths.leaseDir, storePath: paths.storeDir })
        : undefined;
      const acquired = await lease?.acquire();
      if (acquired && acquired.kind !== "acquired")
        throw Object.assign(new Error("这段聊天正由另一个窗口保存，尚未提交请求。"), {
          code: "STORE_BUSY",
        });
      try {
        const metadata = await change(await this.readMetadata(id));
        const target = this.path.join(
          this.path.dirname(this.locator.sessionStorePaths(metadata.sessionId).metaPath),
          "session.json"
        );
        const temporary = `${target}.${this.crypto.randomUUID()}.tmp`;
        await this.fs.writeFile(temporary, JSON.stringify(metadata), { mode: 0o600 });
        try {
          await this.fs.rename(temporary, target);
        } catch (error) {
          await this.fs
            .rm(temporary, { force: true })
            .catch((cleanupError) =>
              logWarn("[PiRuntime] metadata temporary cleanup failed", cleanupError)
            );
          throw error;
        }
        const root = this.roots.get(id);
        if (root) {
          Object.assign(root.metadata, metadata);
          if (!metadata.unsentInput) delete root.metadata.unsentInput;
        }
        if (metadata.unsentInput) this.unsentInputs.set(id, metadata.unsentInput);
        else this.unsentInputs.delete(id);
      } finally {
        if (acquired?.kind === "acquired") await lease!.release(acquired.token);
      }
    });
  }

  private async withMetadataLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.metadataWrites.get(id);
    const writing = (previous ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.metadataWrites.set(id, writing);
    try {
      return await writing;
    } finally {
      if (this.metadataWrites.get(id) === writing) this.metadataWrites.delete(id);
    }
  }

  private async saveUnsentInput(id: string, draft: UnsentRootInput | null): Promise<void> {
    await this.updateMetadata(id, (latest) => {
      if (!latest) throw new Error("找不到原聊天，尚未提交这条请求。");
      const updated = { ...latest };
      if (draft) updated.unsentInput = draft;
      else delete updated.unsentInput;
      return updated;
    });
  }

  private stageUnsentInput(id: string, draft: UnsentRootInput) {
    if (this.unsentAdmissions.has(id)) throw new Error("这段聊天已有一条待发请求。");
    const controller = new AbortController();
    const saved = this.updateMetadata(id, async (latest) => {
      if (!latest) throw new Error("找不到原聊天，尚未提交这条请求。");
      if (latest.archivedAtMs || (latest.readOnly && !latest.parentSessionId))
        throw new Error("只读聊天不能保存新的待发请求。");
      const directory = this.path.dirname(this.locator.sessionStorePaths(id).metaPath);
      if (latest.unsentInput && JSON.stringify(latest.unsentInput) !== JSON.stringify(draft)) {
        const prior = latest.unsentInput;
        if (
          prior.kind !== draft.kind ||
          (prior.kind === "fanout" &&
            draft.kind === "fanout" &&
            prior.turn.checkpoint?.fanoutId !== draft.turn.checkpoint?.fanoutId) ||
          (prior.kind === "prompt" &&
            draft.kind === "prompt" &&
            prior.input.requestId !== draft.input.requestId)
        )
          throw new Error("已有尚未发送的原请求，请先继续或放弃它。");
        const original = await restoreUnsentRootInput(prior, directory);
        if (
          original.kind === "prompt" &&
          draft.kind === "prompt" &&
          JSON.stringify(original.input) !== JSON.stringify(draft.input)
        )
          throw new Error("相同请求标识不能替换原文或附件，原请求已保留。");
      }
      const stored = await storeUnsentRootInput(draft, directory);
      if (
        (await this.measureStoreBytes(directory)) +
          new TextEncoder().encode(JSON.stringify(stored)).byteLength >=
        STORE_SIZE_PAUSE_BYTES
      )
        throw new Error("待发请求超过这段聊天的保存容量，尚未提交，请缩小附件或新建聊天。");
      return { ...latest, unsentInput: stored };
    });
    const admission = { controller, saved };
    this.unsentAdmissions.set(id, admission);
    return admission;
  }

  private async pauseUnsentInput(id: string, discard = false): Promise<boolean> {
    const admission = this.unsentAdmissions.get(id);
    if (!admission) return false;
    admission.controller.abort(
      Object.assign(
        new Error(
          discard ? "尚未发送的请求已停止。" : "尚未发送的请求已保存；点击继续后才会发送。"
        ),
        { code: discard ? "CANCELLED" : "QUEUED_INPUT_PAUSED" }
      )
    );
    await admission.saved;
    if (discard) await this.saveUnsentInput(id, null);
    this.pausingRoots.add(id);
    try {
      await this.pool.close(id);
    } finally {
      this.pausingRoots.delete(id);
    }
    if (!discard)
      this.emit(id, { sessionUpdate: "recovery_state", recovery: this.unsentRecovery() });
    return true;
  }

  private unsentRecovery(): RecoveryStateUpdate {
    return {
      status: "available",
      pendingPermissionIds: [],
      pendingQuestionIds: [],
      pendingMutationIds: [],
      crashLoopTripped: false,
      message:
        "这条请求尚未发送，原文和附件引用已保存。点击“继续”后才会发送；停止会放弃这条待发请求。",
    };
  }

  private emit(sessionId: string, update: SessionUpdate): void {
    this.callbacks.emit({ sessionId, update, occurredAt: Date.now() });
  }
}
