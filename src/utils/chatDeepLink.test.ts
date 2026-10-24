import { buildChatDeepLink, buildChatMarkdownLink } from "@/utils/chatDeepLink";

describe("chatDeepLink", () => {
  describe("buildChatDeepLink()", () => {
    it("uses the registered protocol and preserves the session id across title changes", () => {
      expect(buildChatDeepLink("我的库", "root-123")).toBe(
        "obsidian://vault-agent?vault=%E6%88%91%E7%9A%84%E5%BA%93&id=root-123"
      );
    });
  });
  describe("buildChatMarkdownLink()", () => {
    it("escapes the visible title without changing the target", () => {
      expect(buildChatMarkdownLink("[聊天]", "target")).toBe("[\\[聊天\\]](target)");
    });
  });
});
