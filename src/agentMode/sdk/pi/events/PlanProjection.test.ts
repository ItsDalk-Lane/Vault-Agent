import { toCurrentPlan, toPlanProposalUpdate } from "@/agentMode/sdk/pi/events/PlanProjection";

// Projection keeps the proposed body byte-for-byte: the host passes the document to the existing
// plan card instead of parsing a Claude SDK transcript, and optional card fields only appear when
// the durable document has them:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
describe("PlanProjection", () => {
  describe("toCurrentPlan()", () => {
    it("maps the durable plan to the existing card shape without rewriting the body", () => {
      const body = "1. read\n2. write\n\n```json\n{not: parsed}\n```\n";
      const plan = toCurrentPlan({
        planId: "plan-abc",
        revision: 3,
        title: "Ship it",
        body,
        decision: "pending",
        permissionGated: true,
        pendingToolCallId: "tool-call-9",
        sourceFilePath: "Plans/plan.md",
      });

      expect(plan).toEqual({
        id: "plan-abc",
        revision: 3,
        title: "Ship it",
        body,
        sourceFilePath: "Plans/plan.md",
        permissionGated: true,
        pendingToolCallId: "tool-call-9",
        decision: "pending",
      });
    });

    it("omits optional card fields when the document has none", () => {
      const plan = toCurrentPlan({
        planId: "plan-def",
        revision: 1,
        title: "T",
        body: "B",
        decision: "approved",
        permissionGated: false,
      });

      expect(plan).toEqual({
        id: "plan-def",
        revision: 1,
        title: "T",
        body: "B",
        permissionGated: false,
        decision: "approved",
      });
      expect("sourceFilePath" in plan).toBe(false);
      expect("pendingToolCallId" in plan).toBe(false);
    });
  });

  describe("toPlanProposalUpdate()", () => {
    it("wraps the current plan in the existing plan_proposal_update session update", () => {
      const update = toPlanProposalUpdate({
        planId: "plan-abc",
        revision: 2,
        title: "Title",
        body: "Body",
        decision: "pending",
        permissionGated: true,
        pendingToolCallId: "tool-call-1",
      });

      expect(update.sessionUpdate).toBe("plan_proposal_update");
      expect(update.plan).toMatchObject({
        id: "plan-abc",
        revision: 2,
        body: "Body",
        decision: "pending",
      });
    });
  });
});
