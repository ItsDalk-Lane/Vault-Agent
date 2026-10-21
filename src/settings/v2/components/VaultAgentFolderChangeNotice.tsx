import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { AlertTriangle, FolderSync } from "lucide-react";
import React from "react";

export interface VaultAgentFolderChangeNoticeProps {
  oldRoot: string;
  newRoot: string;
  containsMarkdown: boolean;
}

export const VaultAgentFolderChangeNotice: React.FC<VaultAgentFolderChangeNoticeProps> = ({
  oldRoot,
  newRoot,
  containsMarkdown,
}) => {
  return (
    <div className={cn("tw-flex tw-flex-col tw-gap-4")}>
      <div className={cn("tw-flex tw-items-center tw-gap-3 tw-text-normal")}>
        <FolderSync className={cn("tw-size-6 tw-shrink-0 tw-text-accent")} aria-hidden="true" />
        <h2 className={cn("tw-m-0 tw-text-xl tw-font-bold")}>
          {t("settings.folderChange.heading")}
        </h2>
      </div>
      <p className={cn("tw-m-0 tw-text-muted")}>
        {t("settings.folderChange.prefix")} <code>{newRoot}/</code>
        {t("settings.folderChange.mid")}{" "}
        <strong className={cn("tw-text-normal")}>{oldRoot}/</strong>
        {t("settings.folderChange.suffix")}
      </p>
      {containsMarkdown && (
        <div
          className={cn(
            "tw-flex tw-items-start tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-warning/40",
            "tw-bg-secondary tw-px-3 tw-py-2.5 tw-text-xs tw-text-normal"
          )}
          role="alert"
        >
          <AlertTriangle
            className={cn("tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning")}
            aria-hidden="true"
          />
          <span>
            <strong>{t("settings.folderChange.warningTitle")}</strong>{" "}
            {t("settings.folderChange.warningPrefix")} <code>{newRoot}/</code>{" "}
            {t("settings.folderChange.warningSuffix")}
          </span>
        </div>
      )}
    </div>
  );
};
