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

// 供应商身份到协议端点的映射；同一个供应商可能同时提供多种协议，按 BYOK 协议取对应事实。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const PROTOCOLS_BY_PROVIDER_TYPE: Readonly<Record<ProviderType, readonly string[]>> = Object.freeze(
  {
    "openai-compatible": Object.freeze(["openai-completions", "openai-responses"]),
    anthropic: Object.freeze(["anthropic-messages"]),
    google: Object.freeze(["google-generative-ai"]),
  }
);

// 同一供应商可提供多种协议；缺省地址仍以锁定 SDK 的对应协议为准。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
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

export function getProviderCapability(
  provider: Pick<CatalogProvider, "providerType" | "defaultBaseUrl" | "useResponsesApi">
): ProviderCapability | null {
  // 内置目录只暴露已支持且地址完整的协议，避免把占位符作为密钥接收方。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  const providerType = provider.providerType;
  if (!providerType || !["anthropic", "google", "openai-compatible"].includes(providerType))
    return null;
  const defaultBaseUrl = normalizeBaseUrlForProtocol(provider.defaultBaseUrl ?? "", providerType);
  if (!defaultBaseUrl) return null;
  const hostname = new URL(defaultBaseUrl).hostname;
  return {
    providerType,
    defaultBaseUrl,
    ...(provider.useResponsesApi ? { useResponsesApi: true } : {}),
    requiresApiKey: !["localhost", "127.0.0.1", "[::1]"].includes(hostname),
  };
}

export function resolveProviderBaseUrl(
  provider: Pick<Provider, "providerType" | "baseUrl" | "origin">,
  capability?: ProviderCapability | null
): string | undefined {
  const saved = provider.baseUrl?.trim();
  // 用户地址决定凭据的接收方，不能按目录或历史默认值静默改道。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (saved) return normalizeBaseUrlForProtocol(saved, provider.providerType) ? saved : undefined;
  const catalogId = provider.origin.kind === "byok" ? provider.origin.catalogProviderId : undefined;
  const declared = declaredProviderEndpoint(catalogId, provider.providerType);
  if (declared) return declared;
  if (capability?.providerType === provider.providerType && capability.defaultBaseUrl) {
    return normalizeBaseUrlForProtocol(capability.defaultBaseUrl, provider.providerType);
  }
  return undefined;
}
