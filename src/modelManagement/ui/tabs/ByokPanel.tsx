import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/SearchBar";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { t } from "@/i18n";
import { isProviderEnabled } from "@/modelManagement/providers/providerAvailability";
import {
  CUSTOM_OPENAI_DEFINITION,
  LOCAL_PROVIDER_DEFINITIONS,
} from "@/modelManagement/catalog/builtinDefinitions";
import { byokProvidersAtom, configuredModelsAtom } from "@/modelManagement/state/atoms";
import type { ConfiguredModel } from "@/modelManagement/types/persisted";
import { useModelManagement } from "@/modelManagement/ui/ModelManagementContext";
import {
  ByokGlobalTable,
  type ByokTableGroup,
} from "@/modelManagement/ui/components/ByokGlobalTable";
import { AddProviderModal } from "@/modelManagement/ui/dialogs/AddProviderDialog";
import { ConfigureProviderModal } from "@/modelManagement/ui/dialogs/ConfigureProviderDialog";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react";
import { Notice } from "obsidian";
import React, { useMemo, useState } from "react";

const EMPTY_MODELS: readonly ConfiguredModel[] = Object.freeze([]);

export const ByokPanel: React.FC = () => {
  const api = useModelManagement();
  const app = useApp();

  const providers = useAtomValue(byokProvidersAtom, { store: settingsStore });
  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });

  const catalogProviders = api.catalogService.getAllProviders();
  const [query, setQuery] = useState("");

  const groups = useMemo<ByokTableGroup[]>(() => {
    const byProvider = new Map<string, ConfiguredModel[]>();
    for (const model of configuredModels) {
      const provider = providers.find((candidate) => candidate.providerId === model.providerId);
      if (!provider || !isProviderEnabled(provider)) continue;
      const list = byProvider.get(model.providerId);
      if (list) list.push(model);
      else byProvider.set(model.providerId, [model]);
    }
    const q = query.trim().toLowerCase();
    return providers
      .map((provider) => {
        const all = byProvider.get(provider.providerId) ?? (EMPTY_MODELS as ConfiguredModel[]);
        if (!q || provider.displayName.toLowerCase().includes(q)) {
          return { provider, models: all };
        }
        const models = all.filter(
          (m) => m.info.displayName.toLowerCase().includes(q) || m.info.id.toLowerCase().includes(q)
        );
        return { provider, models };
      })
      .filter((g) => !q || g.models.length > 0 || g.provider.displayName.toLowerCase().includes(q));
  }, [providers, configuredModels, query]);

  const handleAddProvider = (): void => {
    new AddProviderModal(app, {
      catalogProviders,
      localTemplates: LOCAL_PROVIDER_DEFINITIONS,
      customTemplate: CUSTOM_OPENAI_DEFINITION,
      onPick: (source) =>
        new ConfigureProviderModal(app, {
          state: { mode: "new", source },
          api,
        }).open(),
    }).open();
  };

  const handleRemove = (providerId: string): void => {
    const provider = providers.find((p) => p.providerId === providerId);
    if (!provider) return;
    const modal = new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeProvider(providerId);
        } catch (err) {
          logError("[ByokPanel] removeProvider failed", err);
          new Notice(t("ui.model.removeProviderFailed"));
        }
      },
      t("ui.model.removeProviderConfirm", { provider: provider.displayName }),
      t("ui.model.removeProvider"),
      t("ui.common.remove"),
      t("common.cancel")
    );
    modal.open();
  };

  return (
    <div className="tw-relative tw-flex tw-flex-col tw-gap-4 tw-py-4">
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-4">
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-xl tw-font-bold tw-text-normal">{t("ui.model.byokTitle")}</div>
          <div className="tw-max-w-xl tw-text-sm tw-text-muted">{t("ui.model.byokSubtitle")}</div>
        </div>
        <Button className="tw-shrink-0" onClick={handleAddProvider}>
          <Plus className="tw-size-4" />
          {t("ui.model.addProvider")}
        </Button>
      </div>

      <SearchBar value={query} onChange={setQuery} placeholder={t("ui.model.searchProviders")} />

      <div className="tw-flex tw-flex-col">
        <ByokGlobalTable
          groups={groups}
          emptyMessage={
            query.trim() && providers.length > 0 ? t("ui.model.noProviderMatch") : undefined
          }
          onConfigure={(id) =>
            new ConfigureProviderModal(app, {
              state: { mode: "edit", providerId: id },
              api,
            }).open()
          }
          onRemove={handleRemove}
        />
      </div>
    </div>
  );
};
