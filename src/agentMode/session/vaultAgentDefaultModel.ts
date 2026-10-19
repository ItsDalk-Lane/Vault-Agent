import type { BackendDescriptor, BackendId } from "./types";
import { type VaultAgentSettings, getSettings, setSettings } from "@/settings/model";

export function seedVaultAgentDefaultModel(
  descriptors: readonly BackendDescriptor[],
  configuredModelId: string
): BackendId[] {
  const settings = getSettings();
  const targets = new Map<BackendId, string>();
  for (const descriptor of descriptors) {
    const baseModelId = descriptor.getWireBaseId?.(configuredModelId, settings) ?? null;
    if (baseModelId) targets.set(descriptor.id, baseModelId);
  }
  if (targets.size === 0) return [];

  setSettings((cur: VaultAgentSettings) => {
    const backends = { ...cur.agentMode.backends } as Record<
      string,
      Record<string, unknown> | undefined
    >;
    for (const [backendId, baseModelId] of targets) {
      backends[backendId] = {
        ...(backends[backendId] ?? {}),
        defaultModel: { baseModelId, effort: null },
      };
    }
    return { agentMode: { ...cur.agentMode, backends } };
  });
  return [...targets.keys()];
}
