import React from "react";
import { SettingSection } from "./setting-section";
import { SettingItem } from "./setting-item";
import type { Meta, StoryObj } from "@/lib/story";

function SettingRows() {
  return (
    <SettingSection>
      <SettingItem
        type="select"
        title="Default model"
        description="Select a model for new conversations."
        value="local"
        options={[{ label: "A local model with a long readable name", value: "local" }]}
        onChange={() => undefined}
      />
      <SettingItem
        type="switch"
        title="Notifications"
        description="Play a sound when a turn is complete."
        checked={true}
        onCheckedChange={() => undefined}
      />
      <SettingItem type="text" title="Name" value="Saved name" onChange={() => undefined} />
      <SettingItem
        type="textarea"
        title="Description"
        value="Saved description"
        onChange={() => undefined}
      />
    </SettingSection>
  );
}

const meta = {
  title: "UI/Setting Item",
  component: SettingRows,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta;
export default meta;
export const ResponsiveRows: StoryObj = {};
