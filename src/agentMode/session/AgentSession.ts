import { canSendFollowUpDuringRecovery } from "@/agentMode/session/RecoveryPolicy";
import { AI_SENDER, USER_SENDER, WEB_SELECTED_TEXT_TAG } from "@/constants";
import { t } from "@/i18n";
import { logInfo, logWarn } from "@/logger";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import {
  AgentChatMessage,
  AgentMcpServer,
  AgentMessagePart,
  AgentPlanEntry,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AgentToolCallOutput,
  AskUserQuestionPrompt,
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  BudgetUpdate,
  VaultAgentMode,
  CompactionSnapshot,
  CurrentPlan,
  EnabledModelEntry,
  ModelSelection,
  NewAgentChatMessage,
  OpenSessionOutput,
  PERMISSION_ALLOW_KINDS,
  PERMISSION_REJECT_KINDS,
  PermissionDecision,
  PermissionOptionKind,
  PermissionPrompt,
  PlanDecisionAction,
  PlanSummary,
  PromptContent,
  PromptInput,
  PromptOutput,
  RecoveryStateUpdate,
  SessionEvent,
  SessionId,
  SessionProjection,
  StreamCursor,
  RunStateUpdate,
  isRunTerminal,
  PlanUsage,
  SessionUsage,
  StopReason,
  ToolCallContent,
  ToolCallDelta,
  ToolCallSnapshot,
  TurnFileChange,
  FileChangeRevertResult,
} from "@/agentMode/session/types";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  MessageContext,
} from "@/types/message";
import { err2String, formatDateTime, type FormattedDateTime } from "@/utils";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { deriveChatTitleFromMessages } from "@/agentMode/session/chatHistoryMerge";
import { isCompactCommand } from "@/commands/compactCommand";
import { ContextProcessor } from "@/contextProcessor";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import type { FanoutRunInput } from "@/agentMode/session/fanout/FanoutOrchestrator";
import { isFanout } from "@/agentMode/session/fanout/answerers";
import {
  FANOUT_READONLY_PREAMBLE,
  isDirectAnswerTurn,
  serializeFanoutComposite,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import { v4 as uuidv4 } from "uuid";
import { getSettings } from "@/settings/model";
import {
  EMPTY_ENABLED_MODELS,
  ENABLED_MODEL_WAIT_MS,
  noEnabledModelError,
  pickEnabledModel,
} from "@/agentMode/session/enabledModelSelection";
import { stripUserMessageWrapper } from "@/agentMode/session/promptEnvelope";
import { replayPersistedMode } from "@/agentMode/session/replayPersistedMode";
import type {
  FeedbackDraft,
  FeedbackOfferResult,
} from "@/agentMode/session/feedback/feedbackMcpServer";
import type { FeedbackEvidence, FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";

export type RunFanoutTurn = (input: FanoutRunInput) => Promise<FanoutTurn>;

export const DEFAULT_TITLE_PREFIX = "New session";
const MAX_TOOL_OUTPUT_TEXT_CHARS = 256_000;
const EMPTY_PERMISSIONS: PermissionPrompt[] = [];
const EMPTY_QUESTIONS: AskUserQuestionPrompt[] = [];
const EMPTY_ANSWERS: AgentQuestionAnswers = Object.freeze({});
const EMPTY_BACKGROUND_TASK_IDS: readonly string[] = Object.freeze([]);
const EMPTY_BACKEND_IDS: ReadonlyArray<BackendId> = Object.freeze([]);

export type AgentSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

export const ATTENTION_TRIGGER_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "idle",
  "error",
  "awaiting_permission",
]);

export interface AgentSessionListener {
  onMessagesChanged(): void;
  onStatusChanged(status: AgentSessionStatus): void;
  onModelChanged?(): void;
  onLabelChanged?(): void;
  onCurrentPlanChanged?(): void;
  onCurrentTodoListChanged?(): void;
  onNeedsAttentionChanged?(needsAttention: boolean): void;
}

export interface ProjectContextUpdates {
  epoch: number;
  block: string;
}

export interface ProjectContextUpdatesHooks {
  getProjectContextUpdates?: () => ProjectContextUpdates | null;
  markProjectContextUpdatesDelivered?: (epoch: number) => void;
}

export interface AgentSessionStartOptions extends ProjectContextUpdatesHooks {
  backend: BackendProcess;
  cwd: string;
  internalId: string;
  chatInputId?: string;
  backendId: BackendId;
  projectId?: ProjectScopeId;
  defaultModelSelection?: ModelSelection;
  defaultMode?: VaultAgentMode | null;
  getDescriptor?: () => BackendDescriptor | undefined;
  runFanoutTurn?: RunFanoutTurn;
  getDisplayName?: (backendId: BackendId) => string;
  getProjectContextBlock?: () => string;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
}

export interface AgentSessionStateOptions extends ProjectContextUpdatesHooks {
  backend: BackendProcess;
  backendSessionId: SessionId;
  internalId: string;
  chatInputId?: string;
  backendId: BackendId;
  projectId?: ProjectScopeId;
  defaultModelSelection?: ModelSelection;
  defaultMode?: VaultAgentMode | null;
  cwd?: string | null;
  getDescriptor?: () => BackendDescriptor | undefined;
  runFanoutTurn?: RunFanoutTurn;
  getDisplayName?: (backendId: BackendId) => string;
}

export class AgentSession {
  readonly store = new AgentMessageStore();
  readonly internalId: string;
  readonly chatInputId: string;
  readonly backendId: BackendId;
  readonly projectId: ProjectScopeId;
  readonly ready: Promise<void>;
  private backendSessionId: SessionId | null = null;
  private isActive = false;
  private readonly backend: BackendProcess;
  readonly cwd: string | null;
  private readonly getProjectContextBlockFn: (() => string) | null;
  private firstPromptSent = false;
  private lastSentWebTabBlock: string | null = null;
  private readonly getDescriptor: (() => BackendDescriptor | undefined) | null;
  private readonly runFanoutTurn: RunFanoutTurn | null;
  private readonly getDisplayName: ((backendId: BackendId) => string) | null;
  private readonly getProjectContextUpdatesFn: (() => ProjectContextUpdates | null) | null;
  private readonly markProjectContextUpdatesDeliveredFn: ((epoch: number) => void) | null;
  private cachedStatus: AgentSessionStatus = "starting";
  private startupFailed = false;
  private startupSettled = false;
  private lastTurnError = false;
  private lastMentionedAgents: ReadonlyArray<BackendId> = EMPTY_BACKEND_IDS;
  private placeholderId: string | null = null;
  private pendingUserMessageId: string | null = null;
  private currentTurnHadRoutedToolActivity = false;
  private currentMessageIds = new Set<string>();
  private settledStream: {
    placeholderId: string;
    messageIds: Set<string>;
    turnStartedAtMs: number;
  } | null = null;
  private pendingCancellation: Promise<void> | null = null;
  private activeBackgroundTaskIds: readonly string[] = EMPTY_BACKGROUND_TASK_IDS;
  private cancelledPromptDrain: Promise<void> | null = null;
  private cancelledMessageIds = new Set<string>();
  private abortController: AbortController | null = null;
  private listeners = new Set<AgentSessionListener>();
  private unregisterSessionHandler: (() => void) | null = null;
  private currentState: BackendState | null = null;
  private label: string | null = null;
  private labelSource: "user" | "agent" | null = null;
  private disposed = false;
  private readonly initializationController = new AbortController();
  private initializationPending = false;
  private resumeSelection: ModelSelection | undefined;
  private resumeMode: VaultAgentMode | null | undefined;
  private settleReady: () => void = () => {};
  private historyOpen = false;
  private historyUser: { wireId: string | undefined; raw: string; occurredAt?: number } | null =
    null;
  private historyAiId: string | null = null;
  private historyTurnStartedAt: number | undefined;
  private projectionCursor: StreamCursor | null = null;
  private recoveredPermissions: readonly PermissionPrompt[] = EMPTY_PERMISSIONS;
  private recoveredQuestions: readonly AskUserQuestionPrompt[] = EMPTY_QUESTIONS;
  private readonly projectionIdAliases = new Map<string, string>();
  private pendingPlanResolvers = new Map<
    string,
    {
      request: PermissionPrompt;
      resolve: (resp: PermissionDecision) => void;
    }
  >();
  private pendingToolResolvers = new Map<
    string,
    {
      request: PermissionPrompt;
      resolve: (resp: PermissionDecision) => void;
    }
  >();
  private pendingQuestionResolvers = new Map<
    string,
    {
      request: AskUserQuestionPrompt;
      resolve: (answers: AgentQuestionAnswers) => void;
    }
  >();
  private currentPlan: CurrentPlan | null = null;
  private currentTodoList: AgentTodoListEntry[] | null = null;
  private currentTodoListSignature: string | null = null;
  private currentUsage: SessionUsage | null = null;
  private currentRun: RunStateUpdate | null = null;
  private currentBudget: BudgetUpdate | null = null;
  private feedbackOffer: FeedbackOffer | null = null;
  private recoveryState: RecoveryStateUpdate | null = null;

  private currentPlanUsage: PlanUsage | null = null;
  private planSeq = 0;
  private decidedPlanToolCallIds = new Set<string>();
  private needsAttention = false;
  private notifyScheduled = false;
  private notifyHandle: ReturnType<typeof setTimeout> | number | null = null;

  constructor(opts: AgentSessionStateOptions | AgentSessionStartOptions) {
    this.backend = opts.backend;
    this.internalId = opts.internalId;
    this.chatInputId = opts.chatInputId ?? uuidv4();
    this.backendId = opts.backendId;
    this.projectId = opts.projectId ?? GLOBAL_SCOPE;
    this.cwd = opts.cwd ?? null;
    this.getDescriptor = opts.getDescriptor ?? null;
    this.runFanoutTurn = opts.runFanoutTurn ?? null;
    this.getDisplayName = opts.getDisplayName ?? null;
    this.getProjectContextUpdatesFn = opts.getProjectContextUpdates ?? null;
    this.markProjectContextUpdatesDeliveredFn = opts.markProjectContextUpdatesDelivered ?? null;
    this.getProjectContextBlockFn =
      "getProjectContextBlock" in opts ? (opts.getProjectContextBlock ?? null) : null;
    if ("backendSessionId" in opts) {
      this.backendSessionId = opts.backendSessionId;
      this.resumeSelection = opts.defaultModelSelection;
      this.resumeMode = opts.defaultMode;
      // The backend replays the chat as live-shaped updates until its load response; collect them from the first frame. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
      this.historyOpen = true;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(
        opts.backendSessionId,
        (event) => this.handleSessionEvent(event)
      );
      this.ready = new Promise<void>((resolve) => {
        this.settleReady = resolve;
      });
    } else {
      this.currentState = null;
      this.initializationPending = true;
      this.ready = this.initialize(opts);
    }
  }

  completeResume(state: BackendState | null): void {
    this.endHistory();
    this.currentState = state;
    const settle = () => {
      this.startupSettled = true;
      this.recomputeStatusIfChanged();
      this.settleReady();
    };
    const selection = this.resumeSelection ?? state?.model?.current;
    if (!selection || !state || state.readOnly === true) return settle();
    void this.applyStartupSelection(selection, this.resumeMode)
      // A resumed chat stays open to pick an enabled model; sends on any other model are refused.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/625
      .catch((e) => logWarn(`[AgentMode] resumed ${this.backendId} session kept its model`, e))
      .finally(settle);
  }

  static start(opts: AgentSessionStartOptions): AgentSession {
    return new AgentSession(opts);
  }

  getBackendSessionId(): SessionId | null {
    return this.backendSessionId;
  }

  setIsActive(active: boolean): void {
    if (this.disposed || this.isActive === active) return;
    this.isActive = active;
    if (this.backendSessionId) {
      this.backend.setSessionObserved?.({
        sessionId: this.backendSessionId,
        observed: active,
      });
    }
  }

  isHistoricalOnly(): boolean {
    return this.currentState?.readOnly === true;
  }

  async readSubagentHistory(conversationId: string): Promise<readonly AgentChatMessage[]> {
    await this.ready;
    if (this.disposed || !this.backendSessionId) throw new Error("此聊天已关闭。");
    if (!this.backend.readSubagentHistory) throw new MethodUnsupportedError("readSubagentHistory");
    return this.backend.readSubagentHistory({ sessionId: this.backendSessionId, conversationId });
  }

  getRecoveryState(): RecoveryStateUpdate | null {
    return this.recoveryState;
  }

  async recoverSession(action: "continue" | "abort" | "reconcile"): Promise<void> {
    await this.ready;
    if (this.disposed || !this.backendSessionId) throw new Error("此聊天已关闭。");
    const recovery = this.recoveryState;
    if (!recovery || recovery.status === "none") return;
    const canContinue =
      recovery.status === "available" ||
      recovery.status === "interrupted" ||
      (recovery.status === "read_only" && recovery.crashLoopTripped);
    if (action === "continue" && !canContinue) {
      throw new Error("此记录目前只读，请先导出，并使用兼容版本恢复。");
    }
    const queuedFanout =
      action === "continue"
        ? this.store
            .getDisplayMessages()
            .find(
              (message) =>
                message.fanout?.checkpoint?.awaitingAdmission && !message.fanout.summary.complete
            )
        : undefined;
    // 未获得执行名额的多模型工作没有 SDK 输入可重放，继续须交还原比较卡片的统一入口。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (queuedFanout) {
      await this.resumeFanout(queuedFanout.id);
      return;
    }
    if (!this.backend.recoverSession) throw new MethodUnsupportedError("recoverSession");
    await this.backend.recoverSession({ sessionId: this.backendSessionId, action });
  }

  async rolloverSession(): Promise<OpenSessionOutput> {
    await this.ready;
    if (this.disposed || !this.backendSessionId) throw new Error("此聊天已关闭。");
    if (this.isHistoricalOnly()) throw new Error(t("localData.readOnly"));
    const status = this.getStatus();
    if (status !== "idle" && status !== "error") throw new Error("请先等待当前工作结束。");
    if (!this.backend.rolloverSession) throw new MethodUnsupportedError("rolloverSession");
    const controller = new AbortController();
    this.abortController = controller;
    this.recomputeStatusIfChanged();
    try {
      return await this.backend.rolloverSession({ sessionId: this.backendSessionId });
    } finally {
      if (this.abortController === controller) this.abortController = null;
      this.recomputeStatusIfChanged();
    }
  }

  async revertFileChange(change: TurnFileChange): Promise<FileChangeRevertResult> {
    await this.ready;
    if (this.disposed || !this.backendSessionId) throw new Error("此聊天已关闭。");
    if (this.isHistoricalOnly()) throw new Error(t("localData.readOnly"));
    const status = this.getStatus();
    if (status !== "idle" && status !== "error") throw new Error("请等待当前工作结束后再回退。");
    if (!this.backend.revertFileChange) throw new MethodUnsupportedError("revertFileChange");
    if (!change.mutationOperationIds?.length)
      throw new Error("这条旧记录没有可核验的回退凭据，请手动检查文件。");
    const controller = new AbortController();
    this.abortController = controller;
    this.lastTurnError = false;
    this.recomputeStatusIfChanged();
    try {
      return await this.backend.revertFileChange({
        sessionId: this.backendSessionId,
        operationIds: change.mutationOperationIds,
        signal: controller.signal,
      });
    } finally {
      if (this.abortController === controller) this.abortController = null;
      this.recomputeStatusIfChanged();
    }
  }

  private async initialize(opts: AgentSessionStartOptions): Promise<void> {
    const { backend, cwd, defaultModelSelection } = opts;
    try {
      const resp = await backend.newSession({
        cwd,
        signal: this.initializationController.signal,
        projectId: this.projectId,
        mcpServers: opts.mcpServers,
      });
      if (this.disposed || this.initializationController.signal.aborted) {
        await backend.closeSession?.({ sessionId: resp.sessionId });
        return;
      }
      const modelLog = resp.state.model
        ? `model=${resp.state.model.current.baseModelId} (available: ${resp.state.model.availableModels
            .map((m) => m.baseModelId)
            .join(", ")})`
        : "agent did not report model state";
      logInfo(`[AgentMode] session ${resp.sessionId} ${modelLog}`);
      this.backendSessionId = resp.sessionId;
      this.currentState = resp.state;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(resp.sessionId, (event) =>
        this.handleSessionEvent(event)
      );
      if (this.disposed) {
        this.unregisterSessionHandler();
        this.unregisterSessionHandler = null;
        return;
      }
      this.backend.setSessionObserved?.({ sessionId: resp.sessionId, observed: this.isActive });
      this.recomputeStatusIfChanged();
      this.notifyModelChanged();

      const selection = defaultModelSelection ?? resp.state.model?.current;
      if (selection) await this.applyStartupSelection(selection, opts.defaultMode);
      this.startupSettled = true;
      this.recomputeStatusIfChanged();
    } catch (err) {
      if (this.disposed || this.initializationController.signal.aborted) return;
      logWarn(`[AgentMode] session/new failed for ${this.internalId}`, err);
      this.startupFailed = true;
      this.recomputeStatusIfChanged();
      throw err instanceof Error ? err : new Error(err2String(err));
    } finally {
      this.initializationPending = false;
    }
  }

  getState(): BackendState | null {
    return this.currentState;
  }

  async setModel(modelId: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionModel({
      sessionId: this.backendSessionId,
      modelId,
    });
    this.dropUsageWindowOnModelChange(next);
    this.currentState = next;
    this.notifyModelChanged();
  }

  async applyModelWireId(wireId: string): Promise<void> {
    const apply = this.currentState?.model?.apply;
    if (apply?.kind === "setConfigOption") {
      await this.setConfigOption(apply.configId, wireId);
      return;
    }
    await this.setModel(wireId);
  }

  private async applyStartupSelection(
    selection: ModelSelection,
    mode: VaultAgentMode | null = null
  ): Promise<void> {
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return;
    if (this.runsOnlyEnabledModels()) {
      await this.settleOnEnabledModel(descriptor, selection, mode);
      return;
    }
    try {
      await descriptor.applySelection(this, selection);
    } catch (e) {
      logWarn(
        `[AgentMode] could not apply startup selection ${selection.baseModelId}; keeping the agent's model`,
        e
      );
    }
  }

  // 模型状态尚未到达时需等候确认，不能选用用户未启用的模型。https://github.com/Brevilabs/obsidian-copilot-private/issues/625
  private async settleOnEnabledModel(
    descriptor: BackendDescriptor,
    seed: ModelSelection,
    mode: VaultAgentMode | null
  ): Promise<void> {
    const enabled = this.enabledModels();
    const pick = () => pickEnabledModel(enabled, this.currentState?.model, seed);
    await this.waitForState(
      () => pick().settled && (!mode || this.currentState?.mode?.apply[mode] !== undefined)
    );
    if (this.disposed) return;
    const { target } = pick();
    if (!target) throw noEnabledModelError(descriptor.displayName);
    await descriptor.applySelection(this, target);
    await replayPersistedMode(this, mode);
  }

  private waitForState(isReady: () => boolean): Promise<void> {
    if (isReady()) return Promise.resolve();
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe({
        onMessagesChanged: () => {},
        onStatusChanged: (status) => {
          if (status === "closed") finish();
        },
        onModelChanged: () => {
          if (isReady()) finish();
        },
      });
      const timer = window.setTimeout(() => finish(), ENABLED_MODEL_WAIT_MS);
      const finish = (): void => {
        window.clearTimeout(timer);
        unsubscribe();
        resolve();
      };
    });
  }

  private isOnModelNotEnabled(): boolean {
    const current = this.currentState?.model?.current.baseModelId;
    return (
      this.runsOnlyEnabledModels() &&
      current !== undefined &&
      !this.enabledModels().some((entry) => entry.baseModelId === current)
    );
  }

  private runsOnlyEnabledModels(): boolean {
    return this.getDescriptor?.()?.routesVaultAgentModels === true;
  }

  private enabledModels(): readonly EnabledModelEntry[] {
    return this.getDescriptor?.()?.getEnabledModelEntries?.(getSettings()) ?? EMPTY_ENABLED_MODELS;
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionConfigOption({
      sessionId: this.backendSessionId,
      configId,
      value,
    });
    this.dropUsageWindowOnModelChange(next);
    this.currentState = next;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  async setMode(modeId: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionMode({
      sessionId: this.backendSessionId,
      modeId,
    });
    this.currentState = next;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  canSwitchModel(): boolean | null {
    if (this.getStatus() === "starting") return false;
    return this.currentState?.model?.apply.kind === "setConfigOption"
      ? this.backend.isSetSessionConfigOptionSupported()
      : this.backend.isSetSessionModelSupported();
  }

  canSwitchEffort(): boolean | null {
    if (this.getStatus() === "starting") return false;
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return null;
    return this.currentState?.model?.apply.kind === "setConfigOption"
      ? this.backend.isSetSessionConfigOptionSupported()
      : this.backend.isSetSessionModelSupported();
  }

  canSwitchMode(): boolean | null {
    if (this.getStatus() === "starting") return false;
    const mode = this.currentState?.mode;
    if (!mode) return null;
    const sample = mode.options[0];
    if (!sample) return null;
    const spec = mode.apply[sample.value];
    if (!spec) return null;
    // 组合模式需确认每一步都受支持，才能向用户提供切换。https://github.com/Brevilabs/obsidian-copilot-private/issues/551
    const steps = spec.kind === "sequence" ? spec.steps : [spec];
    const capabilities = steps.map((step) =>
      step.kind === "setConfigOption"
        ? this.backend.isSetSessionConfigOptionSupported()
        : this.backend.isSetSessionModeSupported()
    );
    if (capabilities.includes(false)) return false;
    if (capabilities.includes(null)) return null;
    return true;
  }

  getActiveBackgroundTaskCount(): number {
    return this.activeBackgroundTaskIds.length;
  }

  getStatus(): AgentSessionStatus {
    if (this.disposed) return "closed";
    if (this.startupFailed) return "error";
    if (this.backendSessionId === null || !this.startupSettled) return "starting";
    if (
      this.pendingPlanResolvers.size +
        this.pendingToolResolvers.size +
        this.pendingQuestionResolvers.size >
      0
    ) {
      return "awaiting_permission";
    }
    if (this.abortController !== null) return "running";
    if (!this.recoveryState || this.recoveryState.status === "none") {
      const status = this.currentRun?.status;
      if (status === "awaiting_permission" || status === "awaiting_question")
        return "awaiting_permission";
      if (status === "accepting" || status === "running" || status === "cancelling")
        return "running";
    }
    if (this.lastTurnError) return "error";
    return "idle";
  }

  getNeedsAttention(): boolean {
    return this.needsAttention;
  }

  markNeedsAttention(): void {
    if (this.needsAttention) return;
    this.needsAttention = true;
    this.notifyNeedsAttentionChanged();
  }

  clearNeedsAttention(): void {
    if (!this.needsAttention) return;
    this.needsAttention = false;
    this.notifyNeedsAttentionChanged();
  }

  private notifyNeedsAttentionChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onNeedsAttentionChanged?.(this.needsAttention);
      } catch (e) {
        logWarn(`[AgentMode] needs-attention listener threw`, e);
      }
    }
  }

  hasUserVisibleMessages(): boolean {
    return this.store.getDisplayMessages().length > 0;
  }

  loadDisplayMessages(messages: AgentChatMessage[]): void {
    this.store.loadMessages(messages);
    this.notifyMessages();
  }

  getLabel(): string | null {
    return this.label;
  }

  getLabelSource(): "user" | "agent" | null {
    return this.labelSource;
  }

  setLabel(label: string | null): void {
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "user" : null;
    this.notifyLabelChanged();
  }

  restoreLabel(label: string, source: "user" | "agent"): void {
    if (source === "user") this.setLabel(label);
    else this.applyAgentLabel(label);
  }

  private backendSummarizesTitle(): boolean {
    return this.getDescriptor?.()?.summarizesSessionTitle ?? true;
  }

  private applyAgentLabel(label: string | null | undefined): void {
    if (this.labelSource === "user") return;
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "agent" : null;
    this.notifyLabelChanged();
  }

  private notifyLabelChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onLabelChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] label listener threw`, e);
      }
    }
  }

  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  canSteer(): boolean {
    const status = this.getStatus();
    return Boolean(
      this.backend.steerSession &&
      !this.isHistoricalOnly() &&
      (!this.recoveryState || this.recoveryState.status === "none") &&
      (status === "running" || status === "awaiting_permission")
    );
  }

  async steerPrompt(
    displayText: string,
    context?: MessageContext,
    promptContent?: PromptContent[]
  ): Promise<void> {
    if (!displayText.trim() || /^\s*\//.test(displayText))
      throw new Error("补充当前工作仅支持普通文字；命令请等本轮结束后发送。");
    if (!this.canSteer() || !this.backendSessionId || !this.backend.steerSession)
      throw new Error("未补充：当前工作不能接收补充，请重新发送。");
    // 排队消息的插入要带上与普通发送相同的笔记/网页资料和图片，不能只送纯文本。
    // https://github.com/ItsDalk-Lane/Vault-Agent/issues/16
    const webTabBlock =
      (context?.webTabs?.length ?? 0) > 0 ? await serializeWebTabContext(context) : "";
    const promptContext = buildPromptContext(context, webTabBlock);
    await this.backend.steerSession({
      sessionId: this.backendSessionId,
      requestId: `steer-${uuidv4()}`,
      text: displayText,
      prompt: buildPromptBlocks(displayText, promptContent),
      context: promptContext,
    });
  }

  sendPrompt(
    displayText: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>
  ): { userMessageId: string; turn: Promise<StopReason> } {
    if (
      this.recoveryState &&
      this.recoveryState.status !== "none" &&
      !canSendFollowUpDuringRecovery(this.recoveryState)
    ) {
      throw new Error("上次工作尚未处理，请先选择继续或结束未完成的工作。");
    }
    if (this.isHistoricalOnly()) throw new Error(t("localData.readOnly"));
    // Agents only compact when /compact is the whole prompt, so nothing rides along with it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
    const sendsCompact = isCompactCommand(displayText);
    if (sendsCompact) {
      displayText = displayText.trim();
      context = undefined;
      promptContent = undefined;
      mentionedAgents = undefined;
    }
    const status = this.getStatus();
    if (status === "starting") {
      throw new Error("Session is still starting");
    }
    if (status === "running" || status === "awaiting_permission") {
      throw new Error("Session already has a turn in flight");
    }
    if (status === "closed") {
      throw new Error("Session is closed");
    }

    const userMessage: NewAgentChatMessage = {
      message: displayText,
      sender: USER_SENDER,
      timestamp: formatDateTime(new Date()),
      isVisible: true,
      context,
      content: buildUserDisplayContent(displayText, promptContent),
    };
    const userMessageId = this.store.addMessage(userMessage);
    this.pendingUserMessageId = userMessageId;

    const turnStartedAtMs = Date.now();
    const placeholder: NewAgentChatMessage = {
      message: "",
      sender: AI_SENDER,
      timestamp: formatDateTime(new Date(turnStartedAtMs)),
      isVisible: true,
      parts: [],
    };
    this.placeholderId = this.store.addMessage(placeholder);
    this.currentMessageIds = new Set();
    this.currentTurnHadRoutedToolActivity = false;
    this.notifyMessages();

    if (this.label === null && !this.backendSummarizesTitle()) {
      this.applyAgentLabel(deriveChatTitleFromMessages(this.store.getDisplayMessages()));
    }

    this.lastMentionedAgents =
      mentionedAgents && mentionedAgents.length > 0 ? mentionedAgents : EMPTY_BACKEND_IDS;

    this.abortController = new AbortController();
    this.lastTurnError = false;
    this.recomputeStatusIfChanged();

    const turn = this.runTurn(
      displayText,
      userMessageId,
      context,
      turnStartedAtMs,
      promptContent,
      sendsCompact
    );
    return { userMessageId, turn };
  }

  private async runTurn(
    displayText: string,
    userMessageId: string,
    context: MessageContext | undefined,
    turnStartedAtMs: number,
    promptContent?: PromptContent[],
    sendsCompact = false
  ): Promise<StopReason> {
    const placeholderId = this.placeholderId;
    const sessionId = this.backendSessionId!;
    const signal = this.abortController!.signal;
    try {
      // 后台 Stop 与下一次明确输入可以同时到达界面，旧取消必须先结算才可提交新请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const cancellation = this.pendingCancellation;
      if (cancellation) await cancellation;
      const priorPromptDrain = this.cancelledPromptDrain;
      if (priorPromptDrain) {
        await Promise.race([
          priorPromptDrain,
          new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          }),
        ]);
      }

      const hasWebTabs = (context?.webTabs?.length ?? 0) > 0;
      const webTabBlock = hasWebTabs ? await serializeWebTabContext(context) : "";
      if (placeholderId && this.isOnModelNotEnabled()) {
        return this.refuseTurn(
          placeholderId,
          turnStartedAtMs,
          t("agentInfra.session.modelNotEnabled", {
            agent: this.displayNameFor(this.backendId),
          })
        );
      }
      // Project context, its updates and fanout history ride the next normal turn.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
      const isFirstTurn = !this.firstPromptSent && !sendsCompact;
      const projectContextBlock = isFirstTurn ? (this.getProjectContextBlockFn?.() ?? null) : null;
      const projectContextUpdates = sendsCompact
        ? null
        : (this.getProjectContextUpdatesFn?.() ?? null);
      const projectContextUpdatesBlock = projectContextUpdates?.block ?? null;

      if (
        this.runFanoutTurn &&
        isFanout(this.lastMentionedAgents, this.backendId) &&
        placeholderId
      ) {
        return await this.runFanoutPath(
          placeholderId,
          displayText,
          buildPromptBlocks(displayText, promptContent),
          turnStartedAtMs,
          buildPromptContext(context, webTabBlock, projectContextBlock, projectContextUpdatesBlock)
        );
      }

      const webTabPromptBlock = webTabBlock === this.lastSentWebTabBlock ? "" : webTabBlock;
      const req: PromptInput = {
        sessionId,
        prompt: buildPromptBlocks(displayText, promptContent),
        context: buildPromptContext(
          context,
          webTabPromptBlock,
          projectContextBlock,
          projectContextUpdatesBlock
        ),
      };
      const promptStarted = !signal.aborted;
      let resp: PromptOutput = { stopReason: "cancelled" };
      if (promptStarted) {
        const backingPrompt = this.backend.prompt(req);
        resp = await Promise.race([
          backingPrompt,
          new Promise<PromptOutput>((resolve) => {
            signal.addEventListener("abort", () => resolve({ stopReason: "cancelled" }), {
              once: true,
            });
          }),
        ]);
        if (signal.aborted) {
          // SDK 请求的完成承诺是旧事件已提交的边界，不能再用静默计时猜测执行是否结束。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const drain = backingPrompt.then(
            () => undefined,
            () => undefined
          );
          this.cancelledPromptDrain = drain;
          void drain.then(() => {
            if (this.cancelledPromptDrain === drain) this.cancelledPromptDrain = null;
          });
          resp = { stopReason: "cancelled" };
        }
      }
      // 本地命令没有模型回答，不能展示空回复错误，也不能提前消费下一次真正请求的上下文。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (resp.handledLocally) {
        if (placeholderId && !this.store.hasAssistantActivity(placeholderId)) {
          this.store.deleteMessage(placeholderId);
        }
        this.currentMessageIds = new Set();
        if (this.placeholderId === placeholderId) this.placeholderId = null;
        this.settledStream = null;
        this.notifyMessages();
        return resp.stopReason;
      }
      if (isFirstTurn && promptStarted) this.firstPromptSent = true;
      if (webTabBlock && promptStarted) this.lastSentWebTabBlock = webTabBlock;
      if (projectContextUpdates && promptStarted) {
        this.markProjectContextUpdatesDeliveredFn?.(projectContextUpdates.epoch);
      }
      if (
        placeholderId &&
        resp.stopReason !== "cancelled" &&
        !this.currentTurnHadRoutedToolActivity &&
        !this.store.hasAssistantActivity(placeholderId)
      ) {
        const message = buildEmptyTurnMessage(this.backendId, resp.stopReason);
        logWarn(
          `[AgentMode] ${this.backendId} completed a turn without assistant text or tool activity (stopReason=${resp.stopReason})`
        );
        this.store.markMessageError(placeholderId, message);
      }
      if (placeholderId) this.store.settleOpenCompactions(placeholderId);
      if (
        placeholderId &&
        this.store.markTurnComplete(
          placeholderId,
          resp.stopReason,
          this.turnDurationFromRun(turnStartedAtMs)
        )
      ) {
        this.notifyMessages();
      }
      if (placeholderId && resp.stopReason !== "cancelled") {
        this.settledStream = {
          placeholderId,
          messageIds: this.currentMessageIds,
          turnStartedAtMs,
        };
      } else if (resp.stopReason === "cancelled") {
        this.settledStream = null;
      }
      this.currentMessageIds = new Set();
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      if (resp.stopReason === "end_turn") void this.pollSessionTitle();
      return resp.stopReason;
    } catch (err) {
      logWarn(`[AgentMode] prompt failed`, err);
      if (placeholderId) {
        const failure = formatPromptFailure(err);
        // The turn's error already shows the failure, so the row must not repeat it.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/633
        this.store.settleOpenCompactions(placeholderId, "failed");
        this.store.markMessageError(placeholderId, failure, Date.now() - turnStartedAtMs);
        this.notifyMessages();
      }
      this.lastTurnError = true;
      this.currentMessageIds = new Set();
      if (this.placeholderId === placeholderId) this.placeholderId = null;
      throw err;
    } finally {
      if (this.pendingUserMessageId === userMessageId) this.pendingUserMessageId = null;
      this.abortController = null;
      this.recomputeStatusIfChanged();
    }
  }

  private refuseTurn(placeholderId: string, turnStartedAtMs: number, message: string): StopReason {
    this.store.markMessageError(placeholderId, message);
    this.store.markTurnComplete(placeholderId, "refusal", Date.now() - turnStartedAtMs);
    this.currentMessageIds = new Set();
    if (this.placeholderId === placeholderId) this.placeholderId = null;
    this.notifyMessages();
    return "refusal";
  }

  private async runFanoutPath(
    placeholderId: string,
    originalPromptText: string,
    promptBlocks: PromptContent[],
    turnStartedAtMs: number,
    promptContext?: PromptInput["context"]
  ): Promise<StopReason> {
    const signal = this.abortController?.signal ?? new AbortController().signal;
    const input: FanoutRunInput = {
      agents: this.lastMentionedAgents,
      mainAgent: this.backendId,
      fanoutId: `${this.backendSessionId}:${placeholderId}`,
      parentSessionId: this.backendSessionId ?? undefined,
      mainModelKey: this.currentState?.model?.current.baseModelId,
      projectId: this.projectId,
      prompt: withReadOnlyPreamble(promptBlocks),
      ...(promptContext ? { context: promptContext } : {}),
      originalPromptText,
      signal,
      onChange: (turn) => {
        this.store.setFanout(placeholderId, turn);
        this.scheduleNotifyMessages();
      },
    };
    const turn = await this.runFanoutTurn!(input);
    this.store.setFanout(placeholderId, turn);

    const stopReason: StopReason = signal.aborted ? "cancelled" : "end_turn";
    // Persist the FULL composite as the message body so the dropdown reconstructs
    // on reload. Any non-empty slot text counts (including a terminal slot's
    // partial text), so a turn cancelled mid-stream is saved, not dropped blank.
    // A sole agent's empty terminal slot also carries the only visible outcome
    // and must survive reload with its error/cancel status.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/481
    const hasAnswerText = Object.values(turn.answers).some((a) => a.text.trim().length > 0);
    const hasContent =
      turn.summary.text.trim().length > 0 || hasAnswerText || isDirectAnswerTurn(turn);
    if (hasContent) {
      const composite = serializeFanoutComposite(turn, (id) => this.displayNameFor(id));
      this.store.appendAgentText(placeholderId, composite);
    }
    if (this.store.markTurnComplete(placeholderId, stopReason, Date.now() - turnStartedAtMs)) {
      this.notifyMessages();
    }
    if (this.placeholderId === placeholderId) this.placeholderId = null;
    return stopReason;
  }

  async resumeFanout(messageId: string): Promise<void> {
    const previous = this.store.getMessage(messageId)?.fanout;
    const checkpoint = previous?.checkpoint;
    const status = this.getStatus();
    // 继续按钮是恢复收费工作的明确授权，查看旧聊天本身不会执行。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (
      this.isHistoricalOnly() ||
      this.backendId !== "pi" ||
      !checkpoint ||
      !this.runFanoutTurn ||
      (status !== "idle" && status !== "error")
    )
      return;
    this.abortController = new AbortController();
    this.lastTurnError = false;
    this.recomputeStatusIfChanged();
    try {
      // 继续预算暂停时先恢复原 SDK 检查点，再读取同一候选；不能重新提交用户问题。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (
        !checkpoint.awaitingAdmission &&
        (previous.summary.status === "paused" ||
          Object.values(previous.answers).some((answer) => answer.status === "paused")) &&
        this.backendSessionId
      ) {
        if (!this.backend.recoverSession) throw new MethodUnsupportedError("recoverSession");
        await this.backend.recoverSession({ sessionId: this.backendSessionId, action: "continue" });
      }

      const turn = await this.runFanoutTurn({
        agents: Object.keys(previous.answers),
        mainAgent: "pi",
        fanoutId: checkpoint.fanoutId,
        parentSessionId: this.backendSessionId ?? undefined,
        mainModelKey: checkpoint.mainModelKey,
        projectId: this.projectId,
        prompt: checkpoint.prompt,
        ...(checkpoint.context ? { context: checkpoint.context } : {}),
        originalPromptText: checkpoint.originalPromptText,
        resumeTurn: previous,
        signal: this.abortController.signal,
        onChange: (next) => {
          this.store.setFanout(messageId, next);
          this.notifyMessages();
        },
      });
      this.store.setFanout(messageId, turn);
    } finally {
      this.abortController = null;
      this.notifyMessages();
      this.recomputeStatusIfChanged();
    }
  }

  private displayNameFor(backendId: BackendId): string {
    return this.getDisplayName?.(backendId) ?? backendId;
  }

  async pause(): Promise<void> {
    if (!this.backend.pauseSession || !this.backendSessionId)
      throw new Error("当前聊天不支持暂停。");
    await this.backend.pauseSession({ sessionId: this.backendSessionId });
  }

  async cancel(): Promise<void> {
    if (this.pendingCancellation) {
      // 旧 Stop 等待期间的新输入仍可被明确停止，复用后端取消也不能吞掉这次用户操作。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      this.abortController?.abort();
      return this.pendingCancellation;
    }
    const status = this.getStatus();
    // 父回合结束后后台仍可运行，停止入口按持久子任务快照开放而不阻塞普通新输入。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (
      status !== "running" &&
      status !== "awaiting_permission" &&
      !this.activeBackgroundTaskIds.length
    )
      return;
    if (!this.backendSessionId) return;
    let release!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pendingCancellation = cancellation;
    try {
      this.abortController?.abort();
      this.settledStream = null;
      for (const messageId of this.currentMessageIds) this.cancelledMessageIds.add(messageId);
      this.currentMessageIds = new Set();
      if (this.pendingToolResolvers.size > 0) {
        this.flushResolvers(this.pendingToolResolvers);
        this.notifyMessages();
      }
      if (this.pendingQuestionResolvers.size > 0) {
        this.flushQuestionResolvers();
        this.notifyMessages();
      }
      try {
        await this.backend.cancel({ sessionId: this.backendSessionId });
      } catch (e) {
        logWarn(`[AgentMode] cancel notification failed`, e);
      }
    } finally {
      if (this.pendingCancellation === cancellation) this.pendingCancellation = null;
      release();
    }
  }

  async releaseBackendSession(): Promise<void> {
    if (!this.backendSessionId && this.initializationPending) {
      this.initializationController.abort();
      await this.ready.catch(() => undefined);
      if (!this.backendSessionId) return;
    }
    const backendSessionId = this.backendSessionId;
    if (!backendSessionId || !this.backend.closeSession) {
      throw new Error(t("agentInfra.session.closeUnsupported"));
    }
    try {
      await this.backend.closeSession({ sessionId: backendSessionId });
    } catch (error) {
      if (error instanceof MethodUnsupportedError) {
        throw new Error(t("agentInfra.session.closeUnsupported"));
      }
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.setIsActive(false);
    this.disposed = true;
    this.initializationController.abort();
    if (this.initializationPending) await this.ready.catch(() => undefined);
    this.unregisterSessionHandler?.();
    this.unregisterSessionHandler = null;
    this.flushResolvers(this.pendingPlanResolvers);
    this.flushResolvers(this.pendingToolResolvers);
    this.flushQuestionResolvers();
    this.decidedPlanToolCallIds.clear();
    this.currentPlan = null;
    this.currentTodoList = null;
    this.currentTodoListSignature = null;
    this.settledStream = null;
    this.cancelledPromptDrain = null;
    this.cancelledMessageIds.clear();
    this.currentMessageIds = new Set();
    this.recomputeStatusIfChanged();
    this.cancelScheduledNotify();
    this.listeners.clear();
  }

  handlePlanProposalPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    if (request.signal?.aborted) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    const toolCallId = request.toolCall.toolCallId;
    const exitPlan = tryReadExitPlanModeCall({
      kind: request.toolCall.kind,
      rawInput: request.toolCall.rawInput,
      isPlanProposal: request.toolCall.isPlanProposal,
    });
    if (exitPlan) {
      this.publishGatedPlan(toolCallId, exitPlan);
    }
    return new Promise<PermissionDecision>((resolve) => {
      const entry = {
        request,
        resolve: (decision: PermissionDecision) => {
          request.signal?.removeEventListener("abort", onAbort);
          resolve(decision);
        },
      };
      const onAbort = () => {
        // 关闭只撤原窗口，计划决定仍以持久记录为准，不能取消已保存计划或同编号的新窗口。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const current = this.pendingPlanResolvers.get(toolCallId) === entry;
        if (current) this.pendingPlanResolvers.delete(toolCallId);
        entry.resolve({ outcome: { outcome: "cancelled" } });
        if (current) {
          this.recomputeStatusIfChanged();
          this.notifyMessages();
        }
      };
      this.pendingPlanResolvers.set(toolCallId, entry);
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) onAbort();
      else {
        this.recomputeStatusIfChanged();
        this.notifyMessages();
      }
    });
  }

  async resolvePlanProposalPermission(
    toolCallId: string,
    allow: boolean,
    denyMessage?: string
  ): Promise<void> {
    const entry = this.pendingPlanResolvers.get(toolCallId);
    if (!entry) {
      const plan = this.currentPlan;
      if (
        !plan ||
        plan.pendingToolCallId !== toolCallId ||
        !this.backend.decidePendingPlan ||
        !this.backendSessionId
      )
        return;
      await this.backend.decidePendingPlan({
        sessionId: this.backendSessionId,
        planId: plan.id,
        revision: plan.revision,
        action: allow ? "approve" : denyMessage?.trim() ? "feedback" : "reject",
        ...(denyMessage ? { feedback: denyMessage } : {}),
      });
      return;
    }
    this.pendingPlanResolvers.delete(toolCallId);
    const base = decisionFor(
      entry.request,
      allow ? PERMISSION_ALLOW_KINDS : PERMISSION_REJECT_KINDS
    );
    const decision: PermissionDecision = !allow && denyMessage ? { ...base, denyMessage } : base;
    entry.resolve(decision);
    this.recomputeStatusIfChanged();
    this.notifyMessages();
  }

  getCurrentPlan(): CurrentPlan | null {
    return this.currentPlan;
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return this.currentTodoList;
  }

  getReportEvidence(): FeedbackEvidence {
    return {
      backendId: this.backendId,
      model: this.currentState?.model?.current.baseModelId ?? null,
      sessionId: this.backendSessionId,
      raisedAt: new Date().toISOString(),
    };
  }

  getFeedbackOffer(): FeedbackOffer | null {
    return this.feedbackOffer;
  }

  // One card per session, whatever became of it, so a frustrated user is never nagged.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  offerFeedback(draft: FeedbackDraft): FeedbackOfferResult {
    if (this.feedbackOffer) return "already_offered";
    const userMessages = this.store
      .getDisplayMessages()
      .filter((message) => message.sender === USER_SENDER);
    this.feedbackOffer = {
      draft,
      evidence: this.getReportEvidence(),
      afterUserMessageId: userMessages[userMessages.length - 1]?.id ?? null,
      status: "open",
    };
    this.notifyMessages();
    return "shown";
  }

  dismissFeedbackOffer(): void {
    if (this.feedbackOffer?.status !== "open") return;
    const offerId = this.feedbackOffer.id;
    this.feedbackOffer = { ...this.feedbackOffer, status: "dismissed" };
    if (this.backendSessionId && offerId) {
      void this.backend
        .setFeedbackStatus?.({ sessionId: this.backendSessionId, offerId, status: "dismissed" })
        .catch((error: unknown) =>
          logWarn("[AgentMode] could not persist feedback dismissal", error)
        );
      if (getSettings().agentMode.offerFeedbackCards === false) {
        void this.backend
          .setFeedbackEnabled?.({ sessionId: this.backendSessionId, enabled: false })
          .catch((error: unknown) =>
            logWarn("[AgentMode] could not persist feedback preference", error)
          );
      }
    }
    this.notifyMessages();
  }

  markFeedbackReported(report: { reportId: string; issueUrl: string }): void {
    // An upload can land after the user closed the dialog and dismissed the card, which must stay dismissed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
    if (this.feedbackOffer?.status !== "open") return;
    this.feedbackOffer = { ...this.feedbackOffer, status: "reported", report };
    if (this.backendSessionId && this.feedbackOffer.id) {
      void this.backend
        .setFeedbackStatus?.({
          sessionId: this.backendSessionId,
          offerId: this.feedbackOffer.id,
          status: "reported",
        })
        .catch((error: unknown) =>
          logWarn("[AgentMode] could not persist reported feedback", error)
        );
    }
    this.notifyMessages();
  }

  getSessionUsage(): SessionUsage | null {
    return this.currentUsage;
  }

  getPlanUsage(): PlanUsage | null {
    return this.currentPlanUsage;
  }

  seedSessionUsage(usage: SessionUsage | undefined): void {
    if (!usage) return;
    this.currentUsage = usage;
    this.notifyMessages();
    // A persisted snapshot can predate the model's window being known — hosted models
    // never carry one on the wire, and older chats were saved before windows were
    // filled in at all — so without this a reopened chat shows a bare count until its
    // next turn (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
    if (usage.contextWindow === undefined) void this.fillSeededContextWindow(usage);
  }

  private async fillSeededContextWindow(seeded: SessionUsage): Promise<void> {
    if (!this.backend.readContextWindow) return;
    // A chat with no resumable backend session is seeded into a freshly created one,
    // BEFORE its `newSession` has resolved — so at call time the model is not known
    // yet. Wait for startup to settle rather than silently skipping, or exactly those
    // older chats would stay count-only until their next turn
    // (https://github.com/logancyang/obsidian-copilot-preview/issues/193).
    try {
      await this.ready;
    } catch {
      return;
    }
    const wireModelId = this.currentState?.model?.current.baseModelId ?? null;
    if (!wireModelId) return;
    let contextWindow: number | null = null;
    try {
      contextWindow = await this.backend.readContextWindow(wireModelId);
    } catch {
      return;
    }
    if (!contextWindow) return;
    if (this.currentUsage !== seeded) return;
    if (this.currentState?.model?.current.baseModelId !== wireModelId) return;
    this.currentUsage = { ...seeded, contextWindow };
    this.notifyMessages();
  }

  private applyUsageUpdate(usage: SessionUsage): void {
    // Some backends use zero as an empty terminal snapshot after cancellation.
    // It does not measure consumed context, so wait for a positive reading.
    // https://github.com/logancyang/obsidian-copilot/issues/2975
    if (!usage.usedTokens) return;
    if (usage.contextWindow === undefined && this.currentUsage?.contextWindow !== undefined) {
      return;
    }
    this.currentUsage = usage;
    this.notifyMessages();
  }

  // A run and a turn are different clocks: intermediate turn ends never close the loading state,
  // and the completed turn takes its duration from the run's persisted start/end, not render time:
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  private applyRunState(run: RunStateUpdate): void {
    this.currentRun = run;
    if (run.status === "failed") this.lastTurnError = true;
    else if (run.status === "accepting" || run.status === "running") this.lastTurnError = false;
    this.recomputeStatusIfChanged();
  }

  private applyBudgetUpdate(budget: BudgetUpdate): void {
    this.currentBudget = budget;
    // A provider budget with unknown usage must not overwrite a known reading with zeros:
    // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (budget.usage !== null) this.applyUsageUpdate(budget.usage);
  }

  getRunState(): RunStateUpdate | null {
    return this.currentRun;
  }

  getBudget(): BudgetUpdate | null {
    return this.currentBudget;
  }

  private turnDurationFromRun(fallbackStartedAtMs: number): number {
    const run = this.currentRun;
    if (run !== null && isRunTerminal(run.status) && run.endedAtMs !== undefined) {
      return Math.max(0, run.endedAtMs - run.startedAtMs);
    }
    return Date.now() - fallbackStartedAtMs;
  }

  // Compaction reports the new context size directly, so it bypasses applyUsageUpdate's guards.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/635
  private applyCompactedUsage(compaction: CompactionSnapshot): boolean {
    if (compaction.status !== "completed" || compaction.postTokens === undefined) return false;
    this.currentUsage = {
      usedTokens: compaction.postTokens,
      contextWindow: this.currentUsage?.contextWindow,
      updatedAt: Date.now(),
    };
    return true;
  }

  /**
   * Drop the held context window when the model changes, keeping the count. `applyUsageUpdate`
   * ignores windowless snapshots while a windowed one is held, so a stale window would stick.
   * https://github.com/logancyang/obsidian-copilot-preview/issues/193
   */
  private dropUsageWindowOnModelChange(next: BackendState | null): void {
    const before = this.currentState?.model?.current.baseModelId;
    const after = next?.model?.current.baseModelId;
    if (!before || !after || before === after) return;
    if (this.currentUsage?.contextWindow === undefined) return;
    this.currentUsage = { ...this.currentUsage, contextWindow: undefined };
    this.notifyMessages();
  }

  finalizePlanDecision(
    proposalId: string,
    decision?: PlanDecisionAction,
    feedbackText?: string
  ): boolean {
    if (!this.currentPlan || this.currentPlan.id !== proposalId) return false;
    if (this.currentPlan.pendingToolCallId) {
      this.decidedPlanToolCallIds.add(this.currentPlan.pendingToolCallId);
      if (decision) {
        const summary =
          decision === "approve"
            ? t("agentInfra.session.approvedPlan")
            : decision === "reject"
              ? t("agentInfra.session.rejectedPlan")
              : t("agentInfra.session.requestedPlanChanges", {
                  feedback: feedbackText ?? t("agentInfra.session.planFeedbackSent"),
                });
        // ACP may report only a titleless completion after the user decides.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/41
        this.recordUserResponse(this.currentPlan.pendingToolCallId, summary);
      }
    }
    this.currentPlan = null;
    this.notifyCurrentPlanChanged();
    return true;
  }

  private applyPlanProposal(plan: CurrentPlan): boolean {
    const prev = this.currentPlan;
    if (prev !== null && prev.id === plan.id) {
      if (prev.revision > plan.revision) return false;
      if (
        prev.revision === plan.revision &&
        prev.decision !== "pending" &&
        plan.decision === "pending"
      ) {
        return false;
      }
      if (
        prev.revision === plan.revision &&
        prev.decision === plan.decision &&
        prev.body === plan.body &&
        prev.pendingToolCallId === plan.pendingToolCallId
      ) {
        return false;
      }
    }
    this.currentPlan = { ...plan };
    this.notifyCurrentPlanChanged();
    return true;
  }

  private setCurrentPlan(next: Omit<CurrentPlan, "id" | "revision" | "decision">): void {
    if (!this.currentPlan) {
      this.planSeq += 1;
      this.currentPlan = {
        ...next,
        id: `plan-${this.internalId}-${this.planSeq}`,
        revision: 1,
        decision: "pending",
      };
      this.notifyCurrentPlanChanged();
      return;
    }
    const prev = this.currentPlan;
    const bodyChanged = prev.body !== next.body;
    const changed =
      bodyChanged ||
      prev.title !== next.title ||
      prev.sourceFilePath !== next.sourceFilePath ||
      prev.permissionGated !== next.permissionGated ||
      prev.pendingToolCallId !== next.pendingToolCallId ||
      prev.decision !== "pending";
    if (!changed) return;
    this.currentPlan = {
      ...prev,
      ...next,
      revision: bodyChanged ? prev.revision + 1 : prev.revision,
      decision: "pending",
    };
    this.notifyCurrentPlanChanged();
  }

  clearCurrentPlanIfModeLeft(): void {
    if (!this.currentPlan) return;
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return;
    // 独立保存的计划不能因恢复模型设置而被误当成退出计划模式并拒绝。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (descriptor.planLifecycle === "independent") return;
    if (!descriptor.getModeMapping) return;
    if (this.isCurrentlyInPlanMode()) return;
    const pending = this.currentPlan.pendingToolCallId;
    if (pending) {
      void this.resolvePlanProposalPermission(pending, false).catch((error) =>
        logWarn("[AgentSession] plan rejection failed", error)
      );
      this.decidedPlanToolCallIds.add(pending);
    }
    this.currentPlan = null;
    this.notifyCurrentPlanChanged();
  }

  hasPendingPlanPermission(): boolean {
    return (
      this.pendingPlanResolvers.size > 0 ||
      (this.currentPlan?.decision === "pending" && !!this.backend.decidePendingPlan)
    );
  }

  handleToolPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    if (request.signal?.aborted) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    const toolCallId = request.toolCall.toolCallId;
    return new Promise<PermissionDecision>((resolve) => {
      const entry = {
        request,
        resolve: (decision: PermissionDecision) => {
          request.signal?.removeEventListener("abort", onAbort);
          resolve(decision);
        },
      };
      const onAbort = () => {
        // 旧窗口撤销只移除自己的临时回调，不能覆盖同编号的新提示或重新提交持久决定。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const current = this.pendingToolResolvers.get(toolCallId) === entry;
        if (current) this.pendingToolResolvers.delete(toolCallId);
        entry.resolve({ outcome: { outcome: "cancelled" } });
        if (current) {
          this.recomputeStatusIfChanged();
          this.notifyMessages();
        }
      };
      this.pendingToolResolvers.set(toolCallId, entry);
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) onAbort();
      else {
        this.recomputeStatusIfChanged();
        this.notifyMessages();
      }
    });
  }

  async resolveToolPermission(toolCallId: string, optionId: string): Promise<void> {
    const entry = this.pendingToolResolvers.get(toolCallId);
    if (!entry) {
      if (
        !this.recoveredPermissions.some((request) => request.toolCall.toolCallId === toolCallId) ||
        !this.backend.decidePermission ||
        !this.backendSessionId
      )
        return;
      await this.backend.decidePermission({
        sessionId: this.backendSessionId,
        requestId: toolCallId,
        decision: { outcome: { outcome: "selected", optionId } },
      });
      return;
    }
    this.pendingToolResolvers.delete(toolCallId);
    entry.resolve({ outcome: { outcome: "selected", optionId } });
    this.recomputeStatusIfChanged();
    this.notifyMessages();
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    const requests = new Map(
      this.recoveredPermissions.map((request) => [request.toolCall.toolCallId, request])
    );
    for (const [id, entry] of this.pendingToolResolvers) requests.set(id, entry.request);
    return requests.size ? [...requests.values()] : EMPTY_PERMISSIONS;
  }

  handleAskUserQuestion(request: AskUserQuestionPrompt): Promise<AgentQuestionAnswers> {
    const requestId = request.requestId;
    if (request.signal?.aborted) return Promise.resolve(EMPTY_ANSWERS);
    return new Promise<AgentQuestionAnswers>((resolve) => {
      const entry = {
        request,
        resolve: (answers: AgentQuestionAnswers) => {
          request.signal?.removeEventListener("abort", onAbort);
          resolve(answers);
        },
      };
      const onAbort = () => {
        // 终态关闭只撤销同一临时问题，不能向已答复的持久问题再提交空答案或误删新窗口。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const current = this.pendingQuestionResolvers.get(requestId) === entry;
        if (current) this.pendingQuestionResolvers.delete(requestId);
        entry.resolve(EMPTY_ANSWERS);
        if (current) {
          this.recomputeStatusIfChanged();
          this.notifyMessages();
        }
      };
      this.pendingQuestionResolvers.set(requestId, entry);
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) onAbort();
      else {
        this.recomputeStatusIfChanged();
        this.notifyMessages();
      }
    });
  }

  async resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): Promise<void> {
    const entry = this.pendingQuestionResolvers.get(requestId);
    if (!entry) {
      if (
        !this.recoveredQuestions.some((request) => request.requestId === requestId) ||
        !this.backend.answerPendingQuestion ||
        !this.backendSessionId
      )
        return;
      await this.backend.answerPendingQuestion({
        sessionId: this.backendSessionId,
        requestId,
        answers,
      });
      return;
    }
    this.pendingQuestionResolvers.delete(requestId);
    const responses = entry.request.questions.flatMap((question) => {
      const answer = answers[question.answerKey ?? question.question];
      return answer ? [{ question: question.question, answer }] : [];
    });
    // ACP elicitation may have no tool call of its own; record the submitted
    // answers in the current assistant turn.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/551
    if (responses.length > 0) {
      const summary = `Answered: ${responses.map(({ answer }) => answer).join("; ")}`;
      const detail = responses.map(({ question, answer }) => `${question}: ${answer}`).join("\n");
      this.recordUserResponse(requestId, summary, detail);
    }
    entry.resolve(answers);
    this.recomputeStatusIfChanged();
    this.notifyMessages();
  }

  private recordUserResponse(toolCallId: string, summary: string, detail?: string): void {
    const messageId = this.store.findMessageIdWithToolCall(toolCallId) ?? this.placeholderId;
    if (!messageId) return;
    const previous = this.findToolCallPart(messageId, toolCallId);
    const part: AgentMessagePart = {
      ...(previous?.kind === "tool_call" ? previous : {}),
      kind: "tool_call",
      id: toolCallId,
      title: summary,
      status: "completed",
      userResponse: summary,
      ...(detail ? { output: [{ type: "text", text: detail }] } : {}),
    };
    if (this.store.upsertAgentPart(messageId, part)) this.notifyMessages();
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    const requests = new Map(
      this.recoveredQuestions.map((request) => [request.requestId, request])
    );
    for (const [id, entry] of this.pendingQuestionResolvers) requests.set(id, entry.request);
    return requests.size ? [...requests.values()] : EMPTY_QUESTIONS;
  }

  private flushResolvers(
    map: Map<string, { request: PermissionPrompt; resolve: (resp: PermissionDecision) => void }>
  ): void {
    for (const { request, resolve } of map.values()) {
      resolve(decisionFor(request, PERMISSION_REJECT_KINDS));
    }
    map.clear();
    this.recomputeStatusIfChanged();
  }

  private flushQuestionResolvers(): void {
    for (const { resolve } of this.pendingQuestionResolvers.values()) {
      resolve(EMPTY_ANSWERS);
    }
    this.pendingQuestionResolvers.clear();
    this.recomputeStatusIfChanged();
  }

  private handleSessionEvent(event: SessionEvent): void {
    const update = event.update;
    if (update.sessionUpdate === "recovery_state") {
      this.recoveryState = update.recovery;
      this.recomputeStatusIfChanged();
      this.notifyMessages();
      return;
    }
    if (update.sessionUpdate === "feedback_offer") {
      this.feedbackOffer = update.offer;
      this.notifyMessages();
      return;
    }
    if (update.sessionUpdate === "session_projection") {
      this.applySessionProjection(update.projection);
      return;
    }
    if (update.sessionUpdate === "plan_proposal_update") {
      this.applyPlanProposal(update.plan);
      return;
    }
    // A user message echoed outside the replay is already shown from the prompt that sent it. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
    if (update.sessionUpdate === "user_message_chunk" && !this.historyOpen) return;
    if (this.historyOpen && this.appendHistory(update, event.occurredAt)) {
      this.extendHistoryTurn(event.occurredAt);
      return;
    }
    const toolOwnerMessageId =
      update.sessionUpdate === "tool_call_update"
        ? this.store.findMessageIdWithToolCall(update.toolCallId)
        : undefined;
    const toolOwnerStopReason = toolOwnerMessageId
      ? this.store.getMessage(toolOwnerMessageId)?.turnStopReason
      : undefined;
    const isPriorToolUpdate =
      toolOwnerMessageId !== undefined &&
      toolOwnerStopReason !== undefined &&
      toolOwnerStopReason !== "cancelled";

    if (this.cancelledPromptDrain || this.abortController?.signal.aborted) {
      switch (update.sessionUpdate) {
        case "agent_message_chunk":
        case "agent_thought_chunk":
          if (update.messageId) this.cancelledMessageIds.add(update.messageId);
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
        case "tool_call":
        case "plan":
        case "compaction":
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
        case "tool_call_update":
          if (isPriorToolUpdate) break;
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
      }
    }

    if (update.sessionUpdate === "plan" && this.applyCurrentTodoList(update.entries)) {
      this.notifyCurrentTodoListChanged();
    }

    if (update.sessionUpdate === "session_info_update") {
      // 未提供标题的状态更新保留原名，只有明确的空值才能清除标题。https://github.com/Brevilabs/obsidian-copilot-private/issues/632
      if (update.title !== undefined && this.backendSummarizesTitle()) {
        this.applyAgentLabel(update.title);
      }
      return;
    }
    if (update.sessionUpdate === "state_changed") {
      this.dropUsageWindowOnModelChange(update.state);
      this.currentState = update.state;
      this.notifyModelChanged();
      this.clearCurrentPlanIfModeLeft();
      return;
    }
    if (update.sessionUpdate === "current_mode_update") {
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      return;
    }
    if (update.sessionUpdate === "usage_update") {
      this.applyUsageUpdate(update.usage);
      return;
    }
    if (update.sessionUpdate === "run_state") {
      this.applyRunState(update.run);
      return;
    }
    if (update.sessionUpdate === "budget_update") {
      this.applyBudgetUpdate(update.budget);
      return;
    }
    if (update.sessionUpdate === "plan_usage_update") {
      this.currentPlanUsage = update.planUsage;
      this.notifyMessages();
      return;
    }

    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      const text = extractText(update.content);
      if (!text) return;
      const target = this.resolveContentTarget(update.messageId);
      if (!target) {
        logWarn(`[AgentMode] dropping ${update.sessionUpdate} — no target for ${this.internalId}`);
        return;
      }
      const appended =
        update.sessionUpdate === "agent_message_chunk"
          ? this.store.appendAgentText(target, text)
          : this.store.appendAgentThought(target, text);
      if (appended) {
        if (target === this.settledStream?.placeholderId) {
          this.store.extendTurnDuration(target, Date.now() - this.settledStream.turnStartedAtMs);
        }
        this.scheduleNotifyMessages();
      }
      return;
    }

    const placeholderId = this.placeholderId;
    const targetMessageId = isPriorToolUpdate ? toolOwnerMessageId : placeholderId;
    if (!targetMessageId) {
      logWarn(`[AgentMode] dropping session/update — no placeholder for ${this.internalId}`);
      return;
    }

    switch (update.sessionUpdate) {
      case "tool_call": {
        const exitPlan = tryReadExitPlanModeCall({
          kind: update.kind,
          rawInput: update.rawInput,
          isPlanProposal: update.isPlanProposal,
        });
        if (exitPlan) {
          this.publishGatedPlan(update.toolCallId, exitPlan);
          if (this.store.upsertAgentPart(targetMessageId, toolCallToPart(update))) {
            this.scheduleNotifyMessages();
          }
          return;
        }
        if (this.store.upsertAgentPart(targetMessageId, toolCallToPart(update))) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "tool_call_update": {
        if (targetMessageId !== placeholderId) this.currentTurnHadRoutedToolActivity = true;
        const existing = this.findToolCallPart(targetMessageId, update.toolCallId);
        const merged = mergeToolCallUpdate(existing, update);
        if (merged.kind === "tool_call") {
          const exitPlan = tryReadExitPlanModeCall({
            kind: update.kind ?? merged.toolKind,
            rawInput: merged.input,
            isPlanProposal: update.isPlanProposal,
          });
          if (exitPlan) {
            this.publishGatedPlan(merged.id, exitPlan);
          }
        }
        if (this.store.upsertAgentPart(targetMessageId, merged)) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "plan": {
        if (this.store.upsertAgentPart(targetMessageId, planToPart(update))) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "todo_update": {
        const entries: AgentPlanEntry[] = update.todo.items.map((item) => ({
          content: item.text,
          priority: item.priority,
          status: item.status,
        }));
        if (this.store.upsertAgentPart(targetMessageId, planToPart({ entries }))) {
          this.scheduleNotifyMessages();
        }
        if (this.applyCurrentTodoList(entries)) this.notifyCurrentTodoListChanged();
        return;
      }
      case "compaction": {
        const upserted = this.upsertCompactionPart(targetMessageId, update);
        const metered = this.applyCompactedUsage(update);
        if (upserted || metered) this.scheduleNotifyMessages();
        return;
      }
      default:
        logInfo(
          `[AgentMode] ignoring session/update kind=${(update as { sessionUpdate: string }).sessionUpdate}`
        );
        return;
    }
  }

  // The projection is the authoritative display snapshot for a resynced conversation: a newer
  // frame replaces the loaded window in one batch, an older frame is dropped, and the optimistic
  // user turn keeps its UI id/context while the live assistant card adopts the projected answer:
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  private applySessionProjection(projection: SessionProjection): void {
    if (!this.acceptProjectionCursor(projection.cursor)) return;
    if (this.historyOpen) this.discardHistoryReplay();
    const messages = projection.messages.map((message) => ({ ...message }));
    if (projection.mode === "prepend") {
      if (this.store.prependMessages(messages)) this.notifyMessages();
      return;
    }
    const backgroundTaskIds = projection.activeBackgroundTaskIds ?? EMPTY_BACKGROUND_TASK_IDS;
    const backgroundChanged =
      this.activeBackgroundTaskIds.length !== backgroundTaskIds.length ||
      this.activeBackgroundTaskIds.some((id, index) => id !== backgroundTaskIds[index]);
    this.activeBackgroundTaskIds = backgroundTaskIds;
    const recoveryChanged = this.recoveryState !== projection.pending.recovery;
    const pendingChanged =
      JSON.stringify({
        permissions: this.recoveredPermissions,
        questions: this.recoveredQuestions,
        plan: this.currentPlan,
      }) !==
      JSON.stringify({
        permissions: projection.pending.permissions,
        questions: projection.pending.questions,
        plan: projection.pending.plan,
      });
    this.recoveredPermissions = projection.pending.permissions;
    this.recoveredQuestions = projection.pending.questions;
    this.currentPlan = projection.pending.plan;
    this.recoveryState = projection.pending.recovery;
    if (recoveryChanged || pendingChanged) this.recomputeStatusIfChanged();
    if (
      this.store.replaceMessages(this.reconcileReplacementMessages(messages)) ||
      recoveryChanged ||
      pendingChanged ||
      backgroundChanged
    ) {
      this.notifyMessages();
    }
  }

  private acceptProjectionCursor(cursor: StreamCursor): boolean {
    const accepted = this.projectionCursor;
    if (
      accepted !== null &&
      accepted.streamEpoch === cursor.streamEpoch &&
      cursor.frameIndex <= accepted.frameIndex
    ) {
      return false;
    }
    this.projectionCursor = cursor;
    return true;
  }

  private discardHistoryReplay(): void {
    this.historyUser = null;
    this.historyAiId = null;
    this.historyTurnStartedAt = undefined;
    this.historyOpen = false;
  }

  private reconcileReplacementMessages(messages: AgentChatMessage[]): AgentChatMessage[] {
    const display = this.store.getDisplayMessages();
    const storedById = new Map(display.map((message) => [message.id, message]));
    for (const message of messages) {
      const alias = message.isAuxiliary ? undefined : this.projectionIdAliases.get(message.id);
      if (alias !== undefined) message.id = alias;
      const stored = storedById.get(message.id);
      // 后续快照复用已绑定消息键时仍须保留宿主选区对象，不能只在首次别名绑定时复制。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (message.sender === USER_SENDER && stored?.sender === USER_SENDER) {
        message.context = message.context ?? stored.context;
        message.timestamp = message.timestamp ?? stored.timestamp;
        message.content = message.content ?? stored.content;
      }
    }
    const displayedIds = new Set(display.map((message) => message.id));
    this.bindOptimisticUserMessages(messages, displayedIds, display);
    const pendingUserId = this.pendingUserMessageId;
    if (pendingUserId !== null) {
      if (
        messages.some((message) => message.sender === USER_SENDER && message.id === pendingUserId)
      ) {
        this.pendingUserMessageId = null;
      } else {
        // 资料、预算记录可先于 pi.user 触发旧历史快照，新问题要等真实入库后再交接身份。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const pending = storedById.get(pendingUserId);
        if (pending) messages.push(pending);
      }
    }
    this.bindLiveAssistantMessage(messages, displayedIds);
    if (this.placeholderId !== null && !messages.some((m) => m.id === this.placeholderId)) {
      const live = this.store.getMessage(this.placeholderId);
      if (live !== undefined) messages.push(live);
      else this.placeholderId = null;
    }
    return messages;
  }

  private bindOptimisticUserMessages(
    messages: AgentChatMessage[],
    displayedIds: ReadonlySet<string>,
    display: readonly AgentChatMessage[]
  ): void {
    const projectedIds = new Set(messages.map((message) => message.id));
    const unmatchedStored = display.filter(
      (message) => message.sender === USER_SENDER && !projectedIds.has(message.id)
    );
    const unmatchedProjected = messages.filter(
      (message) => message.sender === USER_SENDER && !displayedIds.has(message.id)
    );
    const count = Math.min(unmatchedStored.length, unmatchedProjected.length);
    for (let offset = 1; offset <= count; offset += 1) {
      const stored = unmatchedStored[unmatchedStored.length - offset];
      const projected = unmatchedProjected[unmatchedProjected.length - offset];
      this.projectionIdAliases.set(projected.id, stored.id);
      projected.id = stored.id;
      projected.context = projected.context ?? stored.context;
      projected.timestamp = projected.timestamp ?? stored.timestamp;
      projected.content = projected.content ?? stored.content;
    }
  }

  private bindLiveAssistantMessage(
    messages: AgentChatMessage[],
    displayedIds: ReadonlySet<string>
  ): void {
    const placeholderId = this.placeholderId;
    if (placeholderId === null || !displayedIds.has(placeholderId)) return;
    if (messages.some((message) => message.id === placeholderId && !message.isAuxiliary)) return;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.sender === USER_SENDER) return;
      // 批准和补发的文件凭据是独立记录，不能抢占本轮回答的临时卡而留下半句重复文本。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (message.isAuxiliary) continue;
      if (displayedIds.has(message.id)) return;
      this.projectionIdAliases.set(message.id, placeholderId);
      message.id = placeholderId;
      return;
    }
  }

  // Frames replayed before the load response are the chat's past turns, not a turn in flight. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
  private appendHistory(update: SessionEvent["update"], occurredAt: number | undefined): boolean {
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const text = extractText(update.content);
        const current = this.historyUser;
        if (current && update.messageId !== undefined && current.wireId === update.messageId) {
          current.raw += text;
          return true;
        }
        if (!text.trim()) return true;
        this.flushHistoryUser();
        this.historyAiId = null;
        this.historyUser = { wireId: update.messageId, raw: text, occurredAt };
        this.historyTurnStartedAt = occurredAt;
        return true;
      }
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const text = extractText(update.content);
        if (!text) return true;
        const id = this.historyAiBubbleId(occurredAt);
        const appended =
          update.sessionUpdate === "agent_message_chunk"
            ? this.store.appendAgentText(id, text)
            : this.store.appendAgentThought(id, text);
        if (appended) this.scheduleNotifyMessages();
        return true;
      }
      case "tool_call":
        if (
          this.store.upsertAgentPart(this.historyAiBubbleId(occurredAt), toolCallToPart(update))
        ) {
          this.scheduleNotifyMessages();
        }
        return true;
      case "tool_call_update": {
        const id =
          this.store.findMessageIdWithToolCall(update.toolCallId) ??
          this.historyAiBubbleId(occurredAt);
        const merged = mergeToolCallUpdate(this.findToolCallPart(id, update.toolCallId), update);
        if (this.store.upsertAgentPart(id, merged)) this.scheduleNotifyMessages();
        return true;
      }
      case "plan":
        if (this.store.upsertAgentPart(this.historyAiBubbleId(occurredAt), planToPart(update))) {
          this.scheduleNotifyMessages();
        }
        // The last replayed task list is the one the chat closed with, so the project popover shows it again. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
        if (this.applyCurrentTodoList(update.entries)) this.notifyCurrentTodoListChanged();
        return true;
      case "todo_update": {
        const entries: AgentPlanEntry[] = update.todo.items.map((item) => ({
          content: item.text,
          priority: item.priority,
          status: item.status,
        }));
        if (
          this.store.upsertAgentPart(this.historyAiBubbleId(occurredAt), planToPart({ entries }))
        ) {
          this.scheduleNotifyMessages();
        }
        if (this.applyCurrentTodoList(entries)) this.notifyCurrentTodoListChanged();
        return true;
      }
      case "compaction": {
        // A replayed compaction is already over, so one that never reports an end settles as cancelled rather than spinning. https://github.com/Brevilabs/obsidian-copilot-private/issues/638
        const settled: CompactionSnapshot =
          update.status === "in_progress" ? { ...update, status: "cancelled" } : update;
        if (this.upsertCompactionPart(this.historyAiBubbleId(occurredAt), settled)) {
          this.scheduleNotifyMessages();
        }
        return true;
      }
      default:
        return false;
    }
  }

  private upsertCompactionPart(messageId: string, update: CompactionSnapshot): boolean {
    const existing = this.store
      .getMessage(messageId)
      ?.parts?.find((p) => p.kind === "compaction" && p.id === update.id);
    const startedAtMs = existing?.kind === "compaction" ? existing.startedAtMs : Date.now();
    return this.store.upsertAgentPart(messageId, compactionToPart(update, startedAtMs));
  }

  // A prompt's context envelope stays hidden until its wrapper is complete, so a user bubble waits for the message to end. https://github.com/Brevilabs/obsidian-copilot-private/issues/602
  private flushHistoryUser(): void {
    const pending = this.historyUser;
    this.historyUser = null;
    if (!pending) return;
    this.store.addMessage({
      message: stripUserMessageWrapper(pending.raw),
      sender: USER_SENDER,
      timestamp: historyTimestamp(pending.occurredAt),
      isVisible: true,
    });
    this.scheduleNotifyMessages();
  }

  private historyAiBubbleId(occurredAt: number | undefined): string {
    if (this.historyAiId) return this.historyAiId;
    this.flushHistoryUser();
    const startedAt = this.historyTurnStartedAt;
    this.historyAiId = this.store.addMessage({
      message: "",
      sender: AI_SENDER,
      timestamp: historyTimestamp(occurredAt),
      isVisible: true,
      parts: [],
      turnDurationMs:
        startedAt === undefined || occurredAt === undefined
          ? undefined
          : Math.max(0, occurredAt - startedAt),
    });
    return this.historyAiId;
  }

  // A replayed turn lasts from its prompt to its last timed frame; frames from an agent that sends no times leave it untimed. https://github.com/Brevilabs/obsidian-copilot-private/issues/643
  private extendHistoryTurn(occurredAt: number | undefined): void {
    const startedAt = this.historyTurnStartedAt;
    if (!this.historyAiId || startedAt === undefined || occurredAt === undefined) return;
    if (this.store.extendTurnDuration(this.historyAiId, occurredAt - startedAt)) {
      this.scheduleNotifyMessages();
    }
  }

  private endHistory(): void {
    this.flushHistoryUser();
    this.historyOpen = false;
    this.historyAiId = null;
    this.historyTurnStartedAt = undefined;
  }

  private resolveContentTarget(messageId: string | undefined): string | null {
    if (
      this.cancelledPromptDrain ||
      this.abortController?.signal.aborted ||
      (messageId !== undefined && this.cancelledMessageIds.has(messageId))
    ) {
      return null;
    }
    if (messageId && this.settledStream?.messageIds.has(messageId)) {
      return this.settledStream.placeholderId;
    }
    const placeholderId = this.placeholderId;
    if (!placeholderId) return null;
    if (messageId) this.currentMessageIds.add(messageId);
    return placeholderId;
  }

  private findToolCallPart(messageId: string, toolCallId: string): AgentMessagePart | undefined {
    const msg = this.store.getMessage(messageId);
    return msg?.parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
  }

  private publishGatedPlan(
    toolCallId: string,
    info: { plan: string; planFilePath?: string }
  ): void {
    if (this.decidedPlanToolCallIds.has(toolCallId)) return;
    // 批准请求可能晚于原始计划文档到达，不能从正文重建标题并覆盖已保存的身份和版本：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (this.currentPlan?.pendingToolCallId === toolCallId && this.currentPlan.body === info.plan)
      return;
    const stale = this.currentPlan?.pendingToolCallId;
    if (stale && stale !== toolCallId)
      void this.resolvePlanProposalPermission(stale, false).catch((error) =>
        logWarn("[AgentSession] old plan rejection failed", error)
      );
    const title = derivePlanTitleFromMarkdown(info.plan);
    this.setCurrentPlan({
      body: info.plan,
      title,
      sourceFilePath: info.planFilePath,
      permissionGated: true,
      pendingToolCallId: toolCallId,
    });
  }

  private isCurrentlyInPlanMode(): boolean {
    return this.currentState?.mode?.current === "plan";
  }

  private recomputeStatusIfChanged(): void {
    const next = this.getStatus();
    if (next === this.cachedStatus) return;
    this.cachedStatus = next;
    for (const l of this.listeners) {
      try {
        l.onStatusChanged(next);
      } catch (e) {
        logWarn(`[AgentMode] status listener threw`, e);
      }
    }
  }

  private notifyMessages(): void {
    this.cancelScheduledNotify();
    for (const l of this.listeners) {
      try {
        l.onMessagesChanged();
      } catch (e) {
        logWarn(`[AgentMode] messages listener threw`, e);
      }
    }
  }

  private scheduleNotifyMessages(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    const fire = (): void => {
      this.notifyHandle = null;
      this.notifyScheduled = false;
      this.notifyMessages();
    };
    if (typeof requestAnimationFrame !== "undefined") {
      this.notifyHandle = window.requestAnimationFrame(fire);
    } else {
      this.notifyHandle = window.setTimeout(fire, 16);
    }
  }

  private cancelScheduledNotify(): void {
    if (!this.notifyScheduled) return;
    this.notifyScheduled = false;
    if (this.notifyHandle !== null) {
      if (typeof cancelAnimationFrame !== "undefined" && typeof this.notifyHandle === "number") {
        cancelAnimationFrame(this.notifyHandle);
      } else {
        window.clearTimeout(this.notifyHandle as ReturnType<typeof setTimeout>);
      }
      this.notifyHandle = null;
    }
  }

  private async pollSessionTitle(): Promise<void> {
    if (this.labelSource === "user") return;
    if (!this.backendSummarizesTitle()) return;
    try {
      const resp = await this.backend.listSessions(this.cwd ? { cwd: this.cwd } : {});
      const entry = resp.sessions.find((s) => s.sessionId === this.backendSessionId);
      const title = entry?.title?.trim();
      if (!title) return;
      if (title.startsWith(DEFAULT_TITLE_PREFIX)) return;
      this.applyAgentLabel(title);
    } catch (err) {
      if (err instanceof MethodUnsupportedError) return;
      logWarn(`[AgentMode] session/list title poll failed for ${this.internalId}`, err);
    }
  }

  private notifyModelChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onModelChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] model listener threw`, e);
      }
    }
  }

  private applyCurrentTodoList(entries: AgentPlanEntry[]): boolean {
    const next: AgentTodoListEntry[] = entries.map((e) => ({
      content: e.content,
      status: e.status,
    }));
    const signature = next.length > 0 ? JSON.stringify(next) : null;
    if (signature === this.currentTodoListSignature) return false;
    this.currentTodoList = next.length > 0 ? next : null;
    this.currentTodoListSignature = signature;
    return true;
  }

  private notifyCurrentTodoListChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onCurrentTodoListChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] todo-list listener threw`, e);
      }
    }
  }

  private notifyCurrentPlanChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onCurrentPlanChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] plan listener threw`, e);
      }
    }
  }
}

function buildEmptyTurnMessage(backendId: BackendId, stopReason: StopReason): string {
  return `${backendId} finished the turn without returning any assistant text or tool activity (stop reason: ${stopReason}). Try again, or switch models if this repeats.`;
}

function formatPromptFailure(err: unknown): string {
  const base = err2String(err);
  const providerMessage = extractProviderErrorMessage(err);
  if (!providerMessage || base.includes(providerMessage)) return base;
  return `${base}\n${providerMessage}`;
}

function extractProviderErrorMessage(err: unknown): string | null {
  const found = findProviderErrorPayload(err, new Set<unknown>());
  if (!found) return null;
  const type = typeof found.type === "string" ? found.type : "ProviderError";
  const message = typeof found.message === "string" ? found.message : null;
  if (!message) return type;
  return `${type}: ${message}`;
}

function findProviderErrorPayload(
  value: unknown,
  seen: Set<unknown>
): { type?: unknown; message?: unknown } | null {
  if (value === null || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  const directError = record.error;
  if (directError && typeof directError === "object") {
    const errorRecord = directError as Record<string, unknown>;
    if (typeof errorRecord.message === "string" || typeof errorRecord.type === "string") {
      return { type: errorRecord.type, message: errorRecord.message };
    }
  }
  if (typeof record.message === "string") {
    const parsed = tryParseJsonObject(record.message);
    if (parsed) {
      const nested = findProviderErrorPayload(parsed, seen);
      if (nested) return nested;
    }
  }
  if (record.data) {
    const nested = findProviderErrorPayload(record.data, seen);
    if (nested) return nested;
  }
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      const nested = findProviderErrorPayload(item, seen);
      if (nested) return nested;
    }
  }
  const cause = record.cause;
  if (cause) return findProviderErrorPayload(cause, seen);
  return null;
}

function tryParseJsonObject(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type DisplayContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildUserDisplayContent(
  displayText: string,
  promptContent?: PromptContent[]
): DisplayContentItem[] | undefined {
  const images = (promptContent ?? []).filter(
    (p): p is Extract<PromptContent, { type: "image" }> => p.type === "image"
  );
  if (images.length === 0) return undefined;
  const content: DisplayContentItem[] = [];
  if (displayText.trim()) content.push({ type: "text", text: displayText });
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    });
  }
  return content;
}

function buildPromptBlocks(displayText: string, content?: PromptContent[]): PromptContent[] {
  return [{ type: "text", text: displayText }, ...(content ?? [])];
}

export function buildPromptContext(
  context?: MessageContext,
  webTabBlock?: string,
  projectContextBlock?: string | null,
  projectContextUpdatesBlock?: string | null
): NonNullable<PromptInput["context"]> {
  const materials: NonNullable<PromptInput["context"]>["materials"][number][] = [];
  const notes = buildContextEnvelope(context);
  if (notes)
    materials.push({
      origin: "note",
      text: notes,
      ...(context?.notes.length === 1 ? { sourcePath: context.notes[0]?.path } : {}),
    });
  const selections = buildWebSelectionBlocks(context);
  if (selections) materials.push({ origin: "web", text: selections });
  if (webTabBlock?.trim()) materials.push({ origin: "web", text: webTabBlock });
  const project = [projectContextBlock, projectContextUpdatesBlock].filter(Boolean).join("\n\n");
  return {
    materials,
    ...(project
      ? {
          project: {
            text: project,
            ...(!projectContextBlock && projectContextUpdatesBlock ? { updateOnly: true } : {}),
          },
        }
      : {}),
  };
}

export function withReadOnlyPreamble(blocks: PromptContent[]): PromptContent[] {
  const i = blocks.findIndex((b) => b.type === "text");
  if (i === -1) return [{ type: "text", text: FANOUT_READONLY_PREAMBLE }, ...blocks];
  const block = blocks[i] as Extract<PromptContent, { type: "text" }>;
  const out = blocks.slice();
  out[i] = { type: "text", text: `${FANOUT_READONLY_PREAMBLE}\n\n${block.text}` };
  return out;
}

async function serializeWebTabContext(context: MessageContext | undefined): Promise<string> {
  const webTabs = context?.webTabs;
  if (!webTabs || webTabs.length === 0) return "";
  return (await ContextProcessor.getInstance().processContextWebTabs(webTabs)).trim();
}

function buildWebSelectionBlocks(context: MessageContext | undefined): string | null {
  const selections = (context?.selectedTextContexts ?? []).filter(isWebSelectedTextContext);
  if (selections.length === 0) return null;
  return selections
    .map((s) =>
      [
        `<${WEB_SELECTED_TEXT_TAG}>`,
        `<title>${escapeXml(s.title)}</title>`,
        `<url>${escapeXml(s.url)}</url>`,
        `<content>\n${escapeXml(s.content)}\n</content>`,
        `</${WEB_SELECTED_TEXT_TAG}>`,
      ].join("\n")
    )
    .join("\n\n");
}

function buildContextEnvelope(context: MessageContext | undefined): string | null {
  if (!context) return null;
  const notePaths = (context.notes ?? []).map((n) => n.path).filter(Boolean);
  const excerpts = (context.selectedTextContexts ?? []).filter(isNoteSelectedTextContext);
  if (notePaths.length === 0 && excerpts.length === 0) return null;

  const lines: string[] = [
    "<vault-agent-context>",
    "The user attached the following vault items as context. The vault is your current working directory; open them if you need their contents.",
  ];
  if (notePaths.length > 0) {
    lines.push("", "Notes:");
    for (const p of notePaths) lines.push(`- ${p}`);
  }
  if (excerpts.length > 0) {
    lines.push("", "Selected excerpts (already inlined; no need to re-read):");
    for (const e of excerpts) {
      const location = e.startLine > 0 ? ` (lines ${e.startLine}-${e.endLine})` : "";
      lines.push(`- ${e.notePath}${location}:`);
      for (const l of e.content.split("\n")) lines.push(`  ${l}`);
    }
  }
  lines.push("</vault-agent-context>");
  return lines.join("\n");
}

function extractText(content: PromptContent): string {
  if (content.type === "text") return content.text;
  return "";
}

function toolCallToPart(
  call: ToolCallSnapshot & { sessionUpdate?: "tool_call" }
): AgentMessagePart {
  return {
    kind: "tool_call",
    id: call.toolCallId,
    title: call.title,
    toolKind: call.kind,
    status: call.status ?? "pending",
    input: call.rawInput,
    output: extractToolCallOutputs(call.content),
    locations: call.locations?.map((l) => ({ path: l.path, line: l.line ?? undefined })),
    vendorToolName: call.vendorToolName,
    mcpServer: call.mcpServer,
    parentToolCallId: call.parentToolCallId,
    progress: call.progress,
  };
}

export function tryReadExitPlanModeCall(args: {
  kind?: string;
  rawInput: unknown;
  isPlanProposal?: boolean;
}): { plan: string; planFilePath?: string } | null {
  const raw = args.rawInput as { plan?: unknown; planFilePath?: unknown } | null | undefined;
  const plan = raw?.plan;
  if (typeof plan !== "string") return null;
  if (!args.isPlanProposal && args.kind !== "switch_mode") return null;
  const planFilePath = typeof raw?.planFilePath === "string" ? raw.planFilePath : undefined;
  return { plan, planFilePath };
}

function derivePlanTitleFromMarkdown(md: string): string {
  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").slice(0, 80);
  }
  return t("agentInfra.session.planProposal");
}

function mergeToolCallUpdate(
  existing: AgentMessagePart | undefined,
  upd: ToolCallDelta & { sessionUpdate?: "tool_call_update" }
): AgentMessagePart {
  const base: AgentMessagePart =
    existing && existing.kind === "tool_call"
      ? existing
      : {
          kind: "tool_call",
          id: upd.toolCallId,
          title: upd.title ?? t("agentInfra.session.toolCall"),
          status: "pending",
        };
  if (base.kind !== "tool_call") return base;
  return {
    ...base,
    title: upd.title ?? base.title,
    toolKind: upd.kind ?? base.toolKind,
    status: upd.status ?? base.status,
    input: upd.rawInput !== undefined ? upd.rawInput : base.input,
    output:
      upd.content !== undefined && upd.content !== null
        ? extractToolCallOutputs(upd.content)
        : base.output,
    locations:
      upd.locations !== undefined && upd.locations !== null
        ? upd.locations.map((l) => ({ path: l.path, line: l.line ?? undefined }))
        : base.locations,
    vendorToolName: upd.vendorToolName ?? base.vendorToolName,
    mcpServer: upd.mcpServer ?? base.mcpServer,
    parentToolCallId: upd.parentToolCallId ?? base.parentToolCallId,
    progress: upd.progress === undefined ? base.progress : { ...base.progress, ...upd.progress },
  };
}

function extractToolCallOutputs(
  content: ToolCallContent[] | null | undefined
): AgentToolCallOutput[] | undefined {
  if (!content) return undefined;
  const outputs: AgentToolCallOutput[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text") {
      outputs.push(capToolOutputText(item.content.text));
    } else if (item.type === "diff") {
      outputs.push({
        type: "diff",
        path: item.path,
        oldText: item.oldText ?? null,
        newText: item.newText,
      });
    }
  }
  return outputs.length > 0 ? outputs : undefined;
}

function capToolOutputText(text: string): AgentToolCallOutput {
  if (text.length <= MAX_TOOL_OUTPUT_TEXT_CHARS) return { type: "text", text };
  const omitted = text.length - MAX_TOOL_OUTPUT_TEXT_CHARS;
  return {
    type: "text",
    text:
      text.slice(0, MAX_TOOL_OUTPUT_TEXT_CHARS) +
      `\n\n[Display trimmed: ${omitted.toLocaleString()} more characters. The agent received the full output.]`,
  };
}

function decisionFor(
  req: PermissionPrompt,
  kinds: ReadonlyArray<PermissionOptionKind>
): PermissionDecision {
  for (const k of kinds) {
    const opt = req.options.find((o) => o.kind === k);
    if (opt) return { outcome: { outcome: "selected", optionId: opt.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

function planToPart(plan: PlanSummary & { sessionUpdate?: "plan" }): AgentMessagePart {
  return {
    kind: "plan",
    entries: plan.entries.map((e) => ({
      content: e.content,
      priority: e.priority,
      status: e.status,
    })),
  };
}

function compactionToPart(update: CompactionSnapshot, startedAtMs: number): AgentMessagePart {
  return {
    kind: "compaction",
    id: update.id,
    status: update.status,
    trigger: update.trigger,
    error: update.error,
    preTokens: update.preTokens,
    postTokens: update.postTokens,
    startedAtMs,
  };
}

function historyTimestamp(occurredAt: number | undefined): FormattedDateTime | null {
  return occurredAt === undefined ? null : formatDateTime(new Date(occurredAt));
}
