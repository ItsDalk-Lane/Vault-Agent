import type { VaultAgentSettings } from "@/settings/model";

if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

function makeSettings(overrides: Partial<VaultAgentSettings> = {}): VaultAgentSettings {
  return {
    activeModels: [],
    openAIApiKey: "",
    ...overrides,
  } as unknown as VaultAgentSettings;
}

async function loadModule(overrides: Record<string, unknown> = {}) {
  jest.resetModules();

  const keychain = {
    isAvailable: jest.fn().mockReturnValue(true),
    getVaultId: jest.fn().mockReturnValue("abcd1234"),
    setVaultId: jest.fn(),
    hydrateFromKeychain: jest.fn(async (settings: VaultAgentSettings) => ({
      settings,
      hadFailures: false,
    })),
    persistSecrets: jest.fn().mockReturnValue({
      secretEntries: [],
      keychainIdsToDelete: [],
    }),
    setSecretById: jest.fn(),
    ...overrides,
  };

  jest.doMock("@/services/keychainService", () => ({
    KeychainService: { getInstance: jest.fn(() => keychain) },
  }));
  jest.doMock("@/logger", () => ({ logWarn: jest.fn() }));
  jest.doMock("@/settings/model", () => ({
    sanitizeSettings: jest.fn((settings: VaultAgentSettings) => settings),
  }));

  const module = await import("@/services/settingsPersistence");
  return { module, keychain };
}

describe("settingsPersistence", () => {
  describe("resetPersistenceState()", () => {
    it("clears a pending one-shot persist suppression", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);
      module.suppressNextPersistOnce();

      module.resetPersistenceState();
      await module.persistSettings(makeSettings(), saveData);

      expect(saveData).toHaveBeenCalledTimes(1);
    });
  });

  describe("refreshLastPersistedSettings()", () => {
    it("sets the Keychain diff baseline for the next write", async () => {
      const { module, keychain } = await loadModule();
      const baseline = makeSettings({ openAIApiKey: "old-key" });
      const next = makeSettings({ openAIApiKey: "new-key" });
      module.refreshLastPersistedSettings(baseline);

      await module.persistSettings(next, jest.fn().mockResolvedValue(undefined));

      expect(keychain.persistSecrets).toHaveBeenCalledWith(next, baseline);
    });
  });

  describe("suppressNextPersistOnce()", () => {
    it("skips exactly one subscriber-driven save", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);
      module.suppressNextPersistOnce();

      await module.persistSettings(makeSettings(), saveData);
      await module.persistSettings(makeSettings(), saveData);

      expect(saveData).toHaveBeenCalledTimes(1);
    });
  });

  describe("runPersistenceTransaction()", () => {
    it("keeps the queue usable after a transaction fails", async () => {
      const { module } = await loadModule();
      const failure = new Error("failed transaction");

      await expect(
        module.runPersistenceTransaction(async () => {
          throw failure;
        })
      ).rejects.toBe(failure);

      const followup = jest.fn().mockResolvedValue(undefined);
      await module.runPersistenceTransaction(followup);
      expect(followup).toHaveBeenCalledTimes(1);
    });
  });

  describe("flushPersistence()", () => {
    it("waits for the active settings write", async () => {
      const { module } = await loadModule();
      let release!: () => void;
      let started!: () => void;
      const saving = new Promise<void>((resolve) => {
        started = resolve;
      });
      const saveData = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
            started();
          })
      );
      const persist = module.persistSettings(makeSettings(), saveData);
      await saving;

      let flushed = false;
      const flush = module.flushPersistence().then(() => {
        flushed = true;
      });
      expect(flushed).toBe(false);

      release();
      await Promise.all([persist, flush]);
      expect(flushed).toBe(true);
    });
  });

  describe("loadSettingsWithKeychain()", () => {
    it("preserves current settings and credential pointers without startup migration https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { module, keychain } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);
      const settings = makeSettings({
        _keychainVaultId: "1234abcd",
        language: "zh-CN",
        settingsSchemaVersion: 3,
        providers: {
          local: {
            providerId: "local",
            providerType: "openai-compatible",
            displayName: "Local",
            apiKeyKeychainId: "copilot-v1234abcd-provider-local-api-key",
            origin: { kind: "byok" },
            addedAt: 1,
          },
        },
      });
      const loaded = await module.loadSettingsWithKeychain(settings, saveData);
      expect(loaded).toMatchObject(settings);
      expect(keychain.setVaultId).toHaveBeenCalledWith("1234abcd");
      expect(saveData).not.toHaveBeenCalled();
      expect(keychain.setSecretById).not.toHaveBeenCalled();
    });

    it("uses only Keychain credentials without backing up or rewriting existing settings https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { module, keychain } = await loadModule();
      keychain.hydrateFromKeychain.mockImplementation(async (settings: VaultAgentSettings) => ({
        settings: { ...settings, openAIApiKey: "keychain-key" },
        hadFailures: false,
      }));
      const saveData = jest.fn().mockResolvedValue(undefined);
      const loaded = await module.loadSettingsWithKeychain(
        {
          _keychainVaultId: "1234abcd",
          openAIApiKey: "ignored-disk-value",
          activeModels: [{ name: "custom", provider: "openai", apiKey: "ignored-model-value" }],
        },
        saveData
      );
      const baseline = keychain.hydrateFromKeychain.mock.calls[0][0];
      expect(baseline.openAIApiKey).toBe("");
      expect(baseline.activeModels[0].apiKey).toBe("");
      expect(loaded.openAIApiKey).toBe("keychain-key");
      expect(saveData).not.toHaveBeenCalled();
    });

    it("keeps credentials empty when Keychain is unavailable", async () => {
      const { module, keychain } = await loadModule();
      keychain.isAvailable.mockReturnValue(false);
      const loaded = await module.loadSettingsWithKeychain(
        { _keychainVaultId: "1234abcd", openAIApiKey: "ignored-disk-value" },
        jest.fn()
      );
      expect(loaded.openAIApiKey).toBe("");
      expect(keychain.hydrateFromKeychain).not.toHaveBeenCalled();
    });

    it("persists the default settings and vault namespace for a new install", async () => {
      const { module, keychain } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);
      const loaded = await module.loadSettingsWithKeychain(null, saveData);
      expect(keychain.setVaultId).toHaveBeenCalledWith("abcd1234");
      expect(saveData).toHaveBeenCalledWith(
        expect.objectContaining({
          _keychainVaultId: "abcd1234",
          providers: {},
        })
      );
      expect(loaded._keychainVaultId).toBe("abcd1234");
    });
  });

  describe("persistSettingsWithinTransaction()", () => {
    it("writes Keychain entries and strips the disk snapshot immediately", async () => {
      const { module, keychain } = await loadModule({
        persistSecrets: jest.fn().mockReturnValue({
          secretEntries: [["copilot-vabcd1234-open-a-i-api-key", "new-key"]],
          keychainIdsToDelete: [],
        }),
      });
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.persistSettingsWithinTransaction(
        makeSettings({ openAIApiKey: "new-key" }),
        saveData
      );

      expect(keychain.setSecretById).toHaveBeenCalledWith(
        "copilot-vabcd1234-open-a-i-api-key",
        "new-key"
      );
      expect(saveData.mock.calls[0][0].openAIApiKey).toBe("");
    });
  });

  describe("persistSettings()", () => {
    it("tombstones cleared credentials and never writes them to data.json", async () => {
      const { module, keychain } = await loadModule({
        persistSecrets: jest.fn().mockReturnValue({
          secretEntries: [],
          keychainIdsToDelete: ["copilot-vabcd1234-open-a-i-api-key"],
        }),
      });
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.persistSettings(makeSettings(), saveData);

      expect(keychain.setSecretById).toHaveBeenCalledWith("copilot-vabcd1234-open-a-i-api-key", "");
      expect(saveData.mock.calls[0][0].openAIApiKey).toBe("");
    });

    it("rolls Keychain values back when the disk save fails", async () => {
      const persistSecrets = jest
        .fn()
        .mockReturnValueOnce({
          secretEntries: [["credential-id", "new-key"]],
          keychainIdsToDelete: [],
        })
        .mockReturnValueOnce({
          secretEntries: [["credential-id", "old-key"]],
          keychainIdsToDelete: [],
        });
      const { module, keychain } = await loadModule({ persistSecrets });
      module.refreshLastPersistedSettings(makeSettings({ openAIApiKey: "old-key" }));

      await expect(
        module.persistSettings(
          makeSettings({ openAIApiKey: "new-key" }),
          jest.fn().mockRejectedValue(new Error("disk full"))
        )
      ).rejects.toThrow("disk full");

      expect(keychain.setSecretById).toHaveBeenNthCalledWith(1, "credential-id", "new-key");
      expect(keychain.setSecretById).toHaveBeenNthCalledWith(2, "credential-id", "old-key");
    });
  });
});
