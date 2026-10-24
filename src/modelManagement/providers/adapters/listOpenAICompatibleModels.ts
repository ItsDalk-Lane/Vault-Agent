import {
  fetchWithListModelsTimeout,
  parseModelListResponse,
  type ListModelsResponseResult,
  type ListModelsResult,
} from "./listModelsHttp";
import { describeListModelsFailure } from "./listModelsFailure";
import { t } from "@/i18n";

export type { ListModelsResult } from "./listModelsHttp";

export interface ListOpenAICompatibleModelsOptions {
  apiKey?: string | null;
  openAIOrgId?: string;
  timeoutMs?: number;
  catalogProviderId?: string;
}

export async function listOpenAICompatibleModels(
  baseUrl: string,
  opts: ListOpenAICompatibleModelsOptions = {}
): Promise<ListModelsResult> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { ok: false, message: t("ui.model.err.baseUrlRequired") };
  }
  const base = trimmed.replace(/\/$/, "");

  const headers: Record<string, string> = {};
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
  if (opts.openAIOrgId) headers["OpenAI-Organization"] = opts.openAIOrgId;

  const result = await attempt(base, headers, opts.timeoutMs);
  if (result.ok) return { ok: true, modelIds: result.modelIds };

  const url = `${base}/models`;
  const failure = describeListModelsFailure(
    {
      status: result.status,
      url,
      baseUrl: base,
      providerType: "openai-compatible",
      catalogProviderId: opts.catalogProviderId,
    },
    result.message
  );
  const looksLikeMissingV1 =
    result.status === 404 && failure.kind === "message" && !/\/v1(\/|$)/.test(base);
  const message = looksLikeMissingV1
    ? t("ui.model.err.addV1Hint", { message: failure.message })
    : failure.message;
  return result.status === undefined
    ? { ok: false, message }
    : { ok: false, message, status: result.status };
}

async function attempt(
  base: string,
  headers: Record<string, string>,
  timeoutMs?: number
): Promise<ListModelsResponseResult> {
  try {
    const response = await fetchWithListModelsTimeout(
      `${base}/models`,
      { method: "GET", headers },
      timeoutMs
    );
    return await parseModelListResponse(response, { listKey: "data", idKey: "id" });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
