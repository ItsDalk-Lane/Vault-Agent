import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";

import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";

import { SettingSection } from "@/components/ui/setting-section";
import { DEFAULT_OPEN_AREA, SEND_SHORTCUT } from "@/constants";
import { useApp } from "@/context";
import { applyLanguage, t, type AppLanguage } from "@/i18n";

import { openAgentsFile, writeAgentsFile } from "@/instructions/agentsFile";
import { useAgentsFileDraft } from "@/instructions/useAgentsFileDraft";
import { logError } from "@/logger";
import { debounce } from "@/utils/debounce";
import { ensureVaultAgentSubfolders } from "@/settings/vaultAgentFolder";
import {
  applyVaultAgentRootChange,
  vaultAgentRootContainsNotes,
  findVaultAgentRootFileConflict,
} from "@/settings/vaultAgentRootChange";
import { updateSetting, useSettingsValue, validateVaultAgentFolder } from "@/settings/model";
import { DesktopOnlySettingsPanel } from "@/settings/v2/components/DesktopOnlySettingsPanel";
import { VaultAgentFolderChangeNotice } from "@/settings/v2/components/VaultAgentFolderChangeNotice";
import { VaultInstructionsSetting } from "@/settings/v2/components/VaultInstructionsSetting";

import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { Folder } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";

const LazyAgentSettings = React.lazy(() =>
  import("@/settings/v2/components/AgentSettings").then((module) => ({
    default: module.AgentSettings,
  }))
);

const AgentsSection: React.FC = () => {
  if (!isDesktopRuntime()) {
    return <DesktopOnlySettingsPanel message={t("settings.basic.agentsDesktopOnly")} />;
  }
  return (
    <React.Suspense fallback={null}>
      <LazyAgentSettings />
    </React.Suspense>
  );
};

export const BasicSettings: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();

  const persistedRoot = settings.vaultAgentFolder;
  const [folderDraft, setFolderDraft] = useState(persistedRoot);

  useEffect(() => {
    /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resync the draft when the persisted root changes underneath us (e.g. Reset Settings or a completed change) */
    setFolderDraft(persistedRoot);
    /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resume checking after persisted-root synchronization */
  }, [persistedRoot]);

  const [vaultInstructions, setVaultInstructions] = useAgentsFileDraft(app, "");

  const saveVaultInstructions = useMemo(() => {
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (next: string): Promise<void> => {
      queue = queue.then(() =>
        writeAgentsFile(app, "", next).catch((error) => {
          logError("Failed to save vault instructions.", error);
          new Notice(t("settings.basic.saveAgentsFailed"));
        })
      );
      return queue;
    };
    return debounce(enqueue, 1000);
  }, [app]);
  useEffect(() => () => void saveVaultInstructions.flush(), [saveVaultInstructions]);

  const handleOpenVaultInstructions = async () => {
    await saveVaultInstructions.flush();
    (app as unknown as { setting: { close: () => void } }).setting.close();
    try {
      await openAgentsFile(app, "");
    } catch (error) {
      logError("Failed to open vault AGENTS.md.", error);
      new Notice(error instanceof Error ? error.message : t("settings.basic.openAgentsFailed"));
    }
  };

  const applyFolderChange = () => {
    const validation = validateVaultAgentFolder(folderDraft, app.vault.configDir);
    if (!validation.ok) {
      new Notice(t("settings.basic.folderInvalid", { reason: validation.reason }), 5000);
      return;
    }
    const folder = validation.folder;
    if (folder === persistedRoot) {
      new Notice(t("settings.basic.folderSame"), 3000);
      return;
    }
    const conflict = findVaultAgentRootFileConflict(app, folder);
    if (conflict) {
      new Notice(t("settings.basic.folderConflict", { conflict, folder }), 8000);
      return;
    }
    const containsMarkdown = vaultAgentRootContainsNotes(app, folder);
    new ConfirmModal(
      app,
      () => {
        void applyVaultAgentRootChange(app, folder)
          .then(() => ensureVaultAgentSubfolders(app.vault, { vaultAgentFolder: folder }))
          .then(() => new Notice(t("settings.basic.folderChanged", { folder }), 4000))
          .catch(() => new Notice(t("settings.basic.folderChangeFailed"), 5000));
      },
      <VaultAgentFolderChangeNotice
        oldRoot={persistedRoot}
        newRoot={folder}
        containsMarkdown={containsMarkdown}
      />,
      "",
      containsMarkdown ? t("settings.basic.folderUse") : t("settings.basic.folderChange"),
      t("common.cancel"),
      () => setFolderDraft(persistedRoot)
    ).open();
  };

  return (
    <div className="tw-space-y-4">
      <AgentsSection />

      <SettingSection label={t("settings.basic.general")}>
        <SettingItem
          type="select"
          title={t("settings.basic.language")}
          description={t("settings.basic.languageDesc")}
          value={settings.language}
          onChange={(value) => {
            const language = value as AppLanguage;
            updateSetting("language", language);
            applyLanguage(language);
          }}
          options={[
            { label: t("settings.language.auto"), value: "auto" },
            { label: t("settings.language.en"), value: "en" },
            { label: t("settings.language.zhCn"), value: "zh-CN" },
          ]}
        />

        <SettingItem
          type="select"
          title={t("settings.basic.openPluginIn")}
          description={t("settings.basic.openPluginInDesc")}
          value={settings.defaultOpenArea}
          onChange={(value) => updateSetting("defaultOpenArea", value as DEFAULT_OPEN_AREA)}
          options={[
            { label: t("settings.basic.openArea.view"), value: DEFAULT_OPEN_AREA.VIEW },
            { label: t("settings.basic.openArea.editor"), value: DEFAULT_OPEN_AREA.EDITOR },
          ]}
        />

        <SettingItem
          type="select"
          title={t("settings.basic.sendShortcut")}
          description={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">{t("settings.basic.sendShortcutDesc")}</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-xs tw-text-muted">
                      {t("settings.basic.sendShortcutHelp")}
                    </div>
                  </div>
                }
              />
            </div>
          }
          value={settings.defaultSendShortcut}
          onChange={(value) => updateSetting("defaultSendShortcut", value as SEND_SHORTCUT)}
          options={[
            { label: "Enter", value: SEND_SHORTCUT.ENTER },
            { label: "Shift + Enter", value: SEND_SHORTCUT.SHIFT_ENTER },
          ]}
        />

        <SettingItem
          type="custom"
          title={t("settings.basic.folderTitle")}
          description={t("settings.basic.folderDesc")}
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <Input
              type="text"
              value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyFolderChange();
                }
              }}
              placeholder="vault-agent"
              className="tw-w-full sm:tw-w-[160px]"
              aria-label={t("settings.basic.folderAria")}
            />
            <Button
              variant="secondary"
              onClick={applyFolderChange}
              aria-label={t("settings.basic.applyFolderAria")}
            >
              {t("common.apply")}
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => revealFolderInExplorer(app, settings.vaultAgentFolder)}
              aria-label={t("settings.basic.openFolder")}
              title={t("settings.basic.openFolder")}
            >
              <Folder className="tw-size-4" />
            </Button>
          </div>
        </SettingItem>
      </SettingSection>

      <SettingSection label={t("settings.basic.customInstructions")}>
        {vaultInstructions !== null && (
          <VaultInstructionsSetting
            value={vaultInstructions}
            onChange={(next) => {
              setVaultInstructions(next);
              void saveVaultInstructions(next);
            }}
            onOpen={() => void handleOpenVaultInstructions()}
          />
        )}
      </SettingSection>
    </div>
  );
};
