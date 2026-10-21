import { t } from "@/i18n";
import { getEffectiveSystemPromptsFolder } from "@/settings/vaultAgentFolder";
import { useSystemPrompts } from "@/system-prompts/state";
import React from "react";

export interface LegacyChatPromptsNoticeViewProps {
  promptCount: number;
  folderPath: string;
}

export const LegacyChatPromptsNoticeView: React.FC<LegacyChatPromptsNoticeViewProps> = ({
  promptCount,
  folderPath,
}) => {
  if (promptCount === 0) return null;

  return (
    <div className="tw-mb-3 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-ui-smaller tw-text-muted">
      {t("settings.legacyPrompts.prefix")} <code>AGENTS.md</code>
      {promptCount === 1
        ? t("settings.legacyPrompts.singleSuffix")
        : t("settings.legacyPrompts.manySuffix", { count: promptCount })}{" "}
      <code>{folderPath}</code> {t("settings.legacyPrompts.tail")}
    </div>
  );
};

export const LegacyChatPromptsNotice: React.FC = () => {
  const prompts = useSystemPrompts();
  return (
    <LegacyChatPromptsNoticeView
      promptCount={prompts.length}
      folderPath={getEffectiveSystemPromptsFolder()}
    />
  );
};
