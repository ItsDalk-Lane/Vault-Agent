import type { VerificationResult } from "@/modelManagement/types/runtime";
import { t } from "@/i18n";
import {
  fetchWithListModelsTimeout,
  ListModelsTimeoutError,
  readBodySnippet,
} from "./listModelsHttp";

export interface VerifyViaListModelsOptions {
  timeoutMs?: number;
}

export async function verifyViaListModels(
  url: string,
  headers: Record<string, string>,
  opts: VerifyViaListModelsOptions = {}
): Promise<VerificationResult> {
  try {
    const response = await fetchWithListModelsTimeout(
      url,
      { method: "GET", headers },
      opts.timeoutMs
    );
    return await mapResponse(response);
  } catch (err) {
    return {
      ok: false,
      code: err instanceof ListModelsTimeoutError ? "timeout" : "network",
      message: err instanceof Error ? err.message : String(err),
      checkedAt: Date.now(),
    };
  }
}

async function mapResponse(response: Response): Promise<VerificationResult> {
  const { status } = response;
  const checkedAt = Date.now();
  if (status >= 200 && status < 300) {
    return { ok: true, checkedAt };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: "invalid_api_key",
      message: t("ui.model.err.authentication"),
      status,
      checkedAt,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      message: t("ui.model.err.rateLimited"),
      status,
      checkedAt,
    };
  }
  const snippet = await readBodySnippet(response);
  return {
    ok: false,
    code: "http_error",
    message: snippet
      ? t("ui.model.err.httpWithSnippet", { status, snippet })
      : t("ui.model.err.http", { status }),
    status,
    checkedAt,
  };
}
