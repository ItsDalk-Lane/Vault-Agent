import type { Api, Model, Provider, ProviderAuth, ProviderStreams } from "@earendil-works/pi-ai";

import type { ProtocolApi } from "./ModelIdentity";

export { DEFAULT_PROTOCOL_BASE_URLS } from "@/utils/providerCapability";

export const DEFAULT_CONTEXT_WINDOW = 8192;
export const DEFAULT_MAX_TOKENS = 4096;

export interface ProviderModelConfig {
  readonly upstreamModelId: string;
  readonly displayName?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly reasoning?: boolean;
  readonly supportsImages?: boolean;
  readonly compat?: Model<Api>["compat"];
  readonly reasoningEfforts?: readonly string[];
  readonly thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
  readonly costRates?: Partial<{
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  }>;
}

export interface ProviderBuildConfig {
  readonly providerInstanceId: string;
  readonly protocol: ProtocolApi;
  readonly baseUrl?: string;
  readonly requiresApiKey: boolean;
  readonly models: readonly ProviderModelConfig[];
}

export interface ProviderCreateInput {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly auth: ProviderAuth;
  readonly models: readonly Model<Api>[];
  readonly api: ProviderStreams;
}

export type ProviderStreamsFactory = (protocol: ProtocolApi) => ProviderStreams;

export interface ProviderBuildDeps {
  readonly createProvider: (input: ProviderCreateInput) => Provider;
  readonly streamsFactory: ProviderStreamsFactory;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error("The credential resolution was aborted.");
    error.name = "AbortError";
    throw error;
  }
}

export function createKeychainOnlyAuth(): ProviderAuth {
  return {
    apiKey: {
      name: "Vault Agent keychain",
      check: async ({ credential }) =>
        credential?.key ? { source: "Vault Agent keychain", type: "api_key" } : undefined,
      resolve: async ({ credential, signal }) => {
        throwIfAborted(signal);
        if (!credential?.key) return undefined;
        return {
          auth: { apiKey: credential.key },
          env: credential.env,
          source: "Vault Agent keychain",
        };
      },
    },
  };
}

export function createKeylessAuth(): ProviderAuth {
  return {
    apiKey: {
      name: "Keyless local endpoint",
      check: async () => ({ source: "Keyless local endpoint", type: "api_key" }),
      resolve: async ({ signal }) => {
        throwIfAborted(signal);
        return { auth: {}, source: "Keyless local endpoint" };
      },
    },
  };
}

export function buildProviderModel(
  config: ProviderModelConfig,
  providerInstanceId: string,
  protocol: ProtocolApi,
  baseUrl: string
): Model<Api> {
  const costRates = config.costRates ?? {};
  return {
    id: config.upstreamModelId,
    name: config.displayName ?? config.upstreamModelId,
    api: protocol,
    provider: providerInstanceId,
    baseUrl,
    input: config.supportsImages === true ? ["text", "image"] : ["text"],
    cost: {
      input: costRates.input ?? 0,
      output: costRates.output ?? 0,
      cacheRead: costRates.cacheRead ?? 0,
      cacheWrite: costRates.cacheWrite ?? 0,
    },
    reasoning: config.reasoning === true,
    contextWindow: config.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    compat: config.compat,
    // Pi 会夹紧未声明的档位；显式映射确保 max 等真实支持等级不被降档。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    thinkingLevelMap:
      config.reasoningEfforts === undefined
        ? config.thinkingLevelMap
        : {
            ...config.thinkingLevelMap,
            ...Object.fromEntries(
              ["minimal", "low", "medium", "high", "xhigh", "max"].map((level) => [
                level,
                config.reasoningEfforts!.includes(level)
                  ? (config.thinkingLevelMap?.[
                      level as keyof NonNullable<Model<Api>["thinkingLevelMap"]>
                    ] ?? level)
                  : null,
              ])
            ),
          },
  };
}

export function buildProvider(config: ProviderBuildConfig, deps: ProviderBuildDeps): Provider {
  // 缺少目标地址时拒绝构建，防止把第三方密钥发送到协议默认主机。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (!config.baseUrl)
    throw new Error("The provider endpoint must be resolved before building models.");
  const baseUrl = config.baseUrl;
  const streams = deps.streamsFactory(config.protocol);
  return deps.createProvider({
    id: config.providerInstanceId,
    name: config.providerInstanceId,
    baseUrl,
    auth: config.requiresApiKey ? createKeychainOnlyAuth() : createKeylessAuth(),
    models: config.models.map((model) =>
      buildProviderModel(model, config.providerInstanceId, config.protocol, baseUrl)
    ),
    api: config.requiresApiKey
      ? streams
      : {
          // 官方协议客户端仍要求非空占位值；显式免密端点不发送认证头，也不回读环境密钥：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          stream: (model, context, options) =>
            streams.stream(model, context, {
              ...options,
              apiKey: "vault-agent-keyless",
              headers: { ...options?.headers, authorization: null, "x-api-key": null },
            }),
          streamSimple: (model, context, options) =>
            streams.streamSimple(model, context, {
              ...options,
              apiKey: "vault-agent-keyless",
              headers: { ...options?.headers, authorization: null, "x-api-key": null },
            }),
        },
  });
}

export async function loadPiProviderDeps(): Promise<ProviderBuildDeps> {
  const [{ createProvider }, anthropic, openaiResponses, openaiCompletions, google] =
    await Promise.all([
      import("@earendil-works/pi-ai/models"),
      import("@earendil-works/pi-ai/api/anthropic-messages.lazy"),
      import("@earendil-works/pi-ai/api/openai-responses.lazy"),
      import("@earendil-works/pi-ai/api/openai-completions.lazy"),
      import("@earendil-works/pi-ai/api/google-generative-ai.lazy"),
    ]);

  const streamsByProtocol: Record<ProtocolApi, ProviderStreams> = {
    "anthropic-messages": anthropic.anthropicMessagesApi(),
    "openai-responses": openaiResponses.openAIResponsesApi(),
    "openai-completions": openaiCompletions.openAICompletionsApi(),
    "google-generative-ai": google.googleGenerativeAIApi(),
  };

  return {
    createProvider: (input) =>
      (createProvider as unknown as (value: ProviderCreateInput) => Provider)(input),
    streamsFactory: (protocol) => streamsByProtocol[protocol],
  };
}
