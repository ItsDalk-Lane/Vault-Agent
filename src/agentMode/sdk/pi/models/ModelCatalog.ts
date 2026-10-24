import {
  ENGINE_ID,
  credentialDomainId,
  createConfiguredModelId,
  type EndpointHash,
  type ProtocolApi,
} from "./ModelIdentity";

// Existing model configs map onto Pi's four supported protocols; unmapped or unknown
// configs are retained as needs-protocol, thinking effort exists only where the model
// declares reasoning, and the catalog is derived purely from saved local config with no
// CLI, process, network or model probing:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ExistingProviderBinding {
  readonly providerId: string;
  readonly providerType: string;
  readonly displayName?: string;
  readonly baseUrl?: string;
  readonly useResponsesApi?: boolean;
}

export interface CostRates {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export interface ExistingConfiguredModel {
  readonly configuredModelId?: string;
  readonly providerId: string;
  readonly upstreamModelId: string;
  readonly displayName?: string;
  readonly toolCall?: boolean;
  readonly reasoning?: boolean;
  readonly reasoningEfforts?: readonly string[];
  readonly structuredOutput?: boolean;
  readonly midConversationSystemMessages?: boolean;
  readonly capabilities?: readonly string[];
  readonly contextWindow?: number;
  readonly costRates?: CostRates;
  readonly needsProtocolSelection?: boolean;
}

export type CatalogModelStatus = "ready" | "needs_protocol" | "unsupported_tool_calling";

export interface CatalogModelCapabilities {
  readonly supportsTools: boolean;
  readonly supportsImages: boolean;
  readonly supportsThinking: boolean;
  readonly structuredOutput?: boolean;
  readonly midConversationSystemMessages?: boolean;
  readonly thinkingEfforts: readonly string[];
}

export interface CatalogModelEntry {
  readonly displayName?: string;
  readonly providerDisplayName?: string;
  readonly engineId: typeof ENGINE_ID;
  readonly configuredModelId: string;
  readonly providerInstanceId: string;
  readonly upstreamModelId: string;
  readonly api: ProtocolApi | null;
  readonly baseUrl: string | null;
  readonly credentialDomainId: string;
  readonly status: CatalogModelStatus;
  readonly retained: true;
  readonly capabilities: CatalogModelCapabilities;
  readonly contextWindow: number | null;
  readonly costRates: CostRates | null;
  readonly selected: boolean;
}

export interface ModelCatalogInput {
  readonly providers: readonly ExistingProviderBinding[];
  readonly models: readonly ExistingConfiguredModel[];
  readonly selectedConfiguredModelId?: string | null;
}

export interface ModelCatalogSnapshot {
  readonly engineId: typeof ENGINE_ID;
  readonly models: readonly CatalogModelEntry[];
  readonly readyModels: readonly CatalogModelEntry[];
  readonly unknownConfigs: readonly CatalogModelEntry[];
  readonly selectedConfiguredModelId: string | null;
}

export interface BuildModelCatalogOptions {
  sha256?: EndpointHash;
}

const EMPTY_EFFORTS: readonly string[] = Object.freeze([]);
const VISION_CAPABILITY = "vision";

export function mapProviderProtocol(provider: ExistingProviderBinding): ProtocolApi | null {
  switch (provider.providerType) {
    case "anthropic":
      return "anthropic-messages";
    case "google":
      return "google-generative-ai";
    case "openai-compatible":
      return provider.useResponsesApi === true ? "openai-responses" : "openai-completions";
    default:
      return null;
  }
}

function thinkingEffortsFor(
  model: ExistingConfiguredModel,
  api: ProtocolApi | null
): readonly string[] {
  if (model.reasoning !== true) return EMPTY_EFFORTS;
  // 用户声明的等级必须保留到选择器，协议适配负责将其送达供应商。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  const offered = [...new Set(model.reasoningEfforts ?? EMPTY_EFFORTS)].filter(
    (effort) =>
      api === "openai-completions" ||
      api === "openai-responses" ||
      ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)
  );
  return offered.length ? Object.freeze(offered) : EMPTY_EFFORTS;
}

function capabilitiesFor(
  model: ExistingConfiguredModel,
  api: ProtocolApi | null
): CatalogModelCapabilities {
  return {
    supportsTools: model.toolCall !== false,
    supportsImages: (model.capabilities ?? []).includes(VISION_CAPABILITY),
    supportsThinking: model.reasoning === true,
    // 已开会话必须识别能力声明变化，拒绝使用旧请求配置继续发送。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    structuredOutput: model.structuredOutput,
    midConversationSystemMessages: model.midConversationSystemMessages,
    thinkingEfforts: thinkingEffortsFor(model, api),
  };
}

function statusFor(api: ProtocolApi | null, model: ExistingConfiguredModel): CatalogModelStatus {
  if (api === null || model.needsProtocolSelection === true) return "needs_protocol";
  if (model.toolCall === false) return "unsupported_tool_calling";
  return "ready";
}

export function buildModelCatalog(
  input: ModelCatalogInput,
  options: BuildModelCatalogOptions = {}
): ModelCatalogSnapshot {
  const hash = options.sha256;
  const providers = new Map(input.providers.map((provider) => [provider.providerId, provider]));
  const selectedConfiguredModelId = input.selectedConfiguredModelId ?? null;

  const models = input.models.map((model): CatalogModelEntry => {
    const provider = providers.get(model.providerId);
    const api = provider ? mapProviderProtocol(provider) : null;
    const configuredModelId =
      model.configuredModelId ?? createConfiguredModelId(model.providerId, model.upstreamModelId);
    return {
      engineId: ENGINE_ID,
      configuredModelId,
      displayName: model.displayName ?? model.upstreamModelId,
      providerDisplayName: provider?.displayName ?? model.providerId,
      providerInstanceId: model.providerId,
      upstreamModelId: model.upstreamModelId,
      api,
      baseUrl: provider?.baseUrl ?? null,
      credentialDomainId: credentialDomainId(
        model.providerId,
        api ?? "needs-protocol",
        provider?.baseUrl,
        hash
      ),
      status: statusFor(api, model),
      retained: true,
      capabilities: capabilitiesFor(model, api),
      contextWindow: model.contextWindow ?? null,
      costRates: model.costRates ?? null,
      selected: configuredModelId === selectedConfiguredModelId,
    };
  });

  return {
    engineId: ENGINE_ID,
    models,
    readyModels: models.filter((entry) => entry.status === "ready"),
    unknownConfigs: models.filter((entry) => entry.status === "needs_protocol"),
    selectedConfiguredModelId,
  };
}
