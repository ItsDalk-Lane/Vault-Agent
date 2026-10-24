import type { ModelEnableGroup, ModelEnableRow } from "@/components/ui/ModelEnableList";
import {
  providerDestination,
  isProviderEnabled,
  capabilitiesFromConfiguredInfo,
  type ConfiguredModel,
  type Provider,
} from "@/modelManagement";

export interface Candidate {
  configuredModel: ConfiguredModel;
  provider: Provider;
  enabled: boolean;
}

export function collectChatCandidates(
  configuredModels: readonly ConfiguredModel[],
  providers: Readonly<Record<string, Provider>>,
  enabledIds: ReadonlySet<string>
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const configuredModel of configuredModels) {
    if (configuredModel.info.isEmbedding) continue;
    const provider = providers[configuredModel.providerId];
    if (!provider || !isProviderEnabled(provider)) continue;
    // 只展示当前可配置来源，磁盘中不受支持的记录不能成为模型选项。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    if (provider.origin.kind !== "byok") continue;
    candidates.push({
      configuredModel,
      provider,
      enabled: enabledIds.has(configuredModel.configuredModelId),
    });
  }
  return candidates;
}

export function toRow(candidate: Candidate): ModelEnableRow {
  const { configuredModel, enabled } = candidate;
  const { displayName, id, description } = configuredModel.info;
  return {
    id: configuredModel.configuredModelId,
    label: displayName || id,
    description: description || undefined,
    wireId: id,
    enabled,
    capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
  };
}

export function rowMatches(row: ModelEnableRow, q: string): boolean {
  if (!q) return true;
  return (
    row.label.toLowerCase().includes(q) ||
    row.id.toLowerCase().includes(q) ||
    (row.wireId?.toLowerCase().includes(q) ?? false) ||
    (row.description?.toLowerCase().includes(q) ?? false)
  );
}

export function buildModelEnableGroups(
  candidates: readonly Candidate[],
  query: string
): ModelEnableGroup[] {
  const q = query.trim().toLowerCase();
  const byProvider = new Map<string, ModelEnableGroup>();
  for (const candidate of candidates) {
    const row = toRow(candidate);
    if (!rowMatches(row, q)) continue;
    const { provider } = candidate;
    const bucket = byProvider.get(provider.providerId);
    if (bucket) bucket.rows.push(row);
    else
      byProvider.set(provider.providerId, {
        key: `byok:${provider.providerId}`,
        label: provider.displayName,
        destination: providerDestination(provider),
        rows: [row],
      });
  }
  return [...byProvider.values()];
}
