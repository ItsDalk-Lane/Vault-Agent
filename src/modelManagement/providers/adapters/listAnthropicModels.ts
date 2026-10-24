import {
  fetchWithListModelsTimeout,
  parseModelListResponse,
  type ListModelsResult,
} from "./listModelsHttp";
import { describeListModelsFailure } from "./listModelsFailure";
import { t } from "@/i18n";

const ANTHROPIC_VERSION = "2023-06-01";

export interface ListAnthropicModelsOptions {
  apiKey?: string | null;
  timeoutMs?: number;
  catalogProviderId?: string;
}

export async function listAnthropicModels(
  baseUrl: string,
  opts: ListAnthropicModelsOptions = {}
): Promise<ListModelsResult> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { ok: false, message: t("ui.model.err.baseUrlRequired") };
  }
  const base = trimmed.replace(/\/$/, "").replace(/\/v1$/, "");

  const headers: Record<string, string> = {
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;

  try {
    const url = `${base}/v1/models`;
    const response = await fetchWithListModelsTimeout(
      url,
      { method: "GET", headers },
      opts.timeoutMs
    );
    const result = await parseModelListResponse(response, { listKey: "data", idKey: "id" });
    if (result.ok) return result;
    const failure = describeListModelsFailure(
      {
        status: result.status,
        url,
        baseUrl: base,
        providerType: "anthropic",
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
