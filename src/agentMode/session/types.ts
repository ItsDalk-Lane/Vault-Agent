import type { EffortOption } from "@/lib/model-effort";
import type React from "react";
import type { ModelCapability } from "@/constants";
import type { FormattedDateTime, MessageContext } from "@/types/message";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { PlanUsage } from "@/agentMode/session/planUsage";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";

export type { PlanUsage, UsageWindow } from "@/agentMode/session/planUsage";
import type { ProjectScopeId } from "./scope";

export type { BackendDescriptor, ModelSelectionSession } from "./descriptor";
import type { CurrentPlan } from "./plan";
export type { CurrentPlan, PlanDecisionAction, PlanProposalDecision } from "./plan";

export type BackendId = string;

export interface AgentBrand {
  readonly id: BackendId;
  readonly displayName: string;
  readonly Icon: React.ComponentType<{ className?: string }>;
}

export type SessionId = string;

export type VaultAgentMode = "default" | "plan" | "auto";

export interface ModeMapping {
  kind: "setMode" | "configOption";
  configId?: string;
  canonical: Partial<Record<VaultAgentMode, string>>;
  readOnlyModeId?: string | null;
}

export interface ModeOption {
  value: VaultAgentMode;
  label: string;
}

export type { EffortOption } from "@/lib/model-effort";

export { EFFORT_LEVELS_ASCENDING } from "@/lib/model-effort";

export interface ModelEntry {
  baseModelId: string;
  name: string;
  description?: string;
  provider: string | null;
  effortOptions: EffortOption[];
}

export interface BackendModelCatalog {
  availableModels: readonly ModelEntry[] | null;
}

export type EnabledModelCredentialState = "ok" | "missing_key";

export interface EnabledModelEntry {
  baseModelId: string;
  name: string;
  label?: string;
  description?: string;
  credentialState: EnabledModelCredentialState;
  capabilities?: ModelCapability[];
  effortOptions?: EffortOption[];
}

export interface ModelSelection {
  baseModelId: string;
  effort: string | null;
}

export interface ModelState {
  current: ModelSelection;
  availableModels: ModelEntry[];
  apply: ModelApplySpec;
}

export interface ModelWireCodec {
  encode(selection: ModelSelection): string;

  decode(wireId: string): { selection: ModelSelection; provider: string | null };
}

type ModeApplyStep =
  | { kind: "setMode"; nativeId: string }
  | { kind: "setConfigOption"; configId: string; value: string };

export type ModeApplySpec =
  | ModeApplyStep
  | { kind: "sequence"; steps: [ModeApplyStep, ...ModeApplyStep[]] };

export type ModelApplySpec =
  | { kind: "setModel" }
  | { kind: "setConfigOption"; configId: string; effortConfigId?: string };

export interface BackendState {
  readonly readOnly?: boolean;
  model: ModelState | null;

  mode: {
    current: VaultAgentMode | null;
    options: ModeOption[];
    apply: Partial<Record<VaultAgentMode, ModeApplySpec>>;
  } | null;
}

export interface BackendModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

export interface RawModelState {
  currentModelId: string;
  availableModels: BackendModelInfo[];
}

export interface BackendModeInfo {
  id: string;
  name: string;
  description?: string;
}

export interface RawModeState {
  currentModeId: string;
  availableModes: BackendModeInfo[];
}

export type BackendConfigOption =
  | {
      id: string;
      type: "select";
      name?: string;
      description?: string;
      category?: string | null;
      currentValue: string;
      options: Array<
        | { value: string; name: string; description?: string }
        | {
            name: string;
            description?: string;
            options: Array<{ value: string; name: string; description?: string }>;
          }
      >;
    }
  | {
      id: string;
      type: "boolean";
      name?: string;
      description?: string;
      category?: string | null;
      currentValue: boolean;
    };

export type PromptContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource_link"; uri: string; name?: string };

export type StopReason = "end_turn" | "cancelled" | "refusal" | "max_tokens" | "max_turn_requests";

export type AgentToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type AgentToolStatus = "pending" | "in_progress" | "completed" | "failed" | "interrupted";

export type AgentToolCallOutput =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string | null; newText: string };

export interface AgentPlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export interface AgentTodoListEntry {
  content: string;
  status: AgentPlanEntry["status"];
}

export interface AgentToolProgress {
  description?: string;
  toolName?: string;
  toolUses?: number;
  durationMs?: number;
  totalTokens?: number;
}

export interface ToolCallSnapshot {
  toolCallId: string;
  title: string;
  kind?: AgentToolKind;
  status?: AgentToolStatus;
  rawInput?: unknown;
  content?: ToolCallContent[];
  locations?: Array<{ path: string; line?: number | null }>;
  vendorToolName?: string;
  mcpServer?: string;
  parentToolCallId?: string;
  progress?: AgentToolProgress;
  isPlanProposal?: boolean;
}

export interface ToolCallDelta {
  toolCallId: string;
  title?: string;
  kind?: AgentToolKind;
  status?: AgentToolStatus;
  rawInput?: unknown;
  originalFiles?: Readonly<Record<string, string | null>>;
  content?: ToolCallContent[] | null;
  locations?: Array<{ path: string; line?: number | null }> | null;
  vendorToolName?: string;
  mcpServer?: string;
  parentToolCallId?: string;
  progress?: AgentToolProgress;
  isPlanProposal?: boolean;
}

export type ToolCallContent =
  | { type: "content"; content: { type: "text"; text: string } }
  | { type: "diff"; path: string; oldText?: string | null; newText: string };

export interface PlanSummary {
  entries: AgentPlanEntry[];
}

export type CompactionStatus = "in_progress" | "completed" | "failed" | "cancelled" | "skipped";

export type CompactionTrigger = "manual" | "auto";

export interface CompactionSnapshot {
  id: string;
  status: CompactionStatus;
  trigger: CompactionTrigger;
  error?: string;
  preTokens?: number;
  postTokens?: number;
}

// Durable domain events are vendor-agnostic facts that the UI can replay and restore:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface StreamCursor {
  readonly streamEpoch: string;
  readonly frameIndex: number;
}

export type RunStatus =
  | "idle"
  | "accepting"
  | "running"
  | "awaiting_permission"
  | "awaiting_question"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "paused_budget"
  | "paused_user"
  | "paused_stalled"
  | "failed"
  | "interrupted"
  | "unknown";

export interface RunStateUpdate {
  runId: string;
  requestId: string;
  status: RunStatus;
  startedAtMs: number;
  endedAtMs?: number;
  stopCode?: string;
  cancelEpoch: number;
  modelAttempts?: number | null;
  toolAttempts?: number | null;
}

export function isRunSuccessful(status: RunStatus): boolean {
  return status === "completed";
}

// Loading follows the run, not one turn: only a terminal run may close the turn's loading state.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export function isRunTerminal(status: RunStatus): boolean {
  return (
    status === "completed" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "paused_budget" ||
    status === "paused_user" ||
    status === "paused_stalled" ||
    status === "interrupted"
  );
}

export type UsageSource = "provider" | "local_budget" | "unavailable" | "unknown";

export interface BudgetUpdate {
  source: UsageSource;
  usage: SessionUsage | null;
  requestLimit?: number | null;
  tokenLimit?: number | null;
  costLimitUsd?: number | null;
  updatedAt: number;
}

export type ApprovalStateName =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "consumed"
  | "unknown";

export interface ApprovalStateUpdate {
  requestId: string;
  state: ApprovalStateName;
  toolCall: ToolCallSnapshot;
  options: readonly PermissionOption[];
  decision?: PermissionDecision;
}

export type RecoveryStatus =
  | "pausing"
  | "none"
  | "available"
  | "interrupted"
  | "read_only"
  | "storage_failed"
  | "unknown";

export interface RecoveryStateUpdate {
  status: RecoveryStatus;
  continuationAvailable?: boolean;
  reloadAvailable?: boolean;
  interruptedRun?: RunStateUpdate;
  pendingPermissionIds: readonly string[];
  pendingQuestionIds: readonly string[];
  pendingMutationIds: readonly string[];
  crashLoopTripped: boolean;
  message?: string;
}

export interface SessionTodoItem {
  id: string;
  text: string;
  status: AgentPlanEntry["status"];
  priority: AgentPlanEntry["priority"];
}

export interface SessionTodoUpdate {
  revision: number;
  items: readonly SessionTodoItem[];
}

export interface SessionProjectionPending {
  permissions: readonly PermissionPrompt[];
  questions: readonly AskUserQuestionPrompt[];
  plan: CurrentPlan | null;
  recovery: RecoveryStateUpdate | null;
}

export interface SessionProjection {
  activeBackgroundTaskIds?: readonly string[];
  cursor: StreamCursor;
  mode: "replace" | "prepend";
  messages: readonly AgentChatMessage[];
  pending: SessionProjectionPending;
}

export type SessionUpdate =
  | { sessionUpdate: "user_message_chunk"; content: PromptContent; messageId?: string }
  | { sessionUpdate: "agent_message_chunk"; content: PromptContent; messageId?: string }
  | { sessionUpdate: "agent_thought_chunk"; content: PromptContent; messageId?: string }
  | ({ sessionUpdate: "tool_call" } & ToolCallSnapshot)
  | ({ sessionUpdate: "tool_call_update" } & ToolCallDelta)
  | { sessionUpdate: "plan"; entries: AgentPlanEntry[] }
  | ({ sessionUpdate: "compaction" } & CompactionSnapshot)
  | { sessionUpdate: "session_info_update"; title?: string | null }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: "config_option_update"; configOptions: BackendConfigOption[] }
  | { sessionUpdate: "state_changed"; state: BackendState }
  | { sessionUpdate: "usage_update"; usage: SessionUsage }
  | { sessionUpdate: "plan_usage_update"; planUsage: PlanUsage | null }
  | { sessionUpdate: "feedback_offer"; offer: FeedbackOffer | null }
  | { sessionUpdate: "session_projection"; projection: SessionProjection }
  | { sessionUpdate: "todo_update"; todo: SessionTodoUpdate }
  | { sessionUpdate: "plan_proposal_update"; plan: CurrentPlan }
  | { sessionUpdate: "approval_state"; approval: ApprovalStateUpdate }
  | { sessionUpdate: "recovery_state"; recovery: RecoveryStateUpdate }
  | { sessionUpdate: "run_state"; run: RunStateUpdate }
  | { sessionUpdate: "budget_update"; budget: BudgetUpdate };

export interface SessionUsage {
  usedTokens: number;
  contextWindow?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  updatedAt: number;
}

/** 一轮（一个 run）的用量与计时汇总，逐段累加自持久化的 pi.assistant / pi.tool-result 记录；旧日志缺计时字段时对应项缺省。
 * https://github.com/ItsDalk-Lane/Vault-Agent/issues/11
 */
export interface TurnUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  modelRequests: number;
  modelDurationMs?: number;
  toolDurationMs?: number;
  ttftMs?: number;
  modelId?: string | null;
}

export interface SessionEvent {
  sessionId: SessionId;
  update: SessionUpdate;
  occurredAt?: number;
}

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export const PERMISSION_OPTION_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
  "reject_once",
  "reject_always",
];

export const PERMISSION_ALLOW_KINDS: readonly PermissionOptionKind[] = [
  "allow_once",
  "allow_always",
];

export const PERMISSION_REJECT_KINDS: readonly PermissionOptionKind[] = [
  "reject_once",
  "reject_always",
];

export interface PermissionOption {
  optionId: string;
  name: string;
  description?: string;
  kind: PermissionOptionKind;
}

export interface PermissionPrompt {
  sessionId: SessionId;
  toolCall: ToolCallSnapshot;
  options: PermissionOption[];
  binding?: {
    toolId: string;
    schemaHash: string;
    targets: readonly string[];
    beforeHash?: string;
    scopeVersion: number;
    policyVersion: number;
  };
  signal?: AbortSignal;
}

export interface PermissionDecision {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
  denyMessage?: string;
}

export interface AgentQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  answerKey?: string;
  allowOther?: boolean;
}

export type AgentQuestionAnswers = { [answerKey: string]: string };

export interface AskUserQuestionPrompt {
  sessionId: SessionId;
  requestId: string;
  questions: AgentQuestion[];
  signal?: AbortSignal;
}

export interface AgentMcpServer {
  name: string;
  url: string;
  headers: Readonly<Record<string, string>>;
}

export interface OpenSessionInput {
  signal?: AbortSignal;
  // 多模型恢复复用同一子会话，避免重开后重复创建工作。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  sessionId?: SessionId;
  // 子会话继承父运行预算与只读边界，恢复后也不能另领额度。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  parentSessionId?: SessionId;
  parentRunId?: string;
  readOnly?: boolean;
  cwd: string;
  projectId?: ProjectScopeId;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
}

export interface OpenSessionOutput {
  sessionId: SessionId;
  state: BackendState;
}

export interface ResumeSessionInput {
  sessionId: SessionId;
  cwd: string;
  projectId?: ProjectScopeId;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
}

export type ResumeSessionOutput = OpenSessionOutput;

export interface LoadSessionInput {
  sessionId: SessionId;
  cwd: string;
  projectId?: ProjectScopeId;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
}

export type LoadSessionOutput = OpenSessionOutput;

export interface PromptInput {
  sessionId: SessionId;
  // 相同请求在重开后仍有同一标识，避免重复提交和计费。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  requestId?: string;
  prompt: PromptContent[];
  context?: PromptContext;
}

export const PROMPT_CONTEXT_MAX_BYTES = 128 * 1024;

export interface PromptContext {
  readonly project?: {
    readonly text: string;
    readonly sourcePath?: string;
    readonly updateOnly?: boolean;
  };
  readonly materials: readonly {
    readonly origin: "note" | "web" | "mcp" | "subagent";
    readonly text: string;
    readonly sourcePath?: string;
    readonly url?: string;
    readonly explicitlyImported?: boolean;
    readonly capturedAtMs?: number;
  }[];
}

export interface PromptOutput {
  stopReason: StopReason;
  handledLocally?: boolean;
  turnDiff?: TurnDiff;
}

export interface TurnDiff {
  root: string;
  unifiedDiff: string;
}

export interface ListSessionsInput {
  cwd?: string;
}

export interface ListedSessionInfo {
  sessionId: SessionId;
  cwd: string;
  title?: string | null;
  updatedAt?: string | null;
  createdAtMs?: number;
  lastAccessedAtMs?: number;
  pinnedAt?: number;
  projectId?: ProjectScopeId;
  titleSource?: "user" | "agent";
}

export interface UpdateSessionMetadataInput {
  sessionId: SessionId;
  titleSource?: "user" | "agent";
  title?: string;
  pinnedAt?: number | null;
  lastAccessedAtMs?: number;
}

export interface LocalStoragePaths {
  dataRoot: string;
  vaultStoreRoot: string;
  sessionsRoot: string;
  indexPath: string;
  deletionsRoot: string;
  logsRoot: string;
  tempRoot: string;
}

export interface ListSessionsOutput {
  sessions: ListedSessionInfo[];
}

export interface CancelInput {
  sessionId: SessionId;
}

export type SessionUpdateHandler = (event: SessionEvent) => void;

export interface SessionExportOutput {
  suggestedName: string;
  content: string;
  attachments?: readonly { name: string; content: Uint8Array }[];
}

export interface BackendProcess {
  start?(): Promise<void>;
  getModelCatalog(): BackendModelCatalog;
  isRunning(): boolean;
  onExit(listener: () => void): () => void;
  setPermissionPrompter(fn: (req: PermissionPrompt) => Promise<PermissionDecision>): void;
  setUnhealthyHandler?(fn: () => void): void;
  setAskUserQuestionPrompter?(
    fn: (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>
  ): void;
  setReadOnlySessionPredicate?(fn: (sessionId: SessionId) => boolean): void;
  setFeedbackStatus?(input: {
    sessionId: SessionId;
    offerId: string;
    status: "dismissed" | "reported";
  }): Promise<void>;
  setFeedbackEnabled?(input: { sessionId: SessionId; enabled: boolean }): Promise<void>;
  exportSession?(input: {
    sessionId: SessionId;
    format: "json" | "markdown";
  }): Promise<SessionExportOutput>;
  readContextWindow?(wireModelId: string | null | undefined): Promise<number | null>;
  setSessionObserved?(input: { sessionId: SessionId; observed: boolean }): void;
  readSubagentHistory?(input: {
    sessionId: SessionId;
    conversationId: string;
  }): Promise<readonly AgentChatMessage[]>;
  // prompt/context 让排队消息能带着图片和资料插入进行中的轮次：https://github.com/ItsDalk-Lane/Vault-Agent/issues/16
  steerSession?(input: {
    sessionId: SessionId;
    requestId: string;
    text: string;
    prompt?: PromptContent[];
    context?: PromptContext;
  }): Promise<void>;
  pauseSession?(input: { sessionId: SessionId }): Promise<void>;
  recoverSession?(input: {
    sessionId: SessionId;
    action: "continue" | "abort" | "reconcile";
  }): Promise<void>;
  recordFanoutTurn?(input: { sessionId: SessionId; turn: FanoutTurn }): Promise<void>;
  rolloverSession?(input: { sessionId: SessionId }): Promise<OpenSessionOutput>;
  decidePermission?(input: {
    sessionId: SessionId;
    requestId: string;
    decision: PermissionDecision;
  }): Promise<void>;
  answerPendingQuestion?(input: {
    sessionId: SessionId;
    requestId: string;
    answers: AgentQuestionAnswers;
  }): Promise<void>;
  decidePendingPlan?(input: {
    sessionId: SessionId;
    planId: string;
    revision: number;
    action: "approve" | "reject" | "feedback";
    feedback?: string;
  }): Promise<void>;
  revertFileChange?(input: {
    sessionId: SessionId;
    operationIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<FileChangeRevertResult>;
  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void;
  newSession(params: OpenSessionInput): Promise<OpenSessionOutput>;
  prompt(params: PromptInput): Promise<PromptOutput>;
  cancel(params: CancelInput): Promise<void>;
  closeSession?(params: { sessionId: SessionId }): Promise<void>;
  deleteSession?(params: { sessionId: SessionId }): Promise<void>;
  /** atEntryId 存在时为逐轮分叉：只复制该轮终态 va.run 条目为止的前缀。https://github.com/ItsDalk-Lane/Vault-Agent/issues/12 */
  forkSession?(params: { sessionId: SessionId; atEntryId?: string }): Promise<OpenSessionOutput>;
  updateSessionMetadata?(params: UpdateSessionMetadataInput): Promise<ListedSessionInfo>;
  getLocalStoragePaths?(): LocalStoragePaths;
  writeSessionDiagnostic?(input: {
    sessionId: SessionId;
    name: string;
    content: Uint8Array;
  }): Promise<{ zipDir: string; zipPath: string }>;
  subscribeStorageChanges?(listener: () => void): () => void;
  setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState>;
  isSetSessionModelSupported(): boolean | null;
  setSessionMode(params: { sessionId: SessionId; modeId: string }): Promise<BackendState>;
  isSetSessionModeSupported(): boolean | null;
  setSessionConfigOption(params: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<BackendState>;
  isSetSessionConfigOptionSupported(): boolean | null;
  listSessions(params: ListSessionsInput): Promise<ListSessionsOutput>;
  resumeSession(params: ResumeSessionInput): Promise<ResumeSessionOutput>;
  loadSession(params: LoadSessionInput): Promise<LoadSessionOutput>;
  sessionExistsLocally?(params: { sessionId: SessionId; cwd: string }): Promise<boolean>;
  shutdown(): Promise<void>;
}

export type AgentMessagePart =
  | {
      kind: "tool_call";
      id: string;
      title: string;
      toolKind?: AgentToolKind;
      status: AgentToolStatus;
      userResponse?: string;
      input?: unknown;
      output?: AgentToolCallOutput[];
      locations?: { path: string; line?: number }[];
      vendorToolName?: string;
      mcpServer?: string;
      parentToolCallId?: string;
      progress?: AgentToolProgress;
    }
  | {
      kind: "thought";
      text: string;
      startedAtMs?: number;
      durationMs?: number;
    }
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "plan";
      entries: AgentPlanEntry[];
    }
  | ({ kind: "compaction"; startedAtMs: number } & CompactionSnapshot);

export interface AgentChatMessage {
  id: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  isErrorMessage?: boolean;
  isAuxiliary?: boolean;
  message: string;
  parts?: AgentMessagePart[];
  context?: MessageContext;
  content?: unknown[];
  turnStopReason?: StopReason;
  turnDurationMs?: number;
  /** 该轮的用量与计时汇总；仅完成的 run 消息携带。https://github.com/ItsDalk-Lane/Vault-Agent/issues/11 */
  turnUsage?: TurnUsageSummary;
  /** 该轮终态 va.run 的条目 id（唯一），用于逐轮分支定位；va.run 的 runId 是工作目标标识、跨轮复用，不能当轮锚点。https://github.com/ItsDalk-Lane/Vault-Agent/issues/12 */
  turnEndEntryId?: string;
  fanout?: FanoutTurn;
  fileChanges?: TurnFileChange[];
}

export interface TurnFileChange {
  path: string;
  status: "modified" | "created" | "deleted";
  before: string | null;
  after: string | null;
  additions: number;
  deletions: number;
  mutationOperationIds?: readonly string[];
}

export interface FileChangeRevertResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

export type NewAgentChatMessage = Omit<AgentChatMessage, "id"> & { id?: string };
