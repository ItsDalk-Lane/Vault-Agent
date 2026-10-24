import { isCompactCommand } from "@/commands/compactCommand";
import { USER_SENDER } from "@/constants";
import { t } from "@/i18n";

import type { AgentChatMessage } from "./types";

const MAX_DERIVED_TITLE_CHARS = 60;

export function untitledNativeChat(): string {
  return t("agentInfra.session.untitledChat");
}

export function deriveChatTitleFromMessages(messages: AgentChatMessage[]): string | null {
  // A /compact command says nothing about what the chat is about.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/634
  const firstUser = messages.find(
    (m) => m.sender === USER_SENDER && m.message.trim() && !isCompactCommand(m.message)
  );
  if (!firstUser) {
    // Screenshot-only sessions still need a recognizable tab and history title.
    // https://github.com/logancyang/obsidian-copilot/issues/2850
    return messages.some(
      (m) =>
        m.sender === USER_SENDER &&
        m.content?.some(
          (block) =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "image_url"
        )
    )
      ? t("agentInfra.session.imageAttachment")
      : null;
  }
  const text = firstUser.message
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= MAX_DERIVED_TITLE_CHARS) return text;
  return `${text.slice(0, MAX_DERIVED_TITLE_CHARS).trimEnd()}…`;
}
