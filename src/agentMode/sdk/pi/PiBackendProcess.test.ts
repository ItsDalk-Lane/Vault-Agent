import { requireNodeModule } from "@/utils/desktopRuntime";
import type { VaultAgentSettings } from "@/settings/model";

jest.mock("@/components/modals/ConfirmModal", () => ({ ConfirmModal: class {} }));
jest.mock("@/components/ui/setting-item", () => ({ SettingItem: () => null }));
jest.mock("@/components/ui/button", () => ({ Button: () => null }));
jest.mock("@/components/ui/input", () => ({ Input: () => null }));
jest.mock("./runtime/PiRuntime", () => ({ PiRuntime: jest.fn() }));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));
jest.mock("obsidian", () => ({
  Modal: class {},
  Notice: class {},
  Platform: { isMobile: false },
}));
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: jest.fn(() => {
    throw new Error("The Pi backend must not probe local binaries or Node modules.");
  }),
}));

import { PiBackendDescriptor } from "@/agentMode/backends/pi/descriptor";
import {
  backendDisplayOrder,
  backendRegistry,
  listBackendDescriptors,
} from "@/agentMode/backends/registry";
import { PiRuntime, type PiHostOptions } from "./runtime/PiRuntime";
import { PiBackendProcess, PiRuntimeNotReadyError } from "@/agentMode/sdk/pi/PiBackendProcess";

const requireNodeModuleMock = requireNodeModule as jest.MockedFunction<typeof requireNodeModule>;

const createProcessArgs = {
  plugin: {} as never,
  app: {} as never,
  clientVersion: "test",
  descriptor: PiBackendDescriptor,
};

describe("PiBackendProcess", () => {
  let boundary: {
    initialize: jest.Mock;
    observe: jest.Mock;
    replay: jest.Mock;
    shutdown: jest.Mock;
    open: jest.Mock;
  };
  beforeEach(() => {
    jest.clearAllMocks();
    boundary = {
      initialize: jest.fn(async () => undefined),
      observe: jest.fn(),
      replay: jest.fn(async () => undefined),
      shutdown: jest.fn(async () => undefined),
      open: jest.fn(),
    };
    jest.mocked(PiRuntime).mockImplementation(() => boundary as unknown as PiRuntime);
  });
  describe("PiBackendDescriptor", () => {
    it("creates the bundled engine without installation or binary detection https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const process = PiBackendDescriptor.createBackendProcess(createProcessArgs);
      expect(process).toBeInstanceOf(PiBackendProcess);
      expect(PiBackendDescriptor.planLifecycle).toBe("independent");
      for (const field of [
        "getInstallState",
        "getResolvedBinaryPath",
        "openInstallUI",
        "subscribeInstallState",
        "auth",
      ])
        expect(PiBackendDescriptor).not.toHaveProperty(field);
      expect(requireNodeModuleMock).not.toHaveBeenCalled();
    });
  });

  describe("registry", () => {
    it("registers Pi as the only runtime and model-discovery entry https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(backendRegistry.pi).toBe(PiBackendDescriptor);
      expect(Object.keys(backendRegistry)).toEqual(["pi"]);
      expect(backendDisplayOrder().map((descriptor) => descriptor.id)).toEqual(["pi"]);
      expect(listBackendDescriptors().map((descriptor) => descriptor.id)).toEqual(["pi"]);
    });
  });

  describe("start()", () => {
    it("constructs the sole runtime from the required host and becomes ready only after it starts https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const host = {} as PiHostOptions;
      const process = new PiBackendProcess({ host });
      expect(process.isRuntimeReady()).toBe(false);
      expect(process.isRunning()).toBe(false);
      await process.start();
      await process.start();
      expect(PiRuntime).toHaveBeenCalledTimes(1);
      expect(jest.mocked(PiRuntime).mock.calls[0][0]).toBe(host);
      expect(process.isRuntimeReady()).toBe(true);
      expect(process.isRunning()).toBe(true);
      expect(process.isSetSessionModelSupported()).toBe(true);
      expect(process.isSetSessionModeSupported()).toBe(true);
      expect(process.isSetSessionConfigOptionSupported()).toBe(true);
      await process.shutdown();
      await expect(process.start()).rejects.toBeInstanceOf(PiRuntimeNotReadyError);
    });
  });

  describe("getModelCatalog()", () => {
    it("reads configured model ids and reasoning options without starting a runtime or touching local sessions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const settings = {
        providers: {
          local: {
            providerId: "local",
            providerType: "openai-compatible",
            baseUrl: "https://example.com/v1",
            origin: { kind: "byok" },
          },
        },
        configuredModels: [
          {
            configuredModelId: "saved-model",
            providerId: "local",
            info: { id: "upstream-model", reasoning: true, reasoningEfforts: ["low", "high"] },
          },
        ],
      } as unknown as VaultAgentSettings;
      const process = new PiBackendProcess({
        host: { getSettings: () => settings } as PiHostOptions,
      });

      expect(process.getModelCatalog()).toEqual({
        availableModels: [
          {
            baseModelId: "saved-model",
            name: "upstream-model",
            provider: "local",
            effortOptions: [
              { value: "low", label: "low" },
              { value: "high", label: "high" },
            ],
          },
        ],
      });
      settings.providers.local.enabled = false;
      expect(process.getModelCatalog()).toEqual({ availableModels: [] });
      expect(PiRuntime).not.toHaveBeenCalled();
      expect(requireNodeModuleMock).not.toHaveBeenCalled();
      expect(boundary.open).not.toHaveBeenCalled();
    });

    it("reuses the empty catalog while no usable local models are configured https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const host = {
        getSettings: () =>
          ({ providers: {}, configuredModels: [] }) as unknown as VaultAgentSettings,
      } as PiHostOptions;
      const process = new PiBackendProcess({ host });
      const empty = process.getModelCatalog();
      expect(empty).toEqual({ availableModels: [] });
      expect(process.getModelCatalog()).toBe(empty);
      expect(new PiBackendProcess({ host }).getModelCatalog()).toBe(empty);
      expect(PiRuntime).not.toHaveBeenCalled();
    });
  });

  describe("newSession()", () => {
    it("reports not-ready before a real runtime exists instead of accepting a fake readiness flag https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const process = new PiBackendProcess({ host: {} as PiHostOptions });
      for (const request of [
        process.newSession({ cwd: "/vault" }),
        process.prompt({ sessionId: "root-original", prompt: [] }),
        process.listSessions({}),
        process.cancel({ sessionId: "root-original" }),
      ])
        await expect(request).rejects.toBeInstanceOf(PiRuntimeNotReadyError);
    });
    it("leaves other roots running when one opening is cancelled, busy or rejected by its own store https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const process = new PiBackendProcess({ host: {} as PiHostOptions });
      const unhealthy = jest.fn();
      process.setUnhealthyHandler(unhealthy);
      await process.start();
      const cancellation = new AbortController();
      cancellation.abort(new Error("only this initialization cancelled"));
      for (const failure of [
        cancellation.signal.reason as Error,
        Object.assign(new Error("this root has another writer"), { code: "STORE_BUSY" }),
        new Error("this store could not open"),
      ]) {
        boundary.open.mockRejectedValueOnce(failure);
        await expect(
          process.newSession({ cwd: "/vault", signal: cancellation.signal })
        ).rejects.toBe(failure);
        expect(unhealthy).not.toHaveBeenCalled();
        expect(process.isRunning()).toBe(true);
      }
      await process.shutdown();
    });
  });

  describe("shutdown()", () => {
    it("closes the runtime and publishes its exit once while preserving unsupported readiness after closure https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const process = new PiBackendProcess({ host: {} as PiHostOptions });
      const exited = jest.fn();
      const detach = process.onExit(exited);
      await process.start();
      await process.shutdown();
      await process.shutdown();
      expect(boundary.shutdown).toHaveBeenCalledTimes(1);
      expect(exited).toHaveBeenCalledTimes(1);
      expect(process.isRunning()).toBe(false);
      expect(process.isRuntimeReady()).toBe(false);
      detach();
    });
    it("reports a runtime shutdown failure as unhealthy without publishing a successful exit https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const process = new PiBackendProcess({ host: {} as PiHostOptions });
      const unhealthy = jest.fn();
      const exited = jest.fn();
      process.setUnhealthyHandler(unhealthy);
      process.onExit(exited);
      await process.start();
      boundary.shutdown.mockRejectedValueOnce(new Error("checkpoint close failed"));
      await expect(process.shutdown()).rejects.toThrow("checkpoint close failed");
      expect(unhealthy).toHaveBeenCalledTimes(1);
      expect(exited).not.toHaveBeenCalled();
      await expect(process.shutdown()).resolves.toBeUndefined();
    });
  });
});
