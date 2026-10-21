import {
  mapProviderToOpencodeId,
  ModelEnableList,
  type BackendDescriptor,
  type ModelEnableGroup,
} from "@/agentMode";
import { t } from "@/i18n";
import { logError } from "@/logger";
import {
  backendsAtom,
  configuredModelsAtom,
  providersAtom,
  useModelManagement,
  type AgentType,
} from "@/modelManagement";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import React from "react";
import { buildModelEnableGroups, partitionCandidates } from "./configuredModelGrouping";

interface ConfiguredModelEnableListProps {
  descriptor: BackendDescriptor;
}

const EMPTY_ENABLED: readonly string[] = Object.freeze([]);

const isOpencodeRoutableProvider = (
  provider: Parameters<typeof mapProviderToOpencodeId>[0]
): boolean => mapProviderToOpencodeId(provider) !== null;

export const ConfiguredModelEnableList: React.FC<ConfiguredModelEnableListProps> = ({
  descriptor,
}) => {
  const api = useModelManagement();
  const agentType = descriptor.id as AgentType;

  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });
  const providers = useAtomValue(providersAtom, { store: settingsStore });
  const backends = useAtomValue(backendsAtom, { store: settingsStore });

  const [query, setQuery] = React.useState("");

  const enabledIds = React.useMemo(() => {
    const list = backends[agentType]?.enabledModels ?? EMPTY_ENABLED;
    return new Set(list);
  }, [backends, agentType]);

  const isOpencode = descriptor.id === "opencode";

  const partition = React.useMemo(
    () =>
      partitionCandidates(
        configuredModels,
        providers,
        enabledIds,
        agentType,
        isOpencode,
        isOpencodeRoutableProvider
      ),
    [configuredModels, providers, enabledIds, agentType, isOpencode]
  );

  const groups = React.useMemo<ModelEnableGroup[]>(
    () => buildModelEnableGroups(partition, isOpencode, query),
    [partition, isOpencode, query]
  );

  const handleToggle = React.useCallback(
    (id: string, enabled: boolean) => {
      const run = enabled
        ? api.backendConfigRegistry.enableModel(agentType, id)
        : api.backendConfigRegistry.disableModel(agentType, id);
      run.catch((err) => logError(`[AgentMode] toggle model ${id} for ${agentType} failed`, err));
    },
    [api, agentType]
  );

  const emptyState =
    descriptor.id === "opencode" ? (
      <span>
        {t("settings.models.emptyPrefix")}{" "}
        <span className="tw-font-medium">{t("settings.models.byokTab")}</span>{" "}
        {t("settings.models.emptyOpencodeSuffix")}
      </span>
    ) : (
      <span>{t("settings.models.emptyBackend", { backend: descriptor.displayName })}</span>
    );

  return (
    <ModelEnableList
      groups={groups}
      onToggle={handleToggle}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder={t("settings.models.searchPlaceholder", {
        backend: descriptor.displayName,
      })}
      emptyState={emptyState}
      defaultOpenGroupKey={groups[0]?.key}
    />
  );
};
