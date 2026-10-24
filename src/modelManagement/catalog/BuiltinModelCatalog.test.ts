import { BuiltinModelCatalog } from "./BuiltinModelCatalog";
import { getProviderCapability } from "./providerCapability";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";

describe("BuiltinModelCatalog", () => {
  describe("BuiltinModelCatalog", () => {
    describe("getAllProviders()", () => {
      it(`offers a stable built-in provider list immediately without loading a cache (${ISSUE})`, () => {
        const catalog = new BuiltinModelCatalog();
        const providers = catalog.getAllProviders();
        expect(providers.length).toBeGreaterThan(0);
        expect(catalog.getAllProviders()).toBe(providers);
        expect(new BuiltinModelCatalog().getAllProviders()).toBe(providers);
        expect(Object.isFrozen(providers)).toBe(true);
        expect(providers.map((provider) => provider.displayName)).toEqual(
          providers.map((provider) => provider.displayName).sort((a, b) => a.localeCompare(b))
        );
      });

      it(`includes only providers with a usable BYOK protocol and resolved endpoint (${ISSUE})`, () => {
        const providers = new BuiltinModelCatalog().getAllProviders();
        for (const provider of providers) {
          expect(getProviderCapability(provider)).not.toBeNull();
          expect(Object.keys(provider.models).length).toBeGreaterThan(0);
        }
        expect(
          providers.some((provider) => ["github-copilot", "openai-codex"].includes(provider.id))
        ).toBe(false);
      });
    });

    describe("getProvider()", () => {
      it(`returns bundled model names, prices and the declared default protocol (${ISSUE})`, () => {
        const catalog = new BuiltinModelCatalog();
        expect(catalog.getProvider("openai")).toMatchObject({
          displayName: "OpenAI",
          providerType: "openai-compatible",
          defaultBaseUrl: "https://api.openai.com/v1",
          useResponsesApi: true,
        });
        const model = catalog.getProvider("openai")?.models["gpt-5.5"];
        expect(model?.id).toBe("gpt-5.5");
        expect(typeof model?.displayName).toBe("string");
        expect(typeof model?.cost?.input).toBe("number");
        expect(typeof model?.cost?.output).toBe("number");
        expect(catalog.getProvider("anthropic")).toBe(
          catalog.getAllProviders().find((provider) => provider.id === "anthropic")
        );
      });

      it(`leaves unknown and prototype-shaped provider identifiers unresolved (${ISSUE})`, () => {
        const catalog = new BuiltinModelCatalog();
        expect(catalog.getProvider("custom-service")).toBeUndefined();
        expect(catalog.getProvider("toString")).toBeUndefined();
      });
    });
  });
});
