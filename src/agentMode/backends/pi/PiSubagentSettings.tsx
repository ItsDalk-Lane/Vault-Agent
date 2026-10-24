import React from "react";
import { t } from "@/i18n";

export interface PiSubagentSettingsProps {
  readonly writerEnabled: boolean;
  readonly onWriterEnabledChange: (enabled: boolean) => void;
}

export function PiSubagentSettings({
  writerEnabled,
  onWriterEnabledChange,
}: PiSubagentSettingsProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <label className="tw-flex tw-items-start tw-gap-2 tw-text-sm">
        <input
          type="checkbox"
          checked={writerEnabled}
          onChange={(event) => onWriterEnabledChange(event.target.checked)}
        />
        <span>{t("agentInfra.backend.pi.subagents.writer")}</span>
      </label>
      <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
        {t("agentInfra.backend.pi.subagents.writerDescription")}
      </p>
    </div>
  );
}
