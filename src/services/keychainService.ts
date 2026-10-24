import { type App, type SecretStorage, FileSystemAdapter } from "obsidian";
import { type VaultAgentSettings, getModelKeyFromModel, getSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";
import type { Provider } from "@/modelManagement";
import {
  stripKeychainFields,
  isSensitiveKey,
  MODEL_SECRET_FIELDS,
  TOP_LEVEL_SECRET_FIELDS,
} from "@/services/settingsSecretTransforms";
import { t } from "@/i18n";
import { Notice } from "obsidian";
import { md5 } from "@/utils/hash";
import { logError, logWarn } from "@/logger";

const EXTRA_SECRET_KEYS: readonly string[] = [];

type ModelSecretField = (typeof MODEL_SECRET_FIELDS)[number];

type ModelScope = "chat";

export function isSecretKey(key: string): boolean {
  return isSensitiveKey(key) || EXTRA_SECRET_KEYS.includes(key);
}

function generateVaultId(app: App): string {
  const basePath = getVaultBasePath(app);
  if (basePath) {
    return md5(basePath).slice(0, 8);
  }
  const cryptoApi = window.crypto;
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(4);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return md5(`${Date.now()}-${Math.random()}`).slice(0, 8);
}

function getVaultBasePath(app: App): string | undefined {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getBasePath();
  }
  const adapterAny = adapter as unknown as { getBasePath?: () => string; basePath?: string };
  if (typeof adapterAny.getBasePath === "function") {
    return adapterAny.getBasePath();
  }
  if (typeof adapterAny.basePath === "string") {
    return adapterAny.basePath;
  }
  return undefined;
}

const MAX_SECRET_ID_LENGTH = 64;
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeKeychainId(raw: string, maxLength = MAX_SECRET_ID_LENGTH): string {
  const hash = md5(raw).slice(0, 8);
  const prefixBudget = Math.max(0, maxLength - 9);
  const prefix = slugify(raw).slice(0, prefixBudget);
  return prefix + "-" + hash;
}

function toKeychainId(vaultId: string, settingsKey: string): string {
  const prefix = `copilot-v${vaultId}-`;
  const kebab = settingsKey
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
  const id = prefix + kebab;
  if (id.length <= MAX_SECRET_ID_LENGTH) return id;
  const hash = md5(settingsKey).slice(0, 8);
  return id.slice(0, MAX_SECRET_ID_LENGTH - 9) + "-" + hash;
}

function toModelKeychainId(
  vaultId: string,
  scope: ModelScope,
  modelIdentity: string,
  field: ModelSecretField
): string {
  const kebabField = field.replace(/([A-Z])/g, "-$1").toLowerCase();
  const fieldSegment = `model-${kebabField}`;
  const prefix = `copilot-v${vaultId}-${fieldSegment}-${scope}-`;
  const budget = MAX_SECRET_ID_LENGTH - prefix.length;
  const normalizedModel = normalizeKeychainId(modelIdentity, budget);
  return prefix + normalizedModel;
}

function providerNameSource(provider: Provider): string {
  return provider.origin.catalogProviderId ?? provider.displayName;
}

export function providerKeychainName(
  vaultId: string,
  provider: Provider,
  providers: Record<string, Provider>
): string {
  const taken = new Set(
    Object.values(providers)
      .filter((row) => row.providerId !== provider.providerId)
      .map((row) => row.apiKeyKeychainId)
  );
  const prefix = `copilot-v${vaultId}-provider-`;
  const slug = slugify(providerNameSource(provider)) || "custom";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "-api-key" : `-api-key-${n}`;
    const budget = MAX_SECRET_ID_LENGTH - prefix.length - suffix.length;
    const name = prefix + slug.slice(0, budget).replace(/-$/, "") + suffix;
    if (!taken.has(name)) return name;
  }
}

export function isCopilotOwnedSecret(id: string): boolean {
  return id.startsWith("copilot-");
}

export interface SecretMetaEntry {
  createdAt: number;
  updatedAt: number;
}

const SECRET_META_SETTINGS_KEY = "secret-meta";

export function secretMetaId(vaultId: string): string {
  return toKeychainId(vaultId, SECRET_META_SETTINGS_KEY);
}

export interface HydrateResult {
  settings: VaultAgentSettings;
  hadFailures: boolean;
}

export interface PersistSecretsResult {
  secretEntries: Array<[string, string]>;
  keychainIdsToDelete: string[];
}

export type SaveDataFn = (data: VaultAgentSettings) => Promise<void>;

export class KeychainService {
  private static instance: KeychainService | null = null;
  private app: App;
  private vaultId: string;
  private secretMeta: Record<string, SecretMetaEntry> | null = null;

  private constructor(app: App) {
    this.app = app;
    this.vaultId = generateVaultId(app);
  }

  static getInstance(app?: App): KeychainService {
    if (!KeychainService.instance) {
      if (!app) {
        throw new Error("KeychainService must be initialized with app on first call");
      }
      KeychainService.instance = new KeychainService(app);
    }
    return KeychainService.instance;
  }

  static resetInstance(): void {
    KeychainService.instance = null;
  }

  isAvailable(): boolean {
    return !!this.app.secretStorage;
  }

  getVaultId(): string {
    return this.vaultId;
  }

  setVaultId(id: string): void {
    this.vaultId = id;
    this.secretMeta = null;
  }

  private get storage(): SecretStorage {
    if (!this.app.secretStorage) {
      throw new Error("OS keychain (SecretStorage) is not available.");
    }
    return this.app.secretStorage;
  }

  private removeSecret(id: string): void {
    if (typeof this.storage.deleteSecret === "function") {
      this.storage.deleteSecret(id);
    } else {
      this.storage.setSecret(id, "");
    }
    this.recordSecretRemoval(id);
  }

  // SecretStorage 不暴露条目时间；写入与删除时把时间记录在同库的一条非密钥 JSON 条目里，
  // 供本地数据页展示存储时间。值未变化的重写不刷新时间，注册表之前写入的旧条目没有时间。
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/8
  getSecretMeta(): Readonly<Record<string, SecretMetaEntry>> {
    return { ...this.loadSecretMeta() };
  }

  private loadSecretMeta(): Record<string, SecretMetaEntry> {
    if (this.secretMeta) return this.secretMeta;
    try {
      const raw = this.storage.getSecret(secretMetaId(this.vaultId));
      this.secretMeta = raw ? (JSON.parse(raw) as Record<string, SecretMetaEntry>) : {};
    } catch {
      this.secretMeta = {};
    }
    return this.secretMeta;
  }

  private saveSecretMeta(): void {
    if (!this.secretMeta) return;
    this.storage.setSecret(secretMetaId(this.vaultId), JSON.stringify(this.secretMeta));
  }

  private recordSecretWrite(keychainId: string, value: string, previous: string | null): void {
    if (keychainId === secretMetaId(this.vaultId)) return;
    if (value === "") {
      this.recordSecretRemoval(keychainId);
      return;
    }
    const meta = this.loadSecretMeta();
    const existing = meta[keychainId];
    if (existing && previous === value) return;
    const now = Date.now();
    meta[keychainId] = existing
      ? { createdAt: existing.createdAt, updatedAt: now }
      : { createdAt: now, updatedAt: now };
    this.saveSecretMeta();
  }

  private recordSecretRemoval(keychainId: string): void {
    if (keychainId === secretMetaId(this.vaultId)) {
      this.secretMeta = {};
      return;
    }
    const meta = this.loadSecretMeta();
    if (!(keychainId in meta)) return;
    delete meta[keychainId];
    this.saveSecretMeta();
  }

  setSecretById(keychainId: string, value: string): void {
    let previous: string | null = null;
    try {
      previous = this.storage.getSecret(keychainId);
    } catch {
      previous = null;
    }
    this.storage.setSecret(keychainId, value);
    this.recordSecretWrite(keychainId, value, previous);
  }

  getSecretById(keychainId: string): string | null {
    return this.storage.getSecret(keychainId);
  }

  deleteSecretById(keychainId: string): void {
    this.removeSecret(keychainId);
  }

  deleteSecret(settingsKey: string): void {
    this.removeSecret(toKeychainId(this.vaultId, settingsKey));
  }

  getSecret(settingsKey: string): string | null {
    const id = toKeychainId(this.vaultId, settingsKey);
    return this.storage.getSecret(id);
  }

  getModelSecret(scope: ModelScope, modelIdentity: string, field: ModelSecretField): string | null {
    const id = toModelKeychainId(this.vaultId, scope, modelIdentity, field);
    return this.storage.getSecret(id);
  }

  async hydrateFromKeychain(settings: VaultAgentSettings): Promise<HydrateResult> {
    const hydrated = { ...settings };
    let hadFailures = false;

    for (const key of TOP_LEVEL_SECRET_FIELDS) {
      let keychainValue: string | null;
      try {
        keychainValue = this.getSecret(key);
      } catch (e) {
        logWarn(`Keychain read failed for "${key}".`, e);
        hadFailures = true;
        continue;
      }

      if (keychainValue === "") {
        (hydrated as unknown as Record<string, unknown>)[key] = "";
      } else if (keychainValue !== null) {
        (hydrated as unknown as Record<string, unknown>)[key] = keychainValue;
      }
    }

    const modelResult = await this.hydrateModelSecrets("chat", hydrated.activeModels ?? []);
    hydrated.activeModels = modelResult.models;
    hadFailures = hadFailures || modelResult.hadFailures;

    if (hadFailures) {
      logWarn("Keychain hydrate: some keychain reads failed — values left as-is.");
    }

    return { settings: hydrated, hadFailures };
  }

  persistSecrets(
    settings: VaultAgentSettings,
    prevSettings?: VaultAgentSettings
  ): PersistSecretsResult {
    const secretEntries: Array<[string, string]> = [];
    const clearedSecretIds: string[] = [];

    for (const key of TOP_LEVEL_SECRET_FIELDS) {
      const value = (settings as unknown as Record<string, unknown>)[key];
      const id = toKeychainId(this.vaultId, key);

      if (typeof value === "string" && value.length > 0) {
        secretEntries.push([id, value]);
      } else if (prevSettings) {
        const prevValue = (prevSettings as unknown as Record<string, unknown>)[key];
        if (typeof prevValue === "string" && prevValue.length > 0) {
          clearedSecretIds.push(id);
        }
      }
    }

    this.collectModelSecrets(
      "chat",
      settings.activeModels,
      secretEntries,
      prevSettings?.activeModels,
      clearedSecretIds
    );
    const keychainIdsToDelete = [
      ...this.getDeletedModelKeysForScope(
        "chat",
        prevSettings?.activeModels,
        settings.activeModels
      ),
      ...clearedSecretIds,
    ];

    return { secretEntries, keychainIdsToDelete };
  }

  clearAllVaultSecrets(): void {
    const vaultPrefix = `copilot-v${this.vaultId}-`;
    if (typeof this.storage.listSecrets !== "function") {
      throw new Error(
        "Obsidian Keychain on this build does not support listing entries; " +
          "cannot guarantee a complete clear."
      );
    }
    const allIds = this.storage.listSecrets();
    const failures: string[] = [];
    for (const id of allIds) {
      if (id.startsWith(vaultPrefix)) {
        try {
          this.removeSecret(id);
        } catch {
          failures.push(id);
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Failed to clear ${failures.length} keychain ` +
          `entr${failures.length === 1 ? "y" : "ies"}. Please retry.`
      );
    }
  }

  async forgetAllSecrets(
    saveData: SaveDataFn,
    syncMemory: (data: Partial<VaultAgentSettings>) => void
  ): Promise<void> {
    const current = getSettings();
    if (!this.isAvailable()) {
      throw new Error(
        "Cannot delete API keys from the Obsidian Keychain because Secure Storage is " +
          "unavailable in this Obsidian build. Update Obsidian to 1.11.4 or later, or open " +
          "this vault on a device with Keychain access, then try again."
      );
    }
    if (typeof this.app.secretStorage?.listSecrets !== "function") {
      throw new Error(
        "Cannot delete all API keys because this Obsidian build does not support " +
          "enumerating Keychain entries. Update Obsidian to a newer version and retry."
      );
    }

    const stripped = stripKeychainFields(current);

    try {
      await saveData(stripped);
    } catch (error) {
      logError("forgetAllSecrets: saveData failed — aborting keychain clear", error);
      new Notice(t("notice.keysRemoveFailed"));
      return;
    }

    let keychainError: Error | undefined;
    try {
      this.clearAllVaultSecrets();
    } catch (e) {
      keychainError = e instanceof Error ? e : new Error(String(e));
    }

    syncMemory(stripped);

    if (keychainError) {
      new Notice(t("notice.keychainPartialRemoveFailed"));
      throw keychainError;
    }

    new Notice(t("notice.keysRemoved"));
  }

  private async hydrateModelSecrets(
    scope: ModelScope,
    models: CustomModel[]
  ): Promise<{ models: CustomModel[]; hadFailures: boolean }> {
    if (!models?.length) return { models, hadFailures: false };

    let hadFailures = false;
    const result: CustomModel[] = [];

    for (const model of models) {
      const identity = getModelKeyFromModel(model);
      const copy = { ...model };

      for (const field of MODEL_SECRET_FIELDS) {
        let keychainValue: string | null;
        try {
          keychainValue = this.getModelSecret(scope, identity, field);
        } catch (e) {
          logWarn(`Keychain read failed for model "${identity}" field "${field}".`, e);
          hadFailures = true;
          continue;
        }

        if (keychainValue === "") {
          (copy as unknown as Record<string, unknown>)[field] = "";
        } else if (keychainValue !== null) {
          (copy as unknown as Record<string, unknown>)[field] = keychainValue;
        }
      }

      result.push(copy);
    }

    return { models: result, hadFailures };
  }

  private collectModelSecrets(
    scope: ModelScope,
    models: CustomModel[],
    secretEntries: Array<[string, string]>,
    prevModels?: CustomModel[],
    clearedSecretIds?: string[]
  ): void {
    if (!models?.length) return;

    const prevModelMap = new Map<string, CustomModel>();
    if (prevModels) {
      for (const m of prevModels) {
        prevModelMap.set(getModelKeyFromModel(m), m);
      }
    }

    for (const model of models) {
      const identity = getModelKeyFromModel(model);
      const prevModel = prevModelMap.get(identity);

      for (const field of MODEL_SECRET_FIELDS) {
        const value = model[field];
        const id = toModelKeychainId(this.vaultId, scope, identity, field);

        if (typeof value === "string" && value.length > 0) {
          secretEntries.push([id, value]);
        } else if (prevModel && clearedSecretIds) {
          const prevValue = prevModel[field];
          if (typeof prevValue === "string" && prevValue.length > 0) {
            clearedSecretIds.push(id);
          }
        }
      }
    }
  }

  private getDeletedModelKeysForScope(
    scope: ModelScope,
    prevModels: CustomModel[] | undefined,
    currentModels: CustomModel[]
  ): string[] {
    if (!prevModels?.length) return [];

    const currentIds = new Set((currentModels ?? []).map(getModelKeyFromModel));

    return prevModels
      .filter((m) => !currentIds.has(getModelKeyFromModel(m)))
      .flatMap((m) => {
        const identity = getModelKeyFromModel(m);
        return MODEL_SECRET_FIELDS.flatMap((field) => {
          const prevValue = (m as unknown as Record<string, unknown>)[field];
          if (typeof prevValue !== "string" || prevValue.length === 0) {
            return [];
          }
          return [toModelKeychainId(this.vaultId, scope, identity, field)];
        });
      });
  }
}
