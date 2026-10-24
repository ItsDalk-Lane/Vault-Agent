import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import { AgentNotificationSoundSettings } from "./AgentNotificationSoundSettings";
import { AgentSettingsLayout, type AgentSettingsLayoutProps } from "./AgentSettingsLayout";

function content(soundEnabled: boolean): AgentSettingsLayoutProps {
  return {
    notificationSettings: (
      <AgentNotificationSoundSettings
        enabled={soundEnabled}
        onEnabledChange={() => undefined}
        onSoundChange={() => undefined}
        soundId="piano"
        soundOptions={[{ label: "Piano key", value: "piano" }]}
      />
    ),
  };
}
const meta = {
  title: "Settings/Chat Settings",
  component: AgentSettingsLayout,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentSettingsLayoutProps>;
export default meta;
export const NotificationsOn: StoryObj<AgentSettingsLayoutProps> = { args: content(true) };
export const NotificationsOff: StoryObj<AgentSettingsLayoutProps> = { args: content(false) };
