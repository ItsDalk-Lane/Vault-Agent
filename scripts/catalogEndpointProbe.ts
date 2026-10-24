// 目录端点漂移探针：用插件真实的支持规则探测 models.dev 地址是否仍服务模型列表；只读，不发送任何凭据。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
import type { ProviderCapability } from "@/utils/providerCapability";
import {
  getProviderCapability,
  isModelListUnavailableCatalogProvider,
} from "@/utils/providerCapability";

const MODELS_DEV_URL = "https://models.dev/api.json";
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_CONCURRENCY = 12;

export interface ProbeAttempt {
  readonly id: string;
  readonly url: string;
  readonly status: number | null;
}

export type ProbeClass = "public" | "auth-gated" | "drift" | "model-list-unavailable" | "unknown";

export interface CatalogProbeReport {
  readonly providers: number;
  readonly publicLists: readonly ProbeAttempt[];
  readonly authGated: readonly ProbeAttempt[];
  readonly drift: readonly ProbeAttempt[];
  readonly modelListUnavailable: readonly ProbeAttempt[];
  readonly unknown: readonly ProbeAttempt[];
}

export function catalogProbeUrl(capability: ProviderCapability): string | undefined {
  const base = capability.defaultBaseUrl;
  if (!base) return undefined;
  if (capability.providerType === "anthropic") return `${base}/v1/models`;
  if (capability.providerType === "google")
    return `${base.replace(/\/v1(beta)?$/, "")}/v1beta/models`;
  return `${base}/models`;
}

export function classifyProbeStatus(status: number | null): ProbeClass {
  if (status === 404) return "drift";
  if (status === 200) return "public";
  if (status === 401 || status === 403) return "auth-gated";
  return "unknown";
}

export function classifyProbeAttempt(attempt: ProbeAttempt): ProbeClass {
  if (attempt.status === 404 && isModelListUnavailableCatalogProvider(attempt.id))
    return "model-list-unavailable";
  return classifyProbeStatus(attempt.status);
}

async function probedStatus(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return null;
  }
}

interface WireProvider {
  readonly npm?: string;
  readonly api?: string;
}

export async function probeCatalogEndpoints(): Promise<CatalogProbeReport> {
  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) throw new Error(`models.dev responded with status ${response.status}`);
  const catalog = (await response.json()) as Record<string, WireProvider>;
  const targets: { id: string; url: string }[] = [];
  for (const [id, provider] of Object.entries(catalog)) {
    const capability = getProviderCapability({ id, npm: provider.npm, api: provider.api });
    if (!capability) continue;
    const url = catalogProbeUrl(capability);
    if (url) targets.push({ id, url });
  }
  const attempts: ProbeAttempt[] = [];
  for (let index = 0; index < targets.length; index += PROBE_CONCURRENCY) {
    const batch = targets.slice(index, index + PROBE_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (target) => ({ ...target, status: await probedStatus(target.url) }))
    );
    attempts.push(...settled);
  }
  const group = (kind: ProbeClass): readonly ProbeAttempt[] =>
    attempts.filter((attempt) => classifyProbeAttempt(attempt) === kind);
  return {
    providers: Object.keys(catalog).length,
    publicLists: group("public"),
    authGated: group("auth-gated"),
    drift: group("drift"),
    modelListUnavailable: group("model-list-unavailable"),
    unknown: group("unknown"),
  };
}
