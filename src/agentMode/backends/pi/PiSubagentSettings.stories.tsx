import { PiSubagentSettings, type PiSubagentSettingsProps } from "./PiSubagentSettings";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Pi Subagent Settings",
  component: PiSubagentSettings,
  args: { writerEnabled: false, onWriterEnabledChange: () => undefined },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<PiSubagentSettingsProps>;
export default meta;
export const Default: StoryObj<PiSubagentSettingsProps> = {};
export const WriterEnabled: StoryObj<PiSubagentSettingsProps> = { args: { writerEnabled: true } };
