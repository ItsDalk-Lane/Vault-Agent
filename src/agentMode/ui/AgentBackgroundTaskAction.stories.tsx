import {
  AgentBackgroundTaskAction,
  type AgentBackgroundTaskActionProps,
} from "./AgentBackgroundTaskAction";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Background tasks",
  component: AgentBackgroundTaskAction,
  args: { count: 2, onStop: () => undefined },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentBackgroundTaskActionProps>;
export default meta;
export const Running: StoryObj<AgentBackgroundTaskActionProps> = {};
export const OneRemaining: StoryObj<AgentBackgroundTaskActionProps> = { args: { count: 1 } };
export const Stopping: StoryObj<AgentBackgroundTaskActionProps> = { args: { pending: true } };
