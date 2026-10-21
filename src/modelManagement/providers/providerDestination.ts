import type { Destination } from "@/types/destination";
import type { Provider } from "@/modelManagement/types/persisted";

import { isLoopbackUrl, isSelfHostedUrl } from "./isSelfHostedProvider";
import { t } from "@/i18n";

export function urlDestination(baseUrl: string | undefined, cloudLabel: string): Destination {
  if (!isSelfHostedUrl(baseUrl)) return { kind: "cloud", label: cloudLabel };
  return {
    kind: "local",
    label: isLoopbackUrl(baseUrl) ? t("ui.model.dest.local") : t("ui.model.dest.network"),
  };
}

export function providerDestination(provider: Provider): Destination {
  return urlDestination(provider.baseUrl, provider.displayName);
}
