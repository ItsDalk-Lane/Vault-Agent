import type { Meta, StoryObj } from "@/lib/story";
import { MoreVertical } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { SkillRowLayout, type SkillRowLayoutProps } from "./SkillRowLayout";

const meta = {
  title: "Skills/Custom skill row",
  component: SkillRowLayout,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SkillRowLayoutProps>;
export default meta;

const args: SkillRowLayoutProps = {
  name: "writing-review-with-a-long-descriptive-name",
  description: "Review the structure, clarity and supporting evidence in a long-form note.",
  controls: <SettingSwitch checked aria-label="Enable writing-review in Vault Agent" />,
  actions: (
    <Button variant="ghost" size="icon" aria-label="More actions">
      <MoreVertical className="tw-size-4" />
    </Button>
  ),
};

export const Canonical: StoryObj<SkillRowLayoutProps> = { args };
export const WithChips: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    annotations: (
      <>
        <Badge variant="secondary">hidden from /</Badge>
      </>
    ),
  },
};
export const LegacySource: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    annotations: (
      <span className="tw-truncate tw-text-ui-smaller tw-text-faint">Imported source folder</span>
    ),
  },
};
export const ChipsAndLocation: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    annotations: (
      <>
        <Badge variant="secondary">hidden from /</Badge>
        <span className="tw-truncate tw-text-ui-smaller tw-text-faint">Imported source folder</span>
      </>
    ),
  },
};
