import React from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export interface LegacyHistoryNoticeProps {
  readonly busy: boolean;
  readonly onImport: () => void;
  readonly onExport: () => void;
  // Pi 归档已经保留原记录，不能再提示用户按旧引擎历史重复导入。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  readonly canImport?: boolean;
}

export function LegacyHistoryNotice({
  busy,
  onImport,
  onExport,
  canImport = true,
}: LegacyHistoryNoticeProps) {
  return (
    <div className="tw-m-2 tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-border tw-p-3">
      <p className="tw-m-0 tw-text-ui-small tw-text-muted">
        {t(canImport ? "controls.legacyReadOnly" : "controls.piReadOnlyHistory")}
      </p>
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        {canImport && (
          <Button variant="default" disabled={busy} onClick={onImport}>
            {t("controls.importLegacy")}
          </Button>
        )}
        <Button variant="ghost2" disabled={busy} onClick={onExport}>
          {t("controls.exportArchive")}
        </Button>
      </div>
    </div>
  );
}
