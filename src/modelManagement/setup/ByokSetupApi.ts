import { t } from "@/i18n";
import { v4 as uuidv4 } from "uuid";
import { getSettings, setSettings } from "@/settings/model";
import { providerKeychainName } from "@/services/keychainService";
import type { Provider, ConfiguredModel, BackendConfig } from "@/modelManagement/types/persisted";
import { logError } from "@/logger";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { BackendType } from "@/modelManagement/types/persisted";
import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";

export const BYOK_DEFAULT_AUTO_ENROLL: readonly BackendType[] = Object.freeze(["chat", "pi"]);

export interface SetupProviderInput {
  catalogProviderId?: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl?: string;
  enableCors?: boolean;
  apiKey?: string;
  extras?: Record<string, unknown>;
  requiresApiKey?: boolean;
  models: readonly ModelInfo[];
  autoEnrollIn?: readonly BackendType[];
  enabled?: boolean;
}

export interface SaveProviderDraftInput {
  providerId?: string;
  catalogProviderId?: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl?: string;
  requiresApiKey?: boolean;
  extras?: Record<string, unknown>;
  enabled?: boolean;
  apiKey: string;
  models: readonly { info: ModelInfo; enabled: boolean }[];
}

export interface DraftKeychain {
  getVaultId(): string;
  getSecretById(id: string): string | null;
  setSecretById(id: string, value: string): void;
  deleteSecretById(id: string): void;
}

export interface ByokSetupResult {
  providerId: string;
  configuredModelIds: string[];
}

export class ByokSetupApi {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;
  readonly #backends: BackendConfigRegistry;
  readonly #keychain?: DraftKeychain;

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry,
    backendConfigRegistry: BackendConfigRegistry,
    keychain?: DraftKeychain
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
    this.#backends = backendConfigRegistry;
    this.#keychain = keychain;
  }

  async saveProviderDraft(input: SaveProviderDraftInput): Promise<ByokSetupResult> {
    const before = getSettings();
    const existing = input.providerId ? before.providers[input.providerId] : undefined;
    if (input.providerId && !existing) throw new Error(t("ui.model.saveProviderFailed"));
    const wireIds = new Set<string>();
    for (const { info } of input.models) {
      if (!info.id.trim() || wireIds.has(info.id.trim())) throw new Error(t("ui.byok.invalidId"));
      wireIds.add(info.id.trim());
    }
    const providerId = existing?.providerId ?? uuidv4();
    const provider: Provider = {
      ...existing,
      providerId,
      addedAt: existing?.addedAt ?? Date.now(),
      providerType: input.providerType,
      displayName: input.displayName.trim(),
      baseUrl: input.baseUrl,
      requiresApiKey: input.requiresApiKey ?? existing?.requiresApiKey ?? true,
      extras: input.extras,
      enabled: input.enabled ?? existing?.enabled ?? true,
      apiKeyKeychainId: existing?.apiKeyKeychainId ?? null,
      origin: existing?.origin ?? {
        kind: "byok",
        ...(input.catalogProviderId ? { catalogProviderId: input.catalogProviderId } : {}),
      },
    };
    const oldModels = before.configuredModels.filter((model) => model.providerId === providerId);
    const byWireId = new Map(oldModels.map((model) => [model.info.id, model]));
    const rows: ConfiguredModel[] = input.models.map(({ info }) => {
      const old = byWireId.get(info.id.trim());
      return {
        configuredModelId: old?.configuredModelId ?? uuidv4(),
        providerId,
        configuredAt: old?.configuredAt ?? Date.now(),
        info: { ...info, id: info.id.trim() },
      };
    });
    const currentIds = new Set(rows.map((model) => model.configuredModelId));
    const removedIds = new Set(
      oldModels
        .filter((model) => !currentIds.has(model.configuredModelId))
        .map((model) => model.configuredModelId)
    );
    const visibleIds = rows
      .filter((row, index) => input.models[index].enabled && !row.info.isEmbedding)
      .map((row) => row.configuredModelId);
    const backends: Partial<Record<BackendType, BackendConfig>> = { ...before.backends };
    for (const backend of new Set<BackendType>([
      ...(Object.keys(backends) as BackendType[]),
      ...BYOK_DEFAULT_AUTO_ENROLL,
    ])) {
      const previous = backends[backend]?.enabledModels ?? [];
      const curated = BYOK_DEFAULT_AUTO_ENROLL.includes(backend);
      const kept = previous.filter(
        (id) => !removedIds.has(id) && (!curated || !currentIds.has(id) || visibleIds.includes(id))
      );
      if (curated) for (const id of visibleIds) if (!kept.includes(id)) kept.push(id);
      backends[backend] = { enabledModels: kept };
    }
    // 密钥先写入受保护存储，草稿的三份配置再一次发布，避免消费者观察到半成品。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    if (input.apiKey.trim()) {
      if (!this.#keychain) throw new Error(t("ui.model.saveProviderFailed"));
      provider.apiKeyKeychainId ??= providerKeychainName(
        this.#keychain.getVaultId(),
        provider,
        before.providers
      );
      if (this.#keychain.getSecretById(provider.apiKeyKeychainId) !== input.apiKey) {
        this.#keychain.setSecretById(provider.apiKeyKeychainId, input.apiKey);
      }
    } else if (provider.apiKeyKeychainId) {
      if (!this.#keychain) throw new Error(t("ui.model.saveProviderFailed"));
      this.#keychain.deleteSecretById(provider.apiKeyKeychainId);
      provider.apiKeyKeychainId = null;
    }
    setSettings({
      providers: { ...before.providers, [providerId]: provider },
      configuredModels: [
        ...before.configuredModels.filter((model) => model.providerId !== providerId),
        ...rows,
      ],
      backends,
    });
    this.#providers.notifyConfigChanged(providerId);
    return { providerId, configuredModelIds: rows.map((model) => model.configuredModelId) };
  }

  async setupProvider(input: SetupProviderInput): Promise<ByokSetupResult> {
    const providerId = await this.#providers.add({
      providerType: input.providerType,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      enableCors: input.enableCors,
      enabled: input.enabled,
      requiresApiKey: input.requiresApiKey ?? true,
      origin: {
        kind: "byok",
        ...(input.catalogProviderId ? { catalogProviderId: input.catalogProviderId } : {}),
      },
      extras: input.extras,
    });

    try {
      if (input.apiKey) {
        await this.#providers.setApiKey(providerId, input.apiKey);
      }

      const configuredModelIds = await this.#models.bulkSet(providerId, input.models);

      const newChatIds = configuredModelIds.filter((_, i) => !input.models[i]?.isEmbedding);
      await this.#enrollInBackends(input.autoEnrollIn ?? BYOK_DEFAULT_AUTO_ENROLL, newChatIds);

      return { providerId, configuredModelIds };
    } catch (err) {
      await this.#rollbackProvider(providerId);
      throw err;
    }
  }

  async #enrollInBackends(
    enrollIn: readonly BackendType[],
    newChatIds: readonly string[]
  ): Promise<void> {
    if (newChatIds.length === 0) return;
    for (const backend of enrollIn) {
      const current = this.#backends.get(backend).enabledModels;
      const merged = [...current];
      for (const id of newChatIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      await this.#backends.setEnabledModels(backend, merged);
    }
  }

  async #rollbackProvider(providerId: string): Promise<void> {
    try {
      const modelIds = this.#models.listByProvider(providerId).map((m) => m.configuredModelId);
      if (modelIds.length > 0) {
        await this.#backends.removeRefs(modelIds);
        await this.#models.removeByProvider(providerId);
      }
      await this.#providers.remove(providerId);
    } catch (err) {
      logError(`[modelManagement] ByokSetupApi rollback failed for ${providerId}`, err);
    }
  }
}
