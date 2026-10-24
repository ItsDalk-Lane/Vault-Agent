import { ConfirmModal } from "./ConfirmModal";
import { useApp } from "@/context";
import { describeChatDelete } from "@/lib/chatDeleteText";
import type { Meta, StoryObj } from "@/lib/story";
import { useEffect } from "react";

interface ConfirmationStoryProps {
  destructive?: boolean;
}

function ConfirmationStory({ destructive = false }: ConfirmationStoryProps) {
  const app = useApp();
  useEffect(() => {
    const modal = new ConfirmModal(
      app,
      () => {},
      destructive ? describeChatDelete() : "Continue with this change?",
      destructive ? "Delete chat" : "Confirm change",
      destructive ? "Permanently delete" : "Continue",
      "Cancel",
      undefined,
      destructive
    );
    modal.open();
    return () => modal.close();
  }, [app, destructive]);
  return null;
}

const meta = {
  title: "Dialogs/Confirmation",
  component: ConfirmationStory,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ConfirmationStoryProps>;
export default meta;

export const DefaultConfirmation: StoryObj<ConfirmationStoryProps> = {};
export const PermanentDeletion: StoryObj<ConfirmationStoryProps> = {
  args: { destructive: true },
};
