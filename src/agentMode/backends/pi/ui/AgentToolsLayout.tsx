import { SettingSection } from "@/components/ui/setting-section";
import { t } from "@/i18n";
import React from "react";

export interface AgentToolsLayoutProps {
  permissions: React.ReactNode;
  externalFolders: React.ReactNode;
}

export function AgentToolsLayout({ permissions, externalFolders }: AgentToolsLayoutProps) {
  return (
    <div className="tw-space-y-4">
      <SettingSection label={t("settings.tools.permissions")}>
        <div className="tw-flex tw-flex-col tw-gap-4 tw-py-4">{permissions}</div>
      </SettingSection>
      <SettingSection>
        <div className="tw-py-4">{externalFolders}</div>
      </SettingSection>
    </div>
  );
}
