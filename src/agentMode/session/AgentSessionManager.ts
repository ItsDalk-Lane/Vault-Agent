import { saveChatExport } from "@/services/saveChatExport";
import type { CommandDraftContext } from "@/types/commandDraft";
import { configuredFanoutModels } from "@/agentMode/session/fanout/answerers";
import type { AgentMcpServer, BackendState } from "@/agentMode/session/types";
import type { FeedbackMcpServer } from "@/agentMode/session/feedback/feedbackMcpServer";
import { resolveEffort } from "@/lib/model-effort";
import { t } from "@/i18n";
import { logError, logInfo, logWarn } from "@/logger";
import type VaultAgentPlugin from "@/main";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import {
  getSettings,
  setSettings,
  subscribeToSettingsChange,
  type VaultAgentSettings,
} from "@/settings/model";
import { buildProjectContext } from "@/context/manifestBuilder";
import { err2String } from "@/utils";

import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";

import { App, FileSystemAdapter, Notice, Platform, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { AgentSession, ATTENTION_TRIGGER_STATUSES } from "./AgentSession";
import type { AgentModelPreloader } from "./AgentModelPreloader";
import { buildNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { playNotificationSound } from "@/utils/notificationSound";
import { deriveChatTitleFromMessages } from "./chatHistoryMerge";
import { MethodUnsupportedError } from "./errors";
import { replayPersistedMode } from "./replayPersistedMode";
import { applyModeSpec } from "./modeApply";
import {
  FanoutOrchestrator,
  type FanoutHost,
  type FanoutRunInput,
} from "./fanout/FanoutOrchestrator";
import type { FanoutTurn } from "./fanout/fanoutTypes";
import { modelCatalogSignature } from "./translateBackendState";
import { GLOBAL_SCOPE, type ProjectScopeId } from "./scope";
import { OrphanedProjectError, pickScopeNeighbor, resolveScopeCwd } from "./sessionScope";
import {
  getCachedProjectRecordById,
  getCachedProjectRecords,
  subscribeToProjectRecords,
} from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import {
  getProjectContextSignature,
  getProjectLandingCaptureSignature,
} from "@/projects/projectContextSignature";
import { ProjectContentTracker } from "@/context/projectContentTracker";
import { buildProjectContextUpdatesBlock } from "@/context/contextUpdatesBlockBuilder";

import { ProjectFileManager } from "@/projects/ProjectFileManager";
import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  BackendDescriptor,
  BackendId,
  BackendModelCatalog,
  BackendProcess,
  VaultAgentMode,
  ListedSessionInfo,
  LoadSessionOutput,
  ModeApplySpec,
  ModelSelection,
  PermissionDecision,
  PermissionPrompt,
  SessionId,
} from "./types";

const AUTOSAVE_DEBOUNCE_MS = 500;
const EMPTY_SESSIONS = Object.freeze([]) as unknown as AgentSession[];
const EMPTY_RECENT_CHAT_IDS: ReadonlySet<string> = new Set();
const EMPTY_CHAT_INPUT_IDS: readonly string[] = Object.freeze([]);
const EMPTY_MCP_SERVERS: ReadonlyArray<AgentMcpServer> = Object.freeze([]);

const RESUMED_SESSION_BEHIND_EPOCH = -1;

export type PermissionPrompter = (req: PermissionPrompt) => Promise<PermissionDecision>;

export type AskUserQuestionPrompter = (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;

export type DescriptorResolver = (id: BackendId) => BackendDescriptor | undefined;

export interface PinnedChat {
  id: string;
  pinnedAt?: number;
}

export interface ReplaceSessionOptions {
  preserveChatInput?: boolean;
  seedSelection?: ModelSelection;
}

export interface AgentSessionManagerOptions {
  permissionPrompter: PermissionPrompter;
  askUserQuestionPrompter?: AskUserQuestionPrompter;
  resolveDescriptor: DescriptorResolver;
  modelPreloader: AgentModelPreloader;
  beforeBackendStart?: (id: BackendId) => Promise<void>;
  feedbackServer?: FeedbackMcpServer;
}

export class AgentSessionManager {
  private backends = new Map<BackendId, BackendProcess>();
  private starting = new Map<BackendId, Promise<BackendProcess>>();
  private sessions = new Map<string, AgentSession>();
  private chatUIStates = new Map<string, AgentChatUIState>();
  private activeSessionId: string | null = null;
  private activeProjectId: ProjectScopeId = GLOBAL_SCOPE;
  private scopeSeq = 0;
  private readonly lastActiveByScope = new Map<ProjectScopeId, string>();
  private readonly detachedFromTabIds = new Set<string>();
  private readonly landingCaptureSignatures = new Map<string, string>();
  private readonly contentTracker: ProjectContentTracker;
  private readonly lastSeenProjectContentEpochBySession = new Map<string, number>();
  private previousProjectRecords: ProjectFileRecord[] = [];
  private projectRecordsUnsubscriber?: () => void;
  private readonly firstSessionPromiseByScope = new Map<ProjectScopeId, Promise<AgentSession>>();
  private readonly replacementCursorByChatInputId = new Map<string, Promise<string>>();
  readonly drafts: AgentInputDraftStore;
  private readonly resumedSessionPromiseById = new Map<string, Promise<AgentSession | null>>();
  private latestHistoryLoadRequestId = 0;
  private pendingCreates = 0;
  private listeners = new Set<() => void>();
  private disposed = false;
  private startingBackendId: BackendId | null = null;
  private lastError: string | null = null;
  private lastErrorSeq = 0;

  private readonly pendingBackendRestarts = new Map<
    BackendId,
    { reason: string; immediate: boolean }
  >();
  private readonly restartingBackends = new Set<BackendId>();
  /**
   * Backends running with spawn config the user has since changed. Applying it restarts the
   * backend and closes every session, so it waits for the user's Reload.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  private readonly heldConfigChanges = new Map<BackendId, string>();
  /**
   * Chat inputs mid-replacement during a backend restart, so the composer draft is not
   * pruned in the gap between the old session closing and its replacement existing.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/473
   */
  private readonly retainedChatInputIds = new Set<string>();
  /**
   * `backendId:baseModelId` pairs already warned about; the read runs on every session create.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/474
   */
  private readonly warnedUnavailableModels = new Set<string>();
  private readonly preloader: AgentModelPreloader;
  private readonly preloadStatus = new Map<BackendId, "pending" | "ready" | "error">();
  private readonly sessionState = new Map<
    string,
    {
      saving?: Promise<unknown>;
      indexTimer?: number;
      unsub?: () => void;
      attentionUnsub?: () => void;
    }
  >();

  private readonly readOnlyFanoutSessions = new Set<SessionId>();
  private readonly defaultApplyChains = new Map<string, Promise<void>>();
  private readonly fanoutOrchestrator: FanoutOrchestrator;
  private readonly settingsUnsub: () => void;

  private getSessionState(internalId: string) {
    let entry = this.sessionState.get(internalId);
    if (!entry) {
      entry = {};
      this.sessionState.set(internalId, entry);
    }
    return entry;
  }

  constructor(
    private readonly app: App,
    private readonly plugin: VaultAgentPlugin,
    private readonly opts: AgentSessionManagerOptions
  ) {
    if (Platform.isMobile) {
      throw new Error("AgentSessionManager is desktop only");
    }
    this.preloader = opts.modelPreloader;
    this.drafts = new AgentInputDraftStore(app, (chatInputId) =>
      this.getLiveChatInputIds().includes(chatInputId)
    );
    this.fanoutOrchestrator = new FanoutOrchestrator(this.createFanoutHost());
    this.settingsUnsub = subscribeToSettingsChange((prev, next) =>
      this.onDefaultSelectionsChanged(prev, next)
    );
    this.contentTracker = new ProjectContentTracker(this.app);
    this.setupProjectRecordChangeMonitor();
  }

  private onDefaultSelectionsChanged(prev: VaultAgentSettings, next: VaultAgentSettings): void {
    const prevBackends = prev.agentMode?.backends as
      | Record<string, { defaultModel?: ModelSelection | null } | undefined>
      | undefined;
    const nextBackends = next.agentMode?.backends as
      | Record<string, { defaultModel?: ModelSelection | null } | undefined>
      | undefined;
    for (const session of this.sessions.values()) {
      if (session.getStatus() === "closed") continue;
      const backendId = session.backendId;
      const before = prevBackends?.[backendId]?.defaultModel ?? null;
      const after = nextBackends?.[backendId]?.defaultModel ?? null;
      if (before?.baseModelId === after?.baseModelId && before?.effort === after?.effort) continue;
      const descriptor = this.opts.resolveDescriptor(backendId);
      if (!descriptor) continue;
      this.enqueueDefaultApply(session, descriptor);
    }
  }

  private enqueueDefaultApply(session: AgentSession, descriptor: BackendDescriptor): void {
    const backendId = session.backendId;
    const prior = this.defaultApplyChains.get(session.internalId) ?? Promise.resolve();
    const next = prior
      .then(() => session.ready)
      .then(() => {
        if (session.getStatus() === "closed") return;
        const target = this.getSeedSelection(backendId);
        if (!target) return;
        return descriptor
          .applySelection(session, target)
          .then(() => this.repairDefaultEffort(backendId, session.getState()));
      })
      .catch((e) => logWarn(`[AgentMode] re-applying default model for ${backendId} failed`, e))
      .finally(() => {
        if (this.defaultApplyChains.get(session.internalId) === next) {
          this.defaultApplyChains.delete(session.internalId);
        }
      });
    this.defaultApplyChains.set(session.internalId, next);
  }

  isReadOnlyFanoutSession(backendSessionId: SessionId): boolean {
    return this.readOnlyFanoutSessions.has(backendSessionId);
  }

  runFanoutTurn(input: FanoutRunInput): Promise<FanoutTurn> {
    return this.fanoutOrchestrator.run(input);
  }

  private createFanoutHost(): FanoutHost {
    return {
      ensureBackendForFanout: async (backendId) => {
        const descriptor = this.resolveDescriptor(backendId);
        const proc = await this.ensureBackend(backendId, descriptor);
        return { proc, descriptor };
      },
      getDefaultSelection: (backendId) => this.getSeedSelection(backendId),
      getFanoutModels: () => configuredFanoutModels(getSettings()),
      getDisplayName: (backendId) =>
        configuredFanoutModels(getSettings()).find((model) => model.modelKey === backendId)
          ?.label ?? this.resolveDescriptor(backendId).displayName,
      getCwd: () => {
        const adapter = this.app.vault.adapter;
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
      },
      registerReadOnlySession: (sessionId) => {
        this.readOnlyFanoutSessions.add(sessionId);
        return () => this.readOnlyFanoutSessions.delete(sessionId);
      },
      excludeSubSessionFromHistory: (_backendId, sessionId) => {
        this.readOnlyFanoutSessions.add(sessionId);
      },
    };
  }

  private setupProjectRecordChangeMonitor(): void {
    this.previousProjectRecords = getCachedProjectRecords();
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = subscribeToProjectRecords((nextRecords) => {
      this.handleProjectRecordsChanged(nextRecords);
    });
  }

  private handleProjectRecordsChanged(nextRecords: ProjectFileRecord[]): void {
    if (this.disposed) return;
    const prevRecords = this.previousProjectRecords;
    this.previousProjectRecords = nextRecords;

    for (const nextRecord of nextRecords) {
      const prevRecord = prevRecords.find((r) => r.project.id === nextRecord.project.id);
      if (!prevRecord) continue;
      const nextSignature = getProjectContextSignature(nextRecord);
      if (getProjectContextSignature(prevRecord) === nextSignature) continue;

      this.contentTracker.bumpEpoch(nextRecord.project.id);
    }
  }

  private buildFirstProjectContextBlock(internalId: string, projectId: ProjectScopeId): string {
    this.contentTracker.flushNow();
    this.lastSeenProjectContentEpochBySession.set(
      internalId,
      this.contentTracker.getEpoch(projectId)
    );
    return buildProjectContext(this.app, projectId);
  }

  private getProjectContextUpdates(
    internalId: string,
    projectId: ProjectScopeId
  ): { epoch: number; block: string } | null {
    if (projectId === GLOBAL_SCOPE) return null;
    this.contentTracker.flushNow();
    const epoch = this.contentTracker.getEpoch(projectId);
    const lastSeen = this.lastSeenProjectContentEpochBySession.get(internalId) ?? 0;
    if (epoch <= lastSeen) return null;
    return { epoch, block: buildProjectContextUpdatesBlock() };
  }

  private markProjectContextUpdatesDelivered(internalId: string, epoch: number): void {
    const lastSeen = this.lastSeenProjectContentEpochBySession.get(internalId) ?? 0;
    if (epoch > lastSeen) this.lastSeenProjectContentEpochBySession.set(internalId, epoch);
  }

  async getChatHistoryItems(scope?: ProjectScopeId): Promise<ChatHistoryItem[]> {
    const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
    const { sessions } = await backend.listSessions({ cwd: this.resolveSessionCwd(GLOBAL_SCOPE) });
    return sessions
      .filter((session) => !scope || scope === GLOBAL_SCOPE || session.projectId === scope)
      .map((session) => ({
        id: buildNativeChatId("pi", session.sessionId),
        title: session.title || t("agentInfra.session.untitledChat"),
        createdAt: new Date(
          session.createdAtMs ?? (Date.parse(session.updatedAt ?? "") || Date.now())
        ),
        lastAccessedAt: new Date(
          session.lastAccessedAtMs ?? (Date.parse(session.updatedAt ?? "") || Date.now())
        ),
        pinnedAt: session.pinnedAt ?? undefined,
        projectId: session.projectId,
        backendId: "pi",
        needsAttention: this.findLiveSession("pi", session.sessionId)?.getNeedsAttention(),
      }));
  }

  private recentChatIdsForSession(_internalId: string, session: AgentSession): string[] {
    const ids: string[] = [];
    const backendSessionId = session.getBackendSessionId();
    if (backendSessionId) ids.push(buildNativeChatId(session.backendId, backendSessionId));
    return ids;
  }

  getOpenChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      // A starting or failed session has no backend resource for the user to close.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
      if (!session.getBackendSessionId()) continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  async closeChatSession(historyId: string): Promise<void> {
    for (const [internalId, session] of this.sessions) {
      // History can still display the native identity after the first autosave.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
      if (this.recentChatIdsForSession(internalId, session).includes(historyId)) {
        await this.closeSession(internalId, { releaseBackend: true });
        return;
      }
    }
  }

  /**
   * Closing a tab is navigation; only the history action releases the backend resource.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/429
   */
  detachSessionFromTab(id: string): void {
    const session = this.sessions.get(id);
    if (!session || this.detachedFromTabIds.has(id)) return;
    const scopeIdsBefore = this.getSessionIdsForScope(session.projectId);
    const closedIndex = scopeIdsBefore.indexOf(id);
    this.detachedFromTabIds.add(id);

    if (this.lastActiveByScope.get(session.projectId) === id) {
      this.lastActiveByScope.delete(session.projectId);
    }
    if (this.activeSessionId === id) {
      const nextId = pickScopeNeighbor(
        this.getSessionIdsForScope(session.projectId),
        closedIndex,
        this.lastActiveByScope.get(session.projectId)
      );
      this.activeSessionId = nextId;
      if (nextId) this.lastActiveByScope.set(session.projectId, nextId);
    }
    this.notify();
  }

  getRunningChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (session.getStatus() !== "running") continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  getAttentionChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (!session.getNeedsAttention()) continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  async updateChatTitle(id: string, title: string): Promise<void> {
    const ref = parseNativeChatId(id);
    if (!ref) throw new Error(t("notice.linkNotFound"));
    const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
    await backend.updateSessionMetadata!({ sessionId: ref.sessionId, title, titleSource: "user" });
    this.findLiveSession("pi", ref.sessionId)?.setLabel(title);
    this.notify();
  }

  async setChatPinned(id: string, pinned: boolean): Promise<PinnedChat> {
    const ref = parseNativeChatId(id);
    if (!ref) throw new Error(t("notice.linkNotFound"));
    const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
    const pinnedAt = pinned ? Date.now() : null;
    await backend.updateSessionMetadata!({ sessionId: ref.sessionId, pinnedAt });
    this.notify();
    return { id, pinnedAt: pinnedAt ?? undefined };
  }

  async forkChat(id: string, atEntryId?: string): Promise<AgentSession> {
    const ref = parseNativeChatId(id);
    if (!ref) throw new Error(t("notice.linkNotFound"));
    const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
    const fork = await backend.forkSession!({ sessionId: ref.sessionId, atEntryId });
    return this.loadNativeSessionFromHistory("pi", fork.sessionId);
  }

  private readonly deletingSessions = new Set<string>();

  isDeletingSession(internalId: string): boolean {
    const id = this.sessions.get(internalId)?.getBackendSessionId();
    return id !== undefined && id !== null && this.deletingSessions.has(id);
  }

  async deleteChatHistory(id: string): Promise<void> {
    const ref = parseNativeChatId(id);
    if (!ref) throw new Error(t("notice.linkNotFound"));
    if (this.deletingSessions.has(ref.sessionId)) throw new Error(t("localData.sessionBusy"));
    this.deletingSessions.add(ref.sessionId);
    this.cancelPendingIndexTouch("pi", ref.sessionId);
    this.notify();
    let failure: Error | undefined;
    try {
      const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
      try {
        await backend.deleteSession!({ sessionId: ref.sessionId });
      } catch (error) {
        const removed =
          (error as { code?: string }).code === "SESSION_DELETE_INCOMPLETE" ||
          (backend.sessionExistsLocally &&
            !(await backend.sessionExistsLocally({
              sessionId: ref.sessionId,
              cwd: this.resolveSessionCwd(GLOBAL_SCOPE),
            })));
        if (!removed) throw error;
        failure = error instanceof Error ? error : new Error(String(error));
      }
      for (const [internalId, session] of Array.from(this.sessions)) {
        if (session.getBackendSessionId() === ref.sessionId) await this.closeSession(internalId);
      }
      if (failure) throw failure;
    } finally {
      this.deletingSessions.delete(ref.sessionId);
      this.notify();
    }
  }

  private cancelPendingIndexTouch(backendId: BackendId, sessionId: string): void {
    for (const session of this.sessions.values()) {
      if (session.backendId !== backendId) continue;
      if (session.getBackendSessionId() !== sessionId) continue;
      const state = this.sessionState.get(session.internalId);
      if (state?.indexTimer) {
        window.clearTimeout(state.indexTimer);
        state.indexTimer = undefined;
      }
    }
  }

  async getOrCreateActiveSession(): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const active = this.getActiveSession();
    if (active && active.projectId === this.activeProjectId && active.getStatus() !== "closed") {
      return active;
    }
    const scope = this.activeProjectId;
    const pending = this.firstSessionPromiseByScope.get(scope);
    if (pending) return pending;
    const promise = this.createSession(undefined, scope);
    this.firstSessionPromiseByScope.set(scope, promise);
    try {
      return await promise;
    } finally {
      this.firstSessionPromiseByScope.delete(scope);
    }
  }

  async createSession(
    backendId?: BackendId,
    projectId: ProjectScopeId = this.activeProjectId,
    seedSelection?: ModelSelection,
    chatInputId?: string
  ): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    const requestedId = backendId ?? getSettings().agentMode?.activeBackend ?? "pi";
    const requested = this.opts.resolveDescriptor(requestedId);
    const resolvedId = requested ? requestedId : "pi";
    const errorSeqAtStart = this.lastErrorSeq;
    const descriptor = this.resolveDescriptor(resolvedId);
    const resolvedSeed = seedSelection ?? this.getSeedSelection(resolvedId) ?? undefined;
    if (!resolvedSeed && descriptor.routesVaultAgentModels) {
      const message = `Enable a model for ${descriptor.displayName} in Vault Agent's model settings to start a chat.`;
      this.setLastError(message);
      this.notify();
      throw new Error(message);
    }

    const projectRecord =
      projectId === GLOBAL_SCOPE ? undefined : getCachedProjectRecordById(projectId);

    const landingCaptureSignature = projectRecord
      ? getProjectLandingCaptureSignature(this.app, projectRecord)
      : undefined;

    const cwd = this.resolveSessionCwd(projectId);

    this.pendingCreates++;
    this.startingBackendId = resolvedId;
    this.notify();

    let backend: BackendProcess;
    try {
      backend = await this.ensureBackend(resolvedId, descriptor);
    } catch (err) {
      this.setLastError(err2String(err));
      this.finishPendingCreate();
      throw err;
    }

    const internalId = uuidv4();
    const mcpServers = await this.connectFeedbackServer(internalId);

    if (this.disposed) {
      this.finishPendingCreate();
      throw new Error("AgentSessionManager was shut down during session creation");
    }

    const resolvedChatInputId = chatInputId ?? uuidv4();
    const session = AgentSession.start({
      backend,
      cwd,
      internalId,
      chatInputId: resolvedChatInputId,
      backendId: resolvedId,
      projectId,
      defaultModelSelection: resolvedSeed,
      defaultMode: this.getDefaultMode(resolvedId),
      getDescriptor: () => this.opts.resolveDescriptor(resolvedId),
      runFanoutTurn: (input) => this.runFanoutTurn(input),
      getDisplayName: (backendId) => this.resolveDescriptor(backendId).displayName,
      mcpServers,
      ...(projectId !== GLOBAL_SCOPE
        ? {
            getProjectContextBlock: () => this.buildFirstProjectContextBlock(internalId, projectId),
            getProjectContextUpdates: () => this.getProjectContextUpdates(internalId, projectId),
            markProjectContextUpdatesDelivered: (epoch: number) =>
              this.markProjectContextUpdatesDelivered(internalId, epoch),
          }
        : {}),
    });
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    if (landingCaptureSignature) {
      this.landingCaptureSignatures.set(session.internalId, landingCaptureSignature);
    } else {
      this.landingCaptureSignatures.delete(session.internalId);
    }
    this.detachedFromTabIds.delete(session.internalId);
    this.lastActiveByScope.set(projectId, session.internalId);
    if (projectId === this.activeProjectId) {
      this.activeSessionId = session.internalId;
    }
    this.attachAutoSave(session);
    this.attachAttentionTracking(session);
    this.notify();

    void session.ready
      .then(async () => {
        this.repairDefaultEffort(resolvedId, session.getState());
        if (this.lastErrorSeq === errorSeqAtStart) {
          this.lastError = null;
        }
        logInfo(
          `[AgentMode] session ready (internal=${session.internalId} backend-id=${session.getBackendSessionId()} backend=${resolvedId}); pool size=${this.sessions.size}`
        );
        await replayPersistedMode(session, this.getDefaultMode(resolvedId));
      })
      .catch((err) => {
        this.setLastError(err2String(err));
      })
      .finally(() => this.finishPendingCreate());

    return session;
  }

  async createGlobalSessionWithDraft(
    initialDraft: string,
    commandContext?: CommandDraftContext
  ): Promise<AgentSession> {
    const projectId = GLOBAL_SCOPE;
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);
    let session: AgentSession;
    try {
      session = await this.createSession(undefined, projectId);
    } catch (error) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw error;
    }
    this.drafts.update(session.chatInputId, (draft) => ({
      ...draft,
      input: initialDraft,
      ...(commandContext ? { commandContext } : {}),
    }));
    return session;
  }

  async addContextNoteToActiveChat(note: TFile): Promise<void> {
    const session = await this.getOrCreateActiveSession();
    this.drafts.addContextNote(session.chatInputId, note);
  }

  private setLastError(message: string): void {
    this.lastError = message;
    this.lastErrorSeq++;
  }

  private finishPendingCreate(): void {
    this.pendingCreates--;
    if (this.pendingCreates === 0) this.startingBackendId = null;
    this.notify();
  }

  private resolveDescriptor(backendId: BackendId): BackendDescriptor {
    const descriptor = this.opts.resolveDescriptor(backendId);
    if (!descriptor) {
      throw new Error(`Unknown backend "${backendId}". Did you forget to register it?`);
    }
    return descriptor;
  }

  private resolveSessionCwd(projectId: ProjectScopeId): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Mode requires desktop Obsidian (FileSystemAdapter).");
    }
    return resolveScopeCwd(adapter.getBasePath(), projectId);
  }

  getActiveProjectId(): ProjectScopeId {
    return this.activeProjectId;
  }

  getSessionsForScope(projectId: ProjectScopeId): AgentSession[] {
    const scoped: AgentSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (this.detachedFromTabIds.has(session.internalId)) continue;
      scoped.push(session);
    }
    return scoped.length === 0 ? EMPTY_SESSIONS : scoped;
  }

  private getSessionIdsForScope(projectId: ProjectScopeId): string[] {
    const ids: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (this.detachedFromTabIds.has(session.internalId)) continue;
      ids.push(session.internalId);
    }
    return ids;
  }

  async enterProject(projectId: ProjectScopeId): Promise<void> {
    if (this.disposed) return;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice(t("agentInfra.session.projectGone"));
      return;
    }
    const current = this.getActiveSession();
    if (
      projectId === this.activeProjectId &&
      current &&
      current.projectId === projectId &&
      current.getStatus() !== "closed"
    ) {
      return;
    }

    const previousActiveProjectId = this.activeProjectId;
    const previousActiveSessionId = this.activeSessionId;
    const scopeSeq = this.setActiveScope(projectId);

    if (projectId !== GLOBAL_SCOPE) {
      const reusable = this.pickReusableLandingSession(projectId);
      this.detachSessionsForProjectEntry(projectId, { includeEmpty: !reusable });
      if (reusable) {
        this.detachedFromTabIds.delete(reusable.internalId);
        this.activeSessionId = reusable.internalId;
        this.lastActiveByScope.set(projectId, reusable.internalId);
        reusable.clearNeedsAttention();
        this.notify();
        this.touchProjectUsage(projectId);
        return;
      }
      this.activeSessionId = null;
      this.notify();
      await this.spawnEnteredScopeOrRollback(
        previousActiveProjectId,
        previousActiveSessionId,
        scopeSeq
      );
      this.touchProjectUsage(projectId);
      return;
    }

    const restored = this.restoreScopeActiveSession(projectId);
    if (restored) {
      this.activeSessionId = restored.internalId;
      this.lastActiveByScope.set(projectId, restored.internalId);
      restored.clearNeedsAttention();
      this.notify();
      this.touchProjectUsage(projectId);
      return;
    }

    this.activeSessionId = null;
    this.notify();
    await this.getOrCreateActiveSession();
    this.touchProjectUsage(projectId);
  }

  private detachSessionsForProjectEntry(
    projectId: ProjectScopeId,
    opts: { includeEmpty: boolean }
  ): void {
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (session.getStatus() === "closed") continue;
      if (!opts.includeEmpty && !session.hasUserVisibleMessages()) continue;
      this.detachedFromTabIds.add(session.internalId);
    }
  }

  private pickReusableLandingSession(projectId: ProjectScopeId): AgentSession | null {
    const expected = this.currentLandingCaptureSignature(projectId);
    if (!expected) return null;
    const isReusable = (session: AgentSession): boolean =>
      this.isReusableLandingShell(session, projectId) &&
      !this.detachedFromTabIds.has(session.internalId) &&
      this.landingCaptureSignatures.get(session.internalId) === expected;

    const mruId = this.lastActiveByScope.get(projectId);
    const mru = mruId ? this.sessions.get(mruId) : undefined;
    if (mru && isReusable(mru)) return mru;

    let fallback: AgentSession | null = null;
    for (const session of this.sessions.values()) {
      if (isReusable(session)) fallback = session;
    }
    return fallback;
  }

  private isReusableLandingShell(session: AgentSession, projectId: ProjectScopeId): boolean {
    return (
      session.projectId === projectId &&
      (session.getStatus() === "idle" || session.getStatus() === "starting") &&
      !session.hasUserVisibleMessages()
    );
  }

  private currentLandingCaptureSignature(projectId: ProjectScopeId): string | null {
    if (projectId === GLOBAL_SCOPE) return null;
    const record = getCachedProjectRecordById(projectId);
    return record ? getProjectLandingCaptureSignature(this.app, record) : null;
  }

  private touchProjectUsage(projectId: ProjectScopeId): void {
    if (this.disposed || projectId === GLOBAL_SCOPE || this.activeProjectId !== projectId) return;
    void ProjectFileManager.getInstance(this.app).touchProjectLastUsed(projectId);
  }

  async exitProject(): Promise<void> {
    await this.enterProject(GLOBAL_SCOPE);
  }

  private parkActiveScope(): void {
    const active = this.getActiveSession();
    if (active && active.getStatus() !== "closed") {
      this.lastActiveByScope.set(active.projectId, active.internalId);
    }
  }

  private restoreScopeActiveSession(projectId: ProjectScopeId): AgentSession | null {
    const mruId = this.lastActiveByScope.get(projectId);
    if (mruId) {
      const mru = this.sessions.get(mruId);
      if (mru && mru.getStatus() !== "closed") return mru;
    }
    const scoped = this.getSessionsForScope(projectId);
    return scoped.length > 0 ? scoped[scoped.length - 1] : null;
  }

  private setActiveScope(projectId: ProjectScopeId): number {
    if (projectId === this.activeProjectId) return this.scopeSeq;
    this.parkActiveScope();
    this.activeProjectId = projectId;
    return ++this.scopeSeq;
  }

  private rollbackOptimisticScopeSwitch(
    previousProjectId: ProjectScopeId,
    attemptedScopeVersion: number
  ): void {
    if (this.scopeSeq === attemptedScopeVersion) {
      this.activeProjectId = previousProjectId;
      this.scopeSeq++;
      this.notify();
    }
  }

  private async spawnEnteredScopeOrRollback(
    previousProjectId: ProjectScopeId,
    previousActiveSessionId: string | null,
    attemptedScopeVersion: number
  ): Promise<void> {
    try {
      await this.getOrCreateActiveSession();
    } catch (err) {
      if (this.scopeSeq === attemptedScopeVersion) {
        this.activeProjectId = previousProjectId;
        this.scopeSeq++;
        this.activeSessionId = previousActiveSessionId;
        this.notify();
      }
      throw err;
    }
  }

  setDefaultBackend(backendId: BackendId): void {
    if (getSettings().agentMode?.activeBackend === backendId) return;
    setSettings((cur) => ({
      agentMode: { ...cur.agentMode, activeBackend: backendId },
    }));
    this.notify();
  }

  getDefaultSelection(backendId: BackendId): ModelSelection | null {
    const backends = getSettings().agentMode?.backends as
      | Record<string, { defaultModel?: ModelSelection | null } | undefined>
      | undefined;
    return backends?.[backendId]?.defaultModel ?? null;
  }

  /**
   * A carried selection wins, then the saved default, then the first enabled model with
   * credentials; the saved preference itself is never rewritten.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/474
   * https://github.com/logancyang/obsidian-copilot/issues/3319
   */
  getSeedSelection(backendId: BackendId, preferred?: ModelSelection | null): ModelSelection | null {
    const saved = this.getDefaultSelection(backendId);
    const descriptor = this.opts.resolveDescriptor(backendId);
    const offered = descriptor?.getEnabledModelEntries?.(getSettings());
    const requested = preferred ?? saved;
    // A missing accessor cannot validate agent-native models. An empty list is
    // authoritative because it can mean the user just disabled the last model.
    // https://github.com/logancyang/obsidian-copilot/issues/3319
    if (!offered) return requested;

    const runnable = offered.filter((entry) => entry.credentialState === "ok");
    // A backend that may only run enabled models has no agent default to fall back to.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/625
    if (!requested && descriptor?.routesVaultAgentModels !== true) return null;

    const resolved =
      [preferred, saved].find(
        (selection): selection is ModelSelection =>
          !!selection && runnable.some((entry) => entry.baseModelId === selection.baseModelId)
      ) ?? (runnable[0] ? { baseModelId: runnable[0].baseModelId, effort: null } : null);
    if (requested && resolved?.baseModelId !== requested.baseModelId) {
      const replacementName = runnable.find(
        (entry) => entry.baseModelId === resolved?.baseModelId
      )?.name;
      this.warnSelectionNotRunnable(backendId, requested.baseModelId, replacementName);
    }
    return resolved;
  }

  private warnSelectionNotRunnable(
    backendId: BackendId,
    baseModelId: string,
    replacementName?: string
  ): void {
    const key = `${backendId}:${baseModelId}`;
    if (this.warnedUnavailableModels.has(key)) return;
    this.warnedUnavailableModels.add(key);
    const agent = this.resolveDescriptor(backendId).displayName;
    const model = baseModelId.split("/").pop() || baseModelId;
    logInfo(`[AgentMode] ${backendId} cannot start a chat on ${baseModelId}`);
    new Notice(
      replacementName
        ? t("agentInfra.session.modelUnavailableWithReplacement", {
            agent,
            model,
            replacement: replacementName,
          })
        : t("agentInfra.session.modelUnavailable", { agent, model })
    );
  }

  private repairDefaultEffort(backendId: BackendId, state: BackendState | null): void {
    const saved = this.getDefaultSelection(backendId);
    const model = state?.model;
    if (!saved || model?.current.baseModelId !== saved.baseModelId) return;
    const options = model.availableModels.find(
      (entry) => entry.baseModelId === saved.baseModelId
    )?.effortOptions;
    const effort = resolveEffort(saved.effort, options);
    // Repair the durable preference as well as the session so future chats do
    // not repeatedly request a removed effort. Read the current saved value to
    // preserve valid settings edits made during startup.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
    if (effort !== saved.effort && effort === model.current.effort) {
      void this.persistDefaultSelection(backendId, { ...saved, effort }).catch((err) =>
        logWarn("Failed to save repaired agent effort", err)
      );
    }
  }

  async persistDefaultSelection(
    backendId: BackendId,
    selection: ModelSelection | null
  ): Promise<void> {
    setSettings((cur) => {
      const existing = (cur.agentMode.backends as Record<string, unknown> | undefined)?.[
        backendId
      ] as Record<string, unknown> | undefined;
      return {
        agentMode: {
          ...cur.agentMode,
          backends: {
            ...cur.agentMode.backends,
            [backendId]: { ...(existing ?? {}), defaultModel: selection },
          },
        },
      };
    });
  }

  async applySelection(
    patch: { baseModelId?: string; effort?: string | null },
    opts?: { expectBackendId?: BackendId }
  ): Promise<void> {
    const session = this.getActiveSession();
    if (!session) return;
    if (opts?.expectBackendId && session.backendId !== opts.expectBackendId) return;
    const current = session.getState()?.model?.current;
    if (!current) return;
    const descriptor = this.resolveDescriptor(session.backendId);
    const resolved: ModelSelection = {
      baseModelId: patch.baseModelId ?? current.baseModelId,
      effort: patch.effort !== undefined ? patch.effort : current.effort,
    };
    await descriptor.applySelection(session, resolved);
    this.repairDefaultEffort(session.backendId, session.getState());
  }

  async applyMode(backendId: BackendId, mode: VaultAgentMode, spec: ModeApplySpec): Promise<void> {
    const session = this.getActiveSession();
    if (!session || session.backendId !== backendId) return;
    const latestMapping = this.resolveDescriptor(backendId).getModeMapping?.(null, null);
    const latestNativeId =
      latestMapping?.kind === "setMode" ? latestMapping.canonical[mode] : undefined;
    const resolvedSpec: ModeApplySpec = latestNativeId
      ? { kind: "setMode", nativeId: latestNativeId }
      : spec;
    await applyModeSpec(session, resolvedSpec);
    await this.persistDefaultMode(backendId, mode);
  }

  getDefaultMode(backendId: BackendId): VaultAgentMode | null {
    const backends = getSettings().agentMode?.backends as
      | Record<string, { defaultMode?: VaultAgentMode | null } | undefined>
      | undefined;
    return backends?.[backendId]?.defaultMode ?? null;
  }

  async persistDefaultMode(backendId: BackendId, mode: VaultAgentMode | null): Promise<void> {
    setSettings((cur) => {
      const existing = (cur.agentMode.backends as Record<string, unknown> | undefined)?.[
        backendId
      ] as Record<string, unknown> | undefined;
      return {
        agentMode: {
          ...cur.agentMode,
          backends: {
            ...cur.agentMode.backends,
            [backendId]: { ...(existing ?? {}), defaultMode: mode },
          },
        },
      };
    });
  }

  getBackendProcess(backendId: BackendId): BackendProcess | null {
    return this.backends.get(backendId) ?? null;
  }

  async restartBackend(
    backendId: BackendId,
    reason: string,
    options?: { deferWhileBusy?: boolean }
  ): Promise<boolean> {
    if (this.disposed) return false;
    const inflight = this.starting.get(backendId);
    if (inflight) {
      await inflight.catch(() => undefined);
    }
    const backend = this.backends.get(backendId);
    if (!backend) return this.refreshWarmProbe(backendId, reason);
    // Most config changes preserve the current turn. A Search scope change may
    // opt out so no later tool call uses the prior privacy boundary.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
    if (options?.deferWhileBusy !== false && this.hasBusySession(backendId)) {
      const prev = this.pendingBackendRestarts.get(backendId);
      this.pendingBackendRestarts.set(backendId, {
        reason: prev ? `${prev.reason}; ${reason}` : reason,
        immediate: prev?.immediate ?? false,
      });
      logInfo(`[AgentMode] deferred ${backendId} backend restart: ${reason}`);
      // The chat's Reload action reports a queued restart as in progress, so
      // publish the queue entry rather than leaving the button looking inert.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
      this.notify();
      return true;
    }
    await this.restartBackendNow(backendId, reason, options?.deferWhileBusy === false);
    return true;
  }

  /**
   * A running process keeps its spawn config, so the change is held while a session exists to
   * lose and offered as a Reload. Callers that must apply now call `restartBackend` directly.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  async noteSpawnConfigChanged(backendId: BackendId, reason: string): Promise<void> {
    if (this.disposed) return;
    const inflight = this.starting.get(backendId);
    if (inflight) await inflight.catch(() => undefined);
    if (this.disposed) return;
    if (!this.hasSessionOn(backendId)) {
      await this.restartBackend(backendId, reason);
      return;
    }
    const prev = this.heldConfigChanges.get(backendId);
    this.heldConfigChanges.set(backendId, prev ? `${prev}; ${reason}` : reason);
    logInfo(`[AgentMode] holding ${backendId} backend restart: ${reason}`);
    if (prev === undefined) this.notify();
  }

  hasHeldConfigChange(backendId: BackendId): boolean {
    return this.heldConfigChanges.has(backendId);
  }

  /**
   * Lets the Reload action show progress while the restart is queued behind a turn.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  isBackendRestartPending(backendId: BackendId): boolean {
    return this.restartingBackends.has(backendId) || this.pendingBackendRestarts.has(backendId);
  }

  /**
   * The Reload action: performs the restart `noteSpawnConfigChanged` declined to do.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/475
   */
  async applyHeldConfigChange(backendId: BackendId): Promise<void> {
    const reason = this.heldConfigChanges.get(backendId);
    if (reason === undefined) return;
    await this.restartBackend(backendId, reason);
  }

  private hasSessionOn(backendId: BackendId): boolean {
    return Array.from(this.sessions.values()).some((s) => s.backendId === backendId);
  }

  private refreshWarmProbe(backendId: BackendId, reason: string): boolean {
    if (this.disposed) return false;
    if (!this.canStartBackend(backendId)) return false;
    const probe = this.preloader.refresh(backendId);
    if (!probe) return false;
    logInfo(`[AgentMode] refreshing warm ${backendId} probe: ${reason}`);
    this.registerPreload(backendId, probe);
    return true;
  }

  private canStartBackend(backendId: BackendId): boolean {
    const descriptor = this.opts.resolveDescriptor(backendId);
    return descriptor !== undefined;
  }

  getCachedModelCatalog(backendId: BackendId): BackendModelCatalog | null {
    return this.preloader.getCachedModelCatalog(backendId);
  }

  subscribeModelCache(listener: () => void): () => void {
    return this.preloader.subscribe(listener);
  }

  getModelCacheSignature(backendId: BackendId): string {
    const status = this.getPreloadStatus(backendId);
    const catalog = modelCatalogSignature(this.getCachedModelCatalog(backendId));
    return `${status}#${catalog}`;
  }

  preloadModels(backendId: BackendId): Promise<void> {
    return this.preloader.preload(backendId);
  }

  registerPreload(backendId: BackendId, promise: Promise<void>): void {
    this.preloadStatus.set(backendId, "pending");
    this.notify();
    promise.then(
      () => {
        if (this.disposed) return;
        this.preloadStatus.set(backendId, "ready");
        this.notify();
      },
      () => {
        if (this.disposed) return;
        this.preloadStatus.set(backendId, "error");
        this.notify();
      }
    );
  }

  isPreloadReady(backendId?: BackendId): boolean {
    const id = backendId ?? getSettings().agentMode?.activeBackend;
    if (!id) return true;
    const status = this.preloadStatus.get(id);
    return status === undefined || status === "ready" || status === "error";
  }

  getPreloadStatus(backendId: BackendId): "pending" | "ready" | "error" | "absent" {
    return this.preloadStatus.get(backendId) ?? "absent";
  }

  async closeSession(id: string, options?: { releaseBackend: boolean }): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    const closedScope = session.projectId;
    const scopeIdsBefore = this.getSessionIdsForScope(closedScope);
    const closedIdx = scopeIdsBefore.indexOf(id);
    const supportsPause = !!this.backends.get(session.backendId)?.pauseSession;
    const deleting = this.deletingSessions.has(session.getBackendSessionId() ?? "");
    if (!deleting && supportsPause) {
      const status = session.getStatus();
      const alreadyPaused = session.getRunState()?.status.startsWith("paused_") === true;
      // 关闭标签只保存可继续的工作；必须等暂停落盘后释放，不能把已暂停的待答事项再次终结。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (!alreadyPaused && (status === "running" || status === "awaiting_permission"))
        await session.pause();
    }
    if (!deleting) {
      // 显式释放仍阻止关闭后的新发送；重启后端时保留原有内部拆卸入口。https://github.com/Brevilabs/obsidian-copilot-private/issues/429
      if (options?.releaseBackend) {
        await session.releaseBackendSession();
      } else {
        if (!supportsPause) {
          try {
            await session.cancel();
          } catch (e) {
            logWarn(`[AgentMode] cancel during closeSession failed`, e);
          }
        }
        // 关闭聊天时释放运行会话，避免重开后继续使用已经撤销的反馈连接。
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
        if (session.getBackendSessionId() && !this.restartingBackends.has(session.backendId)) {
          try {
            await session.releaseBackendSession();
          } catch (e) {
            logWarn(`[AgentMode] releasing the backend session during closeSession failed`, e);
          }
        }
      }
    }
    if (!deleting) await this.drainAutoSave(session);
    try {
      await session.dispose();
    } catch (e) {
      logWarn(`[AgentMode] dispose during closeSession failed`, e);
    }
    this.detachAutoSave(id);
    this.opts.feedbackServer?.disconnect(id);
    this.sessions.delete(id);
    this.chatUIStates.delete(id);
    this.landingCaptureSignatures.delete(id);
    this.lastSeenProjectContentEpochBySession.delete(id);
    this.detachedFromTabIds.delete(id);
    if (this.lastActiveByScope.get(closedScope) === id) {
      this.lastActiveByScope.delete(closedScope);
    }
    if (this.activeSessionId === id) {
      const scopeIdsAfter = this.getSessionIdsForScope(closedScope);
      const nextId = pickScopeNeighbor(
        scopeIdsAfter,
        closedIdx,
        this.lastActiveByScope.get(closedScope)
      );
      this.activeSessionId = nextId;
      if (nextId) this.lastActiveByScope.set(closedScope, nextId);
    }
    this.notify();
  }

  setActiveSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (this.activeSessionId === id) return;
    if (session.projectId !== this.activeProjectId) {
      this.setActiveScope(session.projectId);
    }
    this.detachedFromTabIds.delete(id);
    this.activeSessionId = id;
    this.lastActiveByScope.set(session.projectId, id);
    session.clearNeedsAttention();
    const sessionId = session.getBackendSessionId();
    const backend = this.backends.get(session.backendId);
    if (sessionId && !this.deletingSessions.has(sessionId) && backend?.updateSessionMetadata) {
      void backend
        .updateSessionMetadata({ sessionId, lastAccessedAtMs: Date.now() })
        .catch((error) => logWarn("[AgentMode] visit metadata failed", error));
    }
    this.notify();
  }

  async replaceSessionInPlace(
    oldId: string,
    backendId?: BackendId,
    options: ReplaceSessionOptions = {}
  ): Promise<AgentSession> {
    const replacementKey = this.sessions.get(oldId)?.chatInputId ?? oldId;
    const cursor =
      this.replacementCursorByChatInputId.get(replacementKey) ?? Promise.resolve(oldId);
    const replacement = cursor.then((currentId) =>
      this.replaceSessionInPlaceOnce(currentId, backendId, options)
    );
    const nextCursor = replacement.then(
      (current) => current.internalId,
      () => cursor
    );
    this.replacementCursorByChatInputId.set(replacementKey, nextCursor);
    try {
      return await replacement;
    } finally {
      if (this.replacementCursorByChatInputId.get(replacementKey) === nextCursor) {
        this.replacementCursorByChatInputId.delete(replacementKey);
      }
    }
  }

  private async replaceSessionInPlaceOnce(
    oldId: string,
    backendId?: BackendId,
    options: ReplaceSessionOptions = {}
  ): Promise<AgentSession> {
    const oldIdx = Array.from(this.sessions.keys()).indexOf(oldId);
    const replaced = this.sessions.get(oldId);
    const replacedProjectId = replaced?.projectId ?? this.activeProjectId;
    const chatInputId = options.preserveChatInput ? replaced?.chatInputId : undefined;
    const created = await this.createSession(
      backendId,
      replacedProjectId,
      options.seedSelection,
      chatInputId
    );
    if (oldIdx >= 0) {
      this.moveMapEntry(this.sessions, created.internalId, oldIdx);
      this.moveMapEntry(this.chatUIStates, created.internalId, oldIdx);
      this.notify();
    }
    void this.closeSession(oldId).catch((e) =>
      logWarn(`[AgentMode] closeSession during replaceSessionInPlace failed`, e)
    );
    return created;
  }

  private moveMapEntry<V>(map: Map<string, V>, key: string, targetIdx: number): void {
    if (!map.has(key)) return;
    const entries = Array.from(map.entries());
    const fromIdx = entries.findIndex(([k]) => k === key);
    if (fromIdx === -1 || fromIdx === targetIdx) return;
    const [entry] = entries.splice(fromIdx, 1);
    entries.splice(targetIdx, 0, entry);
    map.clear();
    for (const [k, v] of entries) map.set(k, v);
  }

  renameSession(id: string, label: string | null): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.setLabel(label);
    this.notify();
  }

  getIsStarting(): boolean {
    return this.startingBackendId !== null;
  }

  getStartingBackendId(): BackendId | null {
    return this.startingBackendId;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id) ?? null;
  }

  getSessionByBackendId(backendSessionId: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.getBackendSessionId() === backendSessionId) return session;
    }
    return null;
  }

  private findLiveSession(backendId: BackendId, sessionId: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.backendId !== backendId) continue;
      if (session.getBackendSessionId() !== sessionId) continue;
      if (session.getStatus() === "closed") continue;
      return session;
    }
    return null;
  }

  getChatUIState(id: string): AgentChatUIState | null {
    return this.chatUIStates.get(id) ?? null;
  }

  getActiveSession(): AgentSession | null {
    return this.activeSessionId ? (this.sessions.get(this.activeSessionId) ?? null) : null;
  }

  getActiveChatUIState(): AgentChatUIState | null {
    return this.activeSessionId ? (this.chatUIStates.get(this.activeSessionId) ?? null) : null;
  }

  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Prune composer drafts against this rather than `getSessions()`, which omits tabs
   * mid-replacement during a backend restart.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/473
   */
  getLiveChatInputIds(): readonly string[] {
    const ids = new Set(this.retainedChatInputIds);
    for (const session of this.sessions.values()) ids.add(session.chatInputId);
    return ids.size === 0 ? EMPTY_CHAT_INPUT_IDS : Array.from(ids);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const session of this.sessions.values()) {
      if (session.internalId !== this.activeSessionId) session.setIsActive(false);
    }
    this.getActiveSession()?.setIsActive(true);
    this.drafts.prune();
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logError("[AgentMode] manager listener threw", e);
      }
    }
  }

  // 反馈服务不可用时，聊天仍可继续。https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  private async connectFeedbackServer(internalId: string): Promise<ReadonlyArray<AgentMcpServer>> {
    const server = this.opts.feedbackServer;
    if (!server || !getSettings().agentMode.offerFeedbackCards) return EMPTY_MCP_SERVERS;
    try {
      return [
        await server.connect(internalId, (draft) =>
          getSettings().agentMode.offerFeedbackCards
            ? (this.sessions.get(internalId)?.offerFeedback(draft) ?? "turned_off")
            : "turned_off"
        ),
      ];
    } catch (err) {
      logWarn("[AgentMode] feedback MCP server unavailable; continuing without it", err);
      return EMPTY_MCP_SERVERS;
    }
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.settingsUnsub();
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = undefined;
    this.contentTracker.dispose();
    logInfo(
      `[AgentMode] shutdown (pool size=${this.sessions.size}, backends=${this.backends.size})`
    );

    const allSessions = Array.from(this.sessions.values());
    await Promise.allSettled(allSessions.map((s) => this.drainAutoSave(s)));
    for (const id of Array.from(this.sessionState.keys())) {
      this.detachAutoSave(id);
    }

    await Promise.allSettled(
      allSessions.map(async (session) => {
        try {
          const status = session.getStatus();
          if (status === "running" || status === "awaiting_permission") {
            // 退出保存的是可继续的暂停，不能先终结任务；确认暂停落盘后才释放界面。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            if (this.backends.get(session.backendId)?.pauseSession) await session.pause();
            else await session.cancel();
          }
        } catch (e) {
          logError("[AgentMode] save active work during shutdown failed", e);
        }
        try {
          await session.dispose();
        } catch (e) {
          logError("[AgentMode] dispose during shutdown failed", e);
        }
      })
    );
    this.opts.feedbackServer?.dispose();
    this.sessions.clear();
    this.chatUIStates.clear();
    this.landingCaptureSignatures.clear();
    this.lastSeenProjectContentEpochBySession.clear();
    this.activeSessionId = null;
    this.activeProjectId = GLOBAL_SCOPE;
    this.scopeSeq++;
    this.lastActiveByScope.clear();
    this.detachedFromTabIds.clear();
    this.firstSessionPromiseByScope.clear();

    const allBackends = Array.from(this.backends.values());
    await Promise.allSettled(
      allBackends.map(async (proc) => {
        try {
          await proc.shutdown();
        } catch (e) {
          logError("[AgentMode] backend shutdown failed", e);
        }
      })
    );
    this.backends.clear();
    for (const unsubscribe of this.backendStorageUnsubscribers.values()) unsubscribe();
    this.backendStorageUnsubscribers.clear();
    this.storageListeners.clear();
    this.starting.clear();
    this.startingBackendId = null;
    this.listeners.clear();
    this.preloadStatus.clear();
    this.preloader.shutdown();
  }

  private absorbIntoEmptyActiveTab(loaded: AgentSession, previousActiveId: string | null): void {
    if (!previousActiveId || previousActiveId === loaded.internalId) return;
    const previous = this.sessions.get(previousActiveId);
    if (!previous || previous.hasUserVisibleMessages()) return;
    const oldIdx = Array.from(this.sessions.keys()).indexOf(previousActiveId);
    if (oldIdx >= 0) {
      this.moveMapEntry(this.sessions, loaded.internalId, oldIdx);
      this.moveMapEntry(this.chatUIStates, loaded.internalId, oldIdx);
    }
    void this.closeSession(previousActiveId).catch((e) =>
      logWarn(`[AgentMode] closing empty tab during history load failed`, e)
    );
  }

  async loadNativeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const requestId = ++this.latestHistoryLoadRequestId;
    const existing = this.findLiveSession(backendId, sessionId);
    if (existing) {
      const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
      await backend.updateSessionMetadata!({ sessionId, lastAccessedAtMs: Date.now() });
      this.setActiveSession(existing.internalId);
      return existing;
    }
    const previousActiveId = this.activeSessionId;
    const { entry, projectId } = await this.readNativeChatEntry(backendId, sessionId);
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);
    let session: AgentSession;
    try {
      session = await this.resumeNativeChat(backendId, sessionId, entry, projectId);
    } catch (err) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw err;
    }
    const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
    await backend.updateSessionMetadata!({ sessionId, lastAccessedAtMs: Date.now() });
    if (requestId === this.latestHistoryLoadRequestId) {
      this.setActiveSession(session.internalId);
      this.absorbIntoEmptyActiveTab(session, previousActiveId);
      this.notify();
    }
    return session;
  }

  private async readNativeChatEntry(
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<{ entry: ListedSessionInfo | null; projectId: ProjectScopeId }> {
    const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
    const { sessions } = await backend.listSessions({ cwd: this.resolveSessionCwd(GLOBAL_SCOPE) });
    const stored = sessions.find((item) => item.sessionId === sessionId);
    if (!stored)
      throw Object.assign(new Error(t("localData.sessionMissing")), { code: "SESSION_NOT_FOUND" });
    const entry = stored;
    const projectId: ProjectScopeId = entry?.projectId ?? GLOBAL_SCOPE;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice(t("agentInfra.session.chatProjectGone"));
      throw new OrphanedProjectError(projectId);
    }
    return { entry, projectId };
  }

  private async resumeNativeChat(
    backendId: BackendId,
    sessionId: SessionId,
    entry: ListedSessionInfo | null,
    projectId: ProjectScopeId
  ): Promise<AgentSession> {
    const session = await this.tryResumeSessionFromHistory(backendId, sessionId, projectId);
    if (!session) {
      throw new Error(`Could not resume session ${sessionId} from the ${backendId} session store.`);
    }
    if (entry?.title) {
      session.restoreLabel(entry.title, entry.titleSource === "user" ? "user" : "agent");
    }
    return session;
  }

  private async tryResumeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId,
    projectId: ProjectScopeId,
    chatInputId?: string,
    seedSelection?: ModelSelection
  ): Promise<AgentSession | null> {
    const existing = this.findLiveSession(backendId, sessionId);
    if (existing) return existing;

    const key = buildNativeChatId(backendId, sessionId);
    const inFlight = this.resumedSessionPromiseById.get(key);
    if (inFlight) return inFlight;

    const resume = this.resumeSessionFromHistory(
      backendId,
      sessionId,
      projectId,
      chatInputId,
      seedSelection
    ).finally(() => {
      if (this.resumedSessionPromiseById.get(key) === resume) {
        this.resumedSessionPromiseById.delete(key);
      }
    });
    this.resumedSessionPromiseById.set(key, resume);
    return resume;
  }

  private async resumeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId,
    projectId: ProjectScopeId,
    chatInputId?: string,
    seedSelection?: ModelSelection
  ): Promise<AgentSession | null> {
    const cwd = this.resolveSessionCwd(projectId);
    const descriptor = this.resolveDescriptor(backendId);

    this.pendingCreates++;
    this.startingBackendId = backendId;
    this.notify();

    let backend: BackendProcess;
    try {
      backend = await this.ensureBackend(backendId, descriptor);
    } catch (err) {
      this.setLastError(err2String(err));
      this.finishPendingCreate();
      return null;
    }

    if (this.disposed) {
      this.finishPendingCreate();
      return null;
    }

    const internalId = uuidv4();
    const mcpServers = await this.connectFeedbackServer(internalId);
    if (this.disposed) {
      this.finishPendingCreate();
      return null;
    }
    // The chat attaches before the backend replays its history, so replayed frames are never in flight without a handler.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/602
    const session = new AgentSession({
      backend,
      backendSessionId: sessionId,
      internalId,
      chatInputId,
      backendId,
      projectId,
      defaultModelSelection: seedSelection,
      defaultMode: null,
      cwd,
      getDescriptor: () => this.opts.resolveDescriptor(backendId),
      runFanoutTurn: (input) => this.runFanoutTurn(input),
      getDisplayName: (id) => this.resolveDescriptor(id).displayName,
      ...(projectId !== GLOBAL_SCOPE
        ? {
            getProjectContextUpdates: () => this.getProjectContextUpdates(internalId, projectId),
            markProjectContextUpdatesDelivered: (epoch: number) =>
              this.markProjectContextUpdatesDelivered(internalId, epoch),
          }
        : {}),
    });

    const openInput = { sessionId, cwd, projectId, mcpServers };
    let resumeResult: LoadSessionOutput | null = null;
    try {
      resumeResult = await backend.loadSession(openInput);
    } catch (err) {
      if (!(err instanceof MethodUnsupportedError)) {
        logWarn(`[AgentMode] loadSession failed for ${sessionId}`, err);
        await session.dispose();
        this.opts.feedbackServer?.disconnect(internalId);
        this.finishPendingCreate();
        return null;
      }
    }

    if (!resumeResult) {
      try {
        resumeResult = await backend.resumeSession(openInput);
      } catch (err) {
        if (err instanceof MethodUnsupportedError) {
          logInfo(
            `[AgentMode] backend ${backendId} does not support session resume; falling back to fresh session`
          );
        } else {
          logWarn(`[AgentMode] resumeSession failed for ${sessionId}`, err);
        }
        await session.dispose();
        this.opts.feedbackServer?.disconnect(internalId);
        this.finishPendingCreate();
        return null;
      }
    }

    if (this.disposed) {
      await session.dispose();
      this.finishPendingCreate();
      return null;
    }

    session.completeResume(resumeResult.state);

    await session.ready;

    // 冷重开沿用会话权限，不能让全局默认自动模式扩大已有会话的授权。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (resumeResult.state?.readOnly !== true)
      await replayPersistedMode(
        session,
        resumeResult.state?.mode?.current ?? this.getDefaultMode(backendId)
      );
    if (this.disposed) {
      await session.dispose();
      this.finishPendingCreate();
      return null;
    }
    if (projectId !== GLOBAL_SCOPE) {
      this.lastSeenProjectContentEpochBySession.set(internalId, RESUMED_SESSION_BEHIND_EPOCH);
    }
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    this.detachedFromTabIds.delete(session.internalId);
    this.attachAutoSave(session);
    this.attachAttentionTracking(session);
    this.lastError = null;
    this.finishPendingCreate();
    logInfo(
      `[AgentMode] resumed session (internal=${session.internalId} backend-id=${sessionId} backend=${backendId})`
    );
    return session;
  }

  private attachAutoSave(session: AgentSession): void {
    const trigger = () => {
      this.scheduleIndexTouch(session);
    };
    const unsubscribe = session.subscribe({
      onMessagesChanged: trigger,
      onStatusChanged: () => {},
      onLabelChanged: trigger,
    });
    this.getSessionState(session.internalId).unsub = unsubscribe;
  }

  async rolloverSession(internalId: string): Promise<AgentSession> {
    const source = this.sessions.get(internalId);
    if (!source) throw new Error("聊天已关闭，请重新打开后再整理。");
    const summarized = await source.rolloverSession();
    // 新聊天只接收后端保存的官方摘要，原聊天保留在标签与历史中，不能再发送一条伪造用户问题。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const next = await this.resumeNativeChat("pi", summarized.sessionId, null, source.projectId);
    this.setActiveSession(next.internalId);
    this.notify();
    return next;
  }

  async exportActiveSession(
    format: "json" | "markdown" = "json"
  ): Promise<{ path: string } | null> {
    const session = this.getActiveSession();
    if (!session?.getBackendSessionId()) throw new Error(t("localData.noChatToExport"));
    const backend = await this.ensureBackend("pi", this.resolveDescriptor("pi"));
    if (!backend.exportSession) throw new MethodUnsupportedError("exportSession");
    const exported = await backend.exportSession({
      sessionId: session.getBackendSessionId()!,
      format,
    });
    const name = exported.suggestedName.replace(/[\\/:]/g, "_").replace(/^\.+/, "");
    if (!name || !name.endsWith(format === "json" ? ".json" : ".md"))
      throw new Error(t("localData.exportNameInvalid"));
    return saveChatExport(name, exported.content, exported.attachments);
  }

  private scheduleIndexTouch(session: AgentSession): void {
    const state = this.getSessionState(session.internalId);
    if (state.indexTimer) window.clearTimeout(state.indexTimer);
    state.indexTimer = window.setTimeout(() => {
      state.indexTimer = undefined;
      this.flushIndexTouch(session).catch((e) =>
        logWarn(`[AgentMode] session-index update failed for ${session.internalId}`, e)
      );
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private async flushIndexTouch(session: AgentSession): Promise<void> {
    if (!this.sessions.has(session.internalId)) return;
    const sessionId = session.getBackendSessionId();
    const backend = this.backends.get("pi");
    if (!sessionId || !backend?.updateSessionMetadata) return;
    const saving = backend.updateSessionMetadata({
      sessionId,
      lastAccessedAtMs: Date.now(),
      title:
        session.getLabel() ??
        deriveChatTitleFromMessages(session.store.getDisplayMessages()) ??
        undefined,
      titleSource: session.getLabelSource() === "user" ? "user" : "agent",
    });
    this.getSessionState(session.internalId).saving = saving.catch(() => undefined);
    await saving;
  }

  async getLocalDataBackend(): Promise<BackendProcess> {
    return this.ensureBackend("pi", this.resolveDescriptor("pi"));
  }

  private readonly storageListeners = new Set<() => void>();
  private readonly backendStorageUnsubscribers = new Map<BackendId, () => void>();

  subscribeStorageChanges(listener: () => void): () => void {
    this.storageListeners.add(listener);
    return () => this.storageListeners.delete(listener);
  }

  private async drainAutoSave(session: AgentSession): Promise<void> {
    const state = this.sessionState.get(session.internalId);
    if (state?.indexTimer) {
      window.clearTimeout(state.indexTimer);
      state.indexTimer = undefined;
      try {
        await this.flushIndexTouch(session);
      } catch (e) {
        logWarn(`[AgentMode] drain session-index update failed for ${session.internalId}`, e);
      }
    }
    // A save that already started is in neither timer; closing must still wait for it.
    // https://github.com/logancyang/obsidian-copilot/issues/2888
    await state?.saving;
  }

  private detachAutoSave(internalId: string): void {
    const state = this.sessionState.get(internalId);
    if (!state) return;
    this.stopAutoSave(state);
    state.attentionUnsub?.();
    this.sessionState.delete(internalId);
  }

  private stopAutoSave(state: { indexTimer?: number; unsub?: () => void }): void {
    window.clearTimeout(state.indexTimer);
    state.indexTimer = undefined;
    state.unsub?.();
    state.unsub = undefined;
  }

  private attachAttentionTracking(session: AgentSession): void {
    let prev = session.getStatus();
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (next) => {
        const wasRunning = prev === "running";
        const isRunning = next === "running";
        prev = next;
        void this.flushDeferredBackendRestartIfReady(session.backendId);
        // Only a turn that actually ran can newly demand attention.
        // https://github.com/logancyang/obsidian-copilot/issues/2987
        const wantsUser = wasRunning && ATTENTION_TRIGGER_STATUSES.has(next);
        if (wantsUser) this.signalSessionNeedsAttention(session);
        if (wasRunning !== isRunning) this.notify();
      },
    });
    this.getSessionState(session.internalId).attentionUnsub = unsubscribe;
  }

  private isSessionFocused(session: AgentSession): boolean {
    if (this.activeSessionId !== session.internalId) return false;
    // A sidebar input can own keyboard focus while Obsidian keeps the center
    // editor as its most recent leaf. https://github.com/logancyang/obsidian-copilot/issues/2987
    return this.app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE).some((leaf) => {
      const container = leaf.view.containerEl;
      const doc = container.doc;
      const activeElement = doc.activeElement;
      return doc.hasFocus() && activeElement !== null && container.contains(activeElement);
    });
  }

  private signalSessionNeedsAttention(session: AgentSession): void {
    // The dot identifies a different Agent tab that wants the user; keyboard
    // focus does not change which tab is selected. https://github.com/logancyang/obsidian-copilot/issues/2987
    if (this.activeSessionId !== session.internalId) session.markNeedsAttention();
    // Sound follows real focus so a selected but unattended chat can still
    // call the user back. https://github.com/logancyang/obsidian-copilot/issues/2987
    if (this.isSessionFocused(session)) return;
    this.playConfiguredNotificationSound();
  }

  private playConfiguredNotificationSound(): void {
    const { notificationSound, notificationSoundId } = getSettings().agentMode;
    if (!notificationSound) return;
    playNotificationSound(notificationSoundId);
  }

  private wireProcessCallbacks(backendId: BackendId, proc: BackendProcess): void {
    // 更换引擎后页面仍须收到删除与写入通知，不能把订阅留在已关闭的实例上。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    this.backendStorageUnsubscribers.get(backendId)?.();
    const unsubscribe = proc.subscribeStorageChanges?.(() => {
      for (const listener of this.storageListeners) {
        try {
          listener();
        } catch (error) {
          logWarn("[AgentMode] storage listener failed", error);
        }
      }
    });
    if (unsubscribe) this.backendStorageUnsubscribers.set(backendId, unsubscribe);
    else this.backendStorageUnsubscribers.delete(backendId);
    proc.setPermissionPrompter(this.opts.permissionPrompter);
    proc.setUnhealthyHandler?.(() => {
      if (this.disposed || this.backends.get(backendId) !== proc) return;
      // The rejected turn must finish writing its error before replacement.
      // restartBackend defers while that session is running.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/561
      void this.restartBackend(backendId, "internal service stopped").catch((err) => {
        this.setLastError(err2String(err));
        logError(`[AgentMode] ${backendId} internal service restart failed`, err);
      });
    });
    if (this.opts.askUserQuestionPrompter) {
      proc.setAskUserQuestionPrompter?.(this.opts.askUserQuestionPrompter);
    }
    proc.setReadOnlySessionPredicate?.((sessionId) => this.isReadOnlyFanoutSession(sessionId));
  }

  private async ensureBackend(
    backendId: BackendId,
    descriptor: BackendDescriptor
  ): Promise<BackendProcess> {
    await this.opts.beforeBackendStart?.(backendId);
    if (this.disposed) throw new Error("AgentSessionManager has been shut down");
    const existing = this.backends.get(backendId);
    if (existing && existing.isRunning()) return existing;
    const inflight = this.starting.get(backendId);
    if (inflight) return inflight;
    const startPromise = (async () => {
      if (!this.isPreloadReady(backendId)) {
        await this.preloader.preload(backendId);
      }

      const warm = this.preloader.takeWarm(backendId);
      if (warm) {
        this.wireProcessCallbacks(backendId, warm.proc);
        this.installBackendExitHandler(backendId, warm.proc, descriptor);
        this.backends.set(backendId, warm.proc);
        return warm.proc;
      }

      const proc = descriptor.createBackendProcess({
        plugin: this.plugin,
        app: this.app,
        clientVersion: this.plugin.manifest.version,
        descriptor,
      });
      if (proc.start) await proc.start();
      this.wireProcessCallbacks(backendId, proc);
      this.installBackendExitHandler(backendId, proc, descriptor);
      this.backends.set(backendId, proc);
      return proc;
    })();
    this.starting.set(backendId, startPromise);
    try {
      return await startPromise;
    } finally {
      this.starting.delete(backendId);
    }
  }

  private installBackendExitHandler(
    backendId: BackendId,
    proc: BackendProcess,
    descriptor: BackendDescriptor
  ): void {
    proc.onExit(() => {
      if (this.backends.get(backendId) === proc) {
        this.backends.delete(backendId);
        // Retry spawns from current settings; a dead generation has no config left to apply.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
        this.heldConfigChanges.delete(backendId);
      }
      const dead = Array.from(this.sessions.values()).filter((s) => s.backendId === backendId);
      if (dead.length === 0) return;
      for (const s of dead) {
        this.detachAutoSave(s.internalId);
        this.opts.feedbackServer?.disconnect(s.internalId);
        this.sessions.delete(s.internalId);
        this.chatUIStates.delete(s.internalId);
        this.landingCaptureSignatures.delete(s.internalId);
        this.lastSeenProjectContentEpochBySession.delete(s.internalId);
        this.detachedFromTabIds.delete(s.internalId);
        if (this.lastActiveByScope.get(s.projectId) === s.internalId) {
          this.lastActiveByScope.delete(s.projectId);
        }
        s.cancel().catch(() => {});
        s.dispose().catch(() => {});
      }
      if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
        let next: AgentSession | undefined;
        for (const s of this.sessions.values()) {
          if (!this.detachedFromTabIds.has(s.internalId)) {
            next = s;
            break;
          }
        }
        this.activeSessionId = next?.internalId ?? null;
        if (next) {
          this.activeProjectId = next.projectId;
          this.scopeSeq++;
        }
      }
      this.setLastError(`${descriptor.displayName} backend exited unexpectedly.`);
      this.notify();
    });
  }

  private hasBusySession(backendId: BackendId): boolean {
    return Array.from(this.sessions.values()).some((session) => {
      if (session.backendId !== backendId) return false;
      const status = session.getStatus();
      return status === "starting" || status === "running" || status === "awaiting_permission";
    });
  }

  private async flushDeferredBackendRestartIfReady(backendId: BackendId): Promise<void> {
    const pending = this.pendingBackendRestarts.get(backendId);
    if (!pending) return;
    if (!pending.immediate && this.hasBusySession(backendId)) return;
    this.pendingBackendRestarts.delete(backendId);
    try {
      await this.restartBackendNow(backendId, pending.reason, pending.immediate);
    } catch (err) {
      this.setLastError(err2String(err));
      logError(`[AgentMode] deferred ${backendId} backend restart failed`, err);
      this.notify();
    }
  }

  private async rebuildReplacedSession(
    backendId: BackendId,
    projectId: ProjectScopeId,
    chatInputId: string | undefined,
    resumableSessionId: SessionId | undefined,
    label: string | null,
    labelSource: "user" | "agent" | null,
    carriedSelection?: ModelSelection
  ): Promise<AgentSession> {
    // A model-setting change can trigger this restart, so validate the carried
    // selection before seeding either the resumed or the fallback session.
    // https://github.com/logancyang/obsidian-copilot/issues/3319
    const seedSelection = carriedSelection
      ? (this.getSeedSelection(backendId, carriedSelection) ?? undefined)
      : undefined;
    if (resumableSessionId) {
      const resumed = await this.tryResumeSessionFromHistory(
        backendId,
        resumableSessionId,
        projectId,
        chatInputId,
        seedSelection
      ).catch((e) => {
        logWarn(`[AgentMode] resume after ${backendId} restart failed`, e);
        return null;
      });
      if (resumed) {
        if (label && !resumed.getLabel()) resumed.restoreLabel(label, labelSource ?? "agent");
        this.setActiveSession(resumed.internalId);
        return resumed;
      }
      const message = t("agentChat.history.restoreUnavailable");
      this.setLastError(message);
      throw new Error(message);
    }
    return this.createSession(backendId, projectId, seedSelection, chatInputId);
  }

  private async restartBackendNow(
    backendId: BackendId,
    reason: string,
    immediate = false
  ): Promise<void> {
    if (this.restartingBackends.has(backendId)) {
      const prev = this.pendingBackendRestarts.get(backendId);
      this.pendingBackendRestarts.set(backendId, {
        reason: prev ? `${prev.reason}; ${reason}` : reason,
        immediate: (prev?.immediate ?? false) || immediate,
      });
      // A Search scope change queued behind another refresh must keep its
      // non-deferrable privacy semantics when the first refresh completes.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/121
      return;
    }
    const proc = this.backends.get(backendId);
    if (!proc) return;
    this.restartingBackends.add(backendId);
    // Every restart rebuilds spawn config from current settings, so nothing is
    // held once one runs — including restarts this hold never asked for, such
    // as a tightened privacy boundary or a binary that changed underneath.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
    this.heldConfigChanges.delete(backendId);
    logInfo(`[AgentMode] restarting ${backendId} backend: ${reason}`);
    const retainedChatInputIds: string[] = [];
    try {
      const affected = Array.from(this.sessions.values()).filter((s) => s.backendId === backendId);
      const activeSessionId = this.activeSessionId;
      const activeProjectId = this.activeProjectId;
      // Every affected composer must stay owned across the gap, including tabs
      // outside the active scope, or the draft store prunes their unsent text.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
      const replacements = this.canStartBackend(backendId)
        ? affected.map((session) => ({
            internalId: session.internalId,
            projectId: session.projectId,
            chatInputId: session.chatInputId,
            resumableSessionId: session.getBackendSessionId() ?? undefined,
            label: session.getLabel(),
            labelSource: session.getLabelSource(),
            // The displayed selection is otherwise lost when the process restarts.
            // https://github.com/logancyang/obsidian-copilot/issues/3319
            seedSelection: session.getState()?.model?.current,
            detached: this.detachedFromTabIds.has(session.internalId),
          }))
        : [];
      for (const replacement of replacements) {
        retainedChatInputIds.push(replacement.chatInputId);
        this.retainedChatInputIds.add(replacement.chatInputId);
      }
      for (const session of affected) {
        await this.closeSession(session.internalId);
      }
      await proc.shutdown();
      if (this.backends.get(backendId) === proc) {
        this.backends.delete(backendId);
      }
      this.preloader.clearCached(backendId);
      new Notice(
        t("agentInfra.session.refreshed", { agent: this.resolveDescriptor(backendId).displayName })
      );
      if (!this.disposed && this.canStartBackend(backendId)) {
        const probe = this.preloader.preload(backendId);
        this.registerPreload(backendId, probe);
        if (replacements.length > 0 && !this.disposed) {
          await probe;
          let selectedId = activeSessionId;
          for (const replacement of replacements) {
            const rebuilt = await this.rebuildReplacedSession(
              backendId,
              replacement.projectId,
              replacement.chatInputId,
              replacement.resumableSessionId,
              replacement.label,
              replacement.labelSource,
              replacement.seedSelection
            );
            if (replacement.detached) this.detachedFromTabIds.add(rebuilt.internalId);
            if (replacement.internalId === activeSessionId) selectedId = rebuilt.internalId;
          }
          if (selectedId) this.setActiveSession(selectedId);
          else {
            this.activeSessionId = null;
            this.activeProjectId = activeProjectId;
          }
        }
      }
    } finally {
      this.restartingBackends.delete(backendId);
      for (const id of retainedChatInputIds) this.retainedChatInputIds.delete(id);
      this.notify();
    }
    const queued = this.pendingBackendRestarts.get(backendId);
    if (queued !== undefined && !this.disposed) {
      this.pendingBackendRestarts.delete(backendId);
      if (!queued.immediate && this.hasBusySession(backendId)) {
        this.pendingBackendRestarts.set(backendId, queued);
        return;
      }
      try {
        await this.restartBackendNow(backendId, queued.reason, queued.immediate);
      } catch (err) {
        this.setLastError(err2String(err));
        logError(`[AgentMode] queued ${backendId} backend restart failed`, err);
        this.notify();
      }
    }
  }
}
