jest.mock("./declaredPiModels.generated", () => ({
  DECLARED_PI_MODEL_FACTS: Object.fromEntries(
    ["openai", "together", "vercel-ai-gateway"].map((provider) => [
      provider,
      {
        declared: {
          id: "declared",
          api: "openai-completions",
          input: ["text", "image"],
          contextWindow: 128000,
          maxTokens: 16000,
          reasoning: true,
          reasoningEfforts: ["low", "high"],
          compat: { supportsStrictMode: true, supportsMidConvoSystemMessages: false },
        },
      },
    ])
  ),
}));
import {
  lookupDeclaredModelCapabilities,
  lookupDeclaredPiModel,
} from "./DeclaredModelCapabilities";

describe("DeclaredModelCapabilities", () => {
  describe("lookupDeclaredPiModel()", () => {
    it("preserves native declarations for the runtime and rejects unknown identities https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(lookupDeclaredPiModel("openai", "declared")?.compat).toEqual({
        supportsStrictMode: true,
        supportsMidConvoSystemMessages: false,
      });
      expect(lookupDeclaredPiModel("unknown", "declared")).toBeUndefined();
    });
  });
  describe("lookupDeclaredModelCapabilities()", () => {
    it("returns the SDK declaration used to select capabilities automatically https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(lookupDeclaredModelCapabilities("openai", "declared")).toEqual({
        modalities: { input: ["text", "image"] },
        limits: { context: 128000, output: 16000 },
        reasoning: true,
        reasoningEfforts: ["low", "high"],
        capabilities: { structuredOutput: true, midConversationSystemMessages: false },
      });
    });
    it.each(["togetherai", "vercel"])(
      "resolves models.dev provider alias %s without guessing a protocol https://github.com/ItsDalk-Lane/Vault-Agent/issues/2",
      (provider) => {
        expect(lookupDeclaredModelCapabilities(provider, "declared")?.modalities?.input).toEqual([
          "text",
          "image",
        ]);
      }
    );
    it("returns no declaration for an unknown provider or model https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(lookupDeclaredModelCapabilities("unknown", "declared")).toBeUndefined();
      expect(lookupDeclaredModelCapabilities("openai", "unknown")).toBeUndefined();
      expect(lookupDeclaredModelCapabilities("__proto__", "declared")).toBeUndefined();
      expect(lookupDeclaredModelCapabilities("openai", "constructor")).toBeUndefined();
    });
  });
});
