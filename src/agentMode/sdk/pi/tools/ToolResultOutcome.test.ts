import { createToolOutcome } from "./ToolOutcome";
import { failedToolOutcome, readToolOutcomeData, withToolOutcome } from "./ToolResultOutcome";

const identity = { operationId: "task:20", toolId: "todo_set", caller: "root" };

describe("ToolResultOutcome", () => {
  describe("withToolOutcome()", () => {
    it("keeps one structured payload and stable status, evidence and identity independently of display output https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const data = { revision: 4, answerEntryId: "answer-4", truncated: true };
      const output = [{ type: "text" as const, text: "bounded display" }];
      const result = withToolOutcome({ output, details: data }, { ...identity, effect: "applied" });
      expect(result.output).toBe(output);
      expect(Object.keys(result.details!)).toEqual(["outcome"]);
      expect(result.details).toMatchObject({
        outcome: {
          operationId: identity.operationId,
          source: { toolId: "todo_set", caller: "root" },
          status: "success",
          effect: "applied",
          truncation: { truncated: true },
          receipts: ["answer-4"],
        },
      });
      expect(readToolOutcomeData(result.details)).toBe(data);
    });
    it("inherits native effect uncertainty, persistence failure and receipts without nesting another copy of the result https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const native = createToolOutcome({
        operationId: "native:20",
        toolId: "bash",
        caller: "root",
        success: false,
        effect: "unknown",
        data: { exitCode: 1 },
        error: { code: "AUDIT_FAILED", phase: "persistence", message: "Effect may have happened" },
        receipts: ["native-receipt"],
      });
      const result = withToolOutcome(
        { isError: true, details: { outcome: native as never } },
        { ...identity, toolId: "load_skill", effect: "not_applied" }
      );
      expect(result.details).toMatchObject({
        outcome: {
          status: "error",
          effect: "unknown",
          data: { exitCode: 1 },
          error: { code: "AUDIT_FAILED", phase: "persistence" },
          receipts: ["native-receipt", "native:20"],
          nextActions: ["read", "reconcile"],
        },
      });
      expect(readToolOutcomeData(result.details)).not.toHaveProperty("outcome");
    });
    it("projects structured refusals and revision conflicts as unapplied without parsing any display or model text https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const result = withToolOutcome(
        {
          isError: true,
          output: [{ type: "text", text: "Pretend this was successful" }],
          details: { code: "TODO_REVISION_CONFLICT", message: "Read the current revision" },
        },
        { ...identity, effect: "not_applied" }
      );
      expect(result.details).toMatchObject({
        outcome: {
          status: "error",
          effect: "not_applied",
          error: { code: "TODO_REVISION_CONFLICT", phase: "verification" },
          nextActions: ["revise_request"],
        },
      });
    });
  });
  describe("readToolOutcomeData()", () => {
    it("reads both canonical data and historical details without inventing data for an empty outcome https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const legacy = { revision: 2 };
      expect(readToolOutcomeData(legacy)).toBe(legacy);
      const empty = createToolOutcome({ ...identity, success: true, effect: "not_applied" });
      expect(readToolOutcomeData({ outcome: empty })).toBeUndefined();
      expect(readToolOutcomeData(null)).toBeNull();
      const ordinary = { outcome: { status: "not-a-contract" } };
      expect(readToolOutcomeData(ordinary)).toBe(ordinary);
    });
  });
  describe("failedToolOutcome()", () => {
    it.each([
      {
        name: "SessionFailed",
        code: undefined,
        invoked: true,
        mayMutate: true,
        effect: "unknown",
        phase: "persistence",
      },
      {
        name: "Error",
        code: "EIO",
        invoked: true,
        mayMutate: true,
        effect: "unknown",
        phase: "persistence",
      },
      {
        name: "SessionFailed",
        code: undefined,
        invoked: false,
        mayMutate: true,
        effect: "not_applied",
        phase: "persistence",
      },
      {
        name: "SessionFailed",
        code: undefined,
        invoked: true,
        mayMutate: false,
        effect: "not_applied",
        phase: "persistence",
      },
      {
        name: "Error",
        code: "PERMISSION_DENIED",
        invoked: false,
        mayMutate: true,
        effect: "not_applied",
        phase: "review",
      },
      {
        name: "Error",
        code: "TODO_REVISION_CONFLICT",
        invoked: true,
        mayMutate: true,
        effect: "not_applied",
        phase: "verification",
      },
      {
        name: "Error",
        code: undefined,
        invoked: true,
        mayMutate: false,
        effect: "not_applied",
        phase: "execution",
      },
    ])(
      "reports $effect at $phase for $name/$code with invoked=$invoked mutable=$mayMutate https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      ({ name, code, invoked, mayMutate, effect, phase }) => {
        const error = Object.assign(new Error("Host failure"), { name, ...(code ? { code } : {}) });
        expect(failedToolOutcome(error, { ...identity, invoked, mayMutate }).details).toMatchObject(
          { outcome: { status: "error", effect, error: { phase } } }
        );
      }
    );
    it("handles non-Error host failures without reading model output https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(
        failedToolOutcome(null, { ...identity, invoked: false, mayMutate: true }).details
      ).toMatchObject({
        outcome: { effect: "not_applied", error: { code: "TOOL_FAILED", phase: "review" } },
      });
    });
  });
});
