import { SettingSection } from "@/components/ui/setting-section";
import { t } from "@/i18n";
import React from "react";

export interface AgentSettingsLayoutProps {
  notificationSettings: React.ReactNode;
}

export function AgentSettingsLayout({ notificationSettings }: AgentSettingsLayoutProps) {
  return (
    <div className="tw-space-y-4">
      <SettingSection label={t("settings.agents.notifications")}>
        {notificationSettings}
      </SettingSection>
    </div>
  );
}
