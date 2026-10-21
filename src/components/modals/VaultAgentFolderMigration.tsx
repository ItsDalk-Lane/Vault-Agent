import type { HiddenFolderMigration } from "@/settings/revealVaultAgentFolder";
import React from "react";
import { t } from "@/i18n";

export interface VaultAgentFolderMigrationProps {
  migration: HiddenFolderMigration;
}

export function VaultAgentFolderMigration({ migration }: VaultAgentFolderMigrationProps) {
  const { from, to } = migration;
  return (
    <div className="tw-flex tw-flex-col tw-gap-3 tw-whitespace-normal">
      <p className="tw-m-0">{t("ui.folderMigration.hiddenUnsupported", { from })}</p>
      {migration.status === "failed" ? (
        <p className="tw-m-0">
          {t("ui.folderMigration.failed", { reason: migration.reason, from, to })}
        </p>
      ) : migration.leftBehind.length === 0 ? (
        <p className="tw-m-0">{t("ui.folderMigration.done", { to })}</p>
      ) : (
        <>
          <p className="tw-m-0">{t("ui.folderMigration.leftBehind", { from, to })}</p>
          <ul className="tw-m-0 tw-max-h-48 tw-overflow-y-auto tw-pl-5 tw-text-muted">
            {migration.leftBehind.map((path) => (
              <li key={path} className="tw-break-words">
                {path}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
