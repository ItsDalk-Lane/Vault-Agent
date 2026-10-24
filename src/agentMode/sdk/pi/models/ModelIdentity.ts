import { requireNodeModule } from "@/utils/desktopRuntime";

// The engine, the provider instance and the model key are three different identities:
// `pi` is the only engine, a provider instance is one configured endpoint, and a model key
// is a saved selection; credential domains follow the instance and endpoint fingerprints:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const ENGINE_ID = "pi" as const;

export type EngineId = typeof ENGINE_ID;

export type ProtocolApi =
  | "anthropic-messages"
  | "openai-responses"
  | "openai-completions"
  | "google-generative-ai";

export const SUPPORTED_PROTOCOLS: readonly ProtocolApi[] = Object.freeze([
  "anthropic-messages",
  "openai-responses",
  "openai-completions",
  "google-generative-ai",
]);

export type EndpointHash = (input: string) => string;

export interface ConfiguredModelParts {
  readonly providerInstanceId: string;
  readonly upstreamModelId: string;
}

export type ModelIdentityErrorCode = "INVALID_PROVIDER_INSTANCE" | "INVALID_MODEL_KEY";

export class ModelIdentityError extends Error {
  readonly code: ModelIdentityErrorCode;

  constructor(code: ModelIdentityErrorCode, message: string) {
    super(message);
    this.name = "ModelIdentityError";
    this.code = code;
  }
}

const PROVIDER_INSTANCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertProviderInstanceId(providerInstanceId: string): string {
  if (!PROVIDER_INSTANCE_PATTERN.test(providerInstanceId)) {
    throw new ModelIdentityError(
      "INVALID_PROVIDER_INSTANCE",
      `The provider instance id is not usable as an identity: ${providerInstanceId}`
    );
  }
  return providerInstanceId;
}

export function createConfiguredModelId(
  providerInstanceId: string,
  upstreamModelId: string
): string {
  const provider = assertProviderInstanceId(providerInstanceId);
  if (upstreamModelId.trim().length === 0) {
    throw new ModelIdentityError("INVALID_MODEL_KEY", "The upstream model id is empty.");
  }
  return `${provider}:${encodeURIComponent(upstreamModelId)}`;
}

export function parseConfiguredModelId(configuredModelId: string): ConfiguredModelParts | null {
  const separator = configuredModelId.indexOf(":");
  if (separator <= 0 || separator === configuredModelId.length - 1) return null;
  const providerInstanceId = configuredModelId.slice(0, separator);
  if (!PROVIDER_INSTANCE_PATTERN.test(providerInstanceId)) return null;
  let upstreamModelId: string;
  try {
    upstreamModelId = decodeURIComponent(configuredModelId.slice(separator + 1));
  } catch {
    return null;
  }
  return upstreamModelId.length === 0 ? null : { providerInstanceId, upstreamModelId };
}

export function normalizeEndpoint(api: string, baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return `${api}|`;
  let normalized = trimmed;
  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    normalized = url.toString().replace(/\/+$/, "");
  } catch {
    normalized = trimmed.replace(/^(HTTPS?):\/\//i, (_match, scheme: string) => `${scheme}://`);
  }
  return `${api}|${normalized}`;
}

function defaultSha256(input: string): string {
  const crypto = requireNodeModule<typeof import("node:crypto")>("node:crypto");
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function credentialDomainId(
  providerInstanceId: string,
  api: string,
  baseUrl: string | undefined,
  hash: EndpointHash = defaultSha256
): string {
  const provider = assertProviderInstanceId(providerInstanceId);
  const digest = hash(`${provider}|${normalizeEndpoint(api, baseUrl)}`);
  return `pi-cred-${digest.slice(0, 16)}`;
}
