import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { t } from "@/i18n";
import React from "react";

export interface DebuggingSupportSectionProps {
  debug: boolean;
  onDebugChange: (checked: boolean) => void;
  frameLogEnabled: boolean;
  onFrameLogChange: (checked: boolean) => void;
  frameLogPath: string;
  onReportIssue: () => void;
  offerFeedbackCards: boolean;
  onOfferFeedbackCardsChange: (checked: boolean) => void;
  onOpenFrameLog: React.MouseEventHandler<HTMLButtonElement>;
  onClearFrameLog: React.MouseEventHandler<HTMLButtonElement>;
}

export const DebuggingSupportSection: React.FC<DebuggingSupportSectionProps> = ({
  debug,
  onDebugChange,
  frameLogEnabled,
  onFrameLogChange,
  frameLogPath,
  onReportIssue,
  offerFeedbackCards,
  onOfferFeedbackCardsChange,
  onOpenFrameLog,
  onClearFrameLog,
}) => (
  <SettingSection label={t("settings.debug.section")}>
    <SettingItem
      type="custom"
      title={t("report.title")}
      description={t("settings.debug.reportIssueDesc")}
    >
      <Button variant="default" size="sm" onClick={onReportIssue}>
        {t("report.title")}
      </Button>
    </SettingItem>

    <SettingItem
      type="switch"
      title={t("settings.debug.offerFeedback")}
      description={t("settings.debug.offerFeedbackDesc")}
      checked={offerFeedbackCards}
      onCheckedChange={onOfferFeedbackCardsChange}
    />

    <SettingItem
      type="switch"
      title={t("settings.debug.debugMode")}
      description={t("settings.debug.debugModeDesc")}
      checked={debug}
      onCheckedChange={onDebugChange}
    />

    <SettingItem
      type="custom"
      title={t("settings.debug.activityLog")}
      description={t("settings.debug.activityLogDesc", { path: frameLogPath })}
    >
      <div className="tw-flex tw-items-center tw-gap-2">
        <SettingSwitch checked={frameLogEnabled} onCheckedChange={onFrameLogChange} />
        <Button variant="secondary" size="sm" onClick={onOpenFrameLog}>
          {t("settings.debug.open")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onClearFrameLog}>
          {t("settings.debug.clear")}
        </Button>
      </div>
    </SettingItem>
  </SettingSection>
);
