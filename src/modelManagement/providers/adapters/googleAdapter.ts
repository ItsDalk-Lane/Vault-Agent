import * as z from "zod";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyViaListModels } from "./verifyViaListModels";
import { t } from "@/i18n";

import { DEFAULT_PROTOCOL_BASE_URLS } from "@/modelManagement/catalog/providerCapability";

// API 格式选择保存在共享配置中，密钥校验必须接受它而不把它作为请求参数：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const extrasSchema = z.object({ useResponsesApi: z.boolean().optional() }).strict();

type Extras = z.infer<typeof extrasSchema>;

export const googleAdapter: ProviderAdapter<Extras> = {
  providerType: "google",
  extrasSchema,

  verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    if (!ctx.apiKey) {
      return Promise.resolve({
        ok: false,
        code: "missing_api_key",
        message: t("ui.model.err.googleKeyRequired"),
        checkedAt: Date.now(),
      });
    }
    const trimmedBaseUrl = ctx.provider.baseUrl?.trim();
    // 策略端点已含版本时不能再重复拼接，否则密钥校验会请求不存在的地址：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    const base = (trimmedBaseUrl || DEFAULT_PROTOCOL_BASE_URLS["google-generative-ai"])
      .replace(/\/$/, "")
      .replace(/\/v1(beta)?$/, "");
    return verifyViaListModels(`${base}/v1beta/models?key=${encodeURIComponent(ctx.apiKey)}`, {});
  },
};
