import { isSummaryRequest } from "./summaryRequest";

describe("summaryRequest", () => {
  describe("isSummaryRequest()", () => {
    it("routes the locked SDK summarization system request separately from the scripted tool conversation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(
        isSummaryRequest({
          messages: [
            {
              role: "system",
              content:
                "You are a context summarization assistant. Your task is to read a conversation.",
            },
          ],
        })
      ).toBe(true);
    });

    it("keeps a user or tool quotation of summary instructions in the ordinary conversation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      for (const role of ["user", "toolResult", "assistant"])
        expect(
          isSummaryRequest({
            messages: [{ role, content: "You are a context summarization assistant." }],
          })
        ).toBe(false);
      expect(
        isSummaryRequest({ messages: [{ role: "system", content: "You are Vault Agent." }] })
      ).toBe(false);
    });
  });
});
