import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { stripKeychainFields } from "@/services/settingsSecretTransforms";
import { type VaultAgentSettings, sanitizeSettings } from "@/settings/model";
import { Notice } from "obsidian";
import { t } from "@/i18n";

let writeQueue: Promise<void> = Promise.resolve();
let lastPersistedSettings: VaultAgentSettings | undefined;
let suppressNextPersist = false;
let transactionEpoch = 0;
const pendingTombstones = new Set<string>();

const KEYCHAIN_VAULT_ID_RE = /^[a-f0-9]{8}$/;

function isValidKeychainVaultId(value: unknown): value is string {
  return typeof value === "string" && KEYCHAIN_VAULT_ID_RE.test(value);
}

function cloneRawSettings(rawData: unknown): VaultAgentSettings {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return {} as VaultAgentSettings;
  }
  return structuredClone(rawData) as VaultAgentSettings;
}

export function resetPersistenceState(): void {
  writeQueue = Promise.resolve();
  lastPersistedSettings = undefined;
  suppressNextPersist = false;
  transactionEpoch = 0;
  pendingTombstones.clear();
}

export function refreshLastPersistedSettings(data: VaultAgentSettings): void {
  lastPersistedSettings = structuredClone(data);
}

export function suppressNextPersistOnce(): void {
  suppressNextPersist = true;
}

export async function runPersistenceTransaction(task: () => Promise<void>): Promise<void> {
  const job = writeQueue.then(async () => {
    try {
      await task();
    } finally {
      transactionEpoch++;
    }
  });
  writeQueue = job.catch(() => {});
  return job;
}

export async function flushPersistence(): Promise<void> {
  await writeQueue;
}

export async function loadSettingsWithKeychain(
  rawData: unknown,
  saveData: (data: VaultAgentSettings) => Promise<void>
): Promise<VaultAgentSettings> {
  const rawSettings = cloneRawSettings(rawData);
  const keychain = KeychainService.getInstance();
  const vaultId = isValidKeychainVaultId(rawSettings._keychainVaultId)
    ? rawSettings._keychainVaultId
    : keychain.getVaultId();
  keychain.setVaultId(vaultId);
  const baseline = stripKeychainFields({
    ...sanitizeSettings({ ...structuredClone(DEFAULT_SETTINGS), ...rawSettings }),
    _keychainVaultId: vaultId,
  });
  if (rawData == null) await saveData(baseline);

  if (!keychain.isAvailable()) {
    new Notice(t("notice.keychainUnavailable"));
    lastPersistedSettings = structuredClone(baseline);
    return baseline;
  }

  const { settings: hydrated, hadFailures } = await keychain.hydrateFromKeychain(baseline);
  if (hadFailures) new Notice(t("notice.keychainReadFailed"));
  lastPersistedSettings = structuredClone(hydrated);
  return hydrated;
}

async function persistKeychainSettings(
  settings: VaultAgentSettings,
  saveData: (data: VaultAgentSettings) => Promise<void>,
  prev: VaultAgentSettings | undefined
): Promise<void> {
  const keychain = KeychainService.getInstance();
  const cleaned = settings;
  const keychainDiffBase = lastPersistedSettings ?? prev;
  const rollbackSettings = lastPersistedSettings ?? prev;
  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(cleaned, keychainDiffBase);
  const replayedTombstones: string[] = [];

  try {
    for (const id of pendingTombstones) {
      keychain.setSecretById(id, "");
      replayedTombstones.push(id);
    }

    for (const [id, value] of secretEntries) {
      keychain.setSecretById(id, value);
    }

    for (const id of keychainIdsToDelete) {
      try {
        keychain.setSecretById(id, "");
      } catch (error) {
        pendingTombstones.add(id);
        throw error;
      }
    }

    await saveData(stripKeychainFields(cleaned));
    lastPersistedSettings = structuredClone(cleaned);
    for (const id of replayedTombstones) {
      pendingTombstones.delete(id);
    }
  } catch (error) {
    try {
      await restoreKeychainFromSettings(keychain, rollbackSettings, cleaned);
    } catch (rollbackError) {
      logWarn("Failed to roll back Keychain after settings persistence failed.", rollbackError);
    }
    throw error;
  }
}

export async function persistSettingsWithinTransaction(
  settings: VaultAgentSettings,
  saveData: (data: VaultAgentSettings) => Promise<void>,
  prevSettings?: VaultAgentSettings
): Promise<void> {
  await persistKeychainSettings(settings, saveData, prevSettings);
}

export async function persistSettings(
  settings: VaultAgentSettings,
  saveData: (data: VaultAgentSettings) => Promise<void>,
  prevSettings?: VaultAgentSettings
): Promise<void> {
  if (suppressNextPersist) {
    suppressNextPersist = false;
    return;
  }

  const epochAtEnqueue = transactionEpoch;
  const job = writeQueue.then(() => {
    if (epochAtEnqueue !== transactionEpoch) return;
    return persistKeychainSettings(settings, saveData, prevSettings);
  });
  writeQueue = job.catch(() => {});
  return job;
}

async function restoreKeychainFromSettings(
  keychain: KeychainService,
  restoreFrom: VaultAgentSettings | undefined,
  failedSettings: VaultAgentSettings
): Promise<void> {
  if (!restoreFrom) return;

  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(
    restoreFrom,
    failedSettings
  );

  for (const [id, value] of secretEntries) {
    try {
      keychain.setSecretById(id, value);
    } catch (error) {
      logWarn(`Failed to restore Keychain entry "${id}" during rollback.`, error);
    }
  }

  for (const id of keychainIdsToDelete) {
    try {
      keychain.setSecretById(id, "");
      pendingTombstones.delete(id);
    } catch (error) {
      logWarn(`Failed to write Keychain tombstone "${id}" during rollback.`, error);
    }
  }
}
