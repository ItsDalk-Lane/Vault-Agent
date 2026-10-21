import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { Check, Copy } from "lucide-react";
import React from "react";
import { t } from "@/i18n";

interface CopyButtonProps {
  text: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({ text }) => {
  const { isCopied, copy } = useCopyToClipboard();
  return (
    <MessageActionButton
      label={t("ui.chat.copy")}
      icon={isCopied ? Check : Copy}
      onClick={() => copy(text)}
    />
  );
};
