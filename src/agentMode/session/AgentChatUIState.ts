import { logError, logWarn } from "@/logger";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSession } from "@/agentMode/session/AgentSession";
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
} from "@/agentMode/session/types";
import type { MessageContext } from "@/types/message";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";

export class AgentChatUIState implements AgentChatBackend {
  private listeners = new Set<() => void>();
  private currentTurn: Promise<unknown> | null = null;

  constructor(private readonly session: AgentSession) {
    this.session.subscribe({
      onMessagesChanged: () => this.notifyListeners(),
      onStatusChanged: () => this.notifyListeners(),
      onModelChanged: () => this.notifyListeners(),
      onCurrentPlanChanged: () => this.notifyListeners(),
      onCurrentTodoListChanged: () => this.notifyListeners(),
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logWarn("[AgentChatUIState] listener threw", e);
      }
    }
  }

  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[],
    mentionedAgents?: ReadonlyArray<BackendId>
  ): { id: string; turn: Promise<void> } {
    const { userMessageId, turn } = this.session.sendPrompt(
      text,
      context,
      promptContent,
      mentionedAgents
    );
    this.notifyListeners();
    const wrapped = turn.then(
      () => undefined,
      (err) => {
        logError("[AgentMode] turn failed", err);
      }
    );
    this.currentTurn = turn;
    return { id: userMessageId, turn: wrapped };
  }

  canSteer(): boolean {
    return this.session.canSteer();
  }

  async steerMessage(text: string): Promise<void> {
    await this.session.steerPrompt(text);
    this.notifyListeners();
  }

  async resumeFanout(messageId: string): Promise<void> {
    const turn = this.session.resumeFanout(messageId);
    this.currentTurn = turn;
    await turn;
  }

  async readSubagentHistory(conversationId: string): Promise<readonly AgentChatMessage[]> {
    return this.session.readSubagentHistory(conversationId);
  }

  getRecoveryState(): RecoveryStateUpdate | null {
    return this.session.getRecoveryState();
  }

  async recoverSession(action: "continue" | "abort" | "reconcile"): Promise<void> {
    await this.session.recoverSession(action);
  }

  async revertFileChange(change: TurnFileChange): Promise<FileChangeRevertResult> {
    return this.session.revertFileChange(change);
  }

  async pause(): Promise<void> {
    await this.session.pause();
  }

  async cancel(): Promise<void> {
    await this.session.cancel();
  }

  async deleteMessage(id: string): Promise<boolean> {
    const status = this.session.getStatus();
    if (status === "running" || status === "awaiting_permission") {
      logWarn("[AgentChatUIState] delete refused while turn is in flight");
      return false;
    }
    const ok = this.session.store.deleteMessage(id);
    if (ok) this.notifyListeners();
    return ok;
  }

  clearMessages(): void {
    this.session.store.clear();
    this.notifyListeners();
  }

  getMessages(): AgentChatMessage[] {
    return this.session.store.getDisplayMessages();
  }

  isStarting(): boolean {
    return this.session.getStatus() === "starting";
  }

  getActiveBackgroundTaskCount(): number {
    return this.session.getActiveBackgroundTaskCount();
  }

  isTurnInFlight(): boolean {
    const status = this.session.getStatus();
    // A plan decision can resume a turn after the composer has cleared its own
    // loading flag, so the session remains the authority for active work.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/41
    return status === "running" || status === "awaiting_permission";
  }

  getBackendState(): BackendState | null {
    return this.session.getState();
  }

  canSwitchModel(): boolean | null {
    return this.session.canSwitchModel();
  }

  canSwitchEffort(): boolean | null {
    return this.session.canSwitchEffort();
  }

  canSwitchMode(): boolean | null {
    return this.session.canSwitchMode();
  }

  hasPendingPlanPermission(): boolean {
    return this.session.hasPendingPlanPermission();
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    return this.session.getPendingToolPermissions();
  }

  resolveToolPermission(toolCallId: string, optionId: string): void {
    void this.session
      .resolveToolPermission(toolCallId, optionId)
      .catch((error) => logWarn("[AgentChatUIState] approval could not be saved", error));
    this.notifyListeners();
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    return this.session.getPendingAskUserQuestions();
  }

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void {
    void this.session
      .resolveAskUserQuestion(requestId, answers)
      .catch((error) => logWarn("[AgentChatUIState] answer could not be saved", error));
    this.notifyListeners();
  }

  getCurrentPlan(): CurrentPlan | null {
    return this.session.getCurrentPlan();
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return this.session.getCurrentTodoList();
  }

  getFeedbackOffer(): FeedbackOffer | null {
    return this.session.getFeedbackOffer();
  }

  dismissFeedbackOffer(): void {
    this.session.dismissFeedbackOffer();
  }

  markFeedbackReported(report: { reportId: string; issueUrl: string }): void {
    this.session.markFeedbackReported(report);
  }

  getSessionUsage(): SessionUsage | null {
    return this.session.getSessionUsage();
  }

  getPlanUsage(): PlanUsage | null {
    return this.session.getPlanUsage();
  }

  async resolvePlanProposal(
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string
  ): Promise<void> {
    const plan = this.session.getCurrentPlan();
    if (!plan || plan.id !== proposalId || plan.decision !== "pending") return;
    if (!plan.permissionGated || !plan.pendingToolCallId) {
      logWarn("[AgentChatUIState] non-gated plan card has no resolution path");
      return;
    }
    // 等待计划确认请求到达，避免提前隐藏卡片而留下未回答的请求。https://github.com/Brevilabs/obsidian-copilot-private/issues/551
    if (!this.session.hasPendingPlanPermission()) return;
    const trimmedFeedback = decision === "feedback" ? feedbackText?.trim() : undefined;
    await this.session.resolvePlanProposalPermission(
      plan.pendingToolCallId,
      decision === "approve",
      trimmedFeedback
    );
    this.session.finalizePlanDecision(plan.id, decision, trimmedFeedback);
    this.notifyListeners();
  }
}
