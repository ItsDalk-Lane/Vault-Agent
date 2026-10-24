import type { ComponentProps } from "react";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import type { Meta, StoryObj } from "@/lib/story";
const meta = {
  title: "Agent/Queued messages",
  component: QueuedMessageList,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { onRemove: () => {}, onEdit: () => {}, onInsert: () => {}, canInsert: () => true },
} satisfies Meta<ComponentProps<typeof QueuedMessageList>>;
export default meta;
export const ImageOnly: StoryObj<ComponentProps<typeof QueuedMessageList>> = {
  args: {
    messages: [
      {
        id: "image",
        text: "",
        rawInput: "",
        promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
      },
    ],
  },
};
export const InsertableWhileRunning: StoryObj<ComponentProps<typeof QueuedMessageList>> = {
  args: {
    messages: [{ id: "text", text: "换个思路继续", rawInput: "换个思路继续" }],
  },
};
export const AwaitingNextTurn: StoryObj<ComponentProps<typeof QueuedMessageList>> = {
  args: {
    messages: [{ id: "compact", text: "/compact", rawInput: "/compact" }],
    canInsert: () => false,
  },
};
export const InsertInFlight: StoryObj<ComponentProps<typeof QueuedMessageList>> = {
  args: {
    messages: [{ id: "text", text: "结合选区继续", rawInput: "结合选区继续" }],
    pendingInsertId: "text",
  },
};
