// Settings migration is versioned and monotonic: the non-secret configuration is backed up with its
// schema version before anything is written, the write itself must succeed before the migration counts
// as done, BYOK providers keep their keychainId so the existing key is still found, an agent-origin
// model keeps its label but is flagged needs_reconfiguration instead of faking a subscription session
// as an API key, new sessions default to pi while old chat records keep their backendId, and a repeated
// or retried run never duplicates a provider, model or chat:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const PI_SETTINGS_SCHEMA_VERSION = 3;
export const PI_DEFAULT_ENGINE_ID = "pi";

export type SettingsMigrationStatus = "migrated" | "already_current" | "future_version" | "failed";

export interface SettingsMigrationPorts {
  readSettings(): Promise<Record<string, unknown>>;
  writeSettings(next: Record<string, unknown>): Promise<void>;
  writeBackup(input: {
    readonly schemaVersion: number;
    readonly payload: Record<string, unknown>;
  }): Promise<{ readonly path: string }>;
}

export interface SettingsMigrationResult {
  readonly status: SettingsMigrationStatus;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly changes: readonly string[];
  readonly backupPath?: string;
  readonly error?: string;
}

export class SettingsMigration {
  readonly #ports: SettingsMigrationPorts;
  readonly #targetVersion: number;

  constructor(options: {
    readonly ports: SettingsMigrationPorts;
    readonly targetVersion?: number;
  }) {
    this.#ports = options.ports;
    this.#targetVersion = options.targetVersion ?? PI_SETTINGS_SCHEMA_VERSION;
  }

  async migrate(): Promise<SettingsMigrationResult> {
    const settings = await this.#ports.readSettings();
    const fromVersion = readVersion(settings);
    if (fromVersion === this.#targetVersion) {
      return Object.freeze({
        status: "already_current" as const,
        fromVersion,
        toVersion: this.#targetVersion,
        changes: Object.freeze([]),
      });
    }
    if (fromVersion > this.#targetVersion) {
      return Object.freeze({
        status: "future_version" as const,
        fromVersion,
        toVersion: this.#targetVersion,
        changes: Object.freeze([]),
      });
    }
    let backupPath: string | undefined;
    try {
      const backup = await this.#ports.writeBackup({
        schemaVersion: fromVersion,
        payload: redactSecrets(settings),
      });
      backupPath = backup.path;
    } catch (thrown) {
      return Object.freeze({
        status: "failed" as const,
        fromVersion,
        toVersion: this.#targetVersion,
        changes: Object.freeze([]),
        error: `The backup failed: ${errorMessage(thrown)}`,
      });
    }
    const { next, changes } = migrateDocument(settings, this.#targetVersion);
    try {
      await this.#ports.writeSettings(next);
    } catch (thrown) {
      return Object.freeze({
        status: "failed" as const,
        fromVersion,
        toVersion: this.#targetVersion,
        changes: Object.freeze([]),
        backupPath,
        error: `The settings write failed: ${errorMessage(thrown)}`,
      });
    }
    return Object.freeze({
      status: "migrated" as const,
      fromVersion,
      toVersion: this.#targetVersion,
      changes: Object.freeze(changes),
      backupPath,
    });
  }
}

export function migrateDocument(
  settings: Record<string, unknown>,
  targetVersion: number
): { readonly next: Record<string, unknown>; readonly changes: readonly string[] } {
  const next: Record<string, unknown> = { ...settings };
  const changes: string[] = [];
  const providers = normalizeProviders(settings.providers);
  if (providers.changed) {
    next.providers = providers.value;
    changes.push(`deduped providers (${providers.before} -> ${providers.after})`);
  }
  const models = normalizeConfiguredModels(
    settings.configuredModels,
    providers.value ?? settings.providers
  );
  if (models.changed) {
    next.configuredModels = models.value;
    changes.push(
      `normalized configured models (${models.before} -> ${models.after}, ${models.flagged} flagged needsReconfiguration)`
    );
  }
  const backends = isRecord(settings.backends) ? settings.backends : {};
  if (!isRecord(backends.pi)) {
    const eligible = new Set<string>();
    const normalizedProviders = providers.value ?? settings.providers;
    if (Array.isArray(models.value) && isRecord(normalizedProviders)) {
      for (const model of models.value) {
        if (
          !isRecord(model) ||
          typeof model.configuredModelId !== "string" ||
          typeof model.providerId !== "string"
        )
          continue;
        const provider = normalizedProviders[model.providerId];
        if (isRecord(provider) && isRecord(provider.origin) && provider.origin.kind === "byok")
          eligible.add(model.configuredModelId);
      }
    }
    const enabled = new Set<string>();
    for (const backend of Object.values(backends)) {
      if (!isRecord(backend) || !Array.isArray(backend.enabledModels)) continue;
      for (const id of backend.enabledModels)
        if (typeof id === "string" && eligible.has(id)) enabled.add(id);
    }
    // 只迁移用户原已启用的自带密钥模型，订阅模型仍留作历史来源：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    next.backends = { ...backends, pi: { enabledModels: [...enabled] } };
    changes.push("preserved enabled BYOK models for Pi");
  }
  const agentMode = settings.agentMode;
  if (isRecord(agentMode)) {
    if (agentMode.activeBackend !== PI_DEFAULT_ENGINE_ID) {
      next.agentMode = { ...agentMode, activeBackend: PI_DEFAULT_ENGINE_ID };
      changes.push(`new sessions default to ${PI_DEFAULT_ENGINE_ID}`);
    }
  } else {
    next.agentMode = { activeBackend: PI_DEFAULT_ENGINE_ID };
    changes.push(`new sessions default to ${PI_DEFAULT_ENGINE_ID}`);
  }
  next.settingsSchemaVersion = targetVersion;
  changes.push(`settingsSchemaVersion ${readVersion(settings)} -> ${targetVersion}`);
  return { next, changes: Object.freeze(changes) };
}

function normalizeProviders(raw: unknown): {
  readonly value: Record<string, unknown> | undefined;
  readonly changed: boolean;
  readonly before: number;
  readonly after: number;
} {
  if (raw === undefined || raw === null) {
    return { value: undefined, changed: false, before: 0, after: 0 };
  }
  if (isRecord(raw)) {
    return {
      value: raw,
      changed: false,
      before: Object.keys(raw).length,
      after: Object.keys(raw).length,
    };
  }
  if (!Array.isArray(raw)) {
    return { value: undefined, changed: false, before: 0, after: 0 };
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const providerId = typeof entry.providerId === "string" ? entry.providerId : undefined;
    if (providerId === undefined) continue;
    const existing = byId.get(providerId);
    if (existing === undefined) {
      byId.set(providerId, { ...entry });
      continue;
    }
    if (
      (existing.apiKeyKeychainId === undefined || existing.apiKeyKeychainId === null) &&
      entry.apiKeyKeychainId !== undefined
    ) {
      existing.apiKeyKeychainId = entry.apiKeyKeychainId;
    }
  }
  const value: Record<string, unknown> = {};
  for (const [providerId, provider] of byId) value[providerId] = provider;
  return {
    value,
    changed: true,
    before: raw.length,
    after: byId.size,
  };
}

function normalizeConfiguredModels(
  raw: unknown,
  providers: unknown
): {
  readonly value: unknown;
  readonly changed: boolean;
  readonly before: number;
  readonly after: number;
  readonly flagged: number;
} {
  if (!Array.isArray(raw)) {
    return { value: raw, changed: false, before: 0, after: 0, flagged: 0 };
  }
  const agentProviderIds = new Set<string>();
  if (isRecord(providers)) {
    for (const [providerId, provider] of Object.entries(providers)) {
      if (!isRecord(provider)) continue;
      const origin = provider.origin;
      if (isRecord(origin) && origin.kind === "agent") agentProviderIds.add(providerId);
    }
  } else if (Array.isArray(providers)) {
    for (const provider of providers) {
      if (!isRecord(provider)) continue;
      const origin = provider.origin;
      if (isRecord(origin) && origin.kind === "agent" && typeof provider.providerId === "string") {
        agentProviderIds.add(provider.providerId);
      }
    }
  }
  const seen = new Set<string>();
  const value: unknown[] = [];
  let flagged = 0;
  let changed = false;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const configuredModelId =
      typeof entry.configuredModelId === "string" ? entry.configuredModelId : undefined;
    const providerId = typeof entry.providerId === "string" ? entry.providerId : undefined;
    const key =
      configuredModelId ?? `${providerId ?? "unknown"}:${JSON.stringify(entry.info ?? {})}`;
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    const nextEntry: Record<string, unknown> = { ...entry };
    if (providerId !== undefined && agentProviderIds.has(providerId)) {
      if (nextEntry.needsReconfiguration !== true) {
        nextEntry.needsReconfiguration = true;
        flagged += 1;
        changed = true;
      }
    }
    value.push(nextEntry);
  }
  if (value.length !== raw.length) changed = true;
  return { value, changed, before: raw.length, after: value.length, flagged };
}

const SECRET_KEY = /(apikey|token|secret|password|passphrase|credential)/i;
const KEYCHAIN_REFERENCE = /keychainid$/i;

export function redactSecrets(settings: Record<string, unknown>): Record<string, unknown> {
  return redact(settings) as Record<string, unknown>;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && !KEYCHAIN_REFERENCE.test(key)) continue;
    output[key] = redact(entry);
  }
  return output;
}

function readVersion(settings: Record<string, unknown>): number {
  const version = settings.settingsSchemaVersion;
  return typeof version === "number" && Number.isFinite(version) ? version : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : "unknown error";
}
