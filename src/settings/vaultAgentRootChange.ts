import { logWarn } from "@/logger";
import { matchSystemRoots } from "@/search/searchUtils";
import { getVaultAgentSaveData } from "@/settings/vaultAgentSaveData";
import {
  type VaultAgentSettings,
  getSettings,
  normalizeRootFolders,
  setSettings,
  validateVaultAgentFolder,
} from "@/settings/model";
import {
  persistSettingsWithinTransaction,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import type { App } from "obsidian";
import { normalizePath, TFile } from "obsidian";

function buildRootPatch(
  current: Pick<VaultAgentSettings, "vaultAgentFolder" | "vaultAgentRootHistory">,
  folder: string
): Pick<VaultAgentSettings, "vaultAgentFolder" | "vaultAgentRootHistory"> {
  return {
    vaultAgentRootHistory: normalizeRootFolders([
      ...current.vaultAgentRootHistory,
      current.vaultAgentFolder,
      folder,
    ]),
    vaultAgentFolder: folder,
  };
}

export function vaultAgentRootContainsNotes(app: App, folder: string): boolean {
  const root = normalizePath(folder).replace(/\/+$/, "");
  if (root.length === 0) return false;
  return app.vault.getMarkdownFiles().some((file) => matchSystemRoots(file.path, [root]));
}

export function findVaultAgentRootFileConflict(app: App, folder: string): string | null {
  const root = normalizePath(folder).replace(/\/+$/, "");
  if (root.length === 0) return null;
  let prefix = "";
  for (const segment of root.split("/")) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    if (app.vault.getAbstractFileByPath(prefix) instanceof TFile) {
      return prefix;
    }
  }
  return null;
}

export async function applyVaultAgentRootChange(app: App, newRoot: string): Promise<void> {
  const validation = validateVaultAgentFolder(newRoot, app.vault.configDir);
  if (!validation.ok) {
    logWarn("Vault Agent root change rejected an invalid folder value.", validation.reason);
    return;
  }
  const folder = validation.folder;
  const saveData = getVaultAgentSaveData(app);

  await runPersistenceTransaction(async () => {
    const previous = getSettings();
    const target: VaultAgentSettings = { ...previous, ...buildRootPatch(previous, folder) };
    await persistSettingsWithinTransaction(target, saveData, previous);

    const fresh = getSettings();
    const merged: VaultAgentSettings = { ...fresh, ...buildRootPatch(fresh, folder) };
    if (JSON.stringify(merged) !== JSON.stringify(target)) {
      try {
        await persistSettingsWithinTransaction(merged, saveData, target);
      } catch (reconcileError) {
        logWarn(
          "Vault Agent root change: reconcile save for a concurrent edit failed; " +
            "it stays in memory and lands with the next save.",
          reconcileError
        );
      }
    }

    suppressNextPersistOnce();
    setSettings((current) => buildRootPatch(current, folder));
  });
}
