import { getSettings, resetSettings, setSettings, settingsStore } from "@/settings/model";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

import {
  agentBackendPickerAtom,
  chatBackendPickerAtom,
  byokProvidersAtom,
  visibleByokProvidersAtom,
} from "./atoms";

function provider(id: string, origin: Provider["origin"], baseUrl?: string): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName: id,
    baseUrl,
    origin,
    addedAt: 0,
  };
}

function model(configuredModelId: string, providerId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: configuredModelId, displayName: configuredModelId },
    configuredAt: 0,
  };
}

const CLOUD = provider("cloud", { kind: "byok" }, "https://api.anthropic.com");
const LOCAL = provider("local", { kind: "byok" }, "http://localhost:11434/v1");

beforeEach(() => {
  resetSettings();
  setSettings({
    providers: { cloud: CLOUD, local: LOCAL },
    configuredModels: [model("cloud-m", "cloud"), model("local-m", "local")],
    backends: { chat: { enabledModels: ["cloud-m", "local-m", "missing"] } },
  });
});

function pickerIds(): string[] {
  return settingsStore.get(chatBackendPickerAtom).map((e) => e.configuredModelId);
}

function warningById(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const e of settingsStore.get(chatBackendPickerAtom)) {
    out[e.configuredModelId] = e.state === "ok" ? Boolean(e.needsSelfHostWarning) : false;
  }
  return out;
}

describe("atoms", () => {
  describe("agentBackendPickerAtom", () => {
    it("uses agent enablement and excludes unusable command choices without changing saved rows https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const embedded = {
        ...model("embedding", "local"),
        info: { id: "embedding", displayName: "Embedding", isEmbedding: true },
      };
      const noTools = {
        ...model("no-tools", "local"),
        info: { id: "no-tools", displayName: "No tools", toolCall: false },
      };
      setSettings({
        configuredModels: [model("local-m", "local"), embedded, noTools],
        backends: {
          chat: { enabledModels: ["cloud-m"] },
          pi: { enabledModels: ["local-m", "embedding", "no-tools"] },
        },
      });
      expect(
        settingsStore.get(agentBackendPickerAtom).map((entry) => entry.configuredModelId)
      ).toEqual(["local-m"]);
      expect(getSettings().backends.pi?.enabledModels).toEqual([
        "local-m",
        "embedding",
        "no-tools",
      ]);
      expect(getSettings().configuredModels).toHaveLength(3);
    });
  });
  describe("chatBackendPickerAtom", () => {
    it("keeps models from retired agents out of Quick Chat without deleting their saved configuration https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const legacy = provider("legacy", { kind: "agent", agentType: "opencode" });
      setSettings({
        providers: { cloud: CLOUD, legacy },
        configuredModels: [model("cloud-m", "cloud"), model("legacy-m", "legacy")],
        backends: { chat: { enabledModels: ["cloud-m", "legacy-m"] } },
      });
      expect(pickerIds()).toEqual(["cloud-m"]);
      expect(getSettings().providers.legacy).toEqual(legacy);
      expect(getSettings().backends.chat?.enabledModels).toEqual(["cloud-m", "legacy-m"]);
    });

    it("hides a disabled provider and restores its previous model selections when enabled https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      setSettings({ providers: { cloud: { ...CLOUD, enabled: false }, local: LOCAL } });
      expect(pickerIds()).toEqual(["local-m", "missing"]);
      expect(getSettings().backends.chat?.enabledModels).toEqual(["cloud-m", "local-m", "missing"]);
      setSettings({ providers: { cloud: { ...CLOUD, enabled: true }, local: LOCAL } });
      expect(pickerIds()).toEqual(["cloud-m", "local-m", "missing"]);
    });

    it("lists every enabled entry without a Self-Host warning when Self-Host Mode is off", () => {
      expect(pickerIds()).toEqual(["cloud-m", "local-m", "missing"]);
      expect(warningById()).toEqual({ "cloud-m": false, "local-m": false, missing: false });
    });

    it("keeps every entry in order and flags only cloud BYOK when Self-Host Mode is on", () => {
      setSettings({ enableSelfHostMode: true });
      expect(pickerIds()).toEqual(["cloud-m", "local-m", "missing"]);
      expect(warningById()).toEqual({ "cloud-m": true, "local-m": false, missing: false });
    });

    it("drops the Self-Host warning again when the mode is turned back off without rewriting enabled models", () => {
      setSettings({ enableSelfHostMode: true });
      expect(warningById()["cloud-m"]).toBe(true);
      expect(getSettings().backends.chat?.enabledModels).toEqual(["cloud-m", "local-m", "missing"]);

      setSettings({ enableSelfHostMode: false });
      expect(pickerIds()).toEqual(["cloud-m", "local-m", "missing"]);
      expect(warningById()["cloud-m"]).toBe(false);
    });

    it("returns the same empty list on every read when no models are enabled", () => {
      setSettings({
        backends: { chat: { enabledModels: [] } },
        enableSelfHostMode: true,
      });
      const a = settingsStore.get(chatBackendPickerAtom);
      const b = settingsStore.get(chatBackendPickerAtom);
      expect(a).toHaveLength(0);
      expect(a).toBe(b);
    });
  });

  describe("visibleByokProvidersAtom", () => {
    const visibleIds = (): string[] =>
      settingsStore.get(visibleByokProvidersAtom).map((p) => p.providerId);

    it("lists every BYOK provider when Self-Host Mode is off", () => {
      expect(visibleIds().sort()).toEqual(["cloud", "local"]);
    });

    it("lists cloud BYOK below self-hosted providers when Self-Host Mode is on", () => {
      setSettings({ enableSelfHostMode: true });
      expect(visibleIds()).toEqual(["local", "cloud"]);
    });

    it("does not reorder the underlying byokProvidersAtom", () => {
      setSettings({ enableSelfHostMode: true });
      expect(
        settingsStore
          .get(byokProvidersAtom)
          .map((p) => p.providerId)
          .sort()
      ).toEqual(["cloud", "local"]);
    });

    it("restores the original order when Self-Host Mode is turned back off", () => {
      setSettings({ enableSelfHostMode: true });
      expect(visibleIds()).toEqual(["local", "cloud"]);
      setSettings({ enableSelfHostMode: false });
      expect(visibleIds()).toEqual(["cloud", "local"]);
    });

    it("returns the same empty list on every read when no BYOK providers exist", () => {
      setSettings({ providers: {}, configuredModels: [], enableSelfHostMode: true });
      const a = settingsStore.get(visibleByokProvidersAtom);
      const b = settingsStore.get(visibleByokProvidersAtom);
      expect(a).toHaveLength(0);
      expect(a).toBe(b);
    });
  });
});
