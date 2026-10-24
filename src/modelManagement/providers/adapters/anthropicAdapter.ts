import * as z from "zod";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { describeListModelsFailure } from "./listModelsFailure";
import { verifyViaListModels } from "./verifyViaListModels";
import { t } from "@/i18n";

import { DEFAULT_PROTOCOL_BASE_URLS } from "@/modelManagement/catalog/providerCapability";
const ANTHROPIC_VERSION = "2023-06-01";

// API 格式选择保存在共享配置中，密钥校验必须接受它而不把它作为请求参数：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const extrasSchema = z.object({ useResponsesApi: z.boolean().optional() }).strict();

type Extras = z.infer<typeof extrasSchema>;

export const anthropicAdapter: ProviderAdapter<Extras> = {
  providerType: "anthropic",
  extrasSchema,

  async verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    if (!ctx.apiKey) {
      return {
        ok: false,
        code: "missing_api_key",
        message: t("ui.model.err.anthropicKeyRequired"),
        checkedAt: Date.now(),
      };
    }
    const trimmedBaseUrl = ctx.provider.baseUrl?.trim();
    const base = (trimmedBaseUrl || DEFAULT_PROTOCOL_BASE_URLS["anthropic-messages"]).replace(
      /\/$/,
      ""
    );
    const catalogProviderId =
      ctx.provider.origin.kind === "byok" ? ctx.provider.origin.catalogProviderId : undefined;
    const url = `${base}/v1/models`;
    const result = await verifyViaListModels(url, {
      "x-api-key": ctx.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    });
    if (result.ok || result.status !== 404) return result;
    // 404 时说明请求的地址，并给出 SDK 记录的端点，避免只抛出无法定位的 HTTP 状态。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    const failure = describeListModelsFailure(
      {
        status: result.status,
        url,
        baseUrl: base,
        providerType: "anthropic",
        catalogProviderId,
      },
      result.message ?? ""
    );
    return { ...result, message: failure.message };
  },
};
