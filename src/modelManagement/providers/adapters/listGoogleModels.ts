import {
  fetchWithListModelsTimeout,
  parseModelListResponse,
  type ListModelsResult,
} from "./listModelsHttp";
import { describeListModelsFailure } from "./listModelsFailure";
import { t } from "@/i18n";

const MODEL_PREFIX = "models/";

export interface ListGoogleModelsOptions {
  apiKey?: string | null;
  timeoutMs?: number;
  catalogProviderId?: string;
}

export async function listGoogleModels(
  baseUrl: string,
  opts: ListGoogleModelsOptions = {}
): Promise<ListModelsResult> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { ok: false, message: t("ui.model.err.baseUrlRequired") };
  }
  const base = trimmed.replace(/\/$/, "").replace(/\/v1(beta)?$/, "");

  const query = opts.apiKey ? `?key=${encodeURIComponent(opts.apiKey)}` : "";
  const url = `${base}/v1beta/models${query}`;

  try {
    const response = await fetchWithListModelsTimeout(
      url,
      { method: "GET", headers: {} },
      opts.timeoutMs
    );
    const result = await parseModelListResponse(response, {
      listKey: "models",
      idKey: "name",
      normalizeId: (id) => (id.startsWith(MODEL_PREFIX) ? id.slice(MODEL_PREFIX.length) : id),
    });
    if (result.ok) return result;
    // 诊断信息里保留不带密钥参数的地址，避免把 API key 写进错误提示。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    const failure = describeListModelsFailure(
      {
        status: result.status,
        url: `${base}/v1beta/models`,
        baseUrl: base,
        providerType: "google",
        catalogProviderId: opts.catalogProviderId,
      },
      result.message
    );
    return result.status === undefined
      ? { ok: false, message: failure.message }
      : { ok: false, message: failure.message, status: result.status };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
