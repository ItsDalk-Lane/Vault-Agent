import { usePlugin } from "@/contexts/PluginContext";
import { t } from "@/i18n";
import {
  describeLocalKeychainEntries,
  collectLocalData,
  type LocalDataPaths,
  type LocalDataStatus,
} from "@/services/localDataStatus";
import { KeychainService } from "@/services/keychainService";
import { getSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import {
  LocalDataPanel,
  type LocalDataKeychainGroup,
  type LocalDataKeychainGroupKey,
} from "@/settings/v2/components/LocalDataPanel";
import {
  buildLocalDataTree,
  type LocalDataTreeNodeData,
} from "@/settings/v2/components/localDataTree";
import { LocalKeychainDetailModal } from "@/settings/v2/components/LocalKeychainModal";
import { FileSystemAdapter, Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_TREE: readonly LocalDataTreeNodeData[] = Object.freeze([]);

const copyPathToClipboard = async (path: string) => {
  try {
    await navigator.clipboard.writeText(path);
  } catch (failure) {
    new Notice(
      t("localData.pathActionFailed", {
        error: failure instanceof Error ? failure.message : String(failure),
      })
    );
  }
};

const revealPathInFolder = (path: string) => {
  try {
    const electron = requireNodeModule<{
      shell?: { showItemInFolder(path: string): void };
      remote?: { shell?: { showItemInFolder(path: string): void } };
    }>("electron");
    const shell = electron.shell ?? electron.remote?.shell;
    if (!shell) throw new Error(t("localData.locationUnavailable"));
    shell.showItemInFolder(path);
  } catch (failure) {
    new Notice(
      t("localData.pathActionFailed", {
        error: failure instanceof Error ? failure.message : String(failure),
      })
    );
  }
};

export function LocalDataSettings() {
  const plugin = usePlugin();
  const [status, setStatus] = useState<LocalDataStatus | null>(null);
  const [paths, setPaths] = useState<LocalDataPaths | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [keychainGroups, setKeychainGroups] = useState<readonly LocalDataKeychainGroup[] | null>(
    null
  );
  const [credentialsError, setCredentialsError] = useState<string>();
  const refreshRef = useRef<() => void>();
  const adapter = plugin.app.vault.adapter;
  const settingsPath =
    adapter instanceof FileSystemAdapter
      ? adapter.getFullPath(`${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/data.json`)
      : "";
  useEffect(() => {
    let live = true;
    let running = false;
    let dirty = false;
    const refresh = async () => {
      // 删除通知和手动刷新可能同时到达；合并到同一次后续统计，避免旧结果覆盖新结果。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      setLoading(true);
      do {
        dirty = false;
        try {
          const backend = await plugin.agentSessionManager?.getLocalDataBackend();
          if (!live) return;
          if (!backend?.getLocalStoragePaths || !settingsPath)
            throw new Error(t("localData.storageUnavailable"));
          const locations = backend.getLocalStoragePaths();
          const result = await collectLocalData(locations, settingsPath);
          if (!live) return;
          setPaths(locations);
          setStatus(result);
          setError(undefined);
          // 钥匙串不可枚举时仍展示磁盘统计，不把不可用误报为零条。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          try {
            const storage = plugin.app.secretStorage;
            if (typeof storage?.listSecrets !== "function") {
              setKeychainGroups(null);
              setCredentialsError(t("localData.keychainEnumerationUnavailable"));
            } else {
              const keychain = KeychainService.getInstance(plugin.app);
              const groups = describeLocalKeychainEntries(
                storage.listSecrets(),
                keychain.getVaultId(),
                Object.values(getSettings().providers ?? {}).map((provider) => ({
                  apiKeyKeychainId: provider.apiKeyKeychainId,
                  displayName: provider.displayName,
                })),
                getSettings().agentMode.backends.pi?.mcpServers ?? [],
                keychain.getSecretMeta()
              );
              setKeychainGroups([
                { key: "providers", label: t("localData.credentials"), entries: groups.providers },
                { key: "mcp", label: t("localData.mcp"), entries: groups.mcp },
                { key: "other", label: t("localData.other"), entries: groups.other },
              ]);
              setCredentialsError(undefined);
            }
          } catch (failure) {
            setKeychainGroups(null);
            setCredentialsError(
              t("localData.keychainCountFailed", {
                error: failure instanceof Error ? failure.message : String(failure),
              })
            );
          }
        } catch (failure) {
          if (live) setError(failure instanceof Error ? failure.message : String(failure));
        }
      } while (live && dirty);
      running = false;
      if (live) setLoading(false);
    };
    const requestRefresh = () => void refresh();
    const unsubscribe = plugin.agentSessionManager?.subscribeStorageChanges(requestRefresh);
    refreshRef.current = requestRefresh;
    window.addEventListener("focus", requestRefresh);
    requestRefresh();
    return () => {
      live = false;
      refreshRef.current = undefined;
      unsubscribe?.();
      window.removeEventListener("focus", requestRefresh);
    };
  }, [plugin, settingsPath]);
  const tree = useMemo(
    () =>
      status && paths
        ? buildLocalDataTree({
            paths,
            status,
            vaultName: plugin.app.vault.getName(),
          })
        : EMPTY_TREE,
    [status, paths, plugin]
  );
  const settingsFileNote = useMemo(() => {
    const path = requireNodeModule<typeof import("node:path")>("node:path");
    const home = requireNodeModule<typeof import("node:os")>("node:os").homedir();
    const settingsDir = path.dirname(settingsPath);
    const displayDir =
      home && settingsDir.startsWith(home + path.sep)
        ? `~${settingsDir.slice(home.length)}`
        : settingsDir;
    return t("localData.settingsFileNote", { dir: displayDir });
  }, [settingsPath]);
  const openKeychainGroup = useCallback(
    (key: LocalDataKeychainGroupKey) => {
      const group = keychainGroups?.find((candidate) => candidate.key === key);
      if (!group) return;
      new LocalKeychainDetailModal({
        app: plugin.app,
        groupLabel: group.label,
        entries: group.entries,
        unreferencedOnly: key === "other",
      }).open();
    },
    [keychainGroups, plugin]
  );
  return (
    <LocalDataPanel
      status={status}
      tree={tree}
      loading={loading}
      error={error}
      keychainGroups={keychainGroups}
      credentialsError={credentialsError}
      settingsFileNote={settingsFileNote}
      onRefresh={() => refreshRef.current?.()}
      onCopy={(path) => void copyPathToClipboard(path)}
      onReveal={revealPathInFolder}
      onOpenKeychainGroup={openKeychainGroup}
    />
  );
}
