import type { Model, Api, Provider, ProviderAuth, ProviderStreams } from "@earendil-works/pi-ai";
import {
  DEFAULT_PROTOCOL_BASE_URLS,
  buildProvider,
  buildProviderModel,
  createKeychainOnlyAuth,
  createKeylessAuth,
  type ProviderBuildConfig,
} from "./ProviderFactory";

function modelConfig(overrides: Partial<ProviderBuildConfig> = {}): ProviderBuildConfig {
  return {
    providerInstanceId: "provider-1",
    protocol: "anthropic-messages",
    requiresApiKey: true,
    baseUrl: "https://api.anthropic.com",
    models: [{ upstreamModelId: "model-1", displayName: "Model<Api> One" }],
    ...overrides,
  };
}

describe("ProviderFactory", () => {
  describe("buildProvider()", () => {
    it("rejects a missing endpoint before constructing a provider https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const createProvider = jest.fn();
      expect(() =>
        buildProvider(modelConfig({ baseUrl: undefined }), {
          createProvider,
          streamsFactory: jest.fn(),
        })
      ).toThrow("endpoint must be resolved");
      expect(createProvider).not.toHaveBeenCalled();
    });
    it("builds a provider with the declared protocol streams and models", () => {
      const createProviderCalls: unknown[] = [];
      const streams: ProviderStreams = { stream: jest.fn(), streamSimple: jest.fn() };
      const built = buildProvider(modelConfig(), {
        createProvider: (input) => {
          createProviderCalls.push(input);
          return { id: input.id } as Provider;
        },
        streamsFactory: (protocol) => {
          expect(protocol).toBe("anthropic-messages");
          return streams;
        },
      });

      expect(built.id).toBe("provider-1");
      expect(createProviderCalls).toHaveLength(1);
      const input = createProviderCalls[0] as {
        baseUrl: string;
        auth: ProviderAuth;
        models: Model<Api>[];
        api: ProviderStreams;
        name: string;
      };
      expect(input.baseUrl).toBe(DEFAULT_PROTOCOL_BASE_URLS["anthropic-messages"]);
      expect(input.api).toBe(streams);
      expect(input.models).toHaveLength(1);
      expect(input.models[0]).toMatchObject({
        id: "model-1",
        name: "Model<Api> One",
        api: "anthropic-messages",
        provider: "provider-1",
      });
      expect(input.auth.apiKey).toBeDefined();
      expect(input.auth.oauth).toBeUndefined();
    });

    it("exposes the four protocol default base urls instead of falling back between them", () => {
      expect(Object.keys(DEFAULT_PROTOCOL_BASE_URLS).sort()).toEqual([
        "anthropic-messages",
        "google-generative-ai",
        "openai-completions",
        "openai-responses",
      ]);
      expect(DEFAULT_PROTOCOL_BASE_URLS["anthropic-messages"]).toContain("anthropic.com");
      expect(DEFAULT_PROTOCOL_BASE_URLS["openai-responses"]).toContain("openai.com");
      expect(DEFAULT_PROTOCOL_BASE_URLS["google-generative-ai"]).toContain("googleapis.com");
    });
  });

  describe("buildProviderModel()", () => {
    it("fills the required Pi model fields with explicit defaults", () => {
      const model = buildProviderModel(
        { upstreamModelId: "model-x" },
        "provider-1",
        "openai-completions",
        "https://localhost:1234/v1"
      );

      expect(model).toMatchObject({
        id: "model-x",
        name: "model-x",
        api: "openai-completions",
        provider: "provider-1",
        baseUrl: "https://localhost:1234/v1",
        reasoning: false,
        input: ["text"],
        contextWindow: 8192,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      });
    });

    it("preserves declared strict schema and native system message compatibility https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const compat = { supportsStrictMode: true, supportsMidConvoSystemMessages: true };
      const model = buildProviderModel(
        { upstreamModelId: "declared", compat, reasoningEfforts: ["low", "max"] },
        "configured",
        "openai-completions",
        "https://example.com/v1"
      );
      expect(model.compat).toEqual(compat);
      expect(model.thinkingLevelMap).toMatchObject({ low: "low", max: "max", high: null });
    });

    it("preserves provider wire effort names and does not invent an off value https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const configured = {
        upstreamModelId: "declared",
        reasoningEfforts: ["minimal", "high"],
        thinkingLevelMap: { minimal: "MINIMAL", high: "HIGH" },
      };
      const model = buildProviderModel(
        configured,
        "saved",
        "google-generative-ai",
        "https://example.com"
      );
      expect(model.thinkingLevelMap).toMatchObject({ minimal: "MINIMAL", high: "HIGH", low: null });
      expect(model.thinkingLevelMap?.off).toBeUndefined();
    });
    it("inherits declared capabilities and cost rates", () => {
      const model = buildProviderModel(
        {
          upstreamModelId: "model-x",
          displayName: "Model<Api> X",
          reasoning: true,
          supportsImages: true,
          contextWindow: 200_000,
          maxTokens: 16_000,
          costRates: { input: 3, output: 15, cacheRead: 0.3 },
        },
        "provider-1",
        "anthropic-messages",
        DEFAULT_PROTOCOL_BASE_URLS["anthropic-messages"]
      );

      expect(model).toMatchObject({
        name: "Model<Api> X",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200_000,
        maxTokens: 16_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      });
    });
  });

  describe("createKeychainOnlyAuth()", () => {
    it("resolves only the stored Keychain credential and ignores ambient environment keys", async () => {
      const auth = createKeychainOnlyAuth();
      const env = async (name: string) => (name === "ANTHROPIC_API_KEY" ? "env-key" : undefined);
      const ctx = { env, fileExists: async () => false };

      await expect(
        auth.apiKey?.resolve({ ctx, credential: undefined, signal: new AbortController().signal })
      ).resolves.toBeUndefined();
      await expect(
        auth.apiKey?.resolve({
          ctx,
          credential: { type: "api_key", key: "stored-key" },
          signal: new AbortController().signal,
        })
      ).resolves.toMatchObject({ auth: { apiKey: "stored-key" }, source: "Vault Agent keychain" });
      await expect(
        auth.apiKey?.check?.({
          ctx,
          credential: { type: "api_key", key: "stored-key" },
          signal: new AbortController().signal,
        })
      ).resolves.toMatchObject({ type: "api_key" });
      await expect(
        auth.apiKey?.check?.({
          ctx,
          credential: undefined,
          signal: new AbortController().signal,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe("createKeylessAuth()", () => {
    it("marks an explicit keyless local endpoint as configured without a credential", async () => {
      const auth = createKeylessAuth();
      const ctx = { env: async () => undefined, fileExists: async () => false };

      await expect(
        auth.apiKey?.resolve({ ctx, credential: undefined, signal: new AbortController().signal })
      ).resolves.toEqual({ auth: {}, source: "Keyless local endpoint" });
      await expect(
        auth.apiKey?.check?.({
          ctx,
          credential: undefined,
          signal: new AbortController().signal,
        })
      ).resolves.toEqual({ source: "Keyless local endpoint", type: "api_key" });
    });
  });
});
