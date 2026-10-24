import { setSettings, useSettingsValue } from "@/settings/model";
import { playNotificationSound } from "@/utils/notificationSound";
import {
  getNotificationSoundOptions,
  isNotificationSoundId,
} from "@/utils/notificationSoundCatalog";
import React from "react";
import { AgentNotificationSoundSettings } from "./ui/AgentNotificationSoundSettings";
import { AgentSettingsLayout } from "./ui/AgentSettingsLayout";

export const AgentSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <AgentSettingsLayout
      notificationSettings={
        <AgentNotificationSoundSettings
          enabled={settings.agentMode.notificationSound}
          onEnabledChange={(enabled) =>
            setSettings((current) => ({
              agentMode: { ...current.agentMode, notificationSound: enabled },
            }))
          }
          onSoundChange={(value) => {
            if (!isNotificationSoundId(value)) return;
            setSettings((current) => ({
              agentMode: { ...current.agentMode, notificationSoundId: value },
            }));
            playNotificationSound(value);
          }}
          soundId={settings.agentMode.notificationSoundId}
          soundOptions={getNotificationSoundOptions()}
        />
      }
    />
  );
};
