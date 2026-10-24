import { buildNativeChatId, isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";

describe("nativeChatId", () => {
  describe("buildNativeChatId()", () => {
    it("uses the stable host session id directly", () => {
      expect(buildNativeChatId("pi", "root-example")).toBe("root-example");
    });
  });
  describe("isNativeChatId()", () => {
    it("accepts current root ids and rejects note paths and retired protocol ids", () => {
      expect(isNativeChatId("root-example")).toBe(true);
      expect(isNativeChatId("chats/chat.md")).toBe(false);
      expect(isNativeChatId("copilot-agent-session://pi/root-example")).toBe(false);
    });
  });
  describe("parseNativeChatId()", () => {
    it("resolves a root id through the bundled engine", () => {
      expect(parseNativeChatId("root-example")).toEqual({
        backendId: "pi",
        sessionId: "root-example",
      });
    });
    it("rejects paths and empty ids", () => {
      expect(parseNativeChatId("../root-example")).toBeNull();
      expect(parseNativeChatId("")).toBeNull();
    });
  });
});
