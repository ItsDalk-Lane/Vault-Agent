import type { MessageContext } from "@/types/message";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import type {
  AgentChatMessage,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendId,
  BackendState,
  CurrentPlan,
  PermissionPrompt,
  PlanDecisionAction,
  PromptContent,
  RecoveryStateUpdate,
  PlanUsage,
  SessionUsage,
  TurnFileChange,
  FileChangeRevertResult,
} from "./types";

export interface AgentChatBackend {
  subscribe(listener: () => void): () => void;
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>
  ): { id: string; turn: Promise<void> };
  cancel(): Promise<void>;
  pause?(): Promise<void>;
  canSteer?(): boolean;
  steerMessage?(text: string): Promise<void>;
  resumeFanout?(messageId: string): Promise<void>;
  readSubagentHistory?(conversationId: string): Promise<readonly AgentChatMessage[]>;
  getRecoveryState?(): RecoveryStateUpdate | null;
  recoverSession?(action: "continue" | "abort" | "reconcile"): Promise<void>;
  revertFileChange?(change: TurnFileChange): Promise<FileChangeRevertResult>;
  deleteMessage(id: string): Promise<boolean>;
  clearMessages(): void;
  getMessages(): AgentChatMessage[];

  isStarting(): boolean;
  isTurnInFlight(): boolean;
  getActiveBackgroundTaskCount?(): number;

  getBackendState(): BackendState | null;
  canSwitchModel(): boolean | null;
  canSwitchEffort(): boolean | null;
  canSwitchMode(): boolean | null;

  resolvePlanProposal(
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string
  ): Promise<void>;

  getCurrentPlan(): CurrentPlan | null;

  getCurrentTodoList(): AgentTodoListEntry[] | null;

  getSessionUsage(): SessionUsage | null;

  getPlanUsage(): PlanUsage | null;

  hasPendingPlanPermission(): boolean;

  getPendingToolPermissions(): PermissionPrompt[];

  resolveToolPermission(toolCallId: string, optionId: string): void;

  getPendingAskUserQuestions(): AskUserQuestionPrompt[];

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void;

  getFeedbackOffer(): FeedbackOffer | null;

  dismissFeedbackOffer(): void;

  markFeedbackReported(report: { reportId: string; issueUrl: string }): void;
}
