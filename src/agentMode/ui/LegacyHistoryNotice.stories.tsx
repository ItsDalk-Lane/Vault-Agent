import {
  LegacyHistoryNotice,
  type LegacyHistoryNoticeProps,
} from "@/agentMode/ui/LegacyHistoryNotice";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Legacy History",
  component: LegacyHistoryNotice,
  args: { busy: false, onImport: () => undefined, onExport: () => undefined },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<LegacyHistoryNoticeProps>;
export default meta;

export const ReadOnly: StoryObj<LegacyHistoryNoticeProps> = {};
export const Importing: StoryObj<LegacyHistoryNoticeProps> = { args: { busy: true } };
export const ArchivedPiChat: StoryObj<LegacyHistoryNoticeProps> = { args: { canImport: false } };
