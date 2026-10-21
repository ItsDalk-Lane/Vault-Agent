import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingDisclosure } from "@/components/ui/setting-disclosure";
import { SettingSection } from "@/components/ui/setting-section";
import { DEFAULT_OPEN_AREA, SEND_SHORTCUT } from "@/constants";
import { useApp } from "@/context";
import { applyLanguage, t, type AppLanguage } from "@/i18n";
import { cn } from "@/lib/utils";
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
import { QuickChatPanel } from "@/settings/v2/components/QuickChatPanel";
import { DesktopOnlySettingsPanel } from "@/settings/v2/components/DesktopOnlySettingsPanel";
import { VaultAgentFolderChangeNotice } from "@/settings/v2/components/VaultAgentFolderChangeNotice";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import { VaultInstructionsSetting } from "@/settings/v2/components/VaultInstructionsSetting";
import { formatDateTime } from "@/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { Folder, Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";

const LazyAgentSettings = React.lazy(() =>
  import("@/settings/v2/components/AgentSettings").then((module) => ({
    default: module.AgentSettings,
  }))
);

const AgentsSection: React.FC = () => {
  if (!isDesktopRuntime()) {
    // Quick Chat also runs on mobile; its settings must stay outside the desktop import gate.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/373
    return (
      <>
        <DesktopOnlySettingsPanel message={t("settings.basic.agentsDesktopOnly")} />
        <QuickChatPanel />
      </>
    );
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
  const [isChecking, setIsChecking] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [conversationNoteName, setConversationNoteName] = useState(
    settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}"
  );

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

  const applyCustomNoteFormat = () => {
    setIsChecking(true);

    try {
      const format = conversationNoteName || "{$date}_{$time}__{$topic}";
      const requiredVars = ["{$date}", "{$time}", "{$topic}"];
      const missingVars = requiredVars.filter((v) => !format.includes(v));

      if (missingVars.length > 0) {
        new Notice(
          t("settings.basic.noteFormatMissing", { variables: missingVars.join(", ") }),
          4000
        );
        return;
      }

      const illegalChars = /[\\/:*?"<>|]/;
      const formatWithoutVars = format
        .replace(/\{\$date}/g, "")
        .replace(/\{\$time}/g, "")
        .replace(/\{\$topic}/g, "");

      if (illegalChars.test(formatWithoutVars)) {
        new Notice(t("settings.basic.noteFormatIllegal"), 4000);
        return;
      }

      const { fileName: timestampFileName } = formatDateTime(new Date());
      const firstTenWords = "test topic name";

      const customFileName = format
        .replace("{$topic}", firstTenWords.slice(0, 100).replace(/\s+/g, "_"))
        .replace("{$date}", timestampFileName.split("_")[0])
        .replace("{$time}", timestampFileName.split("_")[1]);

      updateSetting("defaultConversationNoteName", format);
      setConversationNoteName(format);
      new Notice(t("settings.basic.noteFormatApplied", { example: customFileName }), 4000);
    } catch (error) {
      new Notice(
        t("settings.basic.noteFormatError", {
          error: error instanceof Error ? error.message : String(error),
        }),
        4000
      );
    } finally {
      setIsChecking(false);
    }
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
        <LegacyChatPromptsNotice />
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

      <SettingSection label={t("settings.basic.savingConversations")}>
        <SettingItem
          type="switch"
          title={t("settings.basic.autosave")}
          description={t("settings.basic.autosaveDesc")}
          checked={settings.autosaveChat}
          onCheckedChange={(checked) => updateSetting("autosaveChat", checked)}
        />

        <Collapsible open={templateOpen} onOpenChange={setTemplateOpen}>
          <CollapsibleTrigger asChild>
            <SettingDisclosure open={templateOpen} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SettingItem
              type="custom"
              title={t("settings.basic.filenameTemplate")}
              description={
                <div className="tw-flex tw-items-start tw-gap-1.5 ">
                  <span className="tw-leading-none">{t("settings.basic.filenameDesc")}</span>
                  <HelpTooltip
                    content={
                      <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                        <div className="tw-text-sm tw-font-medium tw-text-accent">
                          {t("settings.basic.filenameRequired")}
                        </div>
                        <div>
                          <div className="tw-text-sm tw-font-medium tw-text-muted">
                            {t("settings.basic.availableVariables")}
                          </div>
                          <ul className="tw-pl-4 tw-text-sm tw-text-muted">
                            <li>
                              <strong>{"{$date}"}</strong>: {t("settings.basic.varDate")}
                            </li>
                            <li>
                              <strong>{"{$time}"}</strong>: {t("settings.basic.varTime")}
                            </li>
                            <li>
                              <strong>{"{$topic}"}</strong>: {t("settings.basic.varTopic")}
                            </li>
                          </ul>
                          <i className="tw-mt-2 tw-text-sm tw-text-muted">
                            {t("settings.basic.filenameExample", {
                              example: "{$date}_{$time}__{$topic}",
                            })}{" "}
                            → 20250114_153232__polish_this_article_[[Readme]]
                          </i>
                        </div>
                      </div>
                    }
                  />
                </div>
              }
            >
              <div className="tw-flex tw-w-[320px] tw-items-center tw-gap-1.5">
                <Input
                  type="text"
                  className={cn(
                    "tw-min-w-[80px] tw-grow tw-transition-all tw-duration-200",
                    isChecking ? "tw-w-[80px]" : "tw-w-[120px]"
                  )}
                  placeholder="{$date}_{$time}__{$topic}"
                  value={conversationNoteName}
                  onChange={(e) => setConversationNoteName(e.target.value)}
                  disabled={isChecking}
                />

                <Button
                  onClick={() => applyCustomNoteFormat()}
                  disabled={isChecking}
                  variant="secondary"
                >
                  {isChecking ? (
                    <>
                      <Loader2 className="tw-mr-2 tw-size-4 tw-animate-spin" />
                      {t("common.apply")}
                    </>
                  ) : (
                    t("common.apply")
                  )}
                </Button>
              </div>
            </SettingItem>
          </CollapsibleContent>
        </Collapsible>
      </SettingSection>
    </div>
  );
};
