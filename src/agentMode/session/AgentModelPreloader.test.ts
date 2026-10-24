import { App, FileSystemAdapter } from "obsidian";
import type VaultAgentPlugin from "@/main";
import { AgentModelPreloader } from "./AgentModelPreloader";
import type {
  BackendDescriptor,
  BackendProcess,
  BackendState,
  ModelSelection,
  SessionUpdateHandler,
} from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ agentMode: {} })),
}));

function buildApp(): App {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)("/vault");
  return { vault: { adapter } } as unknown as App;
}

function buildPlugin(): VaultAgentPlugin {
  return { manifest: { version: "1.0.0" } } as unknown as VaultAgentPlugin;
}

interface MockProcHandle {
  proc: BackendProcess;
  start: jest.Mock;
  shutdown: jest.Mock;
  newSession: jest.Mock;
  exitListeners: Set<() => void>;
  emitExit: () => void;
}

function makeMockProc(opts?: { newSessionState?: BackendState }): MockProcHandle {
  const start = jest.fn(async () => undefined);
  const shutdown = jest.fn(async () => undefined);
  const state: BackendState = opts?.newSessionState ?? {
    model: {
      current: { baseModelId: "claude-sonnet", effort: null } satisfies ModelSelection,
      availableModels: [
        {
          baseModelId: "claude-sonnet",
          name: "Claude Sonnet",
          provider: "anthropic",
          effortOptions: [],
        },
      ],
      apply: { kind: "setModel" },
    },
    mode: null,
  };
  const newSession = jest.fn(async () => ({ sessionId: "probe-1", state }));
  const exitListeners = new Set<() => void>();
  const proc: BackendProcess = {
    start,
    isRunning: () => true,
    onExit: (fn) => {
      exitListeners.add(fn);
      return () => exitListeners.delete(fn);
    },
    setPermissionPrompter: jest.fn(),
    registerSessionHandler: jest.fn(() => () => {}),
    newSession,
    prompt: jest.fn(),
    cancel: jest.fn(),
    setSessionModel: jest.fn(),
    isSetSessionModelSupported: () => true,
    setSessionMode: jest.fn(),
    isSetSessionModeSupported: () => true,
    setSessionConfigOption: jest.fn(),
    isSetSessionConfigOptionSupported: () => true,
    listSessions: jest.fn(),
    resumeSession: jest.fn(),
    loadSession: jest.fn(),
    shutdown,
  };
  return {
    proc,
    start,
    shutdown,
    newSession,
    exitListeners,
    emitExit: () => {
      for (const fn of exitListeners) fn();
    },
  };
}

function buildDescriptor(makeProc: () => MockProcHandle): {
  descriptor: BackendDescriptor;
  procHandle: MockProcHandle;
} {
  const procHandle = makeProc();
  const descriptor = {
    id: "pi",
    displayName: "Vault Agent",
    createBackendProcess: jest.fn(() => procHandle.proc),
  } as unknown as BackendDescriptor;
  return { descriptor, procHandle };
}

function catalogOf(baseModelIds: string[]): BackendState {
  return {
    model: {
      current: { baseModelId: baseModelIds[0], effort: null },
      availableModels: baseModelIds.map((baseModelId) => ({
        baseModelId,
        name: baseModelId,
        provider: null,
        effortOptions: [],
      })),
      apply: { kind: "setConfigOption", configId: "model" },
    },
    mode: null,
  };
}

function probeHandlerOf(procHandle: MockProcHandle): SessionUpdateHandler {
  return (procHandle.proc.registerSessionHandler as jest.Mock).mock.calls[0][1];
}

function pushCatalog(procHandle: MockProcHandle, state: BackendState): void {
  probeHandlerOf(procHandle)({
    sessionId: "probe-1",
    update: { sessionUpdate: "state_changed", state },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/1";

describe("AgentModelPreloader", () => {
  describe("AgentModelPreloader", () => {
    describe("preload()", () => {
      it(`opens a fresh local discovery session and retains its runtime for the first chat ${ISSUE}`, async () => {
        const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        await preloader.preload("pi");
        expect(procHandle.newSession).toHaveBeenCalledWith({ cwd: "/vault" });
        expect(procHandle.proc.resumeSession).not.toHaveBeenCalled();
        expect(procHandle.proc.loadSession).not.toHaveBeenCalled();
        expect(procHandle.start).toHaveBeenCalledTimes(1);
        expect(procHandle.shutdown).not.toHaveBeenCalled();
        expect(preloader.getCachedModelCatalog("pi")?.availableModels?.[0].baseModelId).toBe(
          "claude-sonnet"
        );
        expect(preloader.takeWarm("pi")?.proc).toBe(procHandle.proc);
        expect(preloader.takeWarm("pi")).toBeNull();
        expect(preloader.getCachedModelCatalog("pi")).not.toBeNull();
      });

      it(`shares an in-flight preload and waits for canonical initialization before creating a runtime ${ISSUE}`, async () => {
        const gate = deferred();
        const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(
          buildApp(),
          buildPlugin(),
          () => descriptor,
          () => gate.promise
        );
        const first = preloader.preload("pi");
        expect(preloader.preload("pi")).toBe(first);
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
        gate.resolve();
        await first;
        expect(procHandle.start).toHaveBeenCalledTimes(1);
      });

      it(`starts no runtime when shutdown wins initialization ${ISSUE}`, async () => {
        const gate = deferred();
        const { descriptor } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(
          buildApp(),
          buildPlugin(),
          () => descriptor,
          () => gate.promise
        );
        const work = preloader.preload("pi");
        preloader.shutdown();
        gate.resolve();
        await work;
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
      });

      it.each(["runtime exit", "plugin shutdown"])(
        `discards a runtime when %s happens during discovery ${ISSUE}`,
        async (event) => {
          const entered = deferred();
          const release = deferred();
          const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
          procHandle.newSession.mockImplementationOnce(async () => {
            entered.resolve();
            await release.promise;
            return { sessionId: "probe-1", state: catalogOf(["configured-1"]) };
          });
          const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
          const work = preloader.preload("pi");
          await entered.promise;
          if (event === "plugin shutdown") preloader.shutdown();
          else procHandle.proc.isRunning = () => false;
          release.resolve();
          await work;
          expect(preloader.takeWarm("pi")).toBeNull();
          expect(preloader.getCachedModelCatalog("pi")).toBeNull();
          expect(procHandle.shutdown).toHaveBeenCalledTimes(1);
        }
      );

      it.each(["missing state", "rejected session"])(
        `shuts down discovery after %s ${ISSUE}`,
        async (failure) => {
          const { descriptor, procHandle } = buildDescriptor(() =>
            makeMockProc({ newSessionState: { model: null, mode: null } })
          );
          if (failure === "rejected session")
            procHandle.newSession.mockRejectedValueOnce(new Error("unavailable"));
          const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
          await preloader.preload("pi");
          expect(procHandle.shutdown).toHaveBeenCalledTimes(1);
          expect(preloader.takeWarm("pi")).toBeNull();
        }
      );

      it(`leaves retired identities outside discovery when no runtime is registered ${ISSUE}`, async () => {
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => undefined);
        await preloader.preload("claude");
        expect(preloader.getWarmProcs()).toEqual([]);
        expect(preloader.getCachedModelCatalog("claude")).toBeNull();
      });
    });

    describe("getCachedModelCatalog()", () => {
      it(`keeps model reasoning options in the authoritative catalog and follows later updates after adoption ${ISSUE}`, async () => {
        const initial = catalogOf(["configured-1"]);
        const updated = catalogOf(["configured-1", "configured-2"]);
        updated.model!.availableModels[1].effortOptions = [{ value: "high", label: "High" }];
        const { descriptor, procHandle } = buildDescriptor(() =>
          makeMockProc({ newSessionState: initial })
        );
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        await preloader.preload("pi");
        preloader.takeWarm("pi");
        const changed = jest.fn();
        preloader.subscribe(changed);
        pushCatalog(procHandle, updated);
        expect(preloader.getCachedModelCatalog("pi")).toEqual({
          availableModels: updated.model!.availableModels,
        });
        expect(changed).toHaveBeenCalledTimes(1);
      });

      it(`ignores late updates from a cleared catalog ${ISSUE}`, async () => {
        const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        await preloader.preload("pi");
        preloader.clearCached("pi");
        pushCatalog(procHandle, catalogOf(["late-model"]));
        expect(preloader.getCachedModelCatalog("pi")).toBeNull();
      });
    });

    describe("refresh()", () => {
      it(`refreshes a cached runtime and coalesces repeated requests into one trailing discovery ${ISSUE}`, async () => {
        const { descriptor } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        await preloader.preload("pi");
        const work = preloader.refresh("pi");
        expect(work).not.toBeNull();
        expect(preloader.refresh("pi")).toBe(work);
        expect(preloader.refresh("pi")).toBe(work);
        await work;
        expect(descriptor.createBackendProcess).toHaveBeenCalledTimes(3);
      });

      it(`returns no work before the engine has any cached catalog ${ISSUE}`, () => {
        const { descriptor } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        expect(preloader.refresh("pi")).toBeNull();
      });
    });

    describe("takeWarm()", () => {
      it(`hands ownership to one chat while retaining the model catalog ${ISSUE}`, async () => {
        const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        await preloader.preload("pi");
        expect(preloader.takeWarm("pi")?.proc).toBe(procHandle.proc);
        expect(preloader.takeWarm("pi")).toBeNull();
        expect(preloader.getCachedModelCatalog("pi")).not.toBeNull();
      });
    });

    describe("getWarmProcs()", () => {
      it(`lists runtimes still awaiting adoption and drops an exited runtime ${ISSUE}`, async () => {
        const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        await preloader.preload("pi");
        expect(preloader.getWarmProcs()).toEqual([{ backendId: "pi", proc: procHandle.proc }]);
        procHandle.emitExit();
        expect(preloader.getWarmProcs()).toEqual([]);
        expect(preloader.getCachedModelCatalog("pi")).toBeNull();
      });
    });

    describe("clearCached()", () => {
      it(`shuts down unused warm runtimes and clears their catalog ${ISSUE}`, async () => {
        const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        await preloader.preload("pi");
        preloader.clearCached("pi");
        expect(procHandle.shutdown).toHaveBeenCalledTimes(1);
        expect(preloader.getWarmProcs()).toEqual([]);
        expect(preloader.getCachedModelCatalog("pi")).toBeNull();
      });
    });

    describe("subscribe()", () => {
      it(`notifies on model availability changes and stops after unsubscribe ${ISSUE}`, async () => {
        const { descriptor } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        const changed = jest.fn();
        const unsubscribe = preloader.subscribe(changed);
        await preloader.preload("pi");
        expect(changed).toHaveBeenCalledTimes(1);
        unsubscribe();
        preloader.clearCached("pi");
        expect(changed).toHaveBeenCalledTimes(1);
      });
    });

    describe("shutdown()", () => {
      it(`closes unadopted runtimes and prevents later preload or refresh work ${ISSUE}`, async () => {
        const { descriptor, procHandle } = buildDescriptor(() => makeMockProc());
        const preloader = new AgentModelPreloader(buildApp(), buildPlugin(), () => descriptor);
        await preloader.preload("pi");
        preloader.shutdown();
        await preloader.preload("pi");
        expect(preloader.refresh("pi")).toBeNull();
        expect(procHandle.shutdown).toHaveBeenCalledTimes(1);
        expect(descriptor.createBackendProcess).toHaveBeenCalledTimes(1);
        expect(preloader.getWarmProcs()).toEqual([]);
        expect(preloader.getCachedModelCatalog("pi")).toBeNull();
      });
    });
  });
});
