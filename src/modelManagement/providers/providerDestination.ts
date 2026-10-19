import type { Destination } from "@/types/destination";
import type { Provider } from "@/modelManagement/types/persisted";

import { isLoopbackUrl, isSelfHostedUrl } from "./isSelfHostedProvider";

export function urlDestination(baseUrl: string | undefined, cloudLabel: string): Destination {
  if (!isSelfHostedUrl(baseUrl)) return { kind: "cloud", label: cloudLabel };
  return {
    kind: "local",
    label: isLoopbackUrl(baseUrl) ? "A server on this computer" : "A server on your local network",
  };
}

export function providerDestination(provider: Provider): Destination {
  return urlDestination(provider.baseUrl, provider.displayName);
}
