import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { DebuggingSupportSection } from "@/settings/v2/components/DebuggingSupportSection";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { t } from "@/i18n";
import { getVaultAgentSaveData } from "@/settings/vaultAgentSaveData";
import { KeychainService } from "@/services/keychainService";
import {
  refreshLastPersistedSettings,
  releaseLegacyCredentialHold,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import { hasPersistedSecrets } from "@/services/settingsSecretTransforms";
import { logError } from "@/logger";
import {
  type VaultAgentSettings,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { Info, ShieldCheck, Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

const LazyAgentToolsSettings = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.AgentToolsSettings }))
);

export const AdvancedSettings: React.FC = () => {
  const app = useApp();
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const [forgetting, setForgetting] = useState(false);
  const [frameLogPath, setFrameLogPath] = useState(() =>
    t("settings.advanced.frameLogDesktopOnlyPath")
  );

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let cancelled = false;
    void import("@/agentMode").then(({ acpFrameSink }) => {
      if (!cancelled) {
        setFrameLogPath(acpFrameSink.getPath());
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const keychainAvailable = KeychainService.getInstance().isAvailable();
  const keychainAppearsEmpty = keychainAvailable && !hasPersistedSecrets(settings);

  const handleReportIssue = useCallback(() => {
    if (!isDesktopRuntime()) {
      new Notice(t("report.desktopOnly"));
      return;
    }
    void (async () => {
      const { openReportIssueModal } = await import("@/agentMode");
      openReportIssueModal(plugin, {
        activeBackend:
          plugin.agentSessionManager?.getActiveSession()?.backendId ??
          settings.agentMode.activeBackend,
      });
    })();
  }, [plugin, settings.agentMode.activeBackend]);

  const handleOpenFrameLog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      new Notice(t("settings.advanced.frameLogsDesktopOnly"));
      return;
    }
    try {
      const { acpFrameSink } = await import("@/agentMode");
      await acpFrameSink.open();
      setFrameLogPath(acpFrameSink.getPath());
    } catch {
      new Notice(t("settings.advanced.frameLogOpenFailed"));
    }
  }, []);

  const handleClearFrameLog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      new Notice(t("settings.advanced.frameLogsDesktopOnly"));
      return;
    }
    try {
      const { acpFrameSink } = await import("@/agentMode");
      await acpFrameSink.clear();
      setFrameLogPath(acpFrameSink.getPath());
      new Notice(t("settings.advanced.frameLogCleared"));
    } catch {
      new Notice(t("settings.advanced.frameLogClearFailed"));
    }
  }, []);

  const handleForgetAllSecrets = useCallback(async () => {
    if (forgetting) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        app,
        () => resolve(true),
        t("settings.advanced.forgetSecretsBody"),
        t("settings.advanced.forgetSecretsTitle"),
        t("settings.advanced.remove"),
        t("common.cancel"),
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setForgetting(true);
    try {
      const keychain = KeychainService.getInstance();
      const saveData = getVaultAgentSaveData(app);

      await runPersistenceTransaction(() =>
        keychain.forgetAllSecrets(
          async (data) => {
            await saveData(data);
            releaseLegacyCredentialHold();
          },
          (nextSettings) => {
            refreshLastPersistedSettings(nextSettings as VaultAgentSettings);
            suppressNextPersistOnce();
            setSettings(nextSettings);
          }
        )
      );
    } catch (error) {
      logError("Failed to forget secrets.", error);
      new Notice(t("settings.advanced.forgetSecretsFailed"));
    } finally {
      setForgetting(false);
    }
  }, [app, forgetting]);

  return (
    <div className="tw-space-y-4">
      {/* 工具权限沿用原配置，只调整入口；唯一内置引擎无需安装或配置按钮。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1 */}
      {isDesktopRuntime() && (
        <React.Suspense fallback={null}>
          <LazyAgentToolsSettings />
        </React.Suspense>
      )}
      <LegacyChatPromptsNotice />

      <SettingSection label={t("settings.advanced.others")}>
        <SettingItem
          type="custom"
          title={t("settings.advanced.apiKeyStorage")}
          description={
            !keychainAvailable ? (
              <>
                {t("settings.advanced.keychainUpdatePrefix")} <code>1.11.4+</code>{" "}
                {t("settings.advanced.keychainUpdateMid")}{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>
                {t("settings.advanced.keychainUpdateSuffix")}
              </>
            ) : keychainAppearsEmpty ? (
              <span className="tw-text-warning">
                {t("settings.advanced.keychainEmptyPrefix")}{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>
                {t("settings.advanced.keychainEmptySuffix")}
              </span>
            ) : (
              <>
                {t("settings.advanced.keychainStoredPrefix")}{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>
                {t("settings.advanced.keychainStoredSuffix")}
              </>
            )
          }
        >
          <div className="tw-flex tw-flex-col tw-items-start tw-gap-2 sm:tw-items-end">
            {keychainAvailable ? (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-bg-success tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-success">
                <ShieldCheck className="tw-size-4" />
                Obsidian Keychain
              </div>
            ) : (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-muted">
                <Info className="tw-size-4" />
                {t("settings.advanced.unavailable")}
              </div>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={safeAsyncHandler(handleForgetAllSecrets)}
              disabled={forgetting || !keychainAvailable}
              title={
                keychainAvailable ? undefined : t("settings.advanced.keychainUnavailableTitle")
              }
              className="tw-gap-1.5"
            >
              <Trash2 className="tw-size-4" />
              {forgetting ? t("settings.advanced.removing") : t("settings.advanced.deleteAllKeys")}
            </Button>
          </div>
        </SettingItem>
      </SettingSection>

      <DebuggingSupportSection
        debug={settings.debug}
        onDebugChange={(checked) => updateSetting("debug", checked)}
        frameLogEnabled={settings.agentMode.debugFullFrames}
        onFrameLogChange={(checked) => {
          setSettings((cur) => ({
            agentMode: { ...cur.agentMode, debugFullFrames: checked },
          }));
        }}
        frameLogPath={frameLogPath}
        onReportIssue={handleReportIssue}
        offerFeedbackCards={settings.agentMode.offerFeedbackCards}
        onOfferFeedbackCardsChange={(checked) => {
          setSettings((cur) => ({
            agentMode: { ...cur.agentMode, offerFeedbackCards: checked },
          }));
        }}
        onOpenFrameLog={safeAsyncHandler(handleOpenFrameLog)}
        onClearFrameLog={safeAsyncHandler(handleClearFrameLog)}
      />
    </div>
  );
};
