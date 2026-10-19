import React from "react";
import { backendNeedsSelfHostWarning, listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentBrand } from "@/agentMode/session/types";
import type VaultAgentPlugin from "@/main";
import { useSettingsValue, type VaultAgentSettings } from "@/settings/model";

export { EMPTY_ANSWERERS, isFanout, resolveAnswerers } from "@/agentMode/session/fanout/answerers";

export const EMPTY_AGENT_BRANDS: ReadonlyArray<AgentBrand> = Object.freeze([]);

export function listInstalledAgentBrands(settings: VaultAgentSettings): ReadonlyArray<AgentBrand> {
  const brands = listBackendDescriptors()
    .filter((descriptor) => descriptor.getInstallState(settings).kind === "ready")
    .map(
      (descriptor) =>
        ({
          id: descriptor.id,
          displayName: descriptor.displayName,
          Icon: descriptor.Icon,
          needsSelfHostWarning: backendNeedsSelfHostWarning(descriptor, settings),
        }) satisfies AgentBrand
    );
  return brands.length > 0 ? brands : EMPTY_AGENT_BRANDS;
}

export function useInstalledAgentBrands(plugin: VaultAgentPlugin): ReadonlyArray<AgentBrand> {
  const settings = useSettingsValue();
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const unsubs = listBackendDescriptors().map((descriptor) =>
        descriptor.subscribeInstallState(plugin, listener)
      );
      return () => unsubs.forEach((unsub) => unsub());
    },
    [plugin]
  );
  const getSnapshot = React.useCallback(
    () =>
      listBackendDescriptors()
        .filter((descriptor) => descriptor.getInstallState(settings).kind === "ready")
        .map((descriptor) => descriptor.id)
        .join(","),
    [settings]
  );
  const readyIds = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    void readyIds;
    return listInstalledAgentBrands(settings);
  }, [settings, readyIds]);
}
