import type { CatalogProvider, Provider, ProviderType } from "@/modelManagement";
import { DECLARED_PI_PROVIDER_ENDPOINTS } from "./declaredPiProviderEndpoints.generated";

export interface ProviderCapability {
  providerType: ProviderType;
  useResponsesApi?: boolean;
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
}

export const DEFAULT_PROTOCOL_BASE_URLS = Object.freeze({
  "anthropic-messages": "https://api.anthropic.com",
  "google-generative-ai": "https://generativelanguage.googleapis.com/v1beta",
  "openai-completions": "https://api.openai.com/v1",
  "openai-responses": "https://api.openai.com/v1",
});

const NPM_PROTOCOLS: Readonly<Record<string, ProviderType>> = Object.freeze({
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/google": "google",
  "@ai-sdk/openai": "openai-compatible",
  "@ai-sdk/openai-compatible": "openai-compatible",
  "@ai-sdk/groq": "openai-compatible",
  "@ai-sdk/cerebras": "openai-compatible",
  "@ai-sdk/togetherai": "openai-compatible",
  "@ai-sdk/deepinfra": "openai-compatible",
  "@ai-sdk/xai": "openai-compatible",
  "@ai-sdk/mistral": "openai-compatible",
  "@openrouter/ai-sdk-provider": "openai-compatible",
  "@ai-sdk/gateway": "openai-compatible",
});

const UNSUPPORTED_NPM: Readonly<Record<string, string>> = Object.freeze({
  "@ai-sdk/amazon-bedrock": "Requires account-specific regional authentication",
  "@ai-sdk/azure": "Requires deployment-specific routing",
  "@ai-sdk/google-vertex": "Requires project and region authentication",
  "@ai-sdk/google-vertex/anthropic": "Requires project and region authentication",
  "watsonx-ai-provider": "Requires IAM authentication and project routing",
  "gitlab-ai-provider": "Requires GitLab-specific authentication and routing",
  "@jerome-benoit/sap-ai-provider-v2": "Requires SAP-specific authentication and routing",
  "ai-gateway-provider": "Requires Cloudflare account and gateway routing",
  "@ai-sdk/perplexity": "Native search protocol cannot be forwarded by this runtime",
  "@ai-sdk/cohere": "The native Cohere protocol is not supported",
});

// 目录里可添加、但静态 API key 无法完成鉴权的供应商：Copilot 依赖 OAuth 会话和编辑器专用头，不能降级成普通 Bearer 请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const UNSUPPORTED_CATALOG_IDS: Readonly<Record<string, string>> = Object.freeze({
  "github-copilot":
    "Requires a GitHub Copilot OAuth session and editor-specific headers; an API-key provider cannot authenticate",
});

// 这些供应商不实现 GET /models；校验时收到 404 不代表地址错误，不能据此判定配置失败。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const MODEL_LIST_UNAVAILABLE_CATALOG_IDS: ReadonlySet<string> = new Set(["oci"]);

// 供应商身份到协议端点的映射；同一个供应商可能同时提供多种协议，按 BYOK 协议取对应事实。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const PROTOCOLS_BY_PROVIDER_TYPE: Readonly<Record<ProviderType, readonly string[]>> = Object.freeze(
  {
    "openai-compatible": Object.freeze(["openai-completions", "openai-responses"]),
    anthropic: Object.freeze(["anthropic-messages"]),
    google: Object.freeze(["google-generative-ai"]),
  }
);

// 目录缺少端点时必须显式补全，避免密钥被静默发往另一服务：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const ENDPOINT_OVERRIDES: Readonly<
  Record<string, { providerType: ProviderType; baseUrl: string }>
> = Object.freeze({
  anthropic: {
    providerType: "anthropic",
    baseUrl: DEFAULT_PROTOCOL_BASE_URLS["anthropic-messages"],
  },
  openai: {
    providerType: "openai-compatible",
    baseUrl: DEFAULT_PROTOCOL_BASE_URLS["openai-completions"],
  },
  google: { providerType: "google", baseUrl: DEFAULT_PROTOCOL_BASE_URLS["google-generative-ai"] },
  groq: { providerType: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1" },
  cerebras: { providerType: "openai-compatible", baseUrl: "https://api.cerebras.ai/v1" },
  togetherai: { providerType: "openai-compatible", baseUrl: "https://api.together.ai/v1" },
  deepinfra: { providerType: "openai-compatible", baseUrl: "https://api.deepinfra.com/v1/openai" },
  xai: { providerType: "openai-compatible", baseUrl: "https://api.x.ai/v1" },
  mistral: { providerType: "openai-compatible", baseUrl: "https://api.mistral.ai/v1" },
  vercel: { providerType: "openai-compatible", baseUrl: "https://ai-gateway.vercel.sh/v1" },
  minimax: { providerType: "anthropic", baseUrl: "https://api.minimax.io/anthropic" },
  "minimax-cn": { providerType: "anthropic", baseUrl: "https://api.minimaxi.com/anthropic" },
  "minimax-coding-plan": { providerType: "anthropic", baseUrl: "https://api.minimax.io/anthropic" },
  "minimax-cn-coding-plan": {
    providerType: "anthropic",
    baseUrl: "https://api.minimax.cn/anthropic",
  },
  // 目录把协议段写进了地址（.../openai/v1），模型列表和生成请求却服务在版本段根路径；统一到实测可达的根地址。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  opencode: {
    providerType: "openai-compatible",
    baseUrl: "https://opencode.ai/inference/v1",
  },
  "opencode-go": {
    providerType: "openai-compatible",
    baseUrl: "https://opencode.ai/inference/go/v1",
  },
});

const LEGACY_ENDPOINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  minimax: ["https://api.minimax.io/anthropic/v1"],
  "minimax-cn": ["https://api.minimax.cn/anthropic/v1", "https://api.minimaxi.com/anthropic/v1"],
  "minimax-coding-plan": ["https://api.minimax.io/anthropic/v1"],
  "minimax-cn-coding-plan": ["https://api.minimax.cn/anthropic/v1"],
  anthropic: ["https://api.anthropic.com/v1"],
  opencode: ["https://opencode.ai/inference/openai/v1"],
  "opencode-go": ["https://opencode.ai/inference/go/openai/v1"],
});

/**
 * Resolve the endpoint the locked Pi SDK records for one catalog provider and BYOK protocol.
 * Used as a last-resort fallback and as a diagnostic when the catalog address fails.
 * https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
 */
export function declaredProviderEndpoint(
  catalogProviderId: string | undefined,
  providerType: ProviderType
): string | undefined {
  if (!catalogProviderId) return undefined;
  const byProtocol = DECLARED_PI_PROVIDER_ENDPOINTS[catalogProviderId];
  if (!byProtocol) return undefined;
  for (const protocol of PROTOCOLS_BY_PROVIDER_TYPE[providerType]) {
    const endpoint = byProtocol[protocol];
    if (!endpoint) continue;
    const normalized = normalizeBaseUrlForProtocol(endpoint, providerType);
    if (normalized) return normalized;
  }
  return undefined;
}

/**
 * Suggest the Pi-recorded endpoint when it disagrees with the resolved catalog address.
 * Returning the address lets the error surface the fix instead of rerouting silently.
 * https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
 */
export function declaredEndpointSuggestion(
  catalogProviderId: string | undefined,
  providerType: ProviderType,
  resolvedBaseUrl: string | undefined
): string | undefined {
  const declared = declaredProviderEndpoint(catalogProviderId, providerType);
  if (!declared) return undefined;
  if (resolvedBaseUrl) {
    const normalized = normalizeBaseUrlForProtocol(resolvedBaseUrl, providerType);
    if (normalized === declared) return undefined;
  }
  return declared;
}

/** Whether a 404 from a model-list probe reflects a missing endpoint expectation. https://github.com/ItsDalk-Lane/Vault-Agent/issues/2 */
export function isModelListUnavailableCatalogProvider(
  catalogProviderId: string | undefined
): boolean {
  return (
    catalogProviderId !== undefined && MODEL_LIST_UNAVAILABLE_CATALOG_IDS.has(catalogProviderId)
  );
}

export function normalizeBaseUrlForProtocol(
  baseUrl: string,
  providerType: ProviderType
): string | undefined {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  // 账户占位符和非法地址不能成为请求目标，避免密钥错发：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (!trimmed || /[{}$\s]|%7[bBdD]|%24/i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    if (providerType === "anthropic") return trimmed.replace(/\/v1$/, "");
    if (providerType === "openai-compatible" && (url.pathname === "/" || !url.pathname))
      return `${trimmed}/v1`;
    return trimmed;
  } catch {
    return undefined;
  }
}

export function getProviderUnsupportedReason(
  provider: Pick<CatalogProvider, "npm" | "api"> & { id?: string }
): string | undefined {
  if (provider.id && Object.hasOwn(UNSUPPORTED_CATALOG_IDS, provider.id))
    return UNSUPPORTED_CATALOG_IDS[provider.id];
  if (!provider.npm || !Object.hasOwn(NPM_PROTOCOLS, provider.npm))
    return (
      (provider.npm && Object.hasOwn(UNSUPPORTED_NPM, provider.npm)
        ? UNSUPPORTED_NPM[provider.npm]
        : undefined) ?? `Unknown npm package: ${provider.npm ?? "missing"}`
    );
  if (provider.api && !normalizeBaseUrlForProtocol(provider.api, NPM_PROTOCOLS[provider.npm]))
    return "Endpoint contains unresolved placeholders or is not a valid HTTP address";
  if (
    !provider.api &&
    (!provider.id ||
      (!Object.hasOwn(ENDPOINT_OVERRIDES, provider.id) &&
        !declaredProviderEndpoint(provider.id, NPM_PROTOCOLS[provider.npm])))
  )
    return "No resolved endpoint; use a custom provider with an explicit address";
  return undefined;
}

export function getProviderCapability(
  provider: Pick<CatalogProvider, "id" | "npm" | "api">
): ProviderCapability | null {
  // 目录身份已知无法用 API key 鉴权时直接拒绝，避免把密钥发到只接受 OAuth 的端点。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (provider.id && Object.hasOwn(UNSUPPORTED_CATALOG_IDS, provider.id)) return null;
  const providerType =
    provider.npm && Object.hasOwn(NPM_PROTOCOLS, provider.npm)
      ? NPM_PROTOCOLS[provider.npm]
      : undefined;
  // 未分类的包不能猜成 OpenAI；原型属性也不是已支持的包名：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (!providerType) return null;
  const override = Object.hasOwn(ENDPOINT_OVERRIDES, provider.id)
    ? ENDPOINT_OVERRIDES[provider.id]
    : undefined;
  if (override && override.providerType !== providerType) return null;
  // 优先级：手工修正 → 目录事实 → SDK 记录的协议端点；目录缺失时仍能得到可验证地址。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  const candidates: readonly (string | undefined)[] = [
    override?.baseUrl,
    provider.api,
    declaredProviderEndpoint(provider.id, providerType),
  ];
  let defaultBaseUrl: string | undefined;
  for (const candidate of candidates) {
    if (!candidate) continue;
    defaultBaseUrl = normalizeBaseUrlForProtocol(candidate, providerType);
    if (defaultBaseUrl) break;
  }
  // 目录入口只展示已有可解析地址的服务；其他地址通过自定义入口填写：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (!defaultBaseUrl) return null;
  const hostname = new URL(defaultBaseUrl).hostname;
  return {
    providerType,
    defaultBaseUrl,
    requiresApiKey: !["localhost", "127.0.0.1", "[::1]"].includes(hostname),
  };
}

export function resolveProviderBaseUrl(
  provider: Pick<Provider, "providerType" | "baseUrl" | "origin">,
  capability?: ProviderCapability | null
): string | undefined {
  const catalogId = provider.origin.kind === "byok" ? provider.origin.catalogProviderId : undefined;
  const override =
    catalogId && Object.hasOwn(ENDPOINT_OVERRIDES, catalogId)
      ? ENDPOINT_OVERRIDES[catalogId]
      : undefined;
  const saved = provider.baseUrl?.trim();
  // 用户自填地址必须保留，仅修正能精确识别的历史错误默认值：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (saved) {
    if (!normalizeBaseUrlForProtocol(saved, provider.providerType)) return undefined;
    if (
      override?.providerType === provider.providerType &&
      catalogId &&
      LEGACY_ENDPOINTS[catalogId]?.includes(saved)
    )
      return override.baseUrl;
    return saved;
  }
  if (override?.providerType === provider.providerType) return override.baseUrl;
  // 缺少目录地址的旧行也要落到 SDK 记录的同协议端点，而不是静默回退协议默认主机。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  const declared = declaredProviderEndpoint(catalogId, provider.providerType);
  if (declared) return declared;
  // 只有同协议的目录事实才能补旧空地址，离线时缺少事实就保持不可用：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (capability?.providerType === provider.providerType && capability.defaultBaseUrl) {
    return normalizeBaseUrlForProtocol(capability.defaultBaseUrl, provider.providerType);
  }
  return undefined;
}
