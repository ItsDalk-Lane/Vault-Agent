import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/i18n";
import React from "react";

interface NotificationSoundOption {
  label: string;
  value: string;
}

export interface AgentNotificationSoundSettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onSoundChange: (soundId: string) => void;
  soundId: string;
  soundOptions: ReadonlyArray<NotificationSoundOption>;
}

export const AgentNotificationSoundSettings: React.FC<AgentNotificationSoundSettingsProps> = ({
  enabled,
  onEnabledChange,
  onSoundChange,
  soundId,
  soundOptions,
}) => (
  <>
    <SettingItem
      type="switch"
      title={t("settings.notification.title")}
      description={t("settings.notification.description")}
      checked={enabled}
      onCheckedChange={onEnabledChange}
    />
    {enabled && (
      <SettingItem
        type="select"
        title={t("settings.notification.sound")}
        description={t("settings.notification.soundDescription")}
        value={soundId}
        onChange={onSoundChange}
        options={[...soundOptions]}
      />
    )}
  </>
);
