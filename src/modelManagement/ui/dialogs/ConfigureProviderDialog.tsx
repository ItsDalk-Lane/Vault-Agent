import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ReactModal } from "@/components/modals/ReactModal";
import { useApp } from "@/context";
import { t } from "@/i18n";
import { logError } from "@/logger";
import {
  DEFAULT_PROTOCOL_BASE_URLS,
  getProviderCapability,
  normalizeBaseUrlForProtocol,
  resolveProviderBaseUrl,
} from "@/modelManagement/catalog/providerCapability";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { isProviderEnabled } from "@/modelManagement/providers/providerAvailability";
import { providerRequiresApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import {
  backendsAtom,
  byokProvidersAtom,
  configuredModelsAtom,
} from "@/modelManagement/state/atoms";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel } from "@/modelManagement/types/persisted";
import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import {
  ModelManagementProvider,
  useModelManagement,
} from "@/modelManagement/ui/ModelManagementContext";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { App, Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createProviderModalScope } from "./providerModalKeyboard";
import { ConfigureProviderEditor } from "./ConfigureProviderEditor";
import { createModelDraft, mergeDeclaredModelInfo, type ProviderDraft } from "./providerDraft";

const EMPTY_MODELS: readonly ConfiguredModel[] = Object.freeze([]);
const EMPTY_CATALOG_MODELS: readonly ModelInfo[] = Object.freeze([]);

export type ConfigureState =
  | { mode: "new"; source: ProviderDefinition }
  | { mode: "edit"; providerId: string };
interface ConfigureProviderFormProps {
  state: ConfigureState;
  onClose: () => void;
  onSaved?: () => void;
}

export function ConfigureProviderForm({ state, onClose, onSaved }: ConfigureProviderFormProps) {
  const api = useModelManagement();
  const app = useApp();
  const providers = useAtomValue(byokProvidersAtom, { store: settingsStore });
  const models = useAtomValue(configuredModelsAtom, { store: settingsStore });
  const backends = useAtomValue(backendsAtom, { store: settingsStore });
  const provider =
    state.mode === "edit"
      ? providers.find((entry) => entry.providerId === state.providerId)
      : undefined;
  const existingModels = useMemo(
    () =>
      state.mode === "edit"
        ? models.filter((model) => model.providerId === state.providerId)
        : EMPTY_MODELS,
    [models, state]
  );
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyResolved, setKeyResolved] = useState(state.mode === "new");
  const [keyError, setKeyError] = useState(false);
  const [keyAttempt, setKeyAttempt] = useState(0);
  const providerId = state.mode === "edit" ? state.providerId : undefined;
  const providerExists = Boolean(provider);
  useEffect(() => {
    if (!providerId || !providerExists) return;
    let cancelled = false;
    void api.providerRegistry.getApiKey(providerId).then(
      (key) => {
        if (!cancelled) {
          setApiKey(key);
          setKeyResolved(true);
        }
      },
      () => {
        if (!cancelled) {
          setKeyError(true);
          setKeyResolved(true);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [api.providerRegistry, providerId, providerExists, keyAttempt]);
  const catalogId =
    state.mode === "new"
      ? state.source.catalogProviderId
      : provider?.origin.kind === "byok"
        ? provider.origin.catalogProviderId
        : undefined;
  const resolveModelInfo = useCallback(
    async (id: string): Promise<Partial<ModelInfo> | undefined> => {
      const catalog = catalogId ? api.catalogService.getProvider(catalogId)?.models[id] : undefined;
      const declared = api.resolveDeclaredModelCapabilities?.(catalogId ?? "", id);
      return catalog || declared
        ? {
            ...catalog,
            ...declared,
            modalities: { ...catalog?.modalities, ...declared?.modalities },
            capabilities: { ...catalog?.capabilities, ...declared?.capabilities },
          }
        : undefined;
    },
    [api, catalogId]
  );
  const catalogModels = useMemo(() => {
    const models = catalogId ? api.catalogService.getProvider(catalogId)?.models : undefined;
    return models
      ? Object.values(models).map((model) =>
          mergeDeclaredModelInfo(
            model,
            api.resolveDeclaredModelCapabilities?.(catalogId ?? "", model.id)
          )
        )
      : EMPTY_CATALOG_MODELS;
  }, [api, catalogId]);
  if (state.mode === "edit" && (!provider || !keyResolved))
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center">
        <Loader2 className="tw-size-5 tw-animate-spin tw-text-muted" />
      </div>
    );
  if (keyError)
    return (
      <div role="alert" className="tw-space-y-3 tw-text-error">
        {t("ui.model.keyReadFailed")}
        <Button
          variant="secondary"
          onClick={() => {
            setKeyError(false);
            setKeyResolved(false);
            setKeyAttempt((attempt) => attempt + 1);
          }}
        >
          {t("ui.byok.retry")}
        </Button>
      </div>
    );
  const source = state.mode === "new" ? state.source : undefined;
  const capability = catalogId
    ? getProviderCapability(api.catalogService.getProvider(catalogId) ?? {})
    : null;
  const type =
    provider?.providerType ??
    capability?.providerType ??
    source?.providerType ??
    "openai-compatible";
  const requiresApiKey = provider
    ? providerRequiresApiKey(provider)
    : (capability?.requiresApiKey ?? source?.requiresApiKey ?? false);
  const initialDraft: ProviderDraft = {
    displayName: provider?.displayName ?? source?.displayName ?? "",
    baseUrl: provider
      ? (resolveProviderBaseUrl(provider, capability) ?? "")
      : (capability?.defaultBaseUrl ?? source?.defaultBaseUrl ?? ""),
    providerType: type,
    apiKey: apiKey ?? "",
    extras: provider?.extras ?? {
      useResponsesApi: capability?.useResponsesApi ?? source?.useResponsesApi ?? false,
    },
    enabled: provider ? isProviderEnabled(provider) : true,
    models: existingModels.map((model) =>
      createModelDraft(
        mergeDeclaredModelInfo(
          model.info,
          api.resolveDeclaredModelCapabilities?.(catalogId ?? "", model.info.id)
        ),
        backends.pi?.enabledModels.includes(model.configuredModelId) ?? false
      )
    ),
  };
  const providerDefault =
    capability?.defaultBaseUrl ??
    source?.defaultBaseUrl ??
    (provider
      ? resolveProviderBaseUrl({ ...provider, baseUrl: undefined }, capability)
      : undefined);
  const protocolDefault = (providerType: ProviderType, responses: boolean): string => {
    if (
      providerDefault &&
      !Object.values(DEFAULT_PROTOCOL_BASE_URLS).some((url) => url === providerDefault)
    )
      return providerDefault;
    return DEFAULT_PROTOCOL_BASE_URLS[
      providerType === "anthropic"
        ? "anthropic-messages"
        : providerType === "google"
          ? "google-generative-ai"
          : responses
            ? "openai-responses"
            : "openai-completions"
    ];
  };
  const save = async (draft: ProviderDraft): Promise<void> => {
    await api.setup.byok.saveProviderDraft({
      providerId,
      catalogProviderId: catalogId,
      providerType: draft.providerType,
      displayName: draft.displayName.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey,
      extras: draft.extras,
      requiresApiKey,
      enabled: draft.enabled,
      models: draft.models.map((model) => ({ info: model.info, enabled: model.enabled })),
    });
    onSaved?.();
    onClose();
  };
  const remove = (): void => {
    if (!providerId || !provider) return;
    new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeProvider(providerId);
          onClose();
        } catch (reason) {
          logError("[ConfigureProviderDialog] removeProvider failed", reason);
          new Notice(t("ui.model.removeProviderFailed"));
        }
      },
      t("ui.model.removeProviderConfirm", { provider: provider.displayName }),
      t("ui.model.removeProvider"),
      t("ui.common.remove"),
      t("common.cancel")
    ).open();
  };
  return (
    <ConfigureProviderEditor
      initialDraft={initialDraft}
      requiresApiKey={requiresApiKey}
      editing={state.mode === "edit"}
      defaultBaseUrl={protocolDefault}
      catalogModels={catalogModels}
      onTestModel={async (draft, model, signal) => {
        if (!api.testModelConnection) throw new Error(t("ui.byok.testUnavailable"));
        await api.testModelConnection({
          provider: {
            providerId: providerId ?? "connection-test",
            providerType: draft.providerType,
            displayName: draft.displayName,
            baseUrl: normalizeBaseUrlForProtocol(draft.baseUrl, draft.providerType),
            origin: { kind: "byok", catalogProviderId: catalogId },
            requiresApiKey,
            extras: draft.extras,
            addedAt: provider?.addedAt ?? Date.now(),
          },
          model,
          apiKey: draft.apiKey,
          checkTools: model.toolCall !== false,
          signal,
        });
      }}
      resolveModelInfo={resolveModelInfo}
      supportsMaxEffort={(id) =>
        api
          .resolveDeclaredModelCapabilities?.(catalogId ?? "", id)
          ?.reasoningEfforts?.includes("max") ?? false
      }
      onSave={save}
      onClose={onClose}
      onRemove={remove}
    />
  );
}

interface ConfigureProviderModalOptions {
  state: ConfigureState;
  api: ModelManagementApi;
  onSaved?: () => void;
}
export class ConfigureProviderModal extends ReactModal {
  constructor(
    app: App,
    private readonly opts: ConfigureProviderModalOptions
  ) {
    super(app);
    this.scope = createProviderModalScope(this.scope, this.contentEl, () => this.close());
  }
  onOpen(): void {
    this.modalEl.addClasses([
      "tw-flex",
      "tw-w-[760px]",
      "tw-max-w-[95vw]",
      "tw-max-h-[85vh]",
      "tw-flex-col",
    ]);
    this.contentEl.addClasses([
      "tw-flex",
      "tw-min-h-0",
      "tw-flex-1",
      "tw-flex-col",
      "tw-overflow-hidden",
    ]);
    super.onOpen();
  }
  protected renderContent(close: () => void): React.ReactElement {
    return (
      <ModelManagementProvider api={this.opts.api}>
        <ConfigureProviderForm
          state={this.opts.state}
          onClose={close}
          onSaved={this.opts.onSaved}
        />
      </ModelManagementProvider>
    );
  }
}
