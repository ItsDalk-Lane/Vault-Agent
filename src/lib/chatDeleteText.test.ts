import { describeChatDelete, formatChatDeleteNotice } from "@/lib/chatDeleteText";

describe("chatDeleteText", () => {
  describe("describeChatDelete()", () => {
    it("warns that records, attachments and revert backups are permanently deleted", () => {
      expect(describeChatDelete()).toContain("cannot be undone");
      expect(describeChatDelete()).toContain("revert backups");
    });
  });
  describe("formatChatDeleteNotice()", () => {
    it("confirms permanent deletion", () => {
      expect(formatChatDeleteNotice()).toBe("Chat permanently deleted.");
    });
  });
});
