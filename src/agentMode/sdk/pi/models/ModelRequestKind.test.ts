import { isCompactionRequest } from "./ModelRequestKind";
describe("ModelRequestKind", () => {
  describe("isCompactionRequest()", () => {
    it("classifies the locked SDK summarizer system request while ignoring quoted user and tool content https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const content =
        "You are a context summarization assistant. Your task is to read a conversation.";
      expect(
        isCompactionRequest({
          messages: [
            { role: "system", content },
            { role: "user", content: "Source" },
          ],
        })
      ).toBe(true);
      for (const role of ["user", "assistant", "toolResult"])
        expect(isCompactionRequest({ messages: [{ role, content }] })).toBe(false);
      expect(
        isCompactionRequest({ messages: [{ role: "system", content: "You are Vault Agent." }] })
      ).toBe(false);
    });
  });
});
