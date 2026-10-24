import type { App } from "obsidian";
import type VaultAgentPlugin from "@/main";
import type { VaultAgentSettings } from "@/settings/model";
import type { BackendDescriptor } from "./session/types";
import type { BuiltinSkillRuntime } from "./skills/SkillManager";
import { applyVaultAgentDefaultModel, createAgentSessionManager } from "./index";
import { reconcileBuiltinSkills } from "./skills/builtin/reconcileBuiltinSkills";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { logFileManager } from "@/logFileManager";
import { seedVaultAgentDefaultModel } from "./session/vaultAgentDefaultModel";

jest.mock("@/agentMode/sdk/pi/models/DeclaredModelCapabilities", () => ({
  lookupDeclaredModelCapabilities: jest.fn(),
}));
jest.mock("@/constants", () => ({}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("@/logFileManager", () => ({ logFileManager: { setStoragePaths: jest.fn() } }));
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  subscribeToSettingsChange: (callback: SettingsSubscriber) => {
    mockSettingsSubscribers.push(callback);
    return () => {};
  },
}));
jest.mock("@/settings/vaultAgentFolder", () => ({
  deriveSkillsFolder: (settings: VaultAgentSettings) => `${settings.vaultAgentFolder}/skills`,
}));
jest.mock("@/settings/builtinSkillPreferences", () => ({ saveBuiltinPreferences: jest.fn() }));
jest.mock("@/utils/appPaths", () => ({
  vaultAgentAppDataDir: () => "/tmp/vault-agent",
  getVaultId: () => "test-vault",
}));
jest.mock("./backends/registry", () => ({
  backendRegistry: {
    get pi() {
      return mockDescriptor;
    },
  },
  CREATABLE_BACKEND_IDS: Object.freeze(["pi"]),
  listBackendDescriptors: () => mockDescriptors,
}));
jest.mock("./session/AgentModelPreloader", () => ({ AgentModelPreloader: jest.fn() }));
jest.mock("./session/AgentSessionManager", () => ({
  AgentSessionManager: jest.fn(() => mockManager),
}));
jest.mock("./session/vaultAgentDefaultModel", () => ({ seedVaultAgentDefaultModel: jest.fn() }));
jest.mock("./session/feedback/feedbackMcpServer", () => ({ createFeedbackMcpServer: jest.fn() }));
jest.mock("./skills", () => ({
  SkillManager: {
    initialize: jest.fn((_app: App, runtime: BuiltinSkillRuntime) => {
      mockRuntime = runtime;
      return { refresh: mockRefresh };
    }),
  },
}));
jest.mock("./skills/builtin/reconcileBuiltinSkills", () => ({ reconcileBuiltinSkills: jest.fn() }));
jest.mock("./skills/builtin/vaultSeedFs", () => ({ buildBuiltinSeedFs: jest.fn() }));
jest.mock("./ui/permissionPrompter", () => ({
  createDefaultPermissionPrompter: jest.fn(),
  createDefaultAskUserQuestionPrompter: jest.fn(),
}));
jest.mock("./ui/VaultAgentView", () => ({}));
jest.mock("@/components/ui/ModelEnableList", () => ({}));
jest.mock("./ui/PlanPreviewView", () => ({}));
jest.mock("./ui/ReportIssueModal", () => ({}));
jest.mock("./session/debugSink", () => ({ setFrameSinkLogsRoot: jest.fn() }));
jest.mock("./backends/pi/PiMcpSettingsPanel", () => ({}));

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/1";
type SettingsSubscriber = (prev: VaultAgentSettings, next: VaultAgentSettings) => void;
const mockSettingsSubscribers: SettingsSubscriber[] = [];
let mockSettings: VaultAgentSettings;
let mockRuntime: BuiltinSkillRuntime;
const mockDescriptor = {
  id: "pi",
  restartOnProviderConfigChange: true,
} as unknown as BackendDescriptor;
const mockDescriptors = Object.freeze([mockDescriptor]);
const mockRefresh = jest.fn<Promise<unknown>, unknown[]>();
const mockManager = {
  getLocalDataBackend: jest.fn().mockResolvedValue({
    getLocalStoragePaths: () => ({ logsRoot: "/private/logs", tempRoot: "/private/tmp" }),
  }),
  preloadModels: jest.fn(async () => {}),
  restartBackend: jest.fn(async (_id: string, _reason: string) => {}),
  noteSpawnConfigChanged: jest.fn(async (_id: string, _reason: string) => {}),
  registerPreload: jest.fn<void, [string, Promise<void>]>(),
};
let plugin: VaultAgentPlugin;
const reconcile = jest.mocked(reconcileBuiltinSkills);

function settingsWith(overrides: Record<string, unknown> = {}): VaultAgentSettings {
  return {
    vaultAgentFolder: "vault-agent",
    agentMode: { skills: {}, backends: {} },
    providers: {
      byok: { providerId: "byok", origin: { kind: "byok" } },
      archived: { providerId: "archived", origin: { kind: "agent", agentType: "claude" } },
      unused: { providerId: "unused", origin: { kind: "byok" } },
    },
    backends: { pi: { enabledModels: ["configured-1"] } },
    configuredModels: [
      {
        configuredModelId: "configured-1",
        providerId: "byok",
        configuredAt: 0,
        info: { id: "glm-5.2", displayName: "GLM-5.2", ...overrides },
      },
    ],
  } as unknown as VaultAgentSettings;
}

function emitSettingsChange(prev: VaultAgentSettings, next: VaultAgentSettings): void {
  mockSettings = next;
  for (const subscriber of mockSettingsSubscribers) subscriber(prev, next);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("agentMode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsSubscribers.length = 0;
    mockSettings = settingsWith({ reasoning: true });
    reconcile.mockResolvedValue(undefined);
    mockRefresh.mockImplementation(() => mockRuntime.prepare("vault-agent/skills"));
    plugin = {
      modelManagement: { providerRegistry: { subscribe: jest.fn() } },
    } as unknown as VaultAgentPlugin;
  });

  describe("applyVaultAgentDefaultModel()", () => {
    it(`seeds a selected model only into the current engine ${ISSUE}`, () => {
      jest.mocked(seedVaultAgentDefaultModel).mockReturnValueOnce(["pi"]);
      expect(applyVaultAgentDefaultModel("configured-1")).toEqual(["pi"]);
      expect(seedVaultAgentDefaultModel).toHaveBeenCalledWith(mockDescriptors, "configured-1");
    });
  });

  describe("createAgentSessionManager()", () => {
    it(`resolves log and report paths from the same backend on demand ${ISSUE}`, async () => {
      createAgentSessionManager({} as App, plugin);
      expect(mockManager.getLocalDataBackend).not.toHaveBeenCalled();
      const resolve = jest.mocked(logFileManager.setStoragePaths).mock.calls[0][0];
      await expect(resolve()).resolves.toEqual({
        logsRoot: "/private/logs",
        tempRoot: "/private/tmp",
      });
    });

    it(`reports unavailable storage paths instead of falling back to an old log location ${ISSUE}`, async () => {
      const gate = deferred();
      reconcile.mockReturnValueOnce(gate.promise);
      createAgentSessionManager({} as App, plugin);
      mockManager.getLocalDataBackend.mockResolvedValueOnce({});
      const resolve = jest.mocked(logFileManager.setStoragePaths).mock.calls[0][0];
      await expect(resolve()).rejects.toThrow("Local storage is unavailable.");
      gate.resolve();
      await mockManager.registerPreload.mock.calls[0][1];
    });

    it(`waits for canonical skills before preloading the bundled engine ${ISSUE}`, async () => {
      const gate = deferred();
      reconcile.mockReturnValueOnce(gate.promise);
      expect(createAgentSessionManager({} as App, plugin)).toBe(mockManager);
      expect(reconcile).toHaveBeenCalledWith(
        expect.objectContaining({
          availableAgents: ["pi"],
          registeredAgents: ["pi"],
          folder: "vault-agent/skills",
        })
      );
      expect(mockRuntime.availableAgents()).toEqual(["pi"]);
      expect(mockRuntime.availableAgents()).toBe(mockRuntime.availableAgents());
      expect(mockManager.registerPreload.mock.calls.map(([id]) => id)).toEqual(["pi"]);
      expect(mockManager.preloadModels).not.toHaveBeenCalled();
      const beforeStart = jest.mocked(AgentModelPreloader).mock.calls[0][3]!;
      const startup = beforeStart("pi");
      gate.resolve();
      await startup;
      await mockManager.registerPreload.mock.calls[0][1];
      expect(mockManager.preloadModels).toHaveBeenCalledWith("pi");
    });

    it.each(["reported", "rejected"])(
      `keeps the engine available after a %s skill refresh failure ${ISSUE}`,
      async (failure) => {
        if (failure === "reported") mockRefresh.mockResolvedValueOnce({ ok: false });
        else mockRefresh.mockRejectedValueOnce(new Error("Disk unavailable"));
        createAgentSessionManager({} as App, plugin);
        await mockManager.registerPreload.mock.calls[0][1];
        expect(mockManager.preloadModels).toHaveBeenCalledWith("pi");
      }
    );

    it.each([
      [{ reasoningEfforts: ["low", "high"] }, { reasoningEfforts: ["medium", "high"] }],
      [{ toolCall: true }, { toolCall: false }],
    ])(
      `refreshes the current model catalog when usable capabilities change ${ISSUE}`,
      (prev, next) => {
        createAgentSessionManager({} as App, plugin);
        emitSettingsChange(settingsWith(prev), settingsWith(next));
        expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
          "pi",
          "model config changed"
        );
      }
    );

    it(`refreshes when the current model is disabled or its provider disappears ${ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin);
      emitSettingsChange(mockSettings, {
        ...mockSettings,
        backends: { ...mockSettings.backends, pi: { enabledModels: [] } },
      });
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith("pi", "model config changed");
      mockManager.noteSpawnConfigChanged.mockClear();
      emitSettingsChange(settingsWith(), { ...settingsWith(), providers: {} });
      expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith("pi", "model config changed");
    });

    it.each([
      ["byok", true],
      ["archived", false],
      ["unused", false],
    ])(
      `refreshes for provider %s only when it supplies an enabled model ${ISSUE}`,
      (providerId, reload) => {
        createAgentSessionManager({} as App, plugin);
        const subscriber = jest.mocked(plugin.modelManagement.providerRegistry.subscribe).mock
          .calls[0][0];
        subscriber(providerId);
        if (reload)
          expect(mockManager.noteSpawnConfigChanged).toHaveBeenCalledWith(
            "pi",
            "provider config changed"
          );
        else expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
      }
    );

    it(`ignores display-only model metadata ${ISSUE}`, () => {
      createAgentSessionManager({} as App, plugin);
      emitSettingsChange(
        settingsWith({ description: "Before" }),
        settingsWith({ description: "After" })
      );
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
      expect(mockManager.restartBackend).not.toHaveBeenCalled();
    });

    it.each(["agent", "retired"])(
      `ignores model and provider changes from a loaded %s source ${ISSUE}`,
      (kind) => {
        const old = {
          ...mockSettings.providers.byok,
          origin: { kind },
        } as unknown as VaultAgentSettings["providers"][string];
        mockSettings = { ...mockSettings, providers: { byok: old } };
        createAgentSessionManager({} as App, plugin);
        const subscriber = jest.mocked(plugin.modelManagement.providerRegistry.subscribe).mock
          .calls[0][0];
        subscriber("byok");
        emitSettingsChange(mockSettings, {
          ...mockSettings,
          configuredModels: mockSettings.configuredModels.map((model) => ({
            ...model,
            info: { ...model.info, reasoning: false },
          })),
        });
        expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
        expect(mockSettings.providers.byok).toBe(old);
      }
    );

    it.each(["preferences", "folder"])(
      `refreshes canonical skills when their %s change ${ISSUE}`,
      async (change) => {
        createAgentSessionManager({} as App, plugin);
        await mockManager.registerPreload.mock.calls[0][1];
        const next =
          change === "folder"
            ? { ...mockSettings, vaultAgentFolder: "other" }
            : {
                ...mockSettings,
                agentMode: {
                  ...mockSettings.agentMode,
                  skills: {
                    ...mockSettings.agentMode.skills,
                    builtinPreferences: { "obsidian-cli": { disabledAgents: ["pi"] } },
                  },
                },
              };
        emitSettingsChange(mockSettings, next);
        expect(mockRefresh).toHaveBeenCalledTimes(2);
        expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
      }
    );
  });
});
