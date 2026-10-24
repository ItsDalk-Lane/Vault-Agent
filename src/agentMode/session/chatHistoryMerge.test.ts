import { AI_SENDER, USER_SENDER } from "@/constants";
import { deriveChatTitleFromMessages } from "./chatHistoryMerge";
import type { AgentChatMessage } from "./types";

function msg(sender: string, message: string): AgentChatMessage {
  return {
    id: `${sender}-${message.slice(0, 4)}`,
    sender,
    message,
    isVisible: true,
  } as AgentChatMessage;
}

describe("chatHistoryMerge", () => {
  describe("deriveChatTitleFromMessages()", () => {
    it("labels image-only sessions and prefers usable user text https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      const imageMessage = {
        ...msg(USER_SENDER, ""),
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
      };
      expect(deriveChatTitleFromMessages([imageMessage])).toBe("Image attachment");
      expect(deriveChatTitleFromMessages([imageMessage, msg(USER_SENDER, "Explain this")])).toBe(
        "Explain this"
      );
      expect(deriveChatTitleFromMessages([{ ...imageMessage, sender: AI_SENDER }])).toBeNull();
      expect(
        deriveChatTitleFromMessages([{ ...imageMessage, content: [null, {}, { type: "text" }] }])
      ).toBeNull();
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/634 skips /compact messages so the chat is titled from the first real message", () => {
      expect(deriveChatTitleFromMessages([msg(USER_SENDER, "/compact")])).toBeNull();
      expect(
        deriveChatTitleFromMessages([
          msg(USER_SENDER, "/compact keep the API"),
          msg(USER_SENDER, "Plan the migration"),
        ])
      ).toBe("Plan the migration");
    });

    it("uses the first user message", () => {
      const title = deriveChatTitleFromMessages([
        msg(USER_SENDER, "Summarize today's meeting notes"),
        msg(AI_SENDER, "Sure, here is a summary…"),
      ]);
      expect(title).toBe("Summarize today's meeting notes");
    });

    it("skips a leading assistant/system message and collapses whitespace", () => {
      const title = deriveChatTitleFromMessages([
        msg(AI_SENDER, "How can I help?"),
        msg(USER_SENDER, "  refactor\n   the  parser  "),
      ]);
      expect(title).toBe("refactor the parser");
    });

    it("unwraps wikilinks and elides long messages", () => {
      const long = `Look at [[Project Plan]] and tell me everything that is wrong with the current approach in detail`;
      const title = deriveChatTitleFromMessages([msg(USER_SENDER, long)]);
      expect(title).toContain("Look at Project Plan");
      expect(title!.endsWith("…")).toBe(true);
      expect(title!.length).toBeLessThanOrEqual(61);
    });

    it("returns null when there is no usable user text", () => {
      expect(deriveChatTitleFromMessages([])).toBeNull();
      expect(deriveChatTitleFromMessages([msg(AI_SENDER, "only assistant")])).toBeNull();
      expect(deriveChatTitleFromMessages([msg(USER_SENDER, "   ")])).toBeNull();
    });
  });
});
