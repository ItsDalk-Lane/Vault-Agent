import { DiffLines } from "@/agentMode/ui/DiffLines";
import { ExpandedBlockSection } from "@/agentMode/ui/ExpandedBlockSection";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

// 展开体分段面板的视觉状态：命令/输入/输出/差异四类段。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/10
const SectionsDemo: React.FC = () => (
  <div className="tw-flex tw-flex-col tw-gap-2">
    <ExpandedBlockSection label="Command" text={"npm test"} />
    <ExpandedBlockSection
      label="Input"
      text={'{\n  "file_path": "notes/today.md",\n  "limit": 50\n}'}
    />
    <ExpandedBlockSection label="Output" text={'{\n  "matches": [\n    "notes/today.md"\n  ]\n}'} />
    <ExpandedBlockSection label="notes/today.md" copyText="# 今日\n今日记录">
      <DiffLines oldText={"# 今日"} newText={"# 今日\n今日记录"} />
    </ExpandedBlockSection>
  </div>
);

const meta = {
  title: "Agent Mode/Expanded Block Sections",
  component: ExpandedBlockSection,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof ExpandedBlockSection>>;
export default meta;

export const AllSectionKinds: StoryObj = {
  render: SectionsDemo,
};
