import { describeChatDelete, formatChatDeleteNotice } from "@/lib/chatDeleteText";

const AGENTS = [
  ["Claude Code", { displayName: "Claude", agentProductName: "Claude Code" }],
  ["Codex", { displayName: "Codex" }],
] as const;

describe("chatDeleteText", () => {
  describe("describeChatDelete()", () => {
    it.each(AGENTS)("names %s as the agent that may keep its own copy", (name, descriptor) => {
      expect(describeChatDelete(descriptor)).toBe(
        `Delete this chat from Vault Agent? ${name} may keep its own copy of this conversation on this computer.`
      );
    });

    it("asks only about Vault Agent when the chat has no known agent", () => {
      expect(describeChatDelete(undefined)).toBe("Delete this chat from Vault Agent?");
    });
  });

  describe("formatChatDeleteNotice()", () => {
    it.each(AGENTS)(
      "says the chat left Vault Agent and %s may keep its own copy",
      (name, descriptor) => {
        expect(formatChatDeleteNotice(descriptor)).toBe(
          `Chat deleted from Vault Agent. ${name} may keep its own copy.`
        );
      }
    );

    it("says only that the chat left Vault Agent when the chat has no known agent", () => {
      expect(formatChatDeleteNotice(undefined)).toBe("Chat deleted from Vault Agent.");
    });
  });
});
