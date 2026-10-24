import { FileSystemAdapter, App, Notice } from "obsidian";
import { mockTFile } from "@/__tests__/mockObsidian";
import { waitFor } from "@testing-library/react";
import { AgentSession } from "./AgentSession";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { AI_SENDER, CHAT_AGENT_VIEWTYPE, USER_SENDER } from "@/constants";
import { playNotificationSound } from "@/utils/notificationSound";
import { AgentSessionManager } from "./AgentSessionManager";
import { GLOBAL_SCOPE } from "./scope";
import {
  getSettings as mockedGetSettings,
  setSettings as mockedSetSettings,
} from "@/settings/model";
import * as projectsState from "@/projects/state";
import { buildProjectContext } from "@/context/manifestBuilder";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { type ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";
import { t } from "@/i18n";
import { saveChatExport } from "@/services/saveChatExport";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type {
  AgentChatMessage,
  BackendProcess,
  BackendDescriptor,
  BackendId,
  BackendModelCatalog,
  BackendState,
  ModelSelection,
  ListedSessionInfo,
  UpdateSessionMetadataInput,
  SessionEvent,
} from "./types";

const mockBuildProjectContext = buildProjectContext as jest.Mock;
const getSettingsMock = mockedGetSettings as jest.Mock;
const setSettingsMock = mockedSetSettings as jest.Mock;
const noticeMock = Notice as unknown as jest.Mock;

jest.mock("@/services/saveChatExport", () => ({ saveChatExport: jest.fn() }));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const settingsChangeCallbacks = new Set<
  (prev: { agentMode: unknown }, next: { agentMode: unknown }) => void
>();

const mockTouchProjectLastUsed = jest.fn(async () => undefined);
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: {
    getInstance: jest.fn(() => ({ touchProjectLastUsed: mockTouchProjectLastUsed })),
  },
}));

jest.mock("@/context/manifestBuilder", () => ({
  buildProjectContext: jest.fn(() => "<project_context>\n</project_context>"),
}));

let mockNotificationSound = true;

jest.mock("@/utils/notificationSound", () => ({
  playNotificationSound: jest.fn(),
}));

function mockDefaultSettings() {
  return {
    agentMode: {
      activeBackend: "pi",
      backends: {},
      notificationSound: mockNotificationSound,
      notificationSoundId: "piano",
    },
  };
}

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(mockDefaultSettings),
  setSettings: jest.fn(),
  subscribeToSettingsChange: jest.fn(
    (cb: (prev: { agentMode: unknown }, next: { agentMode: unknown }) => void) => {
      settingsChangeCallbacks.add(cb);
      return () => settingsChangeCallbacks.delete(cb);
    }
  ),
  settingsStore: { get: jest.fn(() => ({})), set: jest.fn() },
}));

function emitSettingsChange(prev: { agentMode: unknown }, next: { agentMode: unknown }): void {
  for (const cb of settingsChangeCallbacks) cb(prev, next);
}

function mockSavedDefault(saved: { baseModelId: string; effort: string | null } | null): void {
  getSettingsMock.mockReturnValue({
    agentMode: {
      activeBackend: "pi",
      backends: { pi: { defaultModel: saved } },
      notificationSound: false,
      notificationSoundId: "piano",
    },
  });
}

function changeSavedDefault(
  from: { baseModelId: string; effort: string | null } | null,
  to: { baseModelId: string; effort: string | null } | null
): void {
  mockSavedDefault(to);
  emitSettingsChange(
    { agentMode: { backends: { pi: { defaultModel: from } } } },
    { agentMode: { backends: { pi: { defaultModel: to } } } }
  );
}

let mockBackendIsRunning = true;
const mockBackendShutdown = jest.fn(async () => undefined);
const mockBackendStart = jest.fn(async () => undefined);
const mockBackendExitListeners = new Set<() => void>();
const mockSetPermissionPrompter = jest.fn();
let mockUnhealthyHandler: (() => void) | null = null;

const storedChats = new Map<string, ListedSessionInfo>();

function storeChat(
  sessionId: string,
  metadata: Partial<ListedSessionInfo> = {}
): ListedSessionInfo {
  const stored = {
    sessionId,
    cwd: "/vault",
    createdAtMs: 1000,
    lastAccessedAtMs: 2000,
    ...metadata,
  };
  storedChats.set(sessionId, stored);
  return stored;
}

function makeMockBackendProcess() {
  return {
    loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    })),
    resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    })),
    listSessions: jest.fn(async () => ({ sessions: [...storedChats.values()] })),
    updateSessionMetadata: jest.fn(
      async ({ sessionId, ...metadata }: UpdateSessionMetadataInput) => {
        const stored = storedChats.get(sessionId);
        if (!stored) throw new Error("Session not found");
        const updated = {
          ...stored,
          ...metadata,
          pinnedAt: metadata.pinnedAt === null ? undefined : (metadata.pinnedAt ?? stored.pinnedAt),
        };
        storedChats.set(sessionId, updated);
        return updated;
      }
    ),
    forkSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
      const source = storedChats.get(sessionId)!;
      const copy = storeChat(`${sessionId}-fork`, { ...source, sessionId: `${sessionId}-fork` });
      return { sessionId: copy.sessionId, state: { model: null, mode: null } };
    }),
    deleteSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
      storedChats.delete(sessionId);
    }),
    start: mockBackendStart,
    setPermissionPrompter: mockSetPermissionPrompter,
    setUnhealthyHandler: (handler: () => void) => {
      mockUnhealthyHandler = handler;
    },
    onExit: (fn: () => void) => {
      mockBackendExitListeners.add(fn);
      return () => mockBackendExitListeners.delete(fn);
    },
    isRunning: () => mockBackendIsRunning,
    shutdown: mockBackendShutdown,
    closeSession: jest.fn(async (_params: { sessionId: string }) => undefined),
    registerSessionHandler: jest.fn(() => () => {}),
  };
}

const mockSessionDispose = jest.fn(async () => undefined);
const mockSessionCancel = jest.fn(async () => undefined);
let nextBackendSessionId = 1;

type MockSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

interface MockSessionTestHandle {
  setStatus(status: MockSessionStatus): void;
  setMessages(messages: { message: string }[], notify?: boolean): void;
  setHasUserVisibleMessages(value: boolean): void;
}

const sessionTestHandles = new Map<string, MockSessionTestHandle>();

function getSessionTestHandle(session: AgentSession): MockSessionTestHandle {
  const handle = sessionTestHandles.get(session.internalId);
  if (!handle) throw new Error(`No test handle for ${session.internalId}`);
  return handle;
}

function makeMockSession(overrides: {
  internalId: string;
  chatInputId?: string;
  backendSessionId?: string;
  backendId: string;
  backend?: BackendProcess;
  projectId?: string;
  cwd?: string;
  ready?: Promise<void>;
  label?: string;
}): AgentSession {
  const sessionId = overrides.backendSessionId ?? `root-backend-${nextBackendSessionId++}`;
  storeChat(sessionId, { projectId: overrides.projectId });
  let label: string | null = overrides.label ?? null;
  let labelSource: "user" | "agent" | null = overrides.label ? "agent" : null;
  let status: MockSessionStatus = "idle";
  let needsAttention = false;
  let displayMessages: { message: string }[] = [];
  let hasUserVisibleMessages = false;
  const listeners = new Set<{
    onMessagesChanged?: () => void;
    onStatusChanged?: (s: typeof status) => void;
    onNeedsAttentionChanged?: (v: boolean) => void;
  }>();
  const session = {
    internalId: overrides.internalId,
    chatInputId: overrides.chatInputId ?? overrides.internalId,
    backendId: overrides.backendId,
    projectId: overrides.projectId ?? GLOBAL_SCOPE,
    cwd: overrides.cwd ?? null,
    ready: overrides.ready ?? Promise.resolve(),
    getBackendSessionId: () => sessionId,
    getStatus: () => status,
    getRunState: () => null,
    store: { getDisplayMessages: () => displayMessages },
    cancel: mockSessionCancel,
    pause: AgentSession.prototype.pause,
    backend: overrides.backend,
    backendSessionId: sessionId,
    releaseBackendSession: AgentSession.prototype.releaseBackendSession,
    dispose: mockSessionDispose,
    setIsActive: jest.fn(),
    setModel: jest.fn(),
    setMode: jest.fn(),
    setConfigOption: jest.fn(),
    getLabel: () => label,
    getLabelSource: () => labelSource,
    restoreLabel: (next: string, source: "user" | "agent") => {
      label = next;
      labelSource = source;
    },
    setLabel: jest.fn(),
    loadDisplayMessages: jest.fn((messages) => {
      displayMessages = messages;
      hasUserVisibleMessages = messages.length > 0;
    }),
    seedSessionUsage: jest.fn(),
    offerFeedback: jest.fn(() => "shown"),
    getSessionUsage: () => null,
    subscribe: (l: Parameters<typeof listeners.add>[0]) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    hasUserVisibleMessages: () => hasUserVisibleMessages,
    getState: () => null,
    getRecoveryState: () => null,
    getRawSnapshot: () => ({ models: null, modes: null, configOptions: null }),
    getNeedsAttention: () => needsAttention,
    markNeedsAttention: () => {
      if (needsAttention) return;
      needsAttention = true;
      for (const l of listeners) l.onNeedsAttentionChanged?.(true);
    },
    clearNeedsAttention: () => {
      if (!needsAttention) return;
      needsAttention = false;
      for (const l of listeners) l.onNeedsAttentionChanged?.(false);
    },
  } as unknown as AgentSession;
  sessionTestHandles.set(overrides.internalId, {
    setStatus: (next) => {
      if (status === next) return;
      status = next;
      for (const l of listeners) l.onStatusChanged?.(next);
    },
    setMessages: (messages, notify = false) => {
      displayMessages = messages;
      if (notify) for (const l of listeners) l.onMessagesChanged?.();
    },
    setHasUserVisibleMessages: (value) => {
      hasUserVisibleMessages = value;
    },
  });
  return session;
}

const sessionCreateSpy = jest.spyOn(AgentSession, "start").mockImplementation((opts) =>
  makeMockSession({
    internalId: opts.internalId,
    chatInputId: opts.chatInputId,
    backendId: opts.backendId,
    backend: opts.backend,
    projectId: opts.projectId,
    cwd: opts.cwd ?? undefined,
  })
);

type MockAgentChatFocus =
  | "none"
  | "inside"
  | "inside-sidebar"
  | "outside"
  | "other-leaf"
  | "unfocused-window";
let mockAgentChatFocus: MockAgentChatFocus = "none";

function buildWorkspace(): unknown {
  const inside = {} as Element;
  const outside = {} as Element;
  const ownerDocument = {
    hasFocus: () => mockAgentChatFocus !== "unfocused-window",
    get activeElement() {
      return ["inside", "inside-sidebar", "unfocused-window"].includes(mockAgentChatFocus)
        ? inside
        : outside;
    },
  } as Document;
  const containerEl = {
    doc: ownerDocument,
    ownerDocument,
    contains: (element: Element | null) => element === inside,
  } as HTMLElement;
  const chatLeaf = {
    view: {
      containerEl,
      getViewType: () => CHAT_AGENT_VIEWTYPE,
    },
  };
  const otherLeaf = {
    view: {
      containerEl: { ownerDocument } as HTMLElement,
      getViewType: () => "markdown",
    },
  };
  return {
    getMostRecentLeaf: jest.fn(() => {
      if (mockAgentChatFocus === "none") return null;
      if (["inside-sidebar", "other-leaf"].includes(mockAgentChatFocus)) return otherLeaf;
      return chatLeaf;
    }),
    getLeavesOfType: jest.fn((viewType: string) =>
      viewType === CHAT_AGENT_VIEWTYPE ? [chatLeaf] : []
    ),
    getActiveFile: jest.fn(() => null),
  };
}

function buildApp(basePath = "/vault"): App {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(basePath);
  const events = {
    on: jest.fn(() => ({}) as never),
    offref: jest.fn(),
  };
  const vaultFiles = {
    getAbstractFileByPath: jest.fn(() => null),
    getFiles: jest.fn(() => []),
    create: jest.fn(),
    read: jest.fn(async () => ""),
    modify: jest.fn(),
  };
  return {
    vault: { adapter, ...events, ...vaultFiles },
    metadataCache: { ...events },
    workspace: buildWorkspace(),
  } as unknown as App;
}

function buildDescriptor(overrides: Record<string, unknown> = {}): BackendDescriptor {
  return {
    id: "pi",
    displayName: "pi",
    summarizesSessionTitle: true,
    createBackendProcess: jest.fn(() => makeMockBackendProcess()),
    ...overrides,
  } as unknown as BackendDescriptor;
}

function buildApplySelectionDescriptor(applySelection: jest.Mock): BackendDescriptor {
  return buildDescriptor({
    wire: {
      encode: ({ baseModelId, effort }: { baseModelId: string; effort: string | null }) =>
        effort ? `${baseModelId}/${effort}` : baseModelId,
      decode: (id: string) => ({ selection: { baseModelId: id, effort: null }, provider: null }),
    },
    applySelection,
  });
}

function modelCatalog(baseModelId: string): BackendModelCatalog {
  return {
    availableModels: [{ baseModelId, name: baseModelId, provider: null, effortOptions: [] }],
  };
}

type ManagerDeps = ConstructorParameters<typeof AgentSessionManager>[2];

interface ManagerOptions {
  app?: App;
  plugin?: unknown;
  descriptor?: BackendDescriptor;
  resolveDescriptor?: ManagerDeps["resolveDescriptor"];
  preloader?: Record<string, unknown>;
  beforeBackendStart?: ManagerDeps["beforeBackendStart"];
  feedbackServer?: ManagerDeps["feedbackServer"];
}

const builtManagers: AgentSessionManager[] = [];

function buildManager(options: ManagerOptions = {}): AgentSessionManager {
  const descriptor = options.descriptor ?? buildDescriptor();
  const manager = new AgentSessionManager(
    options.app ?? buildApp(),
    (options.plugin ?? {
      manifest: { version: "1.0.0" },
    }) as ConstructorParameters<typeof AgentSessionManager>[1],
    {
      permissionPrompter: jest.fn(),
      resolveDescriptor:
        options.resolveDescriptor ?? ((id) => (id === descriptor.id ? descriptor : undefined)),
      modelPreloader: {
        getCachedModelCatalog: jest.fn(() => null),
        preload: jest.fn(async () => undefined),
        refresh: jest.fn(() => null),
        subscribe: jest.fn(() => () => {}),
        shutdown: jest.fn(),
        clearCached: jest.fn(),
        takeWarm: jest.fn(() => null),
        getWarmProcs: jest.fn(() => []),
        ...options.preloader,
      } as unknown as ManagerDeps["modelPreloader"],
      beforeBackendStart: options.beforeBackendStart,
      feedbackServer: options.feedbackServer,
    }
  );
  builtManagers.push(manager);
  return manager;
}

const FEEDBACK_CHANNEL = Object.freeze({
  name: "vault-agent",
  url: "http://127.0.0.1:4100/mcp",
  headers: Object.freeze({ Authorization: "Bearer t0k3n" }),
});

function buildFeedbackServer(connect: jest.Mock = jest.fn(async () => FEEDBACK_CHANNEL)) {
  return { connect, disconnect: jest.fn(), dispose: jest.fn() };
}

function offerFeedbackCards(enabled: boolean): void {
  getSettingsMock.mockReturnValue({
    ...mockDefaultSettings(),
    agentMode: { ...mockDefaultSettings().agentMode, offerFeedbackCards: enabled },
  });
}

const FEEDBACK_DRAFT = { title: "t", whatHappened: "w", userSaid: "u", repro: "r" };

function seedProjects(...ids: string[]): void {
  projectsState.updateCachedProjectRecords(
    ids.map(
      (id) =>
        ({
          project: { id },
          filePath: `Projects/${id}/project.md`,
          folderName: id,
        }) as unknown as ProjectFileRecord
    )
  );
}

const flushTimers = () => new Promise((resolve) => window.setTimeout(resolve, 0));

function nativeIdOf(session: AgentSession): string {
  return buildNativeChatId(session.backendId, session.getBackendSessionId()!);
}

function endTurn(session: AgentSession, endStatus: MockSessionStatus = "idle"): void {
  const handle = getSessionTestHandle(session);
  handle.setStatus("running");
  handle.setStatus(endStatus);
}

async function createActiveAndBackgroundSessions(
  mgr: AgentSessionManager
): Promise<{ active: AgentSession; background: AgentSession }> {
  const active = await mgr.createSession();
  const background = await mgr.createSession();
  mgr.setActiveSession(active.internalId);
  return { active, background };
}

async function enterWithConversation(
  mgr: AgentSessionManager,
  projectId: string
): Promise<AgentSession> {
  await mgr.enterProject(projectId);
  const session = mgr.getActiveSession()!;
  getSessionTestHandle(session).setHasUserVisibleMessages(true);
  await mgr.exitProject();
  return session;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function buildResumeOnlyBackend(overrides: Record<string, unknown> = {}) {
  return {
    ...makeMockBackendProcess(),
    loadSession: jest.fn(async () => {
      throw new MethodUnsupportedError("session/load");
    }),
    resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    })),
    ...overrides,
  };
}

function holdNextBackendShutdown(): { started: Promise<void>; release: () => void } {
  let release!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    mockBackendShutdown.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveStarted();
          release = () => resolve(undefined);
        })
    );
  });
  return { started, release: () => release() };
}

type ReplayFrame = SessionEvent["update"];

function buildReplayingBackend(
  opts: {
    onLoad?: (emit: (update: ReplayFrame) => void) => void;
    loadSession?: jest.Mock;
    resumeSession?: jest.Mock;
  } = {}
) {
  const handlers = new Map<string, (event: SessionEvent) => void>();
  const buffered: SessionEvent[] = [];
  const unregister = jest.fn();
  const handlerCountAtOpen: Record<"load" | "resume", number> = { load: -1, resume: -1 };
  const deliver = (sessionId: string, update: ReplayFrame) => {
    const handler = handlers.get(sessionId);
    if (handler) handler({ sessionId, update });
    else buffered.push({ sessionId, update });
  };
  const state = { model: null, mode: null };
  const backend = {
    ...makeMockBackendProcess(),
    registerSessionHandler: jest.fn((sessionId: string, handler: (event: SessionEvent) => void) => {
      handlers.set(sessionId, handler);
      for (const event of buffered.splice(0)) handler(event);
      return unregister;
    }),
    loadSession:
      opts.loadSession ??
      jest.fn(async ({ sessionId }: { sessionId: string }) => {
        handlerCountAtOpen.load = handlers.size;
        opts.onLoad?.((update) => deliver(sessionId, update));
        return { sessionId, state };
      }),
    resumeSession:
      opts.resumeSession ??
      jest.fn(async ({ sessionId }: { sessionId: string }) => {
        handlerCountAtOpen.resume = handlers.size;
        return { sessionId, state };
      }),
  };
  return { backend, unregister, handlerCountAtOpen, emit: deliver };
}

const replayChunk = (
  sessionUpdate: "user_message_chunk" | "agent_message_chunk",
  text: string,
  messageId: string
): ReplayFrame => ({ sessionUpdate, content: { type: "text", text }, messageId });

function senderAndText(session: AgentSession): [string, string][] {
  return session.store.getDisplayMessages().map((m) => [m.sender, m.message]);
}

function buildManagerWithReplay(
  backendOverrides: Record<string, unknown> = {},
  descriptorOverrides: Partial<BackendDescriptor> = {},
  feedbackServer?: ManagerDeps["feedbackServer"]
): AgentSessionManager {
  const backend = {
    ...makeMockBackendProcess(),
    loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    })),
    ...backendOverrides,
  };
  return buildManager({
    descriptor: buildDescriptor({ createBackendProcess: () => backend, ...descriptorOverrides }),
    feedbackServer,
  });
}

function readPersistedDefault(
  setSettings: jest.Mock,
  backendId: string
): { baseModelId: string; effort: string | null } | undefined {
  let backends: Record<string, { defaultModel?: { baseModelId: string; effort: string | null } }> =
    {};
  for (const call of setSettings.mock.calls) {
    const updater = call[0];
    if (typeof updater !== "function") continue;
    const patch = updater({ agentMode: { backends } });
    if (patch?.agentMode?.backends) {
      backends = { ...backends, ...patch.agentMode.backends };
    }
  }
  return backends[backendId]?.defaultModel;
}

beforeEach(() => {
  mockBackendIsRunning = true;
  mockNotificationSound = true;
  mockAgentChatFocus = "none";
  (playNotificationSound as jest.Mock).mockClear();
  mockBackendStart.mockClear();
  mockBackendShutdown.mockClear();
  mockSetPermissionPrompter.mockClear();
  mockUnhealthyHandler = null;
  mockBackendExitListeners.clear();
  mockSessionCancel.mockClear();
  mockSessionDispose.mockClear();
  sessionCreateSpy.mockClear();
  nextBackendSessionId = 1;
  settingsChangeCallbacks.clear();
  getSettingsMock.mockImplementation(mockDefaultSettings);
  setSettingsMock.mockClear();
  noticeMock.mockClear();
  mockBuildProjectContext.mockClear();
  mockTouchProjectLastUsed.mockClear();
  storedChats.clear();
  projectsState.updateCachedProjectRecords([]);
});

afterEach(async () => {
  jest.useRealTimers();
  await Promise.all(builtManagers.splice(0).map((mgr) => mgr.shutdown().catch(() => {})));
  projectsState.updateCachedProjectRecords([]);
});

function buildHistoryHarness(
  opts: {
    sessions?: ListedSessionInfo[];
    listSessions?: jest.Mock;
    backendId?: BackendId;
    createBackendProcess?: jest.Mock;
  } = {}
) {
  for (const entry of opts.sessions ?? [{ sessionId: "root-saved-chat", cwd: "/vault" }]) {
    storeChat(entry.sessionId, entry);
  }
  const backend = opts.createBackendProcess?.() ?? makeMockBackendProcess();
  if (opts.listSessions) backend.listSessions = opts.listSessions;
  const descriptor = buildDescriptor({
    id: opts.backendId ?? "pi",
    createBackendProcess: jest.fn(() => backend),
  });
  const app = buildApp();
  const manager = buildManager({ app, descriptor });
  return { manager, descriptor, backend, app };
}

const HISTORY_PROJECT_ID = "proj-1";

// The removed Codex ACP chain used to supply this inventory-free mapping; the session contract it
// exercised still matters, so the fixture lives with the test.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
describe("AgentSessionManager", () => {
  describe("AgentSessionManager", () => {
    describe("constructor", () => {
      async function buildManagerWithLiveSession(
        applySelection: jest.Mock,
        preloader: Record<string, unknown> = {}
      ): Promise<{ mgr: AgentSessionManager; session: AgentSession }> {
        const mgr = buildManager({
          descriptor: buildApplySelectionDescriptor(applySelection),
          preloader,
        });
        return { mgr, session: await mgr.createSession() };
      }
      async function flushApplyChain(): Promise<void> {
        for (let i = 0; i < 12; i++) await Promise.resolve();
      }

      it("re-applies a changed default to a live session on that backend", async () => {
        const applySelection = jest.fn(async () => {});
        const { session } = await buildManagerWithLiveSession(applySelection);

        changeSavedDefault(null, { baseModelId: "opus", effort: "high" });
        await flushApplyChain();

        expect(applySelection).toHaveBeenCalledWith(session, {
          baseModelId: "opus",
          effort: "high",
        });
      });

      it("ignores an unchanged default and other backends' changes", async () => {
        const applySelection = jest.fn(async () => {});
        await buildManagerWithLiveSession(applySelection);

        const same = { baseModelId: "opus", effort: "high" };
        changeSavedDefault(same, { ...same });
        emitSettingsChange(
          { agentMode: { backends: { claude: { defaultModel: null } } } },
          {
            agentMode: {
              backends: { claude: { defaultModel: { baseModelId: "x", effort: null } } },
            },
          }
        );
        await flushApplyChain();

        expect(applySelection).not.toHaveBeenCalled();
      });

      it("leaves a live session unchanged when the explicit default is cleared", async () => {
        const applySelection = jest.fn(async () => {});
        await buildManagerWithLiveSession(applySelection, {
          getCachedModelCatalog: jest.fn(() => modelCatalog("native")),
        });

        const settingsReadsBeforeChange = getSettingsMock.mock.calls.length;
        changeSavedDefault({ baseModelId: "opus", effort: "high" }, null);
        await waitFor(() =>
          expect(getSettingsMock.mock.calls.length).toBeGreaterThan(settingsReadsBeforeChange)
        );

        expect(applySelection).not.toHaveBeenCalled();
      });

      it("defers re-apply for a starting session until ready, using the latest default", async () => {
        const applySelection = jest.fn(async () => {});
        const ready = deferred();
        sessionCreateSpy.mockImplementationOnce((opts) => {
          const session = makeMockSession({
            internalId: opts.internalId,
            backendId: opts.backendId,
          });
          Object.defineProperty(session, "ready", { value: ready.promise });
          getSessionTestHandle(session).setStatus("starting");
          return session;
        });
        const { session } = await buildManagerWithLiveSession(applySelection);

        const latest = { baseModelId: "opus", effort: "low" };
        changeSavedDefault({ baseModelId: "opus", effort: "high" }, latest);
        await flushApplyChain();
        expect(applySelection).not.toHaveBeenCalled();

        ready.resolve();
        await ready.promise;
        await flushApplyChain();

        expect(applySelection).toHaveBeenCalledWith(session, latest);
      });

      it("serializes rapid default changes and commits the latest", async () => {
        const order: string[] = [];
        let resolveFirst: () => void = () => {};
        const applySelection = jest.fn(
          async (_session: AgentSession, sel: { baseModelId: string }) => {
            order.push(sel.baseModelId);
            if (order.length === 1) await new Promise<void>((r) => (resolveFirst = r));
          }
        );
        await buildManagerWithLiveSession(applySelection);

        const first = { baseModelId: "first", effort: null };
        const second = { baseModelId: "second", effort: null };
        changeSavedDefault(null, first);
        await flushApplyChain();
        changeSavedDefault(first, second);
        await flushApplyChain();
        expect(order).toEqual(["first"]);

        resolveFirst();
        await flushApplyChain();

        expect(order).toEqual(["first", "second"]);
      });
    });

    describe("createSession()", () => {
      it("creates a session and sets it as the active one", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        expect(mgr.getSessions()).toEqual([session]);
        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.getActiveChatUIState()).not.toBeNull();
        expect(mgr.getChatUIState(session.internalId)).toBe(mgr.getActiveChatUIState());
      });

      it("attaches the feedback MCP server to a new session and routes its cards to that session", async () => {
        offerFeedbackCards(true);
        const feedbackServer = buildFeedbackServer();
        const mgr = buildManager({ feedbackServer });

        const session = await mgr.createSession();

        expect(feedbackServer.connect).toHaveBeenCalledWith(
          session.internalId,
          expect.any(Function)
        );
        expect(sessionCreateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ mcpServers: [FEEDBACK_CHANNEL] })
        );
        const onOffer = feedbackServer.connect.mock.calls[0][1] as (draft: unknown) => string;
        expect(onOffer(FEEDBACK_DRAFT)).toBe("shown");
        expect(session.offerFeedback).toHaveBeenCalledWith(FEEDBACK_DRAFT);
      });

      it("starts a session without the feedback server while feedback cards are turned off", async () => {
        offerFeedbackCards(false);
        const feedbackServer = buildFeedbackServer();
        const mgr = buildManager({ feedbackServer });

        await mgr.createSession();

        expect(feedbackServer.connect).not.toHaveBeenCalled();
        expect(sessionCreateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ mcpServers: [] })
        );
      });

      it("tells the agent feedback is turned off when the user opts out after the session started", async () => {
        offerFeedbackCards(true);
        const feedbackServer = buildFeedbackServer();
        const mgr = buildManager({ feedbackServer });
        const session = await mgr.createSession();
        const onOffer = feedbackServer.connect.mock.calls[0][1] as (draft: unknown) => string;

        offerFeedbackCards(false);

        expect(onOffer(FEEDBACK_DRAFT)).toBe("turned_off");
        expect(session.offerFeedback).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 still starts the chat when the feedback server cannot start", async () => {
        offerFeedbackCards(true);
        const feedbackServer = buildFeedbackServer(
          jest.fn(async () => {
            throw new Error("EADDRINUSE");
          })
        );
        const mgr = buildManager({ feedbackServer });

        const session = await mgr.createSession();

        expect(mgr.getActiveSession()).toBe(session);
        expect(sessionCreateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ mcpServers: [] })
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 refuses to start a chat, and asks for an enabled model, when a backend that may only run enabled models has none", async () => {
        mockSavedDefault(null);
        const mgr = buildManager({
          descriptor: buildDescriptor({
            routesVaultAgentModels: true,
            getEnabledModelEntries: () => [],
          }),
        });

        await expect(mgr.createSession()).rejects.toThrow(
          "Enable a model for pi in Vault Agent's model settings to start a chat."
        );
        expect(mgr.getLastError()).toBe(
          "Enable a model for pi in Vault Agent's model settings to start a chat."
        );
        expect(mockBackendStart).not.toHaveBeenCalled();
        expect(mgr.getIsStarting()).toBe(false);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 hands the saved mode to the new session so startup waits for that mode to arrive", async () => {
        getSettingsMock.mockReturnValue({
          agentMode: { activeBackend: "pi", backends: { pi: { defaultMode: "default" } } },
        });
        const mgr = buildManager({ descriptor: buildDescriptor({ id: "pi", displayName: "Pi" }) });

        await mgr.createSession();

        expect(sessionCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ defaultMode: "default" })
        );
      });

      it("hands a project session a first-message context builder and a global session none", async () => {
        seedProjects("proj-ctx");
        mockBuildProjectContext.mockReturnValueOnce(
          "<project_context>\n- `/vault/Shared`\n</project_context>"
        );
        const mgr = buildManager();

        await mgr.createSession(undefined, "proj-ctx");
        await mgr.createSession(undefined, GLOBAL_SCOPE);

        const [projectOpts, globalOpts] = sessionCreateSpy.mock.calls.map(([opts]) => opts);
        expect(projectOpts).toMatchObject({ projectId: "proj-ctx" });
        expect(mockBuildProjectContext).not.toHaveBeenCalled();
        expect(projectOpts.getProjectContextBlock!()).toBe(
          "<project_context>\n- `/vault/Shared`\n</project_context>"
        );
        expect(globalOpts.getProjectContextBlock).toBeUndefined();
      });

      it("only spawns the backend once across multiple createSession calls", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await mgr.createSession();
        await mgr.createSession();
        expect(mockBackendStart).toHaveBeenCalledTimes(1);
      });

      it("two concurrent createSession calls each spawn their own session", async () => {
        const mgr = buildManager();
        const [a, b] = await Promise.all([mgr.createSession(), mgr.createSession()]);
        expect(a).not.toBe(b);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(2);
        expect(mgr.getSessions()).toHaveLength(2);
      });

      it.each([false, true])(
        "waits for the startup upgrade and respects shutdown=%s before launching (https://github.com/Brevilabs/obsidian-copilot-private/issues/530)",
        async (shutdown) => {
          const upgrade = deferred();
          const beforeBackendStart = jest.fn(() => upgrade.promise);
          const mgr = buildManager({ beforeBackendStart });
          const creating = mgr.createSession();
          await waitFor(() => expect(beforeBackendStart).toHaveBeenCalled());
          expect(mockBackendStart).not.toHaveBeenCalled();
          if (shutdown) await mgr.shutdown();
          upgrade.resolve();
          if (shutdown) await expect(creating).rejects.toThrow("shut down");
          else {
            await creating;
            expect(mockBackendStart).toHaveBeenCalledTimes(1);
          }
        }
      );

      it("runs a fresh session on the preloader's warm process instead of spawning another", async () => {
        const warmProc = makeMockBackendProcess();
        const descriptor = buildDescriptor();
        const mgr = buildManager({
          descriptor,
          preloader: {
            takeWarm: jest.fn().mockReturnValueOnce({ proc: warmProc }).mockReturnValue(null),
          },
        });

        await mgr.createSession();

        expect(mockBackendStart).not.toHaveBeenCalled();
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const opts = sessionCreateSpy.mock.calls[0][0];
        expect(opts.backend).toBe(warmProc);
        expect(opts).not.toHaveProperty("backendSessionId");
      });

      it("waits for an in-flight preload and adopts its process instead of spawning a second one", async () => {
        let preloadSettled = false;
        const preloadGate = deferred();
        const preload = jest.fn(() => preloadGate.promise);
        const takeWarm = jest.fn(() =>
          preloadSettled ? { proc: makeMockBackendProcess() } : null
        );
        const descriptor = buildDescriptor();
        const mgr = buildManager({ descriptor, preloader: { preload, takeWarm } });
        mgr.registerPreload("pi", preloadGate.promise);

        const sessionPromise = mgr.createSession();
        await flushTimers();

        expect(preload).toHaveBeenCalledWith("pi");
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();

        preloadSettled = true;
        preloadGate.resolve();
        await sessionPromise;

        expect(takeWarm).toHaveBeenCalledWith("pi");
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
        expect(mockBackendStart).not.toHaveBeenCalled();
      });

      it("leaves the seed unset when a catalog exists but no explicit default is stored", async () => {
        const mgr = buildManager({
          preloader: { getCachedModelCatalog: jest.fn(() => modelCatalog("catalog-first")) },
        });

        await mgr.createSession();

        expect(sessionCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ defaultModelSelection: undefined })
        );
      });

      it("a concurrent create that succeeds does not wipe a sibling create's lastError", async () => {
        const mgr = buildManager();
        sessionCreateSpy
          .mockImplementationOnce((opts) =>
            makeMockSession({
              internalId: opts.internalId,
              backendId: opts.backendId,
              ready: (async () => {
                await Promise.resolve();
                await Promise.resolve();
                throw new Error("boom");
              })(),
            })
          )
          .mockImplementationOnce((opts) =>
            makeMockSession({
              internalId: opts.internalId,
              backendSessionId: "backend-ok",
              backendId: opts.backendId,
            })
          );

        const failingSession = await mgr.createSession();
        const succeedingSession = await mgr.createSession();
        await failingSession.ready.catch(() => undefined);
        await succeedingSession.ready;
        await Promise.resolve();
        for (let i = 0; i < 10; i++) await Promise.resolve();

        expect(mgr.getLastError()).toMatch(/boom/);
      });

      it.each([
        { effort: null, confirmed: "low", expected: "low" },
        { effort: "removed", confirmed: "low", expected: "low" },
        { effort: "high", confirmed: "high", expected: undefined },
        { effort: "removed", confirmed: "high", expected: undefined },
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 repairs saved $effort only when the fallback is confirmed ($confirmed)",
        async ({ effort, confirmed, expected }) => {
          mockSavedDefault({ baseModelId: "opus", effort });
          sessionCreateSpy.mockImplementationOnce((opts) => {
            const session = makeMockSession({
              internalId: opts.internalId,
              backendId: opts.backendId,
            });
            jest.spyOn(session, "getState").mockReturnValue({
              model: {
                current: { baseModelId: "opus", effort: confirmed },
                apply: { kind: "setModel" },
                availableModels: [
                  {
                    baseModelId: "opus",
                    name: "Opus",
                    provider: null,
                    effortOptions: [
                      { value: "high", label: "High" },
                      { value: "low", label: "Low" },
                    ],
                  },
                ],
              },
              mode: null,
            });
            return session;
          });
          const mgr = buildManager({ descriptor: buildApplySelectionDescriptor(jest.fn()) });

          await mgr.createSession();
          for (let i = 0; i < 12; i++) await Promise.resolve();

          expect(readPersistedDefault(setSettingsMock, "pi")).toEqual(
            expected === undefined ? undefined : { baseModelId: "opus", effort: expected }
          );
        }
      );

      it("wires the project-context update hooks into a project session but not a global one", async () => {
        seedProjects("proj-hooks");
        const mgr = buildManager();

        await mgr.enterProject("proj-hooks");
        const projectOpts = sessionCreateSpy.mock.calls[0][0];
        expect(typeof projectOpts.getProjectContextUpdates).toBe("function");
        expect(typeof projectOpts.markProjectContextUpdatesDelivered).toBe("function");

        await mgr.exitProject();
        sessionCreateSpy.mockClear();
        await mgr.createSession();
        const globalOpts = sessionCreateSpy.mock.calls[0][0];
        expect(globalOpts.getProjectContextUpdates).toBeUndefined();
        expect(globalOpts.markProjectContextUpdatesDelivered).toBeUndefined();
      });

      it("chimes when a session starts awaiting permission (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();

        endTurn(session, "awaiting_permission");

        expect(playNotificationSound).toHaveBeenCalledTimes(1);
        expect(session.getNeedsAttention()).toBe(false);
      });

      it.each([
        ["no Agent Chat is open", "none"],
        ["a modal outside the chat has focus", "outside"],
        ["another workspace leaf has focus", "other-leaf"],
        ["the Obsidian window is unfocused", "unfocused-window"],
      ] as const)(
        "chimes when a turn ends while %s (https://github.com/logancyang/obsidian-copilot/issues/2987)",
        async (_label, focus) => {
          mockAgentChatFocus = focus;
          const mgr = buildManager();
          const session = await mgr.createSession();

          endTurn(session);

          expect(playNotificationSound).toHaveBeenCalledTimes(1);
          expect(playNotificationSound).toHaveBeenCalledWith("piano");
          expect(session.getNeedsAttention()).toBe(false);
        }
      );

      it.each([
        ["the most recent Agent Chat", "inside"],
        ["a sidebar Agent Chat whose leaf is not most recent", "inside-sidebar"],
      ] as const)(
        "stays silent when focus is inside %s (https://github.com/logancyang/obsidian-copilot/issues/2987)",
        async (_label, focus) => {
          mockAgentChatFocus = focus;
          const mgr = buildManager();
          const session = await mgr.createSession();

          endTurn(session);

          expect(playNotificationSound).not.toHaveBeenCalled();
          expect(session.getNeedsAttention()).toBe(false);
        }
      );

      it("stays silent when the focused Agent Chat starts awaiting permission (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        mockAgentChatFocus = "inside";
        const mgr = buildManager();
        const session = await mgr.createSession();

        endTurn(session, "awaiting_permission");

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(session.getNeedsAttention()).toBe(false);
      });

      it("chimes and flags a backgrounded session that finishes while the chat is focused (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        mockAgentChatFocus = "inside";
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        endTurn(background);

        expect(playNotificationSound).toHaveBeenCalledWith("piano");
        expect(background.getNeedsAttention()).toBe(true);
      });

      it("stays silent but still flags a backgrounded session when the notification sound setting is off (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        mockNotificationSound = false;
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        endTurn(background);

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(background.getNeedsAttention()).toBe(true);
      });

      it("neither chimes nor flags a backgrounded session moving from starting to idle (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        const handle = getSessionTestHandle(background);
        handle.setStatus("starting");
        handle.setStatus("idle");

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(background.getNeedsAttention()).toBe(false);
      });
    });

    describe("createGlobalSessionWithDraft()", () => {
      it("writes the unsent text into the new chat's own draft for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const mgr = buildManager();

        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.drafts.get(session.chatInputId)?.input).toBe("Review this repair");
      });

      it("keeps the editor command selection attached to its own new unsent draft https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
        const mgr = buildManager();
        const commandContext = { selectedText: "original selection", activeFile: null };
        const session = await mgr.createGlobalSessionWithDraft("/summarize", commandContext);
        expect(mgr.drafts.get(session.chatInputId)?.commandContext).toEqual(commandContext);
        expect(session.hasUserVisibleMessages()).toBe(false);
        await mgr.shutdown();
      });
      it("switches directly to the requested scope without spawning an extra blank session for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const projectId = "project-with-no-global-session";
        seedProjects(projectId);
        const mgr = buildManager();
        await mgr.createSession(undefined, projectId);

        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        expect(mgr.getSessions()).toHaveLength(2);
        expect(
          mgr.getSessions().filter((candidate) => candidate.projectId === GLOBAL_SCOPE)
        ).toEqual([session]);
        expect(mgr.getActiveSession()).toBe(session);
      });

      it("drops the drafted text when its session closes for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const mgr = buildManager();
        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        await mgr.closeSession(session.internalId);

        expect(mgr.drafts.get(session.chatInputId)).toBeUndefined();
      });

      it("leaves no draft behind when session creation fails for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const projectId = "project-before-failed-draft";
        seedProjects(projectId);
        const mgr = buildManager();
        await mgr.enterProject(projectId);
        const previousSession = mgr.getActiveSession();
        expect(previousSession).not.toBeNull();
        let failedChatInputId: string | undefined;
        sessionCreateSpy.mockImplementationOnce((opts) => {
          failedChatInputId = opts.chatInputId;
          throw new Error("session creation failed");
        });

        await expect(mgr.createGlobalSessionWithDraft("Review this repair")).rejects.toThrow(
          "session creation failed"
        );

        expect(failedChatInputId).toBeDefined();
        expect(mgr.drafts.get(failedChatInputId as string)).toBeUndefined();
        expect(mgr.getActiveSession()).toBe(previousSession);
      });

      it("does not roll back across newer ABA scope navigation for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        seedProjects("project-a", "project-b");
        offerFeedbackCards(true);
        const feedbackServer = buildFeedbackServer();
        const mgr = buildManager({ feedbackServer });
        const globalSession = await mgr.createSession(undefined, GLOBAL_SCOPE);
        const projectBSession = await mgr.createSession(undefined, "project-b");
        const projectASession = await mgr.createSession(undefined, "project-a");
        mgr.setActiveSession(projectASession.internalId);
        const entered = deferred();
        const release = deferred();
        feedbackServer.connect.mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
          return FEEDBACK_CHANNEL;
        });
        sessionCreateSpy.mockImplementationOnce(() => {
          throw new Error("session creation failed");
        });

        const pendingDraft = mgr.createGlobalSessionWithDraft("Review this repair");
        await entered.promise;
        mgr.setActiveSession(projectBSession.internalId);
        mgr.setActiveSession(globalSession.internalId);
        release.resolve();

        await expect(pendingDraft).rejects.toThrow("session creation failed");
        expect(mgr.getActiveProjectId()).toBe(GLOBAL_SCOPE);
        expect(mgr.getActiveSession()).toBe(globalSession);
      });
    });

    describe("addContextNoteToActiveChat()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 attaches the note to the active chat's draft", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        const note = mockTFile({ path: "Research.md" });

        await mgr.addContextNoteToActiveChat(note);

        expect(mgr.drafts.get(session.chatInputId)?.contextNotes).toEqual([note]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 starts the first chat when none exists so the note has a draft to land in", async () => {
        const mgr = buildManager();
        const note = mockTFile({ path: "Research.md" });

        await mgr.addContextNoteToActiveChat(note);

        const session = mgr.getActiveSession();
        expect(mgr.getSessions()).toEqual([session]);
        expect(mgr.drafts.get(session!.chatInputId)?.contextNotes).toEqual([note]);
      });
    });

    describe("getOrCreateActiveSession()", () => {
      it("returns the existing active session on subsequent calls", async () => {
        const mgr = buildManager();
        const a = await mgr.getOrCreateActiveSession();
        const again = await mgr.getOrCreateActiveSession();
        expect(again).toBe(a);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
      });

      it("dedupes concurrent auto-spawn callers into a single session", async () => {
        const mgr = buildManager();
        const [a, b] = await Promise.all([
          mgr.getOrCreateActiveSession(),
          mgr.getOrCreateActiveSession(),
        ]);
        expect(a).toBe(b);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(mgr.getSessions()).toHaveLength(1);
      });
    });

    describe("setActiveSession()", () => {
      it("keeps only the selected chat observed while three chat tabs remain open https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const second = await mgr.createSession();
        const third = await mgr.createSession();

        expect(first.setIsActive).toHaveBeenLastCalledWith(false);
        expect(second.setIsActive).toHaveBeenLastCalledWith(false);
        expect(third.setIsActive).toHaveBeenLastCalledWith(true);
        expect(mgr.getSessions()).toHaveLength(3);

        mgr.setActiveSession(first.internalId);

        expect(first.setIsActive).toHaveBeenLastCalledWith(true);
        expect(second.setIsActive).toHaveBeenLastCalledWith(false);
        expect(third.setIsActive).toHaveBeenLastCalledWith(false);
        expect(mgr.getSessions()).toHaveLength(3);
      });

      it("persists the latest visit when switching between already open chats https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager } = buildHistoryHarness({ sessions: [] });
        const first = await manager.createSession();
        const second = await manager.createSession();
        const firstId = first.getBackendSessionId()!;
        const secondId = second.getBackendSessionId()!;
        const now = jest.spyOn(Date, "now").mockReturnValue(3000);
        try {
          manager.setActiveSession(first.internalId);
          await waitFor(() => expect(storedChats.get(firstId)?.lastAccessedAtMs).toBe(3000));
          now.mockReturnValue(4000);
          manager.setActiveSession(second.internalId);
          await waitFor(() => expect(storedChats.get(secondId)?.lastAccessedAtMs).toBe(4000));
          const history = await manager.getChatHistoryItems();
          expect(history.find((item) => item.id === firstId)?.lastAccessedAt.getTime()).toBe(3000);
          expect(history.find((item) => item.id === secondId)?.lastAccessedAt.getTime()).toBe(4000);
        } finally {
          now.mockRestore();
        }
      });

      it("does not write visit metadata while the selected chat is being deleted https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({ sessions: [] });
        const first = await manager.createSession();
        await manager.createSession();
        const entered = deferred();
        const release = deferred();
        backend.deleteSession.mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
        });
        const deleting = manager.deleteChatHistory(nativeIdOf(first));
        await entered.promise;
        backend.updateSessionMetadata.mockClear();
        manager.setActiveSession(first.internalId);
        expect(backend.updateSessionMetadata).not.toHaveBeenCalled();
        release.resolve();
        await deleting;
      });

      it("moves the active pointer to the given id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        expect(mgr.getActiveSession()).toBe(b);
        mgr.setActiveSession(a.internalId);
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("is a silent no-op on unknown id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        expect(() => mgr.setActiveSession("nope")).not.toThrow();
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("re-attaches a session detached from its tab when it is surfaced", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        await mgr.enterProject("proj-detach");
        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);

        mgr.setActiveSession(old.internalId);

        expect(mgr.getSessionsForScope("proj-detach")).toContain(old);
        expect(mgr.getActiveSession()).toBe(old);
      });
    });

    describe("closeSession()", () => {
      it("waits for an active chat pause to persist before closing its backend or disposing the tab https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let release!: () => void;
        const saved = new Promise<void>((resolve) => {
          release = resolve;
        });
        let started!: () => void;
        const entered = new Promise<void>((resolve) => {
          started = resolve;
        });
        const backend = {
          ...makeMockBackendProcess(),
          pauseSession: jest.fn(async () => {
            started();
            await saved;
          }),
        };
        const mgr = buildManager({
          descriptor: buildDescriptor({ createBackendProcess: () => backend }),
        });
        const session = await mgr.createSession();
        getSessionTestHandle(session).setStatus("running");
        const closing = mgr.closeSession(session.internalId);
        await Promise.race([entered, closing]);
        expect(backend.pauseSession).toHaveBeenCalledTimes(1);
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(backend.closeSession).not.toHaveBeenCalled();
        expect(mockSessionDispose).not.toHaveBeenCalled();
        release();
        await closing;
        expect(backend.closeSession).toHaveBeenCalledWith({
          sessionId: session.getBackendSessionId(),
        });
        expect(mockSessionDispose).toHaveBeenCalledTimes(1);
      });

      it("releases an already paused pending interaction without pausing or cancelling it again https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const backend = {
          ...makeMockBackendProcess(),
          pauseSession: jest.fn(async () => undefined),
        };
        const mgr = buildManager({
          descriptor: buildDescriptor({ createBackendProcess: () => backend }),
        });
        const session = await mgr.createSession();
        getSessionTestHandle(session).setStatus("awaiting_permission");
        jest.spyOn(session, "getRunState").mockReturnValue({
          runId: "saved",
          requestId: "saved",
          status: "paused_user",
          startedAtMs: 1,
          cancelEpoch: 0,
        });
        await mgr.closeSession(session.internalId, { releaseBackend: true });
        expect(backend.pauseSession).not.toHaveBeenCalled();
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(backend.closeSession).toHaveBeenCalledTimes(1);
        expect(mockSessionDispose).toHaveBeenCalledTimes(1);
      });

      it("removes the session from the pool and cancels + disposes it", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        await mgr.closeSession(a.internalId);
        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mockSessionCancel).toHaveBeenCalled();
        expect(mockSessionDispose).toHaveBeenCalled();
      });

      it("revokes the closed session's feedback server token", async () => {
        offerFeedbackCards(true);
        const feedbackServer = buildFeedbackServer();
        const mgr = buildManager({ feedbackServer });
        const a = await mgr.createSession();

        await mgr.closeSession(a.internalId);

        expect(feedbackServer.disconnect).toHaveBeenCalledWith(a.internalId);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 releases the dropped chat's backend session, so reopening it from history starts one with a live feedback token", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const proc = mgr.getBackendProcess(a.backendId)!;

        await mgr.closeSession(a.internalId);

        expect(proc.closeSession).toHaveBeenCalledWith({ sessionId: a.getBackendSessionId() });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 still closes the chat when the backend cannot release its session", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const proc = mgr.getBackendProcess(a.backendId)!;
        jest.mocked(proc.closeSession!).mockRejectedValueOnce(new Error("session/close timed out"));

        await mgr.closeSession(a.internalId);

        expect(mgr.getSessions()).toEqual([]);
        expect(mockSessionDispose).toHaveBeenCalled();
      });

      it("when the active session is closed, picks the right neighbor as active", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        const c = await mgr.createSession();
        mgr.setActiveSession(b.internalId);
        await mgr.closeSession(b.internalId);
        expect(mgr.getActiveSession()).toBe(c);
        expect(mgr.getSessions()).toEqual([a, c]);
      });

      it("when the rightmost active session is closed, falls back to the new last", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        expect(mgr.getActiveSession()).toBe(b);
        await mgr.closeSession(b.internalId);
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("closing a non-active session leaves the active pointer alone", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        await mgr.closeSession(a.internalId);
        expect(mgr.getActiveSession()).toBe(b);
        expect(mgr.getSessions()).toEqual([b]);
      });

      it("is a no-op for unknown ids", async () => {
        const mgr = buildManager();
        await mgr.closeSession("does-not-exist");
        expect(mgr.getSessions()).toEqual([]);
      });

      it("picks a visible neighbor, never a session detached from its tab", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        await mgr.enterProject("proj-detach");
        const fresh = mgr.getActiveSession()!;

        await mgr.closeSession(fresh.internalId);

        expect(mgr.getActiveSession()).not.toBe(old);
      });
    });

    describe("replaceSessionInPlace()", () => {
      async function flushBackgroundClose(): Promise<void> {
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }

      it("inserts the replacement at the old session's tab-strip index", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        const c = await mgr.createSession();
        const replacement = await mgr.replaceSessionInPlace(b.internalId);
        await flushBackgroundClose();
        expect(mgr.getSessions()).toEqual([a, replacement, c]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("preserves the leftmost slot when replacing the first tab", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        const replacement = await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mgr.getSessions()).toEqual([replacement, b]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("gives the replacement the old tab's chat UI state slot", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        const replacement = await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mgr.getActiveChatUIState()).toBe(mgr.getChatUIState(replacement.internalId));
        expect(mgr.getChatUIState(b.internalId)).not.toBeNull();
      });

      it("closes the old session in the background", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mockSessionCancel).toHaveBeenCalled();
        expect(mockSessionDispose).toHaveBeenCalled();
        expect(mgr.getSessions().some((s) => s.internalId === a.internalId)).toBe(false);
      });

      it("falls back to plain create when the old id is unknown", async () => {
        const mgr = buildManager();
        const replacement = await mgr.replaceSessionInPlace("does-not-exist");
        expect(mgr.getSessions()).toEqual([replacement]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("preserves the logical chat input only when explicitly requested", async () => {
        const mgr = buildManager();
        const freshSource = await mgr.createSession();
        expect(freshSource.chatInputId).not.toBe(freshSource.internalId);
        const freshReplacement = await mgr.replaceSessionInPlace(freshSource.internalId);
        expect(freshReplacement.chatInputId).not.toBe(freshSource.chatInputId);

        const preservedSource = freshReplacement;
        const preservedReplacement = await mgr.replaceSessionInPlace(
          preservedSource.internalId,
          undefined,
          { preserveChatInput: true }
        );
        expect(preservedReplacement.chatInputId).toBe(preservedSource.chatInputId);
      });

      it("keeps the last successful replacement when a queued replacement fails", async () => {
        const mgr = buildManager();
        const source = await mgr.createSession();
        const createSession = mgr.createSession.bind(mgr);
        const secondStarted = deferred();
        const secondGate = deferred();
        let replacementCount = 0;
        jest.spyOn(mgr, "createSession").mockImplementation(async (...args) => {
          replacementCount++;
          if (replacementCount === 2) {
            secondStarted.resolve();
            await secondGate.promise;
            throw new Error("replacement failed");
          }
          return createSession(...args);
        });

        const first = mgr.replaceSessionInPlace(source.internalId, "pi", {
          preserveChatInput: true,
          seedSelection: { baseModelId: "first-model", effort: null },
        });
        const second = mgr.replaceSessionInPlace(source.internalId, "pi", {
          preserveChatInput: true,
          seedSelection: { baseModelId: "latest-model", effort: "high" },
        });
        const firstReplacement = await first;
        await secondStarted.promise;
        const third = mgr.replaceSessionInPlace(firstReplacement.internalId, "pi", {
          preserveChatInput: true,
          seedSelection: { baseModelId: "final-model", effort: "low" },
        });
        secondGate.resolve();
        await expect(second).rejects.toThrow("replacement failed");
        const thirdReplacement = await third;
        await flushBackgroundClose();

        expect(thirdReplacement).not.toBe(firstReplacement);
        expect(thirdReplacement.chatInputId).toBe(source.chatInputId);
        expect(sessionCreateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            defaultModelSelection: { baseModelId: "final-model", effort: "low" },
          })
        );
        expect(mgr.getSessions()).toEqual([thirdReplacement]);
      });
    });

    describe("subscribe()", () => {
      it("notifies subscribers on session create / close / activate", async () => {
        const mgr = buildManager();
        const listener = jest.fn();
        mgr.subscribe(listener);

        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        await mgr.closeSession(b.internalId);

        expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe("shutdown()", () => {
      it("disposes idle sessions without stopping already paused work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await mgr.createSession();
        expect(mgr.getSessions()).toHaveLength(2);

        await mgr.shutdown();
        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(mockSessionDispose).toHaveBeenCalledTimes(2);
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
      });

      it("waits for active work to finish saving its pause before releasing sessions and the backend https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let acknowledgePause!: () => void;
        const pauseSaved = new Promise<void>((resolve) => {
          acknowledgePause = resolve;
        });
        let reportPauseStarted!: () => void;
        const pauseStarted = new Promise<void>((resolve) => {
          reportPauseStarted = resolve;
        });
        const backend = {
          ...makeMockBackendProcess(),
          pauseSession: jest.fn(async () => {
            reportPauseStarted();
            await pauseSaved;
          }),
        };
        const mgr = buildManager({
          descriptor: buildDescriptor({ createBackendProcess: () => backend }),
        });
        const session = await mgr.createSession();
        getSessionTestHandle(session).setStatus("running");

        const closing = mgr.shutdown();
        await Promise.race([pauseStarted, closing]);
        expect(backend.pauseSession).toHaveBeenCalledTimes(1);
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(mockSessionDispose).not.toHaveBeenCalled();
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        acknowledgePause();
        await closing;
        expect(backend.pauseSession).toHaveBeenCalledWith({
          sessionId: session.getBackendSessionId(),
        });
        expect(mockSessionDispose).toHaveBeenCalledTimes(1);
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getSessions()).toEqual([]);
        await mgr.shutdown();
        expect(backend.pauseSession).toHaveBeenCalledTimes(1);
      });

      it("pauses a pending approval and skips inactive sessions instead of overwriting a saved pause https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const backend = {
          ...makeMockBackendProcess(),
          pauseSession: jest.fn(async () => undefined),
        };
        const mgr = buildManager({
          descriptor: buildDescriptor({ createBackendProcess: () => backend }),
        });
        const active = await mgr.createSession();
        getSessionTestHandle(active).setStatus("awaiting_permission");
        for (const status of ["idle", "starting", "error", "closed"] as const) {
          const inactive = await mgr.createSession();
          getSessionTestHandle(inactive).setStatus(status);
        }

        await mgr.shutdown();
        expect(backend.pauseSession).toHaveBeenCalledTimes(1);
        expect(backend.pauseSession).toHaveBeenCalledWith({
          sessionId: active.getBackendSessionId(),
        });
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(mockSessionDispose).toHaveBeenCalledTimes(5);
      });

      it("falls back to cancelling only active sessions when the backend has no pause method https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const mgr = buildManager();
        const active = await mgr.createSession();
        getSessionTestHandle(active).setStatus("running");
        await mgr.createSession();

        await mgr.shutdown();
        expect(mockSessionCancel).toHaveBeenCalledTimes(1);
        expect(mockSessionDispose).toHaveBeenCalledTimes(2);
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
      });

      it("closes the feedback server", async () => {
        const feedbackServer = buildFeedbackServer();
        const mgr = buildManager({ feedbackServer });

        await mgr.shutdown();

        expect(feedbackServer.dispose).toHaveBeenCalledTimes(1);
      });
    });

    describe("getLastError()", () => {
      it("reports an unexpected backend exit and drops every session", async () => {
        const mgr = buildManager();
        const listener = jest.fn();
        mgr.subscribe(listener);
        await mgr.createSession();
        await mgr.createSession();

        for (const fn of mockBackendExitListeners) fn();

        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mgr.getLastError()).toMatch(/exited unexpectedly/);
        expect(listener).toHaveBeenCalled();
      });
    });

    describe("getOpenChatIds()", () => {
      it("includes idle and running conversations and removes released sessions for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const empty = mgr.getOpenChatIds();
        expect(mgr.getOpenChatIds()).toBe(empty);
        const idle = await mgr.createSession();
        const running = await mgr.createSession();
        getSessionTestHandle(running).setStatus("running");
        const idleId = nativeIdOf(idle);
        const runningId = nativeIdOf(running);
        expect(mgr.getOpenChatIds()).toEqual(new Set([idleId, runningId]));
        await mgr.closeChatSession(idleId);
        expect(mgr.getOpenChatIds()).toEqual(new Set([runningId]));
      });
    });

    describe("detachSessionFromTab()", () => {
      it("keeps the backend session open and discoverable in history for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        const proc = mgr.getBackendProcess(session.backendId)!;

        mgr.detachSessionFromTab(session.internalId);

        expect(mgr.getSessionsForScope(session.projectId)).not.toContain(session);
        expect(mgr.getSessions()).toContain(session);
        expect(mgr.getOpenChatIds()).toContain(nativeIdOf(session));
        expect(proc.closeSession).not.toHaveBeenCalled();
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(mockSessionDispose).not.toHaveBeenCalled();
      });
    });

    describe("closeChatSession()", () => {
      it("releases only the selected backend session while preserving another active chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const selected = await mgr.createSession();
        const sibling = await mgr.createSession();
        const proc = mgr.getBackendProcess(selected.backendId)!;
        await mgr.closeChatSession(nativeIdOf(selected));
        expect(proc.closeSession).toHaveBeenCalledWith({
          sessionId: selected.getBackendSessionId(),
        });
        expect(mgr.getSessions()).toEqual([sibling]);
        expect(mgr.getActiveSession()).toBe(sibling);
        expect(proc.shutdown).not.toHaveBeenCalled();
      });
    });

    describe("getRunningChatIds()", () => {
      it("keys a running native session by its native chat id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        getSessionTestHandle(a).setStatus("running");
        expect(mgr.getRunningChatIds().has(nativeIdOf(a))).toBe(true);
      });

      it("excludes a starting session while including a running one", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        getSessionTestHandle(a).setStatus("running");
        getSessionTestHandle(b).setStatus("starting");
        const ids = mgr.getRunningChatIds();
        expect(ids.has(nativeIdOf(a))).toBe(true);
        expect(ids.has(nativeIdOf(b))).toBe(false);
      });

      it("returns the same frozen empty set when nothing is running", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const first = mgr.getRunningChatIds();
        expect(first.size).toBe(0);
        expect(mgr.getRunningChatIds()).toBe(first);
      });

      it("notifies subscribers when a session's running membership flips", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const listener = jest.fn();
        mgr.subscribe(listener);
        getSessionTestHandle(a).setStatus("running");
        expect(listener).toHaveBeenCalledTimes(1);
        listener.mockClear();
        getSessionTestHandle(a).setStatus("idle");
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("keeps a session detached from its tab listed as running so history shows its spinner", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        getSessionTestHandle(old).setStatus("running");

        await mgr.enterProject("proj-detach");

        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);
        expect(mgr.getRunningChatIds().has(nativeIdOf(old))).toBe(true);
      });
    });

    describe("getAttentionChatIds()", () => {
      it("hands a backgrounded finished session over from running to attention", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);
        const nativeId = nativeIdOf(background);

        getSessionTestHandle(background).setStatus("running");
        expect(mgr.getRunningChatIds().has(nativeId)).toBe(true);
        expect(mgr.getAttentionChatIds().has(nativeId)).toBe(false);

        getSessionTestHandle(background).setStatus("idle");
        expect(mgr.getRunningChatIds().has(nativeId)).toBe(false);
        expect(mgr.getAttentionChatIds().has(nativeId)).toBe(true);
      });

      it.each(["error", "awaiting_permission"] as const)(
        "includes a backgrounded session whose turn ends in %s (https://github.com/logancyang/obsidian-copilot/issues/2987)",
        async (endStatus) => {
          const mgr = buildManager();
          const { active, background } = await createActiveAndBackgroundSessions(mgr);

          endTurn(background, endStatus);

          expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(true);
          expect(mgr.getAttentionChatIds().has(nativeIdOf(active))).toBe(false);
        }
      );

      it("does not include a backgrounded session moving from starting to idle", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        const handle = getSessionTestHandle(background);
        handle.setStatus("starting");
        handle.setStatus("idle");

        expect(mgr.getAttentionChatIds().size).toBe(0);
      });

      it("does not include the active session even when its chat is not focused (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const mgr = buildManager();
        const active = await mgr.createSession();

        endTurn(active);

        expect(mgr.getAttentionChatIds().size).toBe(0);
      });

      it("drops the id once the user activates the flagged tab", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);
        endTurn(background);
        expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(true);

        mgr.setActiveSession(background.internalId);

        expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(false);
        expect(background.getNeedsAttention()).toBe(false);
      });

      it("returns the same frozen empty set when nothing needs attention", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const first = mgr.getAttentionChatIds();
        expect(first.size).toBe(0);
        expect(mgr.getAttentionChatIds()).toBe(first);
      });

      it("keeps a session detached from its tab listed so history shows its attention dot", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        old.markNeedsAttention();

        await mgr.enterProject("proj-detach");

        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);
        expect(mgr.getAttentionChatIds().has(nativeIdOf(old))).toBe(true);
      });
    });

    describe("noteSpawnConfigChanged()", () => {
      it("keeps an open session alive and holds the restart for the user (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();

        await mgr.noteSpawnConfigChanged("pi", "managed skills changed");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.hasHeldConfigChange("pi")).toBe(true);
      });

      it("restarts straight away when no session is open on the backend (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        await mgr.closeSession(session.internalId);

        await mgr.noteSpawnConfigChanged("pi", "byok key saved");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("pi")).toBe(false);
      });

      it("refreshes a warm probe that no session has adopted (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const mgr = buildManager({ preloader: { refresh } });

        await mgr.noteSpawnConfigChanged("pi", "byok key saved");

        expect(refresh).toHaveBeenCalledWith("pi");
        expect(mgr.hasHeldConfigChange("pi")).toBe(false);
      });

      it("reports one held change however many times config changes (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const listener = jest.fn();
        mgr.subscribe(listener);

        await mgr.noteSpawnConfigChanged("pi", "managed skills changed");
        await mgr.noteSpawnConfigChanged("pi", "provider config changed");

        expect(listener).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("pi")).toBe(true);
      });
    });

    describe("applyHeldConfigChange()", () => {
      it("restarts the backend and clears the offer (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        await mgr.noteSpawnConfigChanged("pi", "managed skills changed");

        await mgr.applyHeldConfigChange("pi");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("pi");
        expect(mgr.hasHeldConfigChange("pi")).toBe(false);
      });

      it("does nothing when the backend has no held change (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await mgr.createSession();

        await mgr.applyHeldConfigChange("pi");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("replaces an errored session with corrected configuration (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        sessionCreateSpy.mockImplementationOnce((opts) =>
          makeMockSession({
            ...opts,
            ready: Promise.reject(new Error("Invalid API key")),
          })
        );
        const mgr = buildManagerWithReplay();
        const failed = await mgr.createSession();
        getSessionTestHandle(failed).setStatus("error");
        await flushTimers();
        expect(mgr.getLastError()).toContain("Invalid API key");
        await mgr.noteSpawnConfigChanged("pi", "key corrected");
        await mgr.applyHeldConfigChange("pi");
        await flushTimers();
        expect(mgr.getActiveSession()).not.toBe(failed);
        expect(mgr.getActiveSession()?.getStatus()).toBe("idle");
        expect(mgr.getLastError()).toBeNull();
      });

      it("reports the restart as pending until a running turn releases it (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        await mgr.noteSpawnConfigChanged("pi", "managed skills changed");
        getSessionTestHandle(first).setStatus("running");
        const listener = jest.fn();
        mgr.subscribe(listener);

        await mgr.applyHeldConfigChange("pi");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(mgr.isBackendRestartPending("pi")).toBe(true);
        expect(listener).toHaveBeenCalled();

        getSessionTestHandle(first).setStatus("idle");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.isBackendRestartPending("pi")).toBe(false);
        expect(mgr.hasHeldConfigChange("pi")).toBe(false);
      });

      it("clears the held config after a backend exit so retry does not offer another reload (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await mgr.noteSpawnConfigChanged("pi", "key corrected");
        for (const exit of mockBackendExitListeners) exit();
        expect(mgr.hasHeldConfigChange("pi")).toBe(false);
        const recovered = await mgr.getOrCreateActiveSession();
        await mgr.applyHeldConfigChange("pi");
        expect(mgr.getActiveSession()).toBe(recovered);
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("keeps every tab's composer live throughout reload and restores the selected tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const second = await mgr.createSession();
        mgr.setActiveSession(first.internalId);
        const ids = [first.chatInputId, second.chatInputId];
        const drafts = new Map([
          [first.chatInputId, "First unsent draft"],
          [second.chatInputId, "Second unsent draft"],
        ]);
        mgr.subscribe(() => {
          const live = new Set(mgr.getLiveChatInputIds());
          for (const id of drafts.keys()) if (!live.has(id)) drafts.delete(id);
        });
        await mgr.noteSpawnConfigChanged("pi", "key corrected");
        await mgr.applyHeldConfigChange("pi");
        expect([...drafts.values()]).toEqual(["First unsent draft", "Second unsent draft"]);
        expect(mgr.getSessions().map((s) => s.chatInputId)).toEqual(ids);
        expect(mgr.getActiveSession()?.chatInputId).toBe(first.chatInputId);
      });

      it("preserves composers across scopes without surfacing detached conversations (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const projectId = "project-with-drafts";
        seedProjects(projectId);
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, projectId);
        const global = mgr.getActiveSession()!;
        await mgr.enterProject(projectId);
        const landing = mgr.getActiveSession()!;
        await mgr.noteSpawnConfigChanged("pi", "models changed");
        await mgr.applyHeldConfigChange("pi");
        expect(new Set(mgr.getLiveChatInputIds())).toEqual(
          new Set([old.chatInputId, global.chatInputId, landing.chatInputId])
        );
        expect(mgr.getSessionsForScope(projectId).map((s) => s.chatInputId)).toEqual([
          landing.chatInputId,
        ]);
        expect(mgr.getActiveSession()?.chatInputId).toBe(landing.chatInputId);
        expect(mgr.getActiveProjectId()).toBe(projectId);
      });
    });

    describe("restartBackend()", () => {
      it("returns false when the backend has not been started", async () => {
        const mgr = buildManager();

        await expect(mgr.restartBackend("pi", "skills changed")).resolves.toBe(false);
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("restarts an idle backend and replaces the active affected session", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const proc = mgr.getBackendProcess(first.backendId)!;

        await expect(mgr.restartBackend("pi", "skills changed")).resolves.toBe(true);

        expect(proc.closeSession).not.toHaveBeenCalled();
        expect(mockSessionCancel).toHaveBeenCalledWith();
        expect(mockSessionDispose).toHaveBeenCalledWith();
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getSessions()).toHaveLength(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("pi");
      });

      it("refreshes a warm preload probe when the manager owns no process yet", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const mgr = buildManager({ preloader: { refresh } });

        await expect(mgr.restartBackend("pi", "byok key added")).resolves.toBe(true);
        expect(refresh).toHaveBeenCalledWith("pi");
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("does not refresh a warm probe when nothing was preloaded", async () => {
        const refresh = jest.fn(() => null);
        const mgr = buildManager({ preloader: { refresh } });

        await expect(mgr.restartBackend("pi", "byok key added")).resolves.toBe(false);
        expect(refresh).toHaveBeenCalledWith("pi");
      });

      it("re-probes after restart when no replacement session is created", async () => {
        const preload = jest.fn(async () => undefined);
        const mgr = buildManager({ preloader: { preload } });
        const session = await mgr.createSession();
        await mgr.closeSession(session.internalId);
        preload.mockClear();

        await expect(mgr.restartBackend("pi", "byok save")).resolves.toBe(true);

        expect(mockBackendShutdown).toHaveBeenCalled();
        expect(preload).toHaveBeenCalledWith("pi");
      });

      it("re-probes before creating a replacement for an empty chat without an assigned original root https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const preload = jest.fn(async () => undefined);
        const mgr = buildManager({ preloader: { preload } });
        const first = await mgr.createSession();
        jest.spyOn(first, "getBackendSessionId").mockReturnValue(null);
        preload.mockClear();
        sessionCreateSpy.mockClear();

        await expect(mgr.restartBackend("pi", "backend enabled models changed")).resolves.toBe(
          true
        );

        expect(preload).toHaveBeenCalledTimes(1);
        expect(preload).toHaveBeenCalledWith("pi");
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(preload.mock.invocationCallOrder[0]).toBeLessThan(
          sessionCreateSpy.mock.invocationCallOrder[0]
        );
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("pi");
      });

      it("gives the replacement the replaced session's chat input so the composer draft survives (https://github.com/Brevilabs/obsidian-copilot-private/issues/473)", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const chatInputId = first.chatInputId;
        mgr.drafts.update(chatInputId, (draft) => ({ ...draft, input: "half-written question" }));

        await mgr.restartBackend("pi", "byok key saved");

        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.chatInputId).toBe(chatInputId);
        expect(mgr.drafts.get(chatInputId)?.input).toBe("half-written question");
      });

      it("reports the replaced chat input as live while no session owns it (https://github.com/Brevilabs/obsidian-copilot-private/issues/473)", async () => {
        const liveDuringGap: string[][] = [];
        const mgr: AgentSessionManager = buildManager({
          preloader: {
            preload: jest.fn(async () => {
              liveDuringGap.push([...mgr.getLiveChatInputIds()]);
            }),
          },
        });
        const first = await mgr.createSession();
        const chatInputId = first.chatInputId;

        await mgr.restartBackend("pi", "byok key saved");

        expect(liveDuringGap.at(-1)).toContain(chatInputId);
        expect(mgr.getLiveChatInputIds()).toEqual([chatInputId]);
      });

      it.each([
        ["resumes each tab's conversation in place", false],
        ["reports unavailable original tabs", true],
      ] as const)(
        "preserves each tab's model and effort when the restart %s (https://github.com/logancyang/obsidian-copilot/issues/3319)",
        async (_case, unsupported) => {
          const state = (baseModelId: string, effort: string): BackendState => ({
            model: {
              current: { baseModelId, effort },
              availableModels: [],
              apply: { kind: "setModel" },
            },
            mode: null,
          });
          const mgr = buildManagerWithReplay(
            {
              loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
                if (unsupported) throw new MethodUnsupportedError("session/load");
                return { sessionId, state: state("big-pickle", "low") };
              }),
              resumeSession: jest.fn(async () => {
                throw new MethodUnsupportedError("session/resume");
              }),
              setSessionModel: jest.fn(async ({ modelId }: { modelId: string }) => {
                const selection = JSON.parse(modelId);
                return state(selection.baseModelId, selection.effort);
              }),
            },
            {
              applySelection: async (session, selection) =>
                session.applyModelWireId(JSON.stringify(selection)),
            }
          );
          const flash = await mgr.createSession();
          const reasoning = await mgr.createSession();
          jest.spyOn(flash, "getState").mockReturnValue(state("copilot-plus/flash", "high"));
          jest
            .spyOn(reasoning, "getState")
            .mockReturnValue(state("copilot-plus/reasoning", "medium"));
          sessionCreateSpy.mockClear();

          if (unsupported) {
            await expect(mgr.restartBackend("pi", "config changed")).rejects.toThrow(
              t("agentChat.history.restoreUnavailable")
            );
            expect(sessionCreateSpy).not.toHaveBeenCalled();
            expect(mgr.getSessions()).toEqual([]);
            expect(storedChats.has(flash.getBackendSessionId()!)).toBe(true);
            expect(storedChats.has(reasoning.getBackendSessionId()!)).toBe(true);
          } else {
            await mgr.restartBackend("pi", "config changed");
            expect(mgr.getSessions().map((session) => session.getState()?.model?.current)).toEqual([
              { baseModelId: "copilot-plus/flash", effort: "high" },
              { baseModelId: "copilot-plus/reasoning", effort: "medium" },
            ]);
          }
          await mgr.shutdown();
        }
      );

      it.each([
        ["resumes the tab's conversation in place", false],
        ["reports the unavailable original tab", true],
      ] as const)(
        "replaces a disabled tab model with the enabled default when the restart %s (https://github.com/logancyang/obsidian-copilot/issues/3319)",
        async (_case, unsupported) => {
          const originalSettings = getSettingsMock.getMockImplementation();
          const saved = { baseModelId: "copilot-plus/flash", effort: "high" };
          getSettingsMock.mockReturnValue({
            agentMode: { activeBackend: "pi", backends: { pi: { defaultModel: saved } } },
          });
          const state: BackendState = {
            model: {
              current: { baseModelId: "big-pickle", effort: "low" },
              apply: { kind: "setModel" },
              availableModels: [
                {
                  baseModelId: saved.baseModelId,
                  name: "Flash",
                  provider: null,
                  effortOptions: [],
                },
              ],
            },
            mode: null,
          };
          const mgr = buildManagerWithReplay(
            {
              loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
                if (unsupported) throw new MethodUnsupportedError("session/load");
                return { sessionId, state };
              }),
              resumeSession: jest.fn(async () => {
                throw new MethodUnsupportedError("session/resume");
              }),
              setSessionModel: jest.fn(async ({ modelId }: { modelId: string }) => ({
                ...state,
                model: { ...state.model!, current: JSON.parse(modelId) },
              })),
            },
            {
              id: "pi",
              displayName: "Pi",
              getEnabledModelEntries: () => [
                { baseModelId: saved.baseModelId, name: "Flash", credentialState: "ok" },
              ],
              applySelection: async (session, selection) =>
                session.applyModelWireId(JSON.stringify(selection)),
            }
          );
          try {
            const first = await mgr.createSession();
            jest.spyOn(first, "getState").mockReturnValue({
              ...state,
              model: {
                ...state.model!,
                current: { baseModelId: "disabled-model", effort: "medium" },
              },
            });
            sessionCreateSpy.mockClear();

            if (unsupported) {
              await expect(mgr.restartBackend("pi", "enabled models changed")).rejects.toThrow(
                t("agentChat.history.restoreUnavailable")
              );
              expect(sessionCreateSpy).not.toHaveBeenCalled();
              expect(mgr.getActiveSession()).toBeNull();
              expect(storedChats.has(first.getBackendSessionId()!)).toBe(true);
            } else {
              await mgr.restartBackend("pi", "enabled models changed");
              expect(mgr.getActiveSession()?.getState()?.model?.current).toEqual(saved);
            }
          } finally {
            await mgr.shutdown();
            getSettingsMock.mockImplementation(originalSettings);
          }
        }
      );

      it("settles the resumed tab on the seeded model's own effort, not the effort of the model it left (https://github.com/logancyang/obsidian-copilot/issues/3319)", async () => {
        const server = { baseModelId: "big-pickle", effort: "low" };
        const catalogBeforeSetModel = [
          { baseModelId: "big-pickle", name: "Big Pickle", provider: null, effortOptions: [] },
          {
            baseModelId: "copilot-plus/reasoning",
            name: "Reasoning",
            provider: null,
            effortOptions: [{ value: "medium", label: "Medium" }],
          },
        ];
        const catalogAfterSetModel = [
          {
            baseModelId: "copilot-plus/reasoning",
            name: "Reasoning",
            provider: null,
            effortOptions: [
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
            ],
          },
        ];
        const stateFor = (availableModels: unknown): BackendState =>
          ({
            model: { current: { ...server }, apply: { kind: "setModel" }, availableModels },
            mode: null,
          }) as BackendState;
        const mgr = buildManagerWithReplay(
          {
            loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
              sessionId,
              state: stateFor(catalogBeforeSetModel),
            })),
            setSessionModel: jest.fn(async ({ modelId }: { modelId: string }) => {
              const selection = JSON.parse(modelId);
              server.baseModelId = selection.baseModelId;
              server.effort = selection.effort;
              return stateFor(catalogAfterSetModel);
            }),
            setSessionConfigOption: jest.fn(async ({ value }: { value: string }) => {
              server.effort = value;
              return stateFor(catalogAfterSetModel);
            }),
          },
          {
            applySelection: async (session: AgentSession, selection: ModelSelection) =>
              session.applyModelWireId(JSON.stringify(selection)),
          }
        );
        const chat = await mgr.createSession();
        jest.spyOn(chat, "getState").mockReturnValue({
          model: {
            current: { baseModelId: "copilot-plus/reasoning", effort: "high" },
            apply: { kind: "setModel" },
            availableModels: catalogBeforeSetModel,
          },
          mode: null,
        } as unknown as BackendState);

        await mgr.restartBackend("pi", "config changed");

        expect(server).toEqual({ baseModelId: "copilot-plus/reasoning", effort: "high" });
        await mgr.shutdown();
      });

      it("brings the replaced tab back on its own conversation (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const loadSession = jest.fn(async ({ sessionId }: { sessionId: string }) => ({
          sessionId,
          state: { model: null, mode: null },
        }));
        const mgr = buildManagerWithReplay({ loadSession });
        const first = await mgr.createSession();
        const backendSessionId = first.getBackendSessionId();
        const chatInputId = first.chatInputId;

        await mgr.restartBackend("pi", "managed skills changed");

        expect(loadSession).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: backendSessionId })
        );
        const replacement = mgr.getActiveSession();
        expect(replacement).not.toBe(first);
        expect(replacement?.getBackendSessionId()).toBe(backendSessionId);
        expect(replacement?.chatInputId).toBe(chatInputId);
        expect(mgr.getSessions()).toHaveLength(1);
      });

      it("re-attaches the feedback MCP server when it reloads the replaced tab", async () => {
        offerFeedbackCards(true);
        const loadSession = jest.fn(async ({ sessionId }: { sessionId: string }) => ({
          sessionId,
          state: { model: null, mode: null },
        }));
        const mgr = buildManagerWithReplay({ loadSession }, {}, buildFeedbackServer());
        await mgr.createSession();

        await mgr.restartBackend("pi", "managed skills changed");

        expect(loadSession).toHaveBeenCalledWith(
          expect.objectContaining({ mcpServers: [FEEDBACK_CHANNEL] })
        );
      });

      it("revokes the feedback token it handed a replaced tab that fails to reload", async () => {
        offerFeedbackCards(true);
        const feedbackServer = buildFeedbackServer();
        const mgr = buildManagerWithReplay(
          {
            loadSession: jest.fn(async () => {
              throw new Error("load blew up");
            }),
          },
          {},
          feedbackServer
        );
        await mgr.createSession();

        await expect(mgr.restartBackend("pi", "managed skills changed")).rejects.toThrow(
          t("agentChat.history.restoreUnavailable")
        );

        const reloadKey = feedbackServer.connect.mock.calls[1][0];
        expect(feedbackServer.disconnect).toHaveBeenCalledWith(reloadKey);
      });

      it("rebuilds the replaced tab with the tool calls its backend replays during load (https://github.com/Brevilabs/obsidian-copilot-private/issues/643)", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "list the notes", "u1"));
            emit({
              sessionUpdate: "tool_call",
              toolCallId: "tool-ls",
              title: "Bash: ls",
              kind: "execute",
              status: "in_progress",
            });
            emit({ sessionUpdate: "tool_call_update", toolCallId: "tool-ls", status: "completed" });
          },
        });
        const mgr = buildManager({
          descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
        });
        await mgr.createSession();

        await mgr.restartBackend("pi", "managed skills changed");

        expect(senderAndText(mgr.getActiveSession()!)).toEqual([
          [USER_SENDER, "list the notes"],
          [AI_SENDER, ""],
        ]);
        expect(mgr.getActiveSession()!.store.getDisplayMessages()[1].parts).toMatchObject([
          { kind: "tool_call", id: "tool-ls", status: "completed" },
        ]);
      });

      it("uses the backend replay after an error restart without overwriting it from the old display snapshot and retains the unsent composer draft https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "真实已保存工作", "canonical-user"));
            emit(replayChunk("agent_message_chunk", "当前正式结果", "canonical-ai"));
          },
        });
        const manager = buildManager({
          descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
        });
        const original = await manager.createSession();
        const stale: AgentChatMessage[] = [
          {
            id: "stale",
            sender: USER_SENDER,
            message: "不属于执行记录的旧显示快照",
            isVisible: true,
            timestamp: null,
          },
        ];
        getSessionTestHandle(original).setMessages(stale);
        getSessionTestHandle(original).setStatus("error");
        manager.drafts.update(original.chatInputId, (draft) => ({
          ...draft,
          input: "尚未发送的输入",
        }));
        await manager.restartBackend("pi", "refresh configured provider");
        const rebuilt = manager.getActiveSession()!;
        expect(rebuilt.getBackendSessionId()).toBe(original.getBackendSessionId());
        expect(senderAndText(rebuilt)).toEqual([
          [USER_SENDER, "真实已保存工作"],
          [AI_SENDER, "当前正式结果"],
        ]);
        expect(manager.drafts.get(rebuilt.chatInputId)?.input).toBe("尚未发送的输入");
      });

      it("keeps the replaced tab's title across the restart (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        first.restoreLabel("Refactor the importer", "user");

        await mgr.restartBackend("pi", "managed skills changed");

        expect(mgr.getActiveSession()?.getLabel()).toBe("Refactor the importer");
      });

      it("reports failed restoration without creating a new root and permits retrying the stored session https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let unavailable = true;
        const manager = buildManagerWithReplay({
          loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
            if (unavailable) throw new Error("private storage temporarily unavailable");
            return { sessionId, state: { model: null, mode: null } };
          }),
        });
        const original = await manager.createSession();
        sessionCreateSpy.mockClear();
        await expect(manager.restartBackend("pi", "configuration changed")).rejects.toThrow(
          t("agentChat.history.restoreUnavailable")
        );
        expect(manager.getLastError()).toBe(t("agentChat.history.restoreUnavailable"));
        expect(manager.getSessions()).toEqual([]);
        expect(storedChats.has(original.getBackendSessionId()!)).toBe(true);
        expect(sessionCreateSpy).not.toHaveBeenCalled();

        unavailable = false;
        const restored = await manager.loadNativeSessionFromHistory(
          "pi",
          original.getBackendSessionId()!
        );
        expect(restored.getBackendSessionId()).toBe(original.getBackendSessionId());
        expect(manager.getActiveSession()).toBe(restored);
      });

      it("defers restart until an active turn leaves running", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");

        await expect(mgr.restartBackend("pi", "skills changed")).resolves.toBe(true);
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        getSessionTestHandle(first).setStatus("idle");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("pi");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 interrupts a busy turn when a privacy-boundary restart cannot be deferred", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");

        await expect(
          mgr.restartBackend("pi", "Miyo Search scope changed", { deferWhileBusy: false })
        ).resolves.toBe(true);

        expect(mockSessionCancel).toHaveBeenCalledWith();
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 runs a non-deferrable restart immediately even with a held config change (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await mgr.createSession();

        await mgr.noteSpawnConfigChanged("pi", "managed skills changed");
        await mgr.restartBackend("pi", "Miyo Search scope changed", {
          deferWhileBusy: false,
        });

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("pi")).toBe(false);
      });

      it("queues a second concurrent restart so the latest settings are not lost", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const shutdown = holdNextBackendShutdown();

        const first = mgr.restartBackend("pi", "byok save #1");
        await shutdown.started;
        const second = mgr.restartBackend("pi", "byok save #2");
        shutdown.release();
        await Promise.all([first, second]);
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 keeps a queued privacy-boundary restart non-deferrable", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        sessionCreateSpy.mockImplementationOnce((opts) => {
          const replacement = makeMockSession({
            internalId: opts.internalId,
            chatInputId: opts.chatInputId,
            backendId: opts.backendId,
            projectId: opts.projectId,
          });
          getSessionTestHandle(replacement).setStatus("running");
          return replacement;
        });
        const shutdown = holdNextBackendShutdown();

        const ordinaryRestart = mgr.restartBackend("pi", "managed env changed");
        await shutdown.started;
        const privacyRestart = mgr.restartBackend("pi", "Miyo Search scope changed", {
          deferWhileBusy: false,
        });
        shutdown.release();
        await Promise.all([ordinaryRestart, privacyRestart]);
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
      });

      it("restarts after a failed turn settles without restoring an uncommitted display-only error https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        const firstHandle = getSessionTestHandle(first);
        firstHandle.setStatus("running");

        mockUnhealthyHandler?.();
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        const failedTurn = [
          { message: "Summarize this note" },
          {
            message: "OpenCode's internal service stopped. Please try again.",
            isErrorMessage: true,
          },
        ];
        firstHandle.setMessages(failedTurn, true);
        firstHandle.setStatus("error");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(
          mgr
            .getActiveSession()
            ?.store.getDisplayMessages()
            .map((m) => m.message)
        ).toEqual([]);
      });

      it("rebuilds both failed chats from their backend records without copying uncommitted display snapshots https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        const second = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");
        getSessionTestHandle(second).setStatus("running");

        mockUnhealthyHandler?.();
        const firstMessages = [
          { message: "First question" },
          { message: "Internal error: Internal service failure", isErrorMessage: true },
        ];
        const secondMessages = [
          { message: "Second question" },
          {
            message: "OpenCode's internal service stopped. Please try again.",
            isErrorMessage: true,
          },
        ];
        getSessionTestHandle(first).setMessages(firstMessages);
        getSessionTestHandle(first).setStatus("error");
        expect(mockBackendShutdown).not.toHaveBeenCalled();
        getSessionTestHandle(second).setMessages(secondMessages);
        getSessionTestHandle(second).setStatus("error");
        await flushTimers();

        const replaced = mgr.getSessions();
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(
          replaced
            .find((s) => s.chatInputId === first.chatInputId)
            ?.store.getDisplayMessages()
            .map((m) => m.message)
        ).toEqual([]);
        expect(
          replaced
            .find((s) => s.chatInputId === second.chatInputId)
            ?.store.getDisplayMessages()
            .map((m) => m.message)
        ).toEqual([]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 leaves ordinary restarts to replay the backend transcript", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setMessages([{ message: "Local draft transcript" }]);

        await mgr.restartBackend("pi", "models changed");

        expect(mgr.getActiveSession()?.store.getDisplayMessages()).toEqual([]);
      });

      it("reports an unavailable session after a background restart without presenting an unsaved display snapshot as restored https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const mgr = buildManagerWithReplay({
          loadSession: jest.fn(async () => {
            throw new Error("storage unavailable");
          }),
        });
        const first = await mgr.createSession();
        const handle = getSessionTestHandle(first);
        handle.setStatus("running");
        mockUnhealthyHandler?.();
        handle.setMessages([{ message: "Unsaved prompt" }]);
        handle.setStatus("error");
        await waitFor(() =>
          expect(mgr.getLastError()).toBe(t("agentChat.history.restoreUnavailable"))
        );
        expect(mgr.getActiveSession()).toBeNull();
        expect(storedChats.has(first.getBackendSessionId()!)).toBe(true);
      });
    });

    describe("registerPreload()", () => {
      it("moves a backend from pending to ready once the preload resolves", async () => {
        const mgr = buildManager();
        let resolve!: () => void;
        const promise = new Promise<void>((res) => {
          resolve = res;
        });
        mgr.registerPreload("pi", promise);
        expect(mgr.getPreloadStatus("pi")).toBe("pending");
        expect(mgr.isPreloadReady("pi")).toBe(false);
        resolve();
        await promise;
        await Promise.resolve();
        expect(mgr.getPreloadStatus("pi")).toBe("ready");
        expect(mgr.isPreloadReady("pi")).toBe(true);
      });

      it("moves a backend from pending to error when the preload rejects yet still reports ready so chat unblocks", async () => {
        const mgr = buildManager();
        mgr.registerPreload(
          "pi",
          Promise.reject(new Error("preload failed")).catch((e) => {
            throw e;
          })
        );
        await flushTimers();
        expect(mgr.getPreloadStatus("pi")).toBe("error");
        expect(mgr.isPreloadReady("pi")).toBe(true);
      });
    });

    describe("isPreloadReady()", () => {
      it("treats a backend with no registered preload as ready", () => {
        expect(buildManager().isPreloadReady("pi")).toBe(true);
      });
    });

    describe("getPreloadStatus()", () => {
      it("reports absent for a backend with no registered preload", () => {
        expect(buildManager().getPreloadStatus("pi")).toBe("absent");
      });
    });

    describe("getCachedModelCatalog()", () => {
      it("returns the catalog owned by the preloader's probe", () => {
        const catalog = modelCatalog("catalog");
        const mgr = buildManager({ preloader: { getCachedModelCatalog: jest.fn(() => catalog) } });

        expect(mgr.getCachedModelCatalog("pi")).toBe(catalog);
      });
    });

    describe("getModelCacheSignature()", () => {
      it("is stable when shared discovery is unchanged", () => {
        const catalog = modelCatalog("catalog");
        const first = buildManager({ preloader: { getCachedModelCatalog: () => catalog } });
        const second = buildManager({ preloader: { getCachedModelCatalog: () => catalog } });

        expect(first.getModelCacheSignature("pi")).toBe(second.getModelCacheSignature("pi"));
      });

      it("changes when shared model discovery changes", () => {
        const first = buildManager({
          preloader: { getCachedModelCatalog: () => modelCatalog("first-catalog") },
        });
        const second = buildManager({
          preloader: { getCachedModelCatalog: () => modelCatalog("second-catalog") },
        });

        expect(first.getModelCacheSignature("pi")).not.toBe(second.getModelCacheSignature("pi"));
      });
    });

    describe("getSeedSelection()", () => {
      function buildManagerWithOffered(
        offered:
          | readonly (string | { baseModelId: string; credentialState: "ok" | "missing_key" })[]
          | undefined,
        saved: { baseModelId: string; effort: string | null } | null,
        routesVaultAgentModels = false
      ): AgentSessionManager {
        mockSavedDefault(saved);
        return buildManager({
          descriptor: buildDescriptor(
            offered
              ? {
                  routesVaultAgentModels,
                  getEnabledModelEntries: () =>
                    offered.map((entry) =>
                      typeof entry === "string"
                        ? { baseModelId: entry, name: entry, credentialState: "ok" }
                        : { ...entry, name: entry.baseModelId }
                    ),
                }
              : {}
          ),
        });
      }

      it("returns null when nothing has been saved", () => {
        expect(
          buildManagerWithOffered(["copilot-plus/flash"], null).getSeedSelection("pi")
        ).toBeNull();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 seeds the first enabled model with a working key when nothing is saved for a backend that may only run enabled models", () => {
        const mgr = buildManagerWithOffered(
          [
            { baseModelId: "byok/gpt-5.6", credentialState: "missing_key" },
            "copilot-plus/flash",
            "copilot-plus/glm-5.2",
          ],
          null,
          true
        );

        expect(mgr.getSeedSelection("pi")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
        expect(Notice).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 seeds nothing, even from a saved default, when a backend that may only run enabled models has none enabled", () => {
        const mgr = buildManagerWithOffered(
          [],
          { baseModelId: "copilot-plus/glm-5.2", effort: null },
          true
        );

        expect(mgr.getSeedSelection("pi")).toBeNull();
      });

      it("returns the saved selection while its model is still offered", () => {
        const saved = { baseModelId: "copilot-plus/glm-5.2", effort: "high" };

        expect(
          buildManagerWithOffered(
            ["copilot-plus/flash", "copilot-plus/glm-5.2"],
            saved
          ).getSeedSelection("pi")
        ).toEqual(saved);
      });

      it.each([
        {
          name: "prefers a carried-over selection over the saved default while its model is offered",
          offered: ["copilot-plus/flash", "copilot-plus/glm-5.2"],
          saved: { baseModelId: "copilot-plus/flash", effort: "low" },
          preferred: { baseModelId: "copilot-plus/glm-5.2", effort: "high" },
          expected: { baseModelId: "copilot-plus/glm-5.2", effort: "high" },
        },
        {
          name: "falls back to the saved default when the carried-over model is no longer offered",
          offered: ["copilot-plus/flash"],
          saved: { baseModelId: "copilot-plus/flash", effort: "low" },
          preferred: { baseModelId: "copilot-plus/glm-5.2", effort: "high" },
          expected: { baseModelId: "copilot-plus/flash", effort: "low" },
        },
        {
          name: "stands in with an enabled model when the carried-over model was turned off and no saved default can replace it",
          offered: ["copilot-plus/flash"],
          saved: null,
          preferred: { baseModelId: "copilot-plus/glm-5.2", effort: "high" },
          expected: { baseModelId: "copilot-plus/flash", effort: null },
        },
        {
          name: "returns null when there is neither a carried-over selection nor a saved default",
          offered: ["copilot-plus/flash"],
          saved: null,
          preferred: undefined,
          expected: null,
        },
      ] as {
        name: string;
        offered: string[];
        saved: { baseModelId: string; effort: string } | null;
        preferred: { baseModelId: string; effort: string } | undefined;
        expected: { baseModelId: string; effort: string | null } | null;
      }[])("$name (https://github.com/logancyang/obsidian-copilot/issues/3319)", (testCase) => {
        const mgr = buildManagerWithOffered(testCase.offered, testCase.saved);

        expect(mgr.getSeedSelection("pi", testCase.preferred)).toEqual(testCase.expected);
      });

      it("seeds the first enabled model when the saved one is no longer offered, so no prompt goes to the agent's own fallback (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash", "copilot-plus/glm-5.2"], {
          baseModelId: "copilot-plus/minimax-m2.7",
          effort: "high",
        });

        expect(mgr.getSeedSelection("pi")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
      });

      it("uses a credential-ready fallback and reports the substitution when the saved model has no key (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(
          [{ baseModelId: "byok/gpt-5.6", credentialState: "missing_key" }, "copilot-plus/flash"],
          { baseModelId: "byok/gpt-5.6", effort: "high" }
        );

        expect(mgr.getSeedSelection("pi")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
        expect((Notice as unknown as jest.Mock).mock.calls.at(-1)?.[0]).toBe(
          "pi couldn't use gpt-5.6. Using copilot-plus/flash instead."
        );
      });

      it("returns null and reports the unavailable selection when no enabled model is runnable (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(
          [{ baseModelId: "byok/gpt-5.6", credentialState: "missing_key" }],
          { baseModelId: "copilot-plus/minimax-m2.7", effort: null }
        );

        expect(mgr.getSeedSelection("pi")).toBeNull();
        expect(noticeMock.mock.calls.at(-1)?.[0]).toBe(
          "pi couldn't use minimax-m2.7. Enable a model pi can run."
        );
      });

      it("reports an unavailable model once, not on every selection read (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], {
          baseModelId: "copilot-plus/minimax-m2.7",
          effort: null,
        });

        mgr.getSeedSelection("pi");
        mgr.getSeedSelection("pi");

        expect(Notice).toHaveBeenCalledTimes(1);
        expect(noticeMock.mock.calls[0][0]).toContain("minimax-m2.7");
        expect(noticeMock.mock.calls[0][0]).toContain("copilot-plus/flash");
      });

      it("reports each unavailable model once (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], {
          baseModelId: "copilot-plus/model-a",
          effort: null,
        });
        mgr.getSeedSelection("pi");
        expect(noticeMock.mock.calls.at(-1)?.[0]).toContain("model-a");

        mockSavedDefault({ baseModelId: "copilot-plus/model-b", effort: null });
        mgr.getSeedSelection("pi");

        expect(Notice).toHaveBeenCalledTimes(2);
        expect(noticeMock.mock.calls.at(-1)?.[0]).toContain("model-b");
      });

      it("reports when a restarted chat falls back to the saved default (https://github.com/logancyang/obsidian-copilot/issues/3319)", () => {
        const saved = { baseModelId: "copilot-plus/flash", effort: "low" };
        const mgr = buildManagerWithOffered([saved.baseModelId], saved);

        expect(
          mgr.getSeedSelection("pi", {
            baseModelId: "copilot-plus/minimax-m2.7",
            effort: "high",
          })
        ).toEqual(saved);
        expect((Notice as unknown as jest.Mock).mock.calls.at(-1)?.[0]).toBe(
          "pi couldn't use minimax-m2.7. Using copilot-plus/flash instead."
        );
      });

      it("reports the same unavailable model only once across open-chat and saved-default reads (https://github.com/logancyang/obsidian-copilot/issues/3319)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], null);
        const unavailable = {
          baseModelId: "copilot-plus/minimax-m2.7",
          effort: null,
        };
        mgr.getSeedSelection("pi", unavailable);

        mockSavedDefault(unavailable);
        mgr.getSeedSelection("pi");

        expect(Notice).toHaveBeenCalledTimes(1);
      });

      it("returns null when the enabled list is empty rather than reapplying the model the user just disabled (https://github.com/logancyang/obsidian-copilot/issues/3319)", () => {
        const saved = { baseModelId: "copilot-plus/glm-5.2", effort: null };
        const mgr = buildManagerWithOffered([], saved);

        expect(mgr.getSeedSelection("pi")).toBeNull();
        expect(Notice).toHaveBeenCalledTimes(1);
      });

      it("keeps the saved selection when the backend publishes no enabled-model list (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const saved = { baseModelId: "copilot-plus/glm-5.2", effort: null };
        const mgr = buildManagerWithOffered(undefined, saved);

        expect(mgr.getSeedSelection("pi")).toEqual(saved);
        expect(Notice).not.toHaveBeenCalled();
      });

      it("leaves the saved preference on disk so settings can still clear it (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const saved = { baseModelId: "copilot-plus/minimax-m2.7", effort: null };
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], saved);

        expect(mgr.getSeedSelection("pi")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
        expect(mgr.getDefaultSelection("pi")).toEqual(saved);
      });
    });

    describe("applySelection()", () => {
      it("no-ops when no session is active", async () => {
        const mgr = buildManager();
        await expect(
          mgr.applySelection({ effort: "high" }, { expectBackendId: "pi" })
        ).resolves.toBeUndefined();
      });

      it("no-ops when the active session is on a different backend", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await expect(
          mgr.applySelection({ effort: "high" }, { expectBackendId: "claude" })
        ).resolves.toBeUndefined();
      });

      it("delegates dispatch to descriptor.applySelection with the resolved selection", async () => {
        const applySelection = jest.fn(async () => {});
        const mgr = buildManager({ descriptor: buildApplySelectionDescriptor(applySelection) });
        const entry = {
          baseModelId: "anthropic/sonnet",
          name: "Sonnet",
          provider: "anthropic",
          effortOptions: [
            { value: null, label: "Default" },
            { value: "high", label: "High" },
          ],
        };
        sessionCreateSpy.mockImplementationOnce((opts) => {
          const s = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
          (s as unknown as { getState: () => unknown }).getState = () => ({
            model: {
              current: { baseModelId: entry.baseModelId, effort: null },
              availableModels: [entry],
            },
            mode: null,
          });
          return s;
        });
        const session = await mgr.createSession();

        setSettingsMock.mockClear();
        await mgr.applySelection({ effort: "high" }, { expectBackendId: "pi" });
        expect(applySelection).toHaveBeenCalledWith(session, {
          baseModelId: "anthropic/sonnet",
          effort: "high",
        });
        expect(readPersistedDefault(setSettingsMock, "pi")).toBeUndefined();

        applySelection.mockClear();
        setSettingsMock.mockClear();
        await mgr.applySelection({ baseModelId: "anthropic/opus", effort: null });
        expect(applySelection).toHaveBeenCalledWith(session, {
          baseModelId: "anthropic/opus",
          effort: null,
        });
        expect(readPersistedDefault(setSettingsMock, "pi")).toBeUndefined();
      });
    });

    describe("applyMode()", () => {
      function buildModeManager(
        getModeMapping: BackendDescriptor["getModeMapping"]
      ): AgentSessionManager {
        return buildManager({
          descriptor: buildDescriptor({ id: "pi", displayName: "Vault Agent", getModeMapping }),
        });
      }

      it("refreshes a state-independent native mapping before dispatch", async () => {
        const manager = buildModeManager(() => ({
          kind: "setMode",
          canonical: { default: "default", plan: "plan", auto: "auto" },
        }));
        const session = await manager.createSession("pi");

        await manager.applyMode("pi", "auto", {
          kind: "setMode",
          nativeId: "bypassPermissions",
        });

        expect(session.setMode).toHaveBeenCalledWith("auto");
      });

      it("uses the translated spec when the mapping requires live backend state", async () => {
        const manager = buildModeManager((modeState) =>
          modeState
            ? {
                kind: "setMode",
                canonical: { default: "default", plan: "plan", auto: "full-access" },
              }
            : null
        );
        const session = await manager.createSession("pi");

        await manager.applyMode("pi", "auto", {
          kind: "setMode",
          nativeId: "cached-auto",
        });

        expect(session.setMode).toHaveBeenCalledWith("cached-auto");
      });
    });

    describe("getChatHistoryItems()", () => {
      it("lists titles, pin times and visit times directly from session records without reading vault notes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend, app } = buildHistoryHarness({
          sessions: [
            {
              sessionId: "root-stored-chat",
              cwd: "/vault",
              title: "Stored title",
              createdAtMs: 1000,
              lastAccessedAtMs: 5000,
              pinnedAt: 6000,
            },
          ],
        });
        const items = await manager.getChatHistoryItems();
        expect(items).toEqual([
          expect.objectContaining({
            id: buildNativeChatId("pi", "root-stored-chat"),
            title: "Stored title",
            pinnedAt: 6000,
            createdAt: new Date(1000),
            lastAccessedAt: new Date(5000),
            backendId: "pi",
          }),
        ]);
        expect(backend.listSessions).toHaveBeenCalledWith({ cwd: "/vault" });
        expect(app.vault.getFiles).not.toHaveBeenCalled();
        expect(app.vault.read).not.toHaveBeenCalled();
      });

      it("uses each session record's project id to filter project history https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager } = buildHistoryHarness({
          sessions: [
            {
              sessionId: "root-project-chat",
              cwd: "/vault",
              projectId: HISTORY_PROJECT_ID,
              title: "Project",
            },
            { sessionId: "root-global-chat", cwd: "/vault", title: "Global" },
          ],
        });
        expect(
          (await manager.getChatHistoryItems(HISTORY_PROJECT_ID)).map((item) => item.id)
        ).toEqual([buildNativeChatId("pi", "root-project-chat")]);
        expect(await manager.getChatHistoryItems()).toHaveLength(2);
      });
    });

    describe("deleteChatHistory()", () => {
      it("removes the stored session and closes its open tab https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({ sessions: [] });
        const session = await manager.createSession();
        const id = nativeIdOf(session);
        await manager.deleteChatHistory(id);
        expect(backend.deleteSession).toHaveBeenCalledWith({
          sessionId: session.getBackendSessionId(),
        });
        expect(await manager.getChatHistoryItems()).toEqual([]);
        expect(manager.getSessions()).toEqual([]);
        expect(manager.getOpenChatIds().has(id)).toBe(false);
      });

      it("closes a deleted running tab without pausing or releasing its removed backend session https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({ sessions: [] });
        backend.pauseSession = jest.fn().mockRejectedValue(new Error("Session not found"));
        const session = await manager.createSession();
        getSessionTestHandle(session).setStatus("running");
        await manager.deleteChatHistory(nativeIdOf(session));
        expect(backend.pauseSession).not.toHaveBeenCalled();
        expect(backend.closeSession).not.toHaveBeenCalled();
        expect(manager.getSessions()).toEqual([]);
        expect(manager.getOpenChatIds().size).toBe(0);
        expect(await manager.getChatHistoryItems()).toEqual([]);
      });

      it("locks deletion before backend loading and keeps it locked after duplicate attempts https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({ sessions: [] });
        const session = await manager.createSession();
        const entered = deferred();
        const release = deferred();
        backend.deleteSession.mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
        });
        const id = nativeIdOf(session);
        const deleting = manager.deleteChatHistory(id);
        expect(manager.isDeletingSession(session.internalId)).toBe(true);
        await expect(manager.deleteChatHistory(id)).rejects.toThrow(t("localData.sessionBusy"));
        await entered.promise;
        expect(manager.isDeletingSession(session.internalId)).toBe(true);
        await expect(manager.deleteChatHistory(id)).rejects.toThrow(t("localData.sessionBusy"));
        expect(manager.isDeletingSession(session.internalId)).toBe(true);
        expect(backend.deleteSession).toHaveBeenCalledTimes(1);
        release.resolve();
        await deleting;
        expect(manager.isDeletingSession(session.internalId)).toBe(false);
      });

      it("closes the removed session even when sidecar cleanup is incomplete https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({ sessions: [] });
        const session = await manager.createSession();
        const failure = Object.assign(new Error("sidecar cleanup failed"), {
          code: "SESSION_DELETE_INCOMPLETE",
        });
        backend.deleteSession.mockImplementationOnce(
          async ({ sessionId }: { sessionId: string }) => {
            storedChats.delete(sessionId);
            throw failure;
          }
        );
        await expect(manager.deleteChatHistory(nativeIdOf(session))).rejects.toBe(failure);
        expect(manager.getSessions()).toEqual([]);
        expect(manager.getOpenChatIds().size).toBe(0);
        expect(manager.isDeletingSession(session.internalId)).toBe(false);
      });

      it("closes a missing session when deletion succeeded but its index update failed https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({ sessions: [] });
        const session = await manager.createSession();
        const failure = Object.assign(new Error("index write denied"), { code: "EACCES" });
        backend.deleteSession.mockImplementationOnce(
          async ({ sessionId }: { sessionId: string }) => {
            storedChats.delete(sessionId);
            throw failure;
          }
        );
        backend.sessionExistsLocally = jest.fn(async () => false);
        await expect(manager.deleteChatHistory(nativeIdOf(session))).rejects.toBe(failure);
        expect(manager.getSessions()).toEqual([]);
        expect(manager.getOpenChatIds().size).toBe(0);
        expect(manager.isDeletingSession(session.internalId)).toBe(false);
      });

      it("keeps the open session and stored history when deletion fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({ sessions: [] });
        const session = await manager.createSession();
        backend.deleteSession.mockRejectedValueOnce(new Error("disk locked"));
        await expect(manager.deleteChatHistory(nativeIdOf(session))).rejects.toThrow("disk locked");
        expect(manager.getSessions()).toEqual([session]);
        expect(await manager.getChatHistoryItems()).toHaveLength(1);
      });
    });

    describe("isDeletingSession()", () => {
      it("reports pending deletion only for the affected open session and clears it when deletion finishes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({ sessions: [] });
        const session = await manager.createSession();
        const sibling = await manager.createSession();
        const entered = deferred();
        const release = deferred();
        backend.deleteSession.mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
        });
        expect(manager.isDeletingSession(session.internalId)).toBe(false);
        const deleting = manager.deleteChatHistory(nativeIdOf(session));
        await entered.promise;
        expect(manager.isDeletingSession(session.internalId)).toBe(true);
        expect(manager.isDeletingSession(sibling.internalId)).toBe(false);
        expect(manager.isDeletingSession("missing")).toBe(false);
        release.resolve();
        await deleting;
        expect(manager.isDeletingSession(session.internalId)).toBe(false);
      });
    });

    describe("forkChat()", () => {
      it("opens the copied session under a new id and leaves the source title unchanged https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend } = buildHistoryHarness({
          sessions: [{ sessionId: "root-source", cwd: "/vault", title: "Source title" }],
        });
        const fork = await manager.forkChat(buildNativeChatId("pi", "root-source"));
        expect(backend.forkSession).toHaveBeenCalledWith({ sessionId: "root-source" });
        expect(fork.getBackendSessionId()).toBe("root-source-fork");
        expect(manager.getActiveSession()).toBe(fork);
        await manager.updateChatTitle(buildNativeChatId("pi", "root-source-fork"), "Fork title");
        expect(storedChats.get("root-source")?.title).toBe("Source title");
        expect(storedChats.get("root-source-fork")?.title).toBe("Fork title");
      });

      it("forwards the turn-end entry id for a per-turn branch (https://github.com/ItsDalk-Lane/Vault-Agent/issues/12)", async () => {
        const { manager, backend } = buildHistoryHarness({
          sessions: [{ sessionId: "root-source", cwd: "/vault", title: "Source title" }],
        });
        const fork = await manager.forkChat(buildNativeChatId("pi", "root-source"), "23");
        expect(backend.forkSession).toHaveBeenCalledWith({
          sessionId: "root-source",
          atEntryId: "23",
        });
        expect(fork.getBackendSessionId()).toBe("root-source-fork");
      });
    });

    describe("getLocalDataBackend()", () => {
      it("provides the same current backend for local data inspection without creating a chat https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, backend, descriptor } = buildHistoryHarness({ sessions: [] });
        await expect(manager.getLocalDataBackend()).resolves.toBe(backend);
        await expect(manager.getLocalDataBackend()).resolves.toBe(backend);
        expect(descriptor.createBackendProcess).toHaveBeenCalledTimes(1);
        expect(manager.getSessions()).toEqual([]);
      });
    });

    describe("updateChatTitle()", () => {
      it("stores the renamed title and updates the open tab https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager } = buildHistoryHarness({ sessions: [] });
        const session = await manager.createSession();
        await manager.updateChatTitle(nativeIdOf(session), "Renamed conversation");
        expect((await manager.getChatHistoryItems())[0].title).toBe("Renamed conversation");
        expect(session.setLabel).toHaveBeenCalledWith("Renamed conversation");
      });
    });

    describe("setChatPinned()", () => {
      it("pins and unpins the same session id without creating a note https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, app } = buildHistoryHarness();
        const id = buildNativeChatId("pi", "root-saved-chat");
        const pinned = await manager.setChatPinned(id, true);
        expect(pinned.id).toBe(id);
        expect(pinned.pinnedAt).toEqual(expect.any(Number));
        expect((await manager.getChatHistoryItems())[0].pinnedAt).toBe(pinned.pinnedAt);
        await expect(manager.setChatPinned(id, false)).resolves.toEqual({
          id,
          pinnedAt: undefined,
        });
        expect((await manager.getChatHistoryItems())[0].pinnedAt).toBeUndefined();
        expect(app.vault.create).not.toHaveBeenCalled();
      });
    });

    describe("rolloverSession()", () => {
      it("opens the real summarized root in the source project and preserves the source chat without sending a question https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const replay = buildReplayingBackend();
        const prompt = jest.fn();
        const rolloverSession = jest.fn(async ({ sessionId }: { sessionId: string }) => {
          replay.emit(sessionId, {
            sessionUpdate: "state_changed",
            state: { model: null, mode: null, readOnly: true },
          });
          return { sessionId: "root-new-summary", state: { model: null, mode: null } };
        });
        const pi = buildDescriptor({
          id: "pi",
          createBackendProcess: () => ({ ...replay.backend, prompt, rolloverSession }),
        });
        const manager = buildManager({ descriptor: pi });
        storeChat("root-source");
        storeChat("root-new-summary");
        const source = await manager.loadNativeSessionFromHistory("pi", "root-source");
        const next = await manager.rolloverSession(source.internalId);
        expect(rolloverSession).toHaveBeenCalledWith({ sessionId: "root-source" });
        expect(next.getBackendSessionId()).toBe("root-new-summary");
        expect(next.projectId).toBe(source.projectId);
        expect(manager.getActiveSession()).toBe(next);
        expect(manager.getSessions()).toContain(source);
        expect(source.getState()?.readOnly).toBe(true);
        expect(prompt).not.toHaveBeenCalled();
      });

      it("keeps the selected source visible when summary creation fails and rejects an unavailable source https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const replay = buildReplayingBackend();
        const rolloverSession = jest.fn(async () => {
          throw new Error("summary failed");
        });
        const manager = buildManager({
          descriptor: buildDescriptor({
            id: "pi",
            createBackendProcess: () => ({ ...replay.backend, rolloverSession }),
          }),
        });
        storeChat("root-source");
        storeChat("root-new-summary");
        const source = await manager.loadNativeSessionFromHistory("pi", "root-source");
        const port = manager;
        await expect(port.rolloverSession(source.internalId)).rejects.toThrow("summary failed");
        expect(manager.getActiveSession()).toBe(source);
        await expect(port.rolloverSession("missing")).rejects.toThrow("聊天已关闭");
        expect(rolloverSession).toHaveBeenCalledTimes(1);
      });
    });

    describe("subscribeStorageChanges()", () => {
      it("keeps page subscriptions working after the engine is replaced and releases them at shutdown https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const emitters: (() => void)[] = [];
        const releases = [jest.fn(), jest.fn()];
        const exits: (() => void)[] = [];
        let created = 0;
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => {
              const generation = created++;
              return {
                ...makeMockBackendProcess(),
                subscribeStorageChanges: (listener: () => void) => {
                  emitters[generation] = listener;
                  return releases[generation];
                },
                onExit: (listener: () => void) => {
                  exits.push(listener);
                  return () => undefined;
                },
              };
            },
          }),
        });
        const listener = jest.fn();
        const stop = manager.subscribeStorageChanges(listener);
        await manager.getLocalDataBackend();
        emitters[0]();
        expect(listener).toHaveBeenCalledTimes(1);
        exits[0]();
        await manager.getLocalDataBackend();
        expect(releases[0]).toHaveBeenCalledTimes(1);
        emitters[1]();
        expect(listener).toHaveBeenCalledTimes(2);
        stop();
        emitters[1]();
        expect(listener).toHaveBeenCalledTimes(2);
        await manager.shutdown();
        expect(releases[1]).toHaveBeenCalledTimes(1);
      });
      it("isolates a failed page listener from the remaining subscribers https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let emit!: () => void;
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => ({
              ...makeMockBackendProcess(),
              subscribeStorageChanges: (listener: () => void) => {
                emit = listener;
                return () => undefined;
              },
            }),
          }),
        });
        manager.subscribeStorageChanges(() => {
          throw new Error("closed page");
        });
        const listener = jest.fn();
        manager.subscribeStorageChanges(listener);
        await manager.getLocalDataBackend();
        expect(() => emit()).not.toThrow();
        expect(listener).toHaveBeenCalledTimes(1);
      });
    });

    describe("exportActiveSession()", () => {
      it("exports a standalone copy through the system picker and preserves cancellation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const replay = buildReplayingBackend();
        const attachments = [{ name: "images/photo.png", content: new Uint8Array([1, 2, 3]) }];
        const exportSession = jest.fn(async () => ({
          suggestedName: "chat.md",
          content: "![photo](images/photo.png)",
          attachments,
        }));
        const manager = buildManager({
          descriptor: buildDescriptor({
            id: "pi",
            createBackendProcess: () => ({ ...replay.backend, exportSession }),
          }),
        });
        storeChat("root-export");
        await manager.loadNativeSessionFromHistory("pi", "root-export");
        (saveChatExport as jest.Mock)
          .mockResolvedValueOnce({ path: "/chosen/chat.md" })
          .mockResolvedValueOnce(null);
        await expect(manager.exportActiveSession("markdown")).resolves.toEqual({
          path: "/chosen/chat.md",
        });
        expect(exportSession).toHaveBeenCalledWith({
          sessionId: "root-export",
          format: "markdown",
        });
        expect(saveChatExport).toHaveBeenCalledWith(
          "chat.md",
          "![photo](images/photo.png)",
          attachments
        );
        await expect(manager.exportActiveSession("markdown")).resolves.toBeNull();
      });
      it("rejects exporting before a chat is available https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        await expect(buildManager().exportActiveSession()).rejects.toThrow(
          t("localData.noChatToExport")
        );
      });
    });

    describe("loadNativeSessionFromHistory()", () => {
      it("reports a missing session without creating a replacement or reading vault notes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { manager, app } = buildHistoryHarness({ sessions: [] });
        await expect(
          manager.loadNativeSessionFromHistory("pi", "root-deleted")
        ).rejects.toMatchObject({
          code: "SESSION_NOT_FOUND",
          message: t("localData.sessionMissing"),
        });
        expect(manager.getSessions()).toEqual([]);
        expect(app.vault.read).not.toHaveBeenCalled();
      });
      it("preserves the original pending Pi plan while real Manager restore replays model, effort and ordinary mode configuration https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const replay = buildReplayingBackend();
        const plan = {
          id: "original-plan",
          revision: 1,
          title: "PISMOKE-REOPEN-PLAN",
          body: "原始正文与标题不同",
          permissionGated: true,
          pendingToolCallId: "original-plan-call",
          decision: "pending" as const,
        };
        const state = {
          model: null,
          mode: {
            current: "default",
            options: [],
            apply: {
              default: { kind: "setMode", nativeId: "default" },
              auto: { kind: "setMode", nativeId: "auto" },
            },
          },
        } as BackendState;
        const decide = jest.fn(async () => undefined);
        const backend = {
          ...replay.backend,
          decidePendingPlan: decide,
          prompt: jest.fn(),
          setSessionConfigOption: jest.fn(async () => state),
          setSessionMode: jest.fn(async () => state),
          loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
            replay.emit(sessionId, {
              sessionUpdate: "session_projection",
              projection: {
                cursor: { streamEpoch: "original", frameIndex: 1 },
                mode: "replace",
                messages: [],
                pending: {
                  permissions: [],
                  questions: [],
                  plan,
                  recovery: {
                    status: "available",
                    pendingPermissionIds: [],
                    pendingQuestionIds: [],
                    pendingMutationIds: [],
                    crashLoopTripped: false,
                  },
                },
              },
            });
            return { sessionId, state };
          }),
        } as unknown as BackendProcess;
        const descriptor = buildDescriptor({
          id: "pi",
          planLifecycle: "independent",
          createBackendProcess: () => backend,
          getModeMapping: () => ({
            kind: "setMode",
            canonical: { default: "default", plan: "plan" },
          }),
        });
        const manager = buildManager({ descriptor });
        getSettingsMock.mockReturnValue({
          agentMode: { activeBackend: "pi", backends: { pi: { defaultMode: "auto" } } },
        });
        storeChat("root-saved-plan-root");
        const session = await manager.loadNativeSessionFromHistory("pi", "root-saved-plan-root");
        expect(backend.setSessionMode).not.toHaveBeenCalled();
        expect(session.getState()?.mode?.current).toBe("default");
        expect(session.getCurrentPlan()).toEqual(plan);
        await session.setConfigOption("pi-model", "saved-model");
        await session.setConfigOption("pi-effort", "medium");
        await session.setMode("default");
        expect(session.getCurrentPlan()).toEqual(plan);
        expect(session.hasPendingPlanPermission()).toBe(true);
        expect(decide).not.toHaveBeenCalled();
        expect(backend.prompt).not.toHaveBeenCalled();
        await session.resolvePlanProposalPermission("original-plan-call", false, "先核对原文");
        expect(decide).toHaveBeenCalledWith({
          sessionId: "root-saved-plan-root",
          planId: "original-plan",
          revision: 1,
          action: "feedback",
          feedback: "先核对原文",
        });
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 keeps the frames replayed before the load response as history bubbles and drops out-of-turn frames that arrive after it", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "test", "u1"));
            emit(replayChunk("agent_message_chunk", "first ", "a1"));
          },
        });
        const { manager } = buildHistoryHarness({
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("pi", "root-saved-chat");
        replay.emit("root-saved-chat", replayChunk("agent_message_chunk", "second", "a1"));

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "test"],
          [AI_SENDER, "first "],
        ]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/643 shows a reopened chat's thinking, tool call with its result, todo plan, and reply from the frames its backend replays during load", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "rename the note", "u1"));
            emit({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "mv" } });
            emit({
              sessionUpdate: "tool_call",
              toolCallId: "tool-mv",
              title: "Bash: mv a.md b.md",
              kind: "execute",
              status: "in_progress",
            });
            emit({ sessionUpdate: "tool_call_update", toolCallId: "tool-mv", status: "completed" });
            emit({
              sessionUpdate: "plan",
              entries: [{ content: "Rename the note", status: "completed", priority: "medium" }],
            });
            emit(replayChunk("agent_message_chunk", "Renamed.", "a1"));
          },
        });
        const { manager } = buildHistoryHarness({
          backendId: "pi",
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("pi", "root-saved-chat");

        const [user, reply] = session.store.getDisplayMessages();
        expect(session.store.getDisplayMessages()).toHaveLength(2);
        expect([user.sender, user.message]).toEqual([USER_SENDER, "rename the note"]);
        expect(reply.parts?.map((p) => p.kind)).toEqual(["thought", "tool_call", "plan", "text"]);
        expect(reply.parts?.find((p) => p.kind === "tool_call")).toMatchObject({
          id: "tool-mv",
          status: "completed",
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 registers the chat's handler before asking the backend to load the session", async () => {
        const replay = buildReplayingBackend();
        const { manager } = buildHistoryHarness({
          createBackendProcess: jest.fn(() => replay.backend),
        });

        await manager.loadNativeSessionFromHistory("pi", "root-saved-chat");

        expect(replay.handlerCountAtOpen.load).toBe(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 registers the chat's handler before falling back to resumeSession when load is unsupported", async () => {
        const replay = buildReplayingBackend({
          loadSession: jest.fn(async () => {
            throw new MethodUnsupportedError("session/load");
          }),
        });
        const { manager } = buildHistoryHarness({
          createBackendProcess: jest.fn(() => replay.backend),
        });

        await manager.loadNativeSessionFromHistory("pi", "root-saved-chat");

        expect(replay.backend.resumeSession).toHaveBeenCalledTimes(1);
        expect(replay.handlerCountAtOpen.resume).toBe(1);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/602 drops out-of-turn agent frames for a chat reopened through resumeSession, which replays nothing", async () => {
        const replay = buildReplayingBackend({
          loadSession: jest.fn(async () => {
            throw new MethodUnsupportedError("session/load");
          }),
        });
        const { manager } = buildHistoryHarness({
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("pi", "root-saved-chat");
        replay.emit("root-saved-chat", replayChunk("agent_message_chunk", "background", "a1"));

        expect(senderAndText(session)).toEqual([]);
      });

      it.each([
        ["load fails", new Error("load blew up"), undefined],
        [
          "load is unsupported and resume fails",
          new MethodUnsupportedError("session/load"),
          new Error("resume blew up"),
        ],
      ] as const)(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/602 disposes the attached chat and opens nothing when %s",
        async (_case, loadError, resumeError) => {
          const replay = buildReplayingBackend({
            loadSession: jest.fn(async () => {
              throw loadError;
            }),
            ...(resumeError
              ? {
                  resumeSession: jest.fn(async () => {
                    throw resumeError;
                  }),
                }
              : {}),
          });
          const { manager } = buildHistoryHarness({
            createBackendProcess: jest.fn(() => replay.backend),
          });

          await expect(
            manager.loadNativeSessionFromHistory("pi", "root-saved-chat")
          ).rejects.toThrow("Could not resume");

          expect(replay.unregister).toHaveBeenCalledTimes(1);
          expect(manager.getSessions()).toEqual([]);
        }
      );

      it.each([
        ["default", false],
        ["plan", false],
        ["default", true],
        [null, true],
      ] as const)(
        "keeps loaded session mode %s and readOnly=%s instead of applying the global auto default https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        async (mode, readOnly) => {
          const state: BackendState = {
            model: null,
            readOnly,
            mode: {
              current: mode,
              options: [
                { value: "default", label: "Default" },
                { value: "plan", label: "Plan" },
                { value: "auto", label: "Auto" },
              ],
              apply: { auto: { kind: "setMode", nativeId: "auto" } },
            },
          };
          const setSessionMode = jest.fn(async () => ({
            ...state,
            mode: { ...state.mode!, current: "auto" as const },
          }));
          const backend = buildResumeOnlyBackend({
            loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
              sessionId,
              state,
            })),
            setSessionMode,
          });
          const { manager } = buildHistoryHarness({ createBackendProcess: jest.fn(() => backend) });
          getSettingsMock.mockReturnValue({
            agentMode: { activeBackend: "pi", backends: { pi: { defaultMode: "auto" } } },
          });
          const session = await manager.loadNativeSessionFromHistory("pi", "root-saved-chat");
          expect(setSessionMode).not.toHaveBeenCalled();
          expect(session.getState()).toBe(state);
          expect(session.getState()?.mode?.current).toBe(mode);
          expect(session.getState()?.readOnly).toBe(readOnly);
        }
      );

      it("uses the global ordinary mode only when a writable session has no persisted mode current https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const state: BackendState = {
          model: null,
          mode: {
            current: null,
            options: [{ value: "auto", label: "Auto" }],
            apply: { auto: { kind: "setMode", nativeId: "auto" } },
          },
        };
        const setSessionMode = jest.fn(async () => ({
          ...state,
          mode: { ...state.mode!, current: "auto" as const },
        }));
        const backend = buildResumeOnlyBackend({
          loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
            sessionId,
            state,
          })),
          setSessionMode,
        });
        const { manager } = buildHistoryHarness({ createBackendProcess: jest.fn(() => backend) });
        getSettingsMock.mockReturnValue({
          agentMode: { activeBackend: "pi", backends: { pi: { defaultMode: "auto" } } },
        });
        const session = await manager.loadNativeSessionFromHistory("pi", "root-saved-chat");
        expect(setSessionMode).toHaveBeenCalledWith({
          sessionId: "root-saved-chat",
          modeId: "auto",
        });
        expect(session.getState()?.mode?.current).toBe("auto");
      });

      it("keeps focus on the most recently opened history row when restores finish out of order https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const entered = deferred();
        const release = deferred();
        const backend = buildResumeOnlyBackend({
          resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
            if (sessionId === "root-first-chat") {
              entered.resolve();
              await release.promise;
            }
            return { sessionId, state: { model: null, mode: null } };
          }),
        });
        const { manager } = buildHistoryHarness({ createBackendProcess: jest.fn(() => backend) });
        storeChat("root-first-chat");
        storeChat("root-second-chat");
        const firstLoading = manager.loadNativeSessionFromHistory("pi", "root-first-chat");
        await entered.promise;
        const second = await manager.loadNativeSessionFromHistory("pi", "root-second-chat");
        expect(manager.getActiveSession()).toBe(second);
        release.resolve();
        const first = await firstLoading;
        expect(first).not.toBe(second);
        expect(manager.getSessions()).toHaveLength(2);
        expect(manager.getActiveSession()).toBe(second);
      });

      it("shares one in-flight restore when the same history row is opened twice https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const entered = deferred();
        const release = deferred();
        const backend = buildResumeOnlyBackend({
          resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
            entered.resolve();
            await release.promise;
            return { sessionId, state: { model: null, mode: null } };
          }),
        });
        const { manager } = buildHistoryHarness({ createBackendProcess: jest.fn(() => backend) });
        const firstLoading = manager.loadNativeSessionFromHistory("pi", "root-saved-chat");
        await entered.promise;
        const secondLoading = manager.loadNativeSessionFromHistory("pi", "root-saved-chat");
        release.resolve();
        const [first, second] = await Promise.all([firstLoading, secondLoading]);
        expect(first).toBe(second);
        expect(backend.resumeSession).toHaveBeenCalledTimes(1);
        expect(manager.getSessions()).toEqual([first]);
        expect(manager.getActiveSession()).toBe(first);
      });

      it("rolls the active scope back when a cross-scope history load fails to resume", async () => {
        seedProjects("proj-rollback");
        const mgr = buildManager();
        await mgr.enterProject("proj-rollback");
        const projectSession = mgr.getActiveSession();
        expect(mgr.getActiveProjectId()).toBe("proj-rollback");

        await expect(mgr.loadNativeSessionFromHistory("pi", "missing")).rejects.toThrow();

        expect(mgr.getActiveProjectId()).toBe("proj-rollback");
        expect(mgr.getActiveSession()).toBe(projectSession);
      });
    });

    describe("enterProject()", () => {
      const PROJECT_ID = "proj-enter";

      function makeRecord(
        contextSource: ProjectConfig["contextSource"],
        usageTimestamps = 0,
        systemPrompt = ""
      ): ProjectFileRecord {
        return {
          project: {
            id: PROJECT_ID,
            name: PROJECT_ID,
            systemPrompt,
            contextSource,
            created: 0,
            UsageTimestamps: usageTimestamps,
          },
          filePath: `Projects/${PROJECT_ID}/project.md`,
          folderName: PROJECT_ID,
        };
      }

      function publish(record: ProjectFileRecord): void {
        projectsState.updateCachedProjectRecords([record]);
      }

      beforeEach(() => seedProjects(PROJECT_ID));

      it("touches last-used after a successful enter that spawns a session", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        expect(ProjectFileManager.getInstance).toHaveBeenCalled();
        expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
      });

      it("touches last-used on the restored-session path (no re-spawn)", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await mgr.exitProject();
        mockTouchProjectLastUsed.mockClear();
        sessionCreateSpy.mockClear();

        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
      });

      it("does not touch a re-click of the already-active project", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        mockTouchProjectLastUsed.mockClear();

        await mgr.enterProject(PROJECT_ID);

        expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
      });

      it("does not touch when the spawn fails", async () => {
        const mgr = buildManager();
        mockBackendStart.mockRejectedValueOnce(new Error("spawn boom"));

        await expect(mgr.enterProject(PROJECT_ID)).rejects.toThrow();

        expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
      });

      it("touches only the current scope when another enter wins the spawn race", async () => {
        const OTHER_ID = "proj-other";
        seedProjects(PROJECT_ID, OTHER_ID);
        const mgr = buildManager();

        const enterStale = mgr.enterProject(PROJECT_ID);
        const enterWinner = mgr.enterProject(OTHER_ID);
        await Promise.all([enterStale, enterWinner]);

        expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(OTHER_ID);
        expect(mockTouchProjectLastUsed).not.toHaveBeenCalledWith(PROJECT_ID);
      });

      it("rolls the entered scope back when its auto-spawn fails", async () => {
        const OTHER_ID = "proj-other-fail";
        seedProjects(PROJECT_ID, OTHER_ID);
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const projectSession = mgr.getActiveSession();
        expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);

        sessionCreateSpy.mockImplementationOnce(() => {
          throw new Error("spawn boom");
        });
        await expect(mgr.enterProject(OTHER_ID)).rejects.toThrow();

        expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);
        expect(mgr.getActiveSession()).toBe(projectSession);
      });

      it("detaches a conversational session on re-entry and spawns a fresh one", async () => {
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, PROJECT_ID);

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const visible = mgr.getSessionsForScope(PROJECT_ID);
        expect(visible).toHaveLength(1);
        expect(visible[0].internalId).not.toBe(old.internalId);
        expect(mgr.getSessions()).toContain(old);
      });

      it("reuses an empty landing session instead of stacking a blank tab", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession();
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(landing);
        expect(mgr.getSessionsForScope(PROJECT_ID)).toHaveLength(1);
      });

      it("does not reuse an error-state landing; spawns a fresh session instead", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        getSessionTestHandle(landing).setStatus("error");
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(landing);
      });

      it("replaces an empty landing on re-entry after the project's sources change", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();

        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const visible = mgr.getSessionsForScope(PROJECT_ID);
        expect(visible).toHaveLength(1);
        expect(visible[0]).not.toBe(landing);
      });

      it("reuses the replacement landing on a later re-entry when nothing changed since", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
        const fresh = mgr.getActiveSession();
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(fresh);
      });

      it("reuses an empty landing after a usage-timestamp-only touch", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession();
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com" }, 12345));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(landing);
      });

      it("keeps an empty landing when only inert project.md text changes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }, 0, "old instructions"));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com" }, 0, "new instructions"));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(landing);
      });

      it("reuses an empty landing after vault content inside the project's sources changes, building its context at the first message", async () => {
        jest.useFakeTimers();
        publish(makeRecord({ inclusions: "Notes" }));
        const app = buildApp();
        const mgr = buildManager({ app });
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        const onModify = (app.vault.on as jest.Mock).mock.calls.find(
          ([event]) => event === "modify"
        )![1];
        onModify(mockTFile({ path: "Notes/topic.md", extension: "md" }));
        jest.advanceTimersByTime(2000);

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(landing);
      });

      it("leaves the first message without an update note, since its context block is built from the current vault", async () => {
        jest.useFakeTimers();
        publish(makeRecord({ inclusions: "Notes" }));
        const app = buildApp();
        const mgr = buildManager({ app });
        await mgr.enterProject(PROJECT_ID);
        const hooks = sessionCreateSpy.mock.calls.at(-1)![0];

        const onModify = (app.vault.on as jest.Mock).mock.calls.find(
          ([event]) => event === "modify"
        )![1];
        onModify(mockTFile({ path: "Notes/topic.md", extension: "md" }));

        hooks.getProjectContextBlock!();
        expect(hooks.getProjectContextUpdates!()).toBeNull();
      });

      it("hands a project session the update note once per change until it acknowledges the epoch", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
        const hooks = sessionCreateSpy.mock.calls.at(-1)![0];
        expect(hooks.getProjectContextUpdates!()).toBeNull();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

        const update = hooks.getProjectContextUpdates!();
        expect(update?.block).toContain("<project_context_updates>");
        hooks.markProjectContextUpdatesDelivered!(update!.epoch);
        expect(hooks.getProjectContextUpdates!()).toBeNull();
      });
    });

    describe("exitProject()", () => {
      const PROJECT_ID = "proj-exit";

      it("does not touch last-used when returning to the global scope", async () => {
        seedProjects(PROJECT_ID);
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        mockTouchProjectLastUsed.mockClear();

        await mgr.exitProject();

        expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
      });
    });
  });
});
