import { compactionPolicyForWindow, requireModelContextWindow } from "./ModelWindowPolicy";
import type { CatalogModelEntry } from "./ModelCatalog";

describe("ModelWindowPolicy", () => {
  describe("requireModelContextWindow()", () => {
    it("uses declared model capacity and refuses unknown or unsupported windows https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(requireModelContextWindow({ contextWindow: 8192 } as CatalogModelEntry)).toBe(8192);
      for (const size of [null, 4096, 8192.5, Number.POSITIVE_INFINITY])
        expect(() =>
          requireModelContextWindow({
            configuredModelId: "model",
            contextWindow: size,
          } as CatalogModelEntry)
        ).toThrow("模型配置");
    });
  });
  describe("compactionPolicyForWindow()", () => {
    it("scales all thresholds to the minimum mixed-model window and caps large windows at the design limits https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(compactionPolicyForWindow(8192)).toEqual({
        enabled: true,
        reserveTokens: 1024,
        keepRecentTokens: 2048,
        backgroundTokens: 1024,
      });
      expect(compactionPolicyForWindow(1000000)).toEqual({
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
        backgroundTokens: 32768,
      });
    });
  });
});
