import type { VaultAgentSettings } from "@/settings/model";
import { isSensitiveKey, stripKeychainFields } from "@/services/settingsSecretTransforms";

function makeSettings(overrides: Partial<VaultAgentSettings> = {}): VaultAgentSettings {
  return {
    activeModels: [],
    ...overrides,
  } as unknown as VaultAgentSettings;
}

describe("settingsSecretTransforms", () => {
  describe("isSensitiveKey()", () => {
    it.each([
      "openAIApiKey",
      "api_key",
      "accessToken",
      "clientSecret",
      "password",
      "plusLicenseKey",
    ])("recognizes %s as sensitive", (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    });

    it.each(["defaultModelKey", "temperature", "userId", "apiVersion"])(
      "does not classify %s as sensitive",
      (key) => {
        expect(isSensitiveKey(key)).toBe(false);
      }
    );
  });

  describe("stripKeychainFields()", () => {
    it("clears top-level and model secrets without mutating the input", () => {
      const settings = makeSettings({
        openAIApiKey: "sk-123",
        defaultModelKey: "gpt-4|openai",
        activeModels: [{ name: "gpt-4", provider: "openai", apiKey: "chat-secret", enabled: true }],
      });

      const result = stripKeychainFields(settings);

      expect(result).not.toBe(settings);
      expect(result.openAIApiKey).toBe("");
      expect(result.defaultModelKey).toBe("gpt-4|openai");
      expect(result.activeModels[0].apiKey).toBe("");
      expect(settings.openAIApiKey).toBe("sk-123");
      expect(settings.activeModels[0].apiKey).toBe("chat-secret");
    });

    it("preserves sparse settings without adding model arrays", () => {
      const result = stripKeychainFields({ openAIApiKey: "secret" } as VaultAgentSettings);
      const record = result as unknown as Record<string, unknown>;

      expect(record.openAIApiKey).toBe("");
      expect(record.activeModels).toBeUndefined();
    });
  });
});
