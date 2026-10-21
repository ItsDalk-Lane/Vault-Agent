import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/i18n";
import type { ClaudeAutoModePermission } from "@/settings/model";
import React from "react";

function autoModeOptions(): { label: string; value: ClaudeAutoModePermission }[] {
  return [
    { label: t("agentInfra.backend.claude.autoMode.auto"), value: "auto" },
    { label: t("agentInfra.backend.claude.autoMode.acceptEdits"), value: "acceptEdits" },
    { label: t("agentInfra.backend.claude.autoMode.bypass"), value: "bypassPermissions" },
  ];
}

export interface ClaudeAutoModePermissionSettingProps {
  value: ClaudeAutoModePermission;
  onChange: (value: ClaudeAutoModePermission) => void;
}

export const ClaudeAutoModePermissionSetting: React.FC<ClaudeAutoModePermissionSettingProps> = ({
  value,
  onChange,
}) => (
  <SettingItem
    type="select"
    title={t("agentInfra.backend.claude.autoModeTitle")}
    description={t("agentInfra.backend.claude.autoModeDescription")}
    value={value}
    options={autoModeOptions()}
    onChange={(next) => onChange(next as ClaudeAutoModePermission)}
  />
);
