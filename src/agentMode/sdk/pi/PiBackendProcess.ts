import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import { logWarn } from "@/logger";
import { PiRuntime, type PiHostOptions } from "@/agentMode/sdk/pi/runtime/PiRuntime";
import type { LegacyChatEntry } from "@/agentMode/session/legacy/LegacyHistoryReader";
import type {
  AgentQuestionAnswers,
  AgentChatMessage,
  AskUserQuestionPrompt,
  BackendProcess,
  BackendState,
  CancelInput,
  ListSessionsInput,
  ListSessionsOutput,
  LoadSessionInput,
  LoadSessionOutput,
  OpenSessionInput,
  OpenSessionOutput,
  PermissionDecision,
  PermissionPrompt,
  PromptInput,
  PromptOutput,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionId,
  SessionUpdateHandler,
  FileChangeRevertResult,
} from "@/agentMode/session/types";

export interface PiBackendProcessOptions {
  host: PiHostOptions;
}

export class PiRuntimeNotReadyError extends Error {
  readonly code = "PI_RUNTIME_NOT_READY";
  readonly method: string;

  constructor(method: string, reason: string) {
    super(`Pi runtime is not ready for ${method}: ${reason}.`);
    this.name = "PiRuntimeNotReadyError";
    this.method = method;
  }
}

export class PiBackendProcess implements BackendProcess {
  private started = false;
  private closed = false;
  private readonly host: PiHostOptions;
  private runtime: PiRuntime | null = null;
  private readonly sessionHandlers = new Map<SessionId, SessionUpdateHandler>();
  private readonly observedSessions = new Set<SessionId>();
  private readonly exitListeners = new Set<() => void>();
  private permissionPrompter: ((request: PermissionPrompt) => Promise<PermissionDecision>) | null =
    null;
  private askUserQuestionPrompter:
    | ((request: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>)
    | null = null;
  private unhealthyHandler: (() => void) | null = null;
  private readOnlySessionPredicate: ((sessionId: SessionId) => boolean) | null = null;

  constructor(options: PiBackendProcessOptions) {
    this.host = options.host;
  }

  isRuntimeReady(): boolean {
    return !this.closed && this.runtime !== null;
  }

  async start(): Promise<void> {
    if (this.closed) throw new PiRuntimeNotReadyError("start", "the process is closed");
    if (!this.runtime) {
      this.runtime = new PiRuntime(this.host, {
        emit: (event) => this.sessionHandlers.get(event.sessionId)?.(event),
        permission: (request) =>
          this.permissionPrompter?.(request) ??
          Promise.resolve({ outcome: { outcome: "cancelled" } }),
        ask: (request) => this.askUserQuestionPrompter?.(request) ?? Promise.resolve({}),
        readOnly: (id) => this.readOnlySessionPredicate?.(id) ?? false,
      });
      for (const sessionId of this.observedSessions) this.runtime.observe(sessionId, true);
    }
    this.assertReady("start");
    this.started = true;
  }

  isRunning(): boolean {
    return this.started && this.isRuntimeReady();
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  setPermissionPrompter(fn: (request: PermissionPrompt) => Promise<PermissionDecision>): void {
    this.permissionPrompter = fn;
  }

  setUnhealthyHandler(fn: () => void): void {
    this.unhealthyHandler = fn;
  }

  setAskUserQuestionPrompter(
    fn: (request: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>
  ): void {
    this.askUserQuestionPrompter = fn;
  }

  setReadOnlySessionPredicate(fn: (sessionId: SessionId) => boolean): void {
    this.readOnlySessionPredicate = fn;
  }

  setSessionObserved({ sessionId, observed }: { sessionId: SessionId; observed: boolean }): void {
    if (this.closed) return;
    if (observed) this.observedSessions.add(sessionId);
    else this.observedSessions.delete(sessionId);
    this.runtime?.observe(sessionId, observed);
  }

  registerSessionHandler(sessionId: SessionId, handler: SessionUpdateHandler): () => void {
    this.sessionHandlers.set(sessionId, handler);
    // 后台聊天也保留事件订阅；只有真实可见性才能占用运行时名额，否则第三个聊天会一直等待。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (this.runtime)
      void this.runtime.replay(sessionId).catch((error) => {
        logWarn("[PiBackendProcess] history replay failed", error);
        this.notifyUnhealthy();
      });
    return () => {
      if (this.sessionHandlers.get(sessionId) === handler) {
        this.sessionHandlers.delete(sessionId);
      }
    };
  }

  async newSession(params: OpenSessionInput): Promise<OpenSessionOutput> {
    this.assertReady("newSession");
    return this.runtime!.open(params);
  }

  async prompt(params: PromptInput): Promise<PromptOutput> {
    this.assertReady("prompt");
    return this.runtime!.prompt(params);
  }

  async steerSession(params: {
    sessionId: string;
    requestId: string;
    text: string;
  }): Promise<void> {
    this.assertReady("steerSession");
    await this.runtime!.steer(params);
  }

  async pauseSession(params: { sessionId: string }): Promise<void> {
    this.assertReady("pauseSession");
    await this.runtime!.pause(params.sessionId);
  }

  async cancel(params: CancelInput): Promise<void> {
    this.assertReady("cancel");
    return this.runtime!.cancel(params.sessionId);
  }

  async closeSession(params: { sessionId: SessionId }): Promise<void> {
    this.assertReady("closeSession");
    return this.runtime!.close(params.sessionId);
  }

  async setSessionModel(params: { sessionId: SessionId; modelId: string }): Promise<BackendState> {
    this.assertReady("setSessionModel");
    return this.runtime!.setModel(params.sessionId, params.modelId);
  }

  isSetSessionModelSupported(): boolean | null {
    return true;
  }

  async setSessionMode(params: { sessionId: SessionId; modeId: string }): Promise<BackendState> {
    this.assertReady("setSessionMode");
    return this.runtime!.setMode(params.sessionId, params.modeId);
  }

  isSetSessionModeSupported(): boolean | null {
    return true;
  }

  async setSessionConfigOption(params: {
    sessionId: SessionId;
    configId: string;
    value: string;
  }): Promise<BackendState> {
    this.assertReady("setSessionConfigOption");
    return this.runtime!.setConfig(params.sessionId, params.configId, params.value);
  }

  isSetSessionConfigOptionSupported(): boolean | null {
    return true;
  }

  async listSessions(params: ListSessionsInput): Promise<ListSessionsOutput> {
    this.assertReady("listSessions");
    return { sessions: await this.runtime!.list(params.cwd) };
  }

  async resumeSession(params: ResumeSessionInput): Promise<ResumeSessionOutput> {
    this.assertReady("resumeSession");
    return this.runtime!.load(params.sessionId, params.cwd);
  }

  async recoverSession(params: {
    sessionId: SessionId;
    action: "continue" | "abort" | "reconcile";
  }): Promise<void> {
    this.assertReady("recoverSession");
    await this.runtime!.recoverSession(params);
  }

  async rolloverSession(params: { sessionId: SessionId }): Promise<OpenSessionOutput> {
    this.assertReady("rolloverSession");
    return this.runtime!.rolloverSession(params);
  }

  async decidePermission(params: {
    sessionId: SessionId;
    requestId: string;
    decision: PermissionDecision;
  }): Promise<void> {
    this.assertReady("decidePermission");
    await this.runtime!.decidePermission(params);
  }

  async answerPendingQuestion(params: {
    sessionId: SessionId;
    requestId: string;
    answers: AgentQuestionAnswers;
  }): Promise<void> {
    this.assertReady("answerPendingQuestion");
    await this.runtime!.answerPendingQuestion(params);
  }

  async decidePendingPlan(params: {
    sessionId: SessionId;
    planId: string;
    revision: number;
    action: "approve" | "reject" | "feedback";
    feedback?: string;
  }): Promise<void> {
    this.assertReady("decidePendingPlan");
    await this.runtime!.decidePendingPlan(params);
  }

  async revertFileChange(params: {
    sessionId: SessionId;
    operationIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<FileChangeRevertResult> {
    this.assertReady("revertFileChange");
    return this.runtime!.revertFileChange(params);
  }

  async loadSession(params: LoadSessionInput): Promise<LoadSessionOutput> {
    this.assertReady("loadSession");
    return this.runtime!.load(params.sessionId, params.cwd);
  }

  async sessionExistsLocally(params: { sessionId: SessionId; cwd: string }): Promise<boolean> {
    this.assertReady("sessionExistsLocally");
    return this.runtime!.exists(params.sessionId);
  }

  async setFeedbackStatus(params: {
    sessionId: SessionId;
    offerId: string;
    status: "dismissed" | "reported";
  }): Promise<void> {
    this.assertReady("setFeedbackStatus");
    await this.runtime!.setFeedbackStatus(params.sessionId, params.offerId, params.status);
  }

  async readSubagentHistory(input: {
    sessionId: SessionId;
    conversationId: string;
  }): Promise<readonly AgentChatMessage[]> {
    this.assertReady("readSubagentHistory");
    return this.runtime!.readSubagentHistory(input.sessionId, input.conversationId);
  }

  async setFeedbackEnabled(params: { sessionId: SessionId; enabled: boolean }): Promise<void> {
    this.assertReady("setFeedbackEnabled");
    await this.runtime!.setFeedbackEnabled(params.sessionId, params.enabled);
  }

  async importLegacySession(input: {
    cwd: string;
    entry: LegacyChatEntry;
  }): Promise<OpenSessionOutput & { notices: readonly string[] }> {
    this.assertReady("importLegacySession");
    return this.runtime!.importLegacySession(input);
  }

  async exportSession(input: {
    sessionId: SessionId;
    format: "json" | "markdown";
    legacy?: LegacyChatEntry;
  }): Promise<{ suggestedName: string; content: string }> {
    this.assertReady("exportSession");
    return this.runtime!.exportSession(input);
  }

  async recordFanoutTurn(input: { sessionId: SessionId; turn: FanoutTurn }): Promise<void> {
    this.assertReady("recordFanoutTurn");
    await this.runtime!.recordFanoutTurn(input);
  }

  async importSessionBackup(input: {
    cwd: string;
    content: string;
  }): Promise<OpenSessionOutput & { notices: readonly string[] }> {
    this.assertReady("importSessionBackup");
    return this.runtime!.importSessionBackup(input);
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.started = false;
    this.sessionHandlers.clear();
    this.observedSessions.clear();
    this.permissionPrompter = null;
    this.askUserQuestionPrompter = null;
    this.readOnlySessionPredicate = null;

    let failure: unknown = null;
    if (this.runtime) {
      try {
        await this.runtime.shutdown();
      } catch (error) {
        failure = error;
      }
      this.runtime = null;
    }
    if (failure) {
      this.notifyUnhealthy();
      this.unhealthyHandler = null;
      throw failure instanceof Error
        ? failure
        : new Error(typeof failure === "string" ? failure : "Session shutdown failed.");
    }

    this.notifyExit();
    this.unhealthyHandler = null;
  }

  private notifyUnhealthy(): void {
    if (!this.unhealthyHandler) return;
    try {
      this.unhealthyHandler();
    } catch (error) {
      logWarn("[PiBackendProcess] unhealthy handler failed", error);
    }
  }

  private notifyExit(): void {
    for (const listener of [...this.exitListeners]) {
      this.exitListeners.delete(listener);
      try {
        listener();
      } catch (error) {
        logWarn("[PiBackendProcess] exit listener failed", error);
      }
    }
  }

  private assertReady(method: string): void {
    if (!this.isRuntimeReady()) {
      throw new PiRuntimeNotReadyError(
        method,
        this.closed ? "the process is closed" : "the runtime has not started"
      );
    }
  }
}
