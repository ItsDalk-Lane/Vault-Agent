import * as z from "zod";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { describeListModelsFailure } from "./listModelsFailure";
import { verifyPathForCatalogProviderId } from "./openaiCompatibleVerifyPath";
import { verifyViaListModels } from "./verifyViaListModels";
import { t } from "@/i18n";

const extrasSchema = z
  .object({
    openAIOrgId: z.string().optional(),
    // Responses 是运行时的格式选择；获取模型列表时只验证并保留该配置：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    useResponsesApi: z.boolean().optional(),
  })
  .strict();

type Extras = z.infer<typeof extrasSchema>;

export const openaiCompatibleAdapter: ProviderAdapter<Extras> = {
  providerType: "openai-compatible",
  extrasSchema,

  async verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    const baseUrl = ctx.provider.baseUrl?.trim();
    if (!baseUrl) {
      return {
        ok: false,
        code: "missing_base_url",
        message: t("ui.model.err.openaiBaseUrlRequired"),
        checkedAt: Date.now(),
      };
    }
    const base = baseUrl.replace(/\/$/, "");

    const headers: Record<string, string> = {};
    if (ctx.apiKey) {
      headers["Authorization"] = `Bearer ${ctx.apiKey}`;
    }
    if (ctx.extras.openAIOrgId) {
      headers["OpenAI-Organization"] = ctx.extras.openAIOrgId;
    }

    const catalogProviderId =
      ctx.provider.origin.kind === "byok" ? ctx.provider.origin.catalogProviderId : undefined;
    const verifyPath = verifyPathForCatalogProviderId(catalogProviderId);
    const url = `${base}/${verifyPath}`;
    const result = await verifyViaListModels(url, headers);
    if (result.ok || result.status !== 404) return result;
    // 404 时说明请求的地址，并给出 SDK 记录的端点，避免只抛出无法定位的 HTTP 状态。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    const failure = describeListModelsFailure(
      {
        status: result.status,
        url,
        baseUrl: base,
        providerType: "openai-compatible",
        catalogProviderId,
      },
      result.message ?? ""
    );
    return { ...result, message: failure.message };
  },
};
