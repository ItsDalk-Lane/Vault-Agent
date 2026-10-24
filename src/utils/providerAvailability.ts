import type { Provider } from "@/modelManagement";

export function isProviderEnabled(provider: Pick<Provider, "enabled">): boolean {
  return provider.enabled !== false;
}
