import { createToolOutcome } from "./ToolOutcome";

describe("ToolOutcome", () => {
  describe("createToolOutcome()", () => {
    it("preserves evidence and structured data independently of display truncation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(
        createToolOutcome({
          operationId: "op",
          toolId: "read",
          caller: "root",
          success: true,
          effect: "applied",
          data: { fileVersion: "whole", nextCursor: "next" },
          receipts: ["receipt"],
          truncated: true,
        })
      ).toMatchObject({
        operationId: "op",
        status: "success",
        data: { fileVersion: "whole", nextCursor: "next" },
        receipts: ["receipt"],
        truncation: { truncated: true },
        nextActions: ["continue"],
      });
    });
    it.each(["unknown", "partially_applied"] as const)(
      "requires factual reconciliation for %s effects regardless of an apparent successful reply https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      (effect) => {
        expect(
          createToolOutcome({
            operationId: "op",
            toolId: "write",
            caller: "subagent",
            success: true,
            effect,
          }).nextActions
        ).toEqual(["read", "reconcile"]);
      }
    );
    it("permits revising an operation that provably did not run https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(
        createToolOutcome({
          operationId: "op",
          toolId: "write",
          caller: "root",
          success: false,
          effect: "not_applied",
          error: { code: "STALE_BASELINE", phase: "verification", message: "Read again" },
        })
      ).toMatchObject({ error: { phase: "verification" }, nextActions: ["revise_request"] });
    });
  });
});
