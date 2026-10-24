import { t } from "@/i18n";
import {
  declaredEndpointSuggestion,
  isModelListUnavailableCatalogProvider,
} from "@/modelManagement/catalog/providerCapability";
import type { ProviderType } from "@/modelManagement/types/catalog";

export interface ListModelsFailureContext {
  readonly status: number | undefined;
  readonly url: string;
  readonly baseUrl: string;
  readonly providerType: ProviderType;
  readonly catalogProviderId: string | undefined;
}

export type ListModelsFailureKind = "message" | "stale-address" | "model-list-unavailable";

export interface ListModelsFailure {
  readonly kind: ListModelsFailureKind;
  readonly message: string;
}

/**
 * Turn a failed model-list probe into an actionable message.
 * A bare status number cannot tell a stale catalog address from a service without
 * a model-list endpoint, so the 404 path names the URL and the recorded endpoint.
 * https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
 */
export function describeListModelsFailure(
  context: ListModelsFailureContext,
  fallbackMessage: string
): ListModelsFailure {
  if (context.status !== 404) return { kind: "message", message: fallbackMessage };
  if (isModelListUnavailableCatalogProvider(context.catalogProviderId)) {
    return {
      kind: "model-list-unavailable",
      message: t("ui.model.err.modelListUnavailable", {
        status: context.status,
        url: context.url,
      }),
    };
  }
  // 目录地址与 SDK 记录的端点不一致时直接给出可粘贴的修复地址，不静默改道。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  const suggestion = declaredEndpointSuggestion(
    context.catalogProviderId,
    context.providerType,
    context.baseUrl
  );
  if (suggestion) {
    return {
      kind: "stale-address",
      message: t("ui.model.err.staleCatalogEndpoint", {
        status: context.status,
        url: context.url,
        endpoint: suggestion,
      }),
    };
  }
  return {
    kind: "message",
    message: t("ui.model.err.httpAtUrl", { status: context.status, url: context.url }),
  };
}
