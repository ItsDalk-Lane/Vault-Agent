import * as z from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyViaListModels } from "./verifyViaListModels";
import { t } from "@/i18n";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

const extrasSchema = z.object({}).strict();

type Extras = z.infer<typeof extrasSchema>;

export const googleAdapter: ProviderAdapter<Extras> = {
  providerType: "google",
  extrasSchema,

  buildLangChainClient(ctx: AdapterBuildContext<Extras>): BaseChatModel {
    throw new Error("[modelManagement] googleAdapter.buildLangChainClient not implemented yet");
  },

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
    const base = (trimmedBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    return verifyViaListModels(`${base}/v1beta/models?key=${encodeURIComponent(ctx.apiKey)}`, {});
  },
};
