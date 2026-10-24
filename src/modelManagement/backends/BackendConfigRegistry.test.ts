import { getSettings, resetSettings, setSettings } from "@/settings/model";

import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import type { BackendType, Provider } from "@/modelManagement/types/persisted";

import { BackendConfigRegistry } from "./BackendConfigRegistry";

import type { App } from "obsidian";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const CHAT: BackendType = "chat";
const PI: BackendType = "pi";

describe("BackendConfigRegistry", () => {
  let registry: BackendConfigRegistry;
  let models: ConfiguredModelRegistry;
  let providers: ProviderRegistry;

  beforeEach(() => {
    resetSettings();
    const fakeApp = { secretStorage: {}, vault: { adapter: {} } } as unknown as App;
    providers = new ProviderRegistry(fakeApp);
    models = new ConfiguredModelRegistry();
    registry = new BackendConfigRegistry(providers, models);
  });

  describe("get()", () => {
    it("returns the same empty default for a backend that was never configured", () => {
      const a = registry.get(CHAT);
      const b = registry.get(CHAT);
      expect(a).toBe(b);
      expect(a.enabledModels).toEqual([]);
    });
  });

  describe("enableModel()", () => {
    it("appends models in the order they are enabled", async () => {
      await registry.enableModel(CHAT, "m1");
      await registry.enableModel(CHAT, "m2");
      await registry.enableModel(CHAT, "m3");
      expect(registry.get(CHAT).enabledModels).toEqual(["m1", "m2", "m3"]);
    });

    it("keeps a single entry when the same model is enabled twice", async () => {
      await registry.enableModel(CHAT, "m1");
      await registry.enableModel(CHAT, "m1");
      expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
    });
  });

  describe("disableModel()", () => {
    it("removes the model and leaves the list unchanged when disabled again", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      await registry.disableModel(CHAT, "m2");
      expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
      await registry.disableModel(CHAT, "m2");
      expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
    });
  });

  describe("setEnabledModels()", () => {
    it("does not notify or replace the backends slice when the ordered ids are identical", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      const listener = jest.fn();
      registry.subscribe(listener);
      const before = getSettings().backends;

      await registry.setEnabledModels(CHAT, ["m1", "m2"]);

      expect(listener).not.toHaveBeenCalled();
      expect(getSettings().backends).toBe(before);
    });

    it("notifies and stores the new order when the same ids are reordered", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      const listener = jest.fn();
      registry.subscribe(listener);

      await registry.setEnabledModels(CHAT, ["m2", "m1"]);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(registry.get(CHAT).enabledModels).toEqual(["m2", "m1"]);
    });
  });

  describe("removeRefs()", () => {
    it("removes the given model ids from every backend", async () => {
      await registry.setEnabledModels(CHAT, ["m1", "m2", "m3"]);
      await registry.setEnabledModels(PI, ["m2", "m4"]);

      await registry.removeRefs(["m2", "m3"]);

      expect(registry.get(CHAT).enabledModels).toEqual(["m1"]);
      expect(registry.get(PI).enabledModels).toEqual(["m4"]);
    });

    it("leaves settings untouched when given no ids", async () => {
      await registry.setEnabledModels(CHAT, ["m1"]);
      const before = getSettings().backends;
      await registry.removeRefs([]);
      expect(getSettings().backends).toBe(before);
    });
  });

  describe("subscribe()", () => {
    it("notifies only for changes that mutate state and stops after unsubscribe", async () => {
      const listener = jest.fn();
      const unsubscribe = registry.subscribe(listener);

      await registry.enableModel(CHAT, "m1");
      expect(listener).toHaveBeenCalledTimes(1);

      await registry.enableModel(CHAT, "m1");
      expect(listener).toHaveBeenCalledTimes(1);

      await registry.setEnabledModels(CHAT, ["m1", "m2"]);
      expect(listener).toHaveBeenCalledTimes(2);

      await registry.disableModel(CHAT, "m2");
      expect(listener).toHaveBeenCalledTimes(3);

      await registry.disableModel(CHAT, "m99");
      expect(listener).toHaveBeenCalledTimes(3);

      await registry.removeRefs(["m1"]);
      expect(listener).toHaveBeenCalledTimes(4);

      await registry.removeRefs([]);
      await registry.removeRefs(["missing-id"]);
      expect(listener).toHaveBeenCalledTimes(4);

      unsubscribe();
      await registry.enableModel(PI, "x");
      expect(listener).toHaveBeenCalledTimes(4);
    });
  });

  describe("resolveEnabled()", () => {
    it.each(["agent", "retired"])(
      "excludes loaded %s sources from current enabled models without changing saved data https://github.com/ItsDalk-Lane/Vault-Agent/issues/2",
      async (kind) => {
        const providerId = await providers.add({
          providerType: "anthropic",
          displayName: "Current",
          origin: { kind: "byok" },
        });
        const currentId = await models.add({
          providerId,
          info: { id: "current", displayName: "Current" },
        });
        const unavailable = {
          ...providers.get(providerId),
          providerId: "unavailable",
          origin: { kind },
        } as unknown as Provider;
        setSettings({ providers: { ...getSettings().providers, unavailable } });
        const unavailableId = await models.add({
          providerId: "unavailable",
          info: { id: "old", displayName: "Old" },
        });
        for (const backend of [CHAT, PI]) {
          await registry.setEnabledModels(backend, [currentId, unavailableId]);
          expect(registry.resolveEnabled(backend).map((entry) => entry.configuredModelId)).toEqual([
            currentId,
          ]);
          expect(registry.get(backend).enabledModels).toEqual([currentId, unavailableId]);
        }
        expect(getSettings().providers.unavailable).toBe(unavailable);
      }
    );

    it("omits disabled providers without deleting backend selections and restores them on enable https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      const providerId = await providers.add({
        providerType: "anthropic",
        displayName: "A",
        origin: { kind: "byok" },
      });
      const id = await models.add({ providerId, info: { id: "m", displayName: "M" } });
      await registry.enableModel("pi", id);
      await providers.update(providerId, { enabled: false });
      expect(registry.resolveEnabled("pi")).toEqual([]);
      expect(registry.get("pi").enabledModels).toEqual([id]);
      await providers.update(providerId, { enabled: true });
      expect(registry.resolveEnabled("pi").map((entry) => entry.configuredModelId)).toEqual([id]);
    });

    it("marks entries whose configured model exists as ok and the rest as broken", async () => {
      const providerId = await providers.add({
        providerType: "anthropic",
        displayName: "Anthropic",
        origin: { kind: "byok" },
      });
      const okId = await models.add({
        providerId,
        info: { id: "claude-sonnet-4-5", displayName: "Claude" },
      });
      await registry.setEnabledModels(CHAT, [okId, "missing-id"]);

      const resolved = registry.resolveEnabled(CHAT);
      expect(resolved).toHaveLength(2);
      expect(resolved[0].state).toBe("ok");
      expect(resolved[1].state).toBe("broken");
    });

    it("returns the same frozen empty list when no models are enabled", async () => {
      await registry.setEnabledModels(CHAT, []);
      const a = registry.resolveEnabled(CHAT);
      const b = registry.resolveEnabled(CHAT);
      expect(a).toHaveLength(0);
      expect(a).toBe(b);
    });
  });
});
