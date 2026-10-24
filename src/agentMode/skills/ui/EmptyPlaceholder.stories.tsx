import type { Meta, StoryObj } from "@/lib/story";
import { EmptyPlaceholder } from "./EmptyPlaceholder";
const meta = {
  title: "Skills/Empty",
  component: EmptyPlaceholder,
  args: { folder: "vault-agent/skills" },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof EmptyPlaceholder>>;
export default meta;
export const ManagedFolder: StoryObj<React.ComponentProps<typeof EmptyPlaceholder>> = {};
