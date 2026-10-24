import {
  PlanDecisionError,
  PlanDecisionService,
  type PlanDecisionPlanPort,
  type SessionExecutionMode,
} from "@/agentMode/sdk/pi/features/PlanDecision";
import type { PlanDocument } from "@/agentMode/sdk/pi/features/Plans";

// A plan decision is one-time and version-checked. Approval only converges the session to default
// (never auto) and resumes the run; it must not grant write permission. Rejection records the
// decision without running the plan, feedback becomes real user input for the next revision, and a
// closed card leaves the proposal pending. Repeated window clicks consume the decision once:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakePlans implements PlanDecisionPlanPort {
  pending: PlanDocument | null;
  readonly decideCalls: Array<{ planId: string; revision: number; action: string }> = [];

  constructor(pending: PlanDocument | null) {
    this.pending = pending;
  }

  async getPending(): Promise<PlanDocument | null> {
    return this.pending;
  }

  async decide(input: {
    planId: string;
    revision: number;
    action: "approve" | "reject" | "feedback";
    feedback?: string;
  }): Promise<PlanDocument> {
    if (this.pending === null) throw new Error("no pending plan");
    this.decideCalls.push({ planId: input.planId, revision: input.revision, action: input.action });
    const decision =
      input.action === "approve"
        ? "approved"
        : input.action === "reject"
          ? "rejected"
          : "rejected_with_feedback";
    const decided: PlanDocument = {
      ...this.pending,
      decision,
      permissionGated: false,
      ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
    };
    this.pending = null;
    return decided;
  }
}

class FakeMode {
  mode: SessionExecutionMode;
  convergeCalls = 0;

  constructor(mode: SessionExecutionMode = "plan") {
    this.mode = mode;
  }

  current(): SessionExecutionMode {
    return this.mode;
  }

  async convergeToDefault(): Promise<void> {
    this.convergeCalls += 1;
    this.mode = "default";
  }
}

class FakeFeedback {
  readonly submitted: Array<{ planId: string; revision: number; text: string }> = [];
  async submit(input: { planId: string; revision: number; text: string }): Promise<void> {
    this.submitted.push(input);
  }
}

class FakeWriteGate {
  readonly calls: string[] = [];
  standaloneBypassCalls = 0;
  async isWriteApprovalRequired(path: string): Promise<boolean> {
    this.calls.push(path);
    return true;
  }
}

function planDocument(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    planId: "plan-1",
    revision: 2,
    title: "Ship it",
    body: "1. do the thing",
    steps: ["do the thing"],
    decision: "pending",
    permissionGated: true,
    pendingToolCallId: "tool-call-1",
    sourceFilePath: "Plans/ship.md",
    bodySource: "propose_plan",
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    ...overrides,
  };
}

interface Harness {
  readonly service: PlanDecisionService;
  readonly plans: FakePlans;
  readonly mode: FakeMode;
  readonly feedback: FakeFeedback;
  readonly writeGate: FakeWriteGate;
}

function harness(
  options: { mode?: SessionExecutionMode; pending?: PlanDocument | null } = {}
): Harness {
  const plans = new FakePlans(options.pending === undefined ? planDocument() : options.pending);
  const mode = new FakeMode(options.mode ?? "plan");
  const feedback = new FakeFeedback();
  const writeGate = new FakeWriteGate();
  const service = new PlanDecisionService({ plans, mode, feedback, writeGate });
  return { service, plans, mode, feedback, writeGate };
}

describe("PlanDecisionService", () => {
  describe("decide()", () => {
    it("approves once, converges plan mode to default and keeps writes approval-gated", async () => {
      const harnessed = harness();

      const outcome = await harnessed.service.decide({
        decisionId: "decision-1",
        planId: "plan-1",
        revision: 2,
        action: "approve",
      });

      expect(outcome).toMatchObject({
        mode: "default",
        resumedRun: true,
        writeStillApprovalRequired: true,
        toolResult: { approved: true, planId: "plan-1", revision: 2 },
      });
      expect(harnessed.mode.convergeCalls).toBe(1);
      expect(harnessed.mode.mode).toBe("default");
      expect(harnessed.writeGate.calls).toEqual(["Plans/ship.md"]);
      expect(harnessed.writeGate.standaloneBypassCalls).toBe(0);
      expect(harnessed.plans.decideCalls).toEqual([
        { planId: "plan-1", revision: 2, action: "approve" },
      ]);
    });

    it("converges an auto mode to default instead of leaving it auto", async () => {
      const harnessed = harness({ mode: "auto" });

      const outcome = await harnessed.service.decide({
        decisionId: "decision-1",
        planId: "plan-1",
        revision: 2,
        action: "approve",
      });

      expect(harnessed.mode.convergeCalls).toBe(1);
      expect(harnessed.mode.mode).toBe("default");
      expect(outcome.mode).toBe("default");
    });

    it("rejects without running the plan or switching to auto", async () => {
      const harnessed = harness();

      const outcome = await harnessed.service.decide({
        decisionId: "decision-1",
        planId: "plan-1",
        revision: 2,
        action: "reject",
      });

      expect(outcome).toMatchObject({
        mode: "plan",
        resumedRun: false,
        toolResult: { approved: false },
      });
      expect(harnessed.mode.mode).toBe("plan");
      expect(harnessed.mode.convergeCalls).toBe(0);
      expect(harnessed.writeGate.calls).toEqual([]);
      expect(harnessed.plans.decideCalls.map((call) => call.action)).toEqual(["reject"]);
    });

    it("records feedback as user input for the next model context", async () => {
      const harnessed = harness();

      const outcome = await harnessed.service.decide({
        decisionId: "decision-1",
        planId: "plan-1",
        revision: 2,
        action: "feedback",
        feedback: "Split step 2 and add tests.",
      });

      expect(outcome).toMatchObject({
        mode: "plan",
        toolResult: { approved: false, feedbackRequired: true },
      });
      expect(harnessed.feedback.submitted).toEqual([
        { planId: "plan-1", revision: 2, text: "Split step 2 and add tests." },
      ]);
      expect(harnessed.service.consumeFeedbackForNextTurn()).toEqual([
        { planId: "plan-1", revision: 2, text: "Split step 2 and add tests." },
      ]);
      expect(harnessed.service.consumeFeedbackForNextTurn()).toEqual([]);
    });

    it("consumes repeated window clicks only once", async () => {
      const harnessed = harness();

      const first = await harnessed.service.decide({
        decisionId: "decision-1",
        planId: "plan-1",
        revision: 2,
        action: "approve",
      });
      const sameId = await harnessed.service.decide({
        decisionId: "decision-1",
        planId: "plan-1",
        revision: 2,
        action: "approve",
      });
      const otherWindow = await harnessed.service.decide({
        decisionId: "decision-2",
        planId: "plan-1",
        revision: 2,
        action: "approve",
      });

      expect(sameId.duplicate).toBe(true);
      expect(otherWindow.duplicate).toBe(true);
      expect(harnessed.plans.decideCalls).toHaveLength(1);
      expect(harnessed.mode.convergeCalls).toBe(1);
      expect(first.duplicate).toBe(false);
    });

    it("rejects a stale revision with the latest plan", async () => {
      const harnessed = harness();

      await expect(
        harnessed.service.decide({
          decisionId: "decision-1",
          planId: "plan-1",
          revision: 1,
          action: "approve",
        })
      ).rejects.toMatchObject({ code: "DECISION_STALE_REVISION", latest: { revision: 2 } });
      expect(harnessed.plans.decideCalls).toEqual([]);
      expect(harnessed.mode.convergeCalls).toBe(0);
    });

    it("requires feedback text for the feedback action", async () => {
      const harnessed = harness();

      await expect(
        harnessed.service.decide({
          decisionId: "decision-1",
          planId: "plan-1",
          revision: 2,
          action: "feedback",
          feedback: "   ",
        })
      ).rejects.toBeInstanceOf(PlanDecisionError);
      expect(harnessed.feedback.submitted).toEqual([]);
    });
  });

  describe("close()", () => {
    it("leaves the proposal pending instead of approving it", async () => {
      const harnessed = harness();

      const outcome = await harnessed.service.close({ planId: "plan-1", revision: 2 });

      expect(outcome).toMatchObject({ closed: true, approved: false, mode: "plan" });
      expect(outcome.plan?.decision).toBe("pending");
      expect(harnessed.plans.decideCalls).toEqual([]);
      expect(harnessed.mode.convergeCalls).toBe(0);
    });
  });
});
