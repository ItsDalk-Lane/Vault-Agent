import { EMPTY_AGENT_BRANDS, listFanoutModelBrands, useFanoutModelBrands } from "./mentionedAgents";
import type { VaultAgentSettings } from "@/settings/model";
import { renderHook } from "@testing-library/react";

let mockSettings = {} as VaultAgentSettings;
jest.mock("@/settings/model", () => ({ useSettingsValue: () => mockSettings }));

function settings(): VaultAgentSettings {
  return {
    backends: { pi: { enabledModels: ["cm-a", "cm-b"] } },
    configuredModels: [
      { configuredModelId: "cm-a", providerId: "a", info: { id: "claude", displayName: "Claude" } },
      { configuredModelId: "cm-b", providerId: "b", info: { id: "gpt", displayName: "GPT" } },
    ],
    providers: {
      a: {
        providerType: "anthropic",
        displayName: "Anthropic",
        apiKeyKeychainId: "key-a",
        origin: { kind: "byok" },
      },
      b: {
        providerType: "openai-compatible",
        displayName: "OpenAI",
        apiKeyKeychainId: "key-b",
        origin: { kind: "byok" },
      },
    },
  } as unknown as VaultAgentSettings;
}

describe("mentionedAgents", () => {
  describe("listFanoutModelBrands()", () => {
    it("offers saved model selections on Pi instead of the engine name https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const brands = listFanoutModelBrands(settings());
      expect(brands.map((brand) => brand.id)).toEqual(["cm-a", "cm-b"]);
      expect(brands.map((brand) => brand.displayName)).toEqual([
        "Claude · Anthropic",
        "GPT · OpenAI",
      ]);
    });
    it("omits models without a key and keeps local providers that need none https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const input = settings();
      input.providers.a.apiKeyKeychainId = null;
      input.providers.b.apiKeyKeychainId = null;
      input.providers.b.requiresApiKey = false;
      expect(listFanoutModelBrands(input).map((brand) => brand.id)).toEqual(["cm-b"]);
    });
    it("returns the frozen empty snapshot when no model is configured", () => {
      expect(
        listFanoutModelBrands({
          configuredModels: [],
          providers: {},
        } as unknown as VaultAgentSettings)
      ).toBe(EMPTY_AGENT_BRANDS);
    });
  });
  describe("useFanoutModelBrands()", () => {
    it("updates mentions after model settings change and keeps stable references otherwise", () => {
      mockSettings = settings();
      const { result, rerender } = renderHook(() => useFanoutModelBrands());
      const before = result.current;
      rerender();
      expect(result.current).toBe(before);
      mockSettings = {
        ...mockSettings,
        configuredModels: mockSettings.configuredModels.slice(0, 1),
      };
      rerender();
      expect(result.current.map((brand) => brand.id)).toEqual(["cm-a"]);
    });
  });
});
