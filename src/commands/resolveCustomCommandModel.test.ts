import { resolveCustomCommandModel } from "./resolveCustomCommandModel";
import type { ModelManagementApi, EnabledBackendEntry } from "@/modelManagement";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";
function entry(id = "target"): EnabledBackendEntry {
  return {
    state: "ok",
    configuredModelId: id,
    configuredModel: {
      configuredModelId: id,
      providerId: "p",
      info: { id: "upstream", displayName: "Model" },
      configuredAt: 1,
    },
    provider: {
      providerId: "p",
      providerType: "openai-compatible",
      origin: { kind: "byok", catalogProviderId: "openai" },
      displayName: "Provider",
      requiresApiKey: false,
      addedAt: 1,
    },
  };
}
function api(entries: EnabledBackendEntry[]) {
  const resolveEnabled = jest.fn(() => entries);
  return { backendConfigRegistry: { resolveEnabled } } as unknown as Pick<
    ModelManagementApi,
    "backendConfigRegistry"
  >;
}

describe("resolveCustomCommandModel", () => {
  describe("resolveCustomCommandModel()", () => {
    it(`resolves an enabled agent model and its old persisted selection using the actual backend list (${ISSUE})`, () => {
      const current = api([entry()]);
      expect(resolveCustomCommandModel(current, "target")).toBe("target");
      expect(resolveCustomCommandModel(current, "upstream|openai")).toBe("target");
      expect(current.backendConfigRegistry.resolveEnabled).toHaveBeenCalledWith("pi");
    });
    it(`does not substitute another provider for a deleted, broken, embedding or unsupported command model (${ISSUE})`, () => {
      const supported = entry();
      if (supported.state !== "ok") throw new Error("fixture");
      const entries: EnabledBackendEntry[] = [
        entry("different"),
        { state: "broken", configuredModelId: "broken" },
        {
          ...supported,
          configuredModelId: "embedding",
          configuredModel: {
            ...supported.configuredModel,
            info: { ...supported.configuredModel.info, isEmbedding: true },
          },
        },
        {
          ...supported,
          configuredModelId: "no-tools",
          configuredModel: {
            ...supported.configuredModel,
            info: { ...supported.configuredModel.info, toolCall: false },
          },
        },
        {
          ...supported,
          configuredModelId: "legacy",
          provider: { ...supported.provider, origin: { kind: "agent", agentType: "opencode" } },
        },
      ];
      for (const selection of ["deleted", "broken", "embedding", "no-tools", "legacy"])
        expect(resolveCustomCommandModel(api(entries), selection)).toBeUndefined();
    });
  });
});
