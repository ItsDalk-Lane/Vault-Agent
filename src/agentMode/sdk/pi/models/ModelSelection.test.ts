import { buildModelCatalog } from "./ModelCatalog";
import { modelEntriesFromCatalog, effortOptionsForCatalogEntry } from "./ModelSelection";

describe("ModelSelection", () => {
  const catalog = buildModelCatalog(
    {
      providers: [
        {
          providerId: "saved",
          providerType: "openai-compatible",
          baseUrl: "https://example.com/v1",
        },
      ],
      models: [
        {
          configuredModelId: "saved-model",
          providerId: "saved",
          upstreamModelId: "wire-model",
          reasoning: true,
          reasoningEfforts: ["low", "custom-deep"],
        },
      ],
    },
    { sha256: (value) => value }
  );
  describe("effortOptionsForCatalogEntry()", () => {
    it("turns selected reasoning levels into picker choices including custom names https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(effortOptionsForCatalogEntry(catalog.readyModels[0])).toEqual([
        { value: "low", label: "low" },
        { value: "custom-deep", label: "custom-deep" },
      ]);
    });
  });
  describe("modelEntriesFromCatalog()", () => {
    it("keeps the configured model identity and selected levels in the chat catalog https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(modelEntriesFromCatalog(catalog)).toEqual([
        {
          baseModelId: "saved-model",
          name: "wire-model",
          provider: "saved",
          effortOptions: [
            { value: "low", label: "low" },
            { value: "custom-deep", label: "custom-deep" },
          ],
        },
      ]);
    });
  });
});
