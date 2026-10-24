import {
  getSettings,
  resetSettings,
  setSettings,
  subscribeToSettingsChange,
} from "@/settings/model";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { App } from "obsidian";
import { ByokSetupApi } from "./ByokSetupApi";
import type { BackendType } from "@/modelManagement/types/persisted";

jest.mock("@/logger", () => ({ logError: jest.fn() }));

function setup() {
  const enabled = new Map<BackendType, string[]>([["chat", ["existing"]]]);
  const keys = new Map<string, string>();
  const api = new ByokSetupApi(
    {
      add: async () => "provider",
      setApiKey: async (id: string, key: string) => {
        keys.set(id, key);
      },
      remove: jest.fn(),
    } as never,
    {
      bulkSet: async (_id: string, models: readonly unknown[]) =>
        models.map((_, index) => `configured-${index}`),
      listByProvider: () => [],
      removeByProvider: jest.fn(),
    } as never,
    {
      get: (backend: BackendType) => ({ enabledModels: enabled.get(backend) ?? [] }),
      setEnabledModels: async (backend: BackendType, ids: string[]) => {
        enabled.set(backend, ids);
      },
      removeRefs: jest.fn(),
    } as never
  );
  return { api, enabled, keys };
}

function draftSetup() {
  resetSettings();
  setSettings({ providers: {}, configuredModels: [], backends: {} });
  const keys = new Map<string, string>();
  const keychain = {
    getVaultId: () => "vault",
    getSecretById: (id: string) => keys.get(id) ?? null,
    setSecretById: jest.fn((id: string, value: string) => {
      keys.set(id, value);
    }),
    deleteSecretById: jest.fn((id: string) => {
      keys.delete(id);
    }),
  };
  const providers = new ProviderRegistry({} as App);
  const models = new ConfiguredModelRegistry();
  const backends = new BackendConfigRegistry(providers, models);
  return {
    api: new ByokSetupApi(providers, models, backends, keychain),
    providers,
    models,
    backends,
    keys,
    keychain,
  };
}

const DRAFT = {
  providerType: "openai-compatible" as const,
  displayName: "Example",
  baseUrl: "https://example.test/v1",
  apiKey: "secret-key",
  models: [
    { info: { id: "shown", displayName: "Shown" }, enabled: true },
    { info: { id: "hidden", displayName: "Hidden" }, enabled: false },
  ],
};

describe("ByokSetupApi", () => {
  describe("ByokSetupApi", () => {
    describe("saveProviderDraft()", () => {
      it("commits the full draft once and keeps model visibility independent https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
        const { api, keys, backends } = draftSetup();
        const changes = jest.fn();
        const unsubscribe = subscribeToSettingsChange(changes);
        const result = await api.saveProviderDraft(DRAFT);
        unsubscribe();
        const saved = getSettings();
        expect(changes).toHaveBeenCalledTimes(1);
        expect(saved.providers[result.providerId]).toMatchObject({
          displayName: "Example",
          enabled: true,
        });
        expect(saved.configuredModels).toHaveLength(2);
        expect(backends.get("chat").enabledModels).toEqual([result.configuredModelIds[0]]);
        expect(backends.get("pi").enabledModels).toEqual([result.configuredModelIds[0]]);
        expect(keys.get(saved.providers[result.providerId].apiKeyKeychainId!)).toBe("secret-key");
        expect(JSON.stringify(saved)).not.toContain("secret-key");
      });
      it("changes API format while preserving identity and CORS and restores switches on reenable https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
        const { api, providers, backends, keys } = draftSetup();
        const first = await api.saveProviderDraft(DRAFT);
        await providers.update(first.providerId, { enableCors: true });
        const original = providers.get(first.providerId)!;
        const listener = jest.fn(() =>
          expect(keys.get(original.apiKeyKeychainId!)).toBe("rotated")
        );
        providers.subscribe(listener);
        const edited = await api.saveProviderDraft({
          ...DRAFT,
          providerId: first.providerId,
          providerType: "anthropic",
          enabled: false,
          apiKey: "rotated",
        });
        expect(edited).toEqual(first);
        expect(providers.get(first.providerId)).toMatchObject({
          providerType: "anthropic",
          enabled: false,
          enableCors: true,
          addedAt: original.addedAt,
          origin: original.origin,
        });
        expect(backends.resolveEnabled("pi")).toEqual([]);
        expect(backends.get("pi").enabledModels).toEqual([first.configuredModelIds[0]]);
        expect(listener).toHaveBeenCalledTimes(1);
        await api.saveProviderDraft({
          ...DRAFT,
          providerId: first.providerId,
          enabled: true,
          apiKey: "rotated",
        });
        expect(backends.resolveEnabled("pi").map((e) => e.configuredModelId)).toEqual([
          first.configuredModelIds[0],
        ]);
      });
      it("allows an empty list and removes only that supplier's stale references https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
        const { api, backends } = draftSetup();
        const first = await api.saveProviderDraft(DRAFT);
        await backends.enableModel("chat", "unrelated");
        await backends.enableModel("pi", first.configuredModelIds[0]);
        await api.saveProviderDraft({ ...DRAFT, providerId: first.providerId, models: [] });
        expect(getSettings().configuredModels).toEqual([]);
        expect(backends.get("chat").enabledModels).toEqual(["unrelated"]);
        expect(backends.get("pi").enabledModels).toEqual([]);
      });
      it.each(["", "shown"])(
        "rejects blank or duplicate id %p before persistence https://github.com/ItsDalk-Lane/Vault-Agent/issues/2",
        async (id) => {
          const { api, keychain } = draftSetup();
          const before = getSettings();
          await expect(
            api.saveProviderDraft({
              ...DRAFT,
              models: [...DRAFT.models, { info: { id, displayName: id }, enabled: true }],
            })
          ).rejects.toThrow();
          expect(getSettings()).toBe(before);
          expect(keychain.setSecretById).not.toHaveBeenCalled();
        }
      );
      it("keeps settings untouched if keychain rejects a write https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
        const { api, keychain } = draftSetup();
        const before = getSettings();
        keychain.setSecretById.mockImplementation(() => {
          throw new Error("locked");
        });
        await expect(api.saveProviderDraft(DRAFT)).rejects.toThrow("locked");
        expect(getSettings()).toBe(before);
      });
      it("clears a key on save and rejects unknown edits without creating a supplier https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
        const { api, keys, providers } = draftSetup();
        const first = await api.saveProviderDraft(DRAFT);
        await api.saveProviderDraft({
          ...DRAFT,
          providerId: first.providerId,
          apiKey: "",
          requiresApiKey: false,
        });
        expect(keys.size).toBe(0);
        expect(providers.get(first.providerId)?.apiKeyKeychainId).toBeNull();
        const before = getSettings();
        await expect(api.saveProviderDraft({ ...DRAFT, providerId: "unknown" })).rejects.toThrow();
        expect(getSettings()).toBe(before);
      });
    });
    describe("setupProvider()", () => {
      it("makes a new chat model available to Pi and quick chat without enabling embeddings https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { api, enabled, keys } = setup();
        const result = await api.setupProvider({
          providerType: "anthropic",
          displayName: "Anthropic",
          apiKey: "test-key",
          models: [
            { id: "claude", displayName: "Claude" },
            { id: "embedding", displayName: "Embedding", isEmbedding: true },
          ],
        });
        expect(result.configuredModelIds).toEqual(["configured-0", "configured-1"]);
        expect(enabled.get("chat")).toEqual(["existing", "configured-0"]);
        expect(enabled.get("pi")).toEqual(["configured-0"]);
        expect([...enabled.keys()]).toEqual(["chat", "pi"]);
        expect(keys.get("provider")).toBe("test-key");
      });
      it("honors an explicit backend enrollment selection", async () => {
        const { api, enabled } = setup();
        await api.setupProvider({
          providerType: "openai-compatible",
          displayName: "Local",
          autoEnrollIn: ["chat"],
          models: [{ id: "local", displayName: "Local" }],
        });
        expect([...enabled.keys()]).toEqual(["chat"]);
      });
    });
  });
});
