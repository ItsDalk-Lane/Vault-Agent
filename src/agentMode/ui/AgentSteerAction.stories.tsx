import { AgentSteerAction, type AgentSteerActionProps } from "./AgentSteerAction";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Supplement current work",
  component: AgentSteerAction,
  args: { onSubmit: () => undefined },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentSteerActionProps>;
export default meta;
export const Ready: StoryObj<AgentSteerActionProps> = {};
export const WaitingForToolRound: StoryObj<AgentSteerActionProps> = { args: { pending: true } };
export const AttachmentsOrCommand: StoryObj<AgentSteerActionProps> = { args: { disabled: true } };
