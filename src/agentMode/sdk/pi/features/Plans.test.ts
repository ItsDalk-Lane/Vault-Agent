import {
  MAX_PLAN_BODY_BYTES,
  Plans,
  type PlanCommitInput,
  type PlanDocument,
  type PlanEvent,
  type PlanStore,
} from "@/agentMode/sdk/pi/features/Plans";

// Proposing a plan is a durable, versioned fact: the body arrives from the propose_plan tool, a new
// revision replaces the pending text (invalidating older approvals), the pending card survives a
// restart, and an oversized body is rejected before any document or event is written:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryPlanStore implements PlanStore {
  current: PlanDocument | null = null;
  readonly commits: PlanCommitInput[] = [];
  readonly events: PlanEvent[] = [];

  async read(): Promise<PlanDocument | null> {
    return this.current;
  }

  async commit(input: PlanCommitInput): Promise<void> {
    this.commits.push(input);
    this.events.push(input.event);
    this.current = input.plan;
  }
}

function harness(now = 1_000): { plans: Plans; store: MemoryPlanStore } {
  const store = new MemoryPlanStore();
  const plans = new Plans({ store, now: () => now });
  return { plans, store };
}

function propose(plans: Plans, body = "first plan body", toolCall = "tool-call-1") {
  return plans.propose({
    title: "Ship the refactor",
    body,
    steps: ["read the design", "write the code"],
    pendingToolCallId: toolCall,
  });
}

describe("Plans", () => {
  describe("propose()", () => {
    it("creates a stable planId, revision and permission-gated CurrentPlan event", async () => {
      const harnessed = harness();

      const plan = await propose(harnessed.plans);

      expect(plan).toMatchObject({
        planId: expect.stringMatching(/^plan-/) as string,
        revision: 1,
        title: "Ship the refactor",
        body: "first plan body",
        decision: "pending",
        permissionGated: true,
        pendingToolCallId: "tool-call-1",
        bodySource: "propose_plan",
      });
      expect(harnessed.store.events).toHaveLength(1);
      expect(harnessed.store.events[0]).toMatchObject({
        type: "plan_proposal_update",
        plan: {
          revision: 1,
          body: "first plan body",
          permissionGated: true,
          decision: "pending",
          pendingToolCallId: "tool-call-1",
        },
      });
      expect(harnessed.store.events[0]?.plan.body).toBe("first plan body");
    });

    it("replaces the pending body with a new revision and keeps the planId", async () => {
      const harnessed = harness();
      const first = await propose(harnessed.plans);
      const second = await harnessed.plans.propose({
        title: "Ship the refactor",
        body: "second plan body",
        steps: ["read the design", "write the code", "test"],
        pendingToolCallId: "tool-call-2",
      });

      expect(second.planId).toBe(first.planId);
      expect(second.revision).toBe(2);
      expect(second.body).toBe("second plan body");
      expect(harnessed.store.events.map((event) => event.plan.body)).toEqual([
        "first plan body",
        "second plan body",
      ]);
      await expect(
        harnessed.plans.decide({ planId: first.planId, revision: 1, action: "approve" })
      ).rejects.toMatchObject({ code: "PLAN_REVISION_CONFLICT" });
    });

    it("returns the existing pending plan unchanged instead of bumping revision", async () => {
      const harnessed = harness();
      const first = await propose(harnessed.plans);

      const again = await propose(harnessed.plans);

      expect(again.revision).toBe(first.revision);
      expect(harnessed.store.commits).toHaveLength(1);
    });

    it("rejects an oversized body before any document or event write", async () => {
      const harnessed = harness();

      await expect(
        harnessed.plans.propose({
          title: "too big",
          body: "x".repeat(MAX_PLAN_BODY_BYTES + 1),
          steps: [],
          pendingToolCallId: "tool-call-1",
        })
      ).rejects.toMatchObject({ code: "PLAN_TOO_LARGE" });
      await expect(
        harnessed.plans.propose({
          title: "too big for byte limit",
          body: "é".repeat(MAX_PLAN_BODY_BYTES / 2 + 1),
          steps: [],
          pendingToolCallId: "tool-call-2",
        })
      ).rejects.toMatchObject({ code: "PLAN_TOO_LARGE" });
      expect(harnessed.store.commits).toEqual([]);
      expect(harnessed.store.events).toEqual([]);
    });

    it("starts a fresh plan after the previous one was decided", async () => {
      const harnessed = harness();
      const first = await propose(harnessed.plans);
      await harnessed.plans.decide({ planId: first.planId, revision: 1, action: "approve" });

      const next = await propose(harnessed.plans, "a new plan body", "tool-call-2");

      expect(next.planId).not.toBe(first.planId);
      expect(next.revision).toBe(1);
    });
  });

  describe("decide()", () => {
    it("invalidates an approval for an older revision", async () => {
      const harnessed = harness();
      const first = await propose(harnessed.plans, "v1 body");
      await propose(harnessed.plans, "v2 body");
      const commitsBefore = harnessed.store.commits.length;

      await expect(
        harnessed.plans.decide({ planId: first.planId, revision: 1, action: "approve" })
      ).rejects.toMatchObject({ code: "PLAN_REVISION_CONFLICT" });
      expect(harnessed.store.commits).toHaveLength(commitsBefore);
      expect(harnessed.store.current?.decision).toBe("pending");
    });

    it("approves the current revision without conflating it with write permission", async () => {
      const harnessed = harness();
      const plan = await propose(harnessed.plans);

      const approved = await harnessed.plans.decide({
        planId: plan.planId,
        revision: plan.revision,
        action: "approve",
      });

      expect(approved).toMatchObject({ decision: "approved", permissionGated: false });
      expect(harnessed.store.events.at(-1)?.plan).toMatchObject({
        decision: "approved",
        permissionGated: false,
      });
      await expect(
        harnessed.plans.decide({ planId: plan.planId, revision: plan.revision, action: "approve" })
      ).rejects.toMatchObject({ code: "PLAN_NOT_PENDING" });
    });

    it("records rejection feedback for the next revision", async () => {
      const harnessed = harness();
      const plan = await propose(harnessed.plans);

      const rejected = await harnessed.plans.decide({
        planId: plan.planId,
        revision: plan.revision,
        action: "feedback",
        feedback: "Please split step 2.",
      });

      expect(rejected).toMatchObject({
        decision: "rejected_with_feedback",
        feedback: "Please split step 2.",
      });
    });

    it("restores the pending card from the store after a restart", async () => {
      const harnessed = harness();
      const plan = await propose(harnessed.plans);

      const restarted = new Plans({ store: harnessed.store, now: () => 2_000 });
      const pending = await restarted.getPending();

      expect(pending).toMatchObject({
        planId: plan.planId,
        revision: plan.revision,
        body: plan.body,
        decision: "pending",
        permissionGated: true,
      });
    });
  });
});
