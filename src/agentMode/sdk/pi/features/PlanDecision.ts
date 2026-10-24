import type { PlanDocument } from "@/agentMode/sdk/pi/features/Plans";

// Approving a plan is a one-time, version-checked decision: it converges the session to default
// (never auto/bypass) so the current run can continue, while every actual write still goes through
// the ToolGateway approval path. Rejecting records the decision without running the work, feedback
// becomes user input for a new revision, and closing the card leaves the proposal pending rather
// than approving it. Repeated clicks consume the decision once:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type PlanDecisionKind = "approve" | "reject" | "feedback";

export type SessionExecutionMode = "default" | "plan" | "auto";

export interface PlanDecisionInput {
  readonly decisionId: string;
  readonly planId: string;
  readonly revision: number;
  readonly action: PlanDecisionKind;
  readonly feedback?: string;
}

export interface PlanDecisionPlanPort {
  getPending(): Promise<PlanDocument | null>;
  decide(input: {
    planId: string;
    revision: number;
    action: PlanDecisionKind;
    feedback?: string;
  }): Promise<PlanDocument>;
}

export interface PlanDecisionPorts {
  readonly plans: PlanDecisionPlanPort;
  readonly mode: {
    current(): SessionExecutionMode;
    convergeToDefault(): Promise<void>;
  };
  readonly feedback: {
    submit(input: { planId: string; revision: number; text: string }): Promise<void>;
  };
  readonly writeGate: {
    isWriteApprovalRequired(path: string): Promise<boolean>;
  };
  readonly now?: () => number;
}

export interface PlanDecisionOutcome {
  readonly decisionId: string;
  readonly plan: PlanDocument;
  readonly mode: SessionExecutionMode;
  readonly resumedRun: boolean;
  readonly writeStillApprovalRequired: boolean;
  readonly duplicate: boolean;
  readonly toolResult: {
    readonly approved: boolean;
    readonly planId: string;
    readonly revision: number;
    readonly feedbackRequired: boolean;
  };
}

export interface ClosedPlanOutcome {
  readonly closed: true;
  readonly approved: false;
  readonly plan: PlanDocument | null;
  readonly mode: SessionExecutionMode;
}

export type PlanDecisionErrorCode =
  | "DECISION_INVALID"
  | "DECISION_PLAN_MISMATCH"
  | "DECISION_STALE_REVISION";

export class PlanDecisionError extends Error {
  readonly code: PlanDecisionErrorCode;
  readonly latest: PlanDocument | null;

  constructor(code: PlanDecisionErrorCode, message: string, latest?: PlanDocument | null) {
    super(message);
    this.name = "PlanDecisionError";
    this.code = code;
    this.latest = latest ?? null;
  }
}

export class PlanDecisionService {
  readonly #ports: PlanDecisionPorts;
  readonly #consumed = new Map<string, PlanDecisionOutcome>();
  readonly #byPlanRevision = new Map<string, PlanDecisionOutcome>();
  readonly #pendingFeedback: Array<{ planId: string; revision: number; text: string }> = [];

  constructor(ports: PlanDecisionPorts) {
    this.#ports = ports;
  }

  async decide(input: PlanDecisionInput): Promise<PlanDecisionOutcome> {
    if (typeof input.decisionId !== "string" || input.decisionId.length === 0) {
      throw new PlanDecisionError("DECISION_INVALID", "decisionId is required.");
    }
    if (input.action !== "approve" && input.action !== "reject" && input.action !== "feedback") {
      throw new PlanDecisionError("DECISION_INVALID", "Unknown plan decision action.");
    }
    if (input.action === "feedback" && (input.feedback ?? "").trim().length === 0) {
      throw new PlanDecisionError("DECISION_INVALID", "Feedback text is required.");
    }
    const consumed = this.#consumed.get(input.decisionId);
    if (consumed !== undefined) return Object.freeze({ ...consumed, duplicate: true });
    const byRevision = this.#byPlanRevision.get(revisionKey(input.planId, input.revision));
    if (byRevision !== undefined) {
      return Object.freeze({ ...byRevision, decisionId: input.decisionId, duplicate: true });
    }
    const pending = await this.#ports.plans.getPending();
    if (pending === null) {
      throw new PlanDecisionError("DECISION_PLAN_MISMATCH", "There is no pending plan.");
    }
    if (pending.planId !== input.planId) {
      throw new PlanDecisionError(
        "DECISION_PLAN_MISMATCH",
        "A different plan is pending.",
        pending
      );
    }
    if (pending.revision !== input.revision) {
      throw new PlanDecisionError(
        "DECISION_STALE_REVISION",
        "A newer plan revision replaced this one; review it again.",
        pending
      );
    }

    const decided = await this.#ports.plans.decide({
      planId: input.planId,
      revision: input.revision,
      action: input.action,
      ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
    });
    let mode = this.#ports.mode.current();
    if (input.action === "approve" && mode !== "default") {
      await this.#ports.mode.convergeToDefault();
      mode = this.#ports.mode.current();
    }
    if (input.action === "feedback") {
      const text = (input.feedback ?? "").trim();
      await this.#ports.feedback.submit({
        planId: input.planId,
        revision: input.revision,
        text,
      });
      this.#pendingFeedback.push({ planId: input.planId, revision: input.revision, text });
    }
    const writeStillApprovalRequired =
      input.action === "approve"
        ? await this.#ports.writeGate.isWriteApprovalRequired(decided.sourceFilePath ?? "")
        : true;
    const outcome: PlanDecisionOutcome = Object.freeze({
      decisionId: input.decisionId,
      plan: decided,
      mode,
      resumedRun: input.action === "approve" && decided.pendingToolCallId.length > 0,
      writeStillApprovalRequired,
      duplicate: false,
      toolResult: Object.freeze({
        approved: input.action === "approve",
        planId: decided.planId,
        revision: decided.revision,
        feedbackRequired: input.action === "feedback",
      }),
    });
    this.#consumed.set(input.decisionId, outcome);
    this.#byPlanRevision.set(revisionKey(decided.planId, decided.revision), outcome);
    return outcome;
  }

  async close(input: { planId: string; revision: number }): Promise<ClosedPlanOutcome> {
    const pending = await this.#ports.plans.getPending();
    if (
      pending !== null &&
      pending.planId === input.planId &&
      pending.revision === input.revision
    ) {
      return {
        closed: true,
        approved: false,
        plan: pending,
        mode: this.#ports.mode.current(),
      };
    }
    return { closed: true, approved: false, plan: pending, mode: this.#ports.mode.current() };
  }

  consumeFeedbackForNextTurn(): readonly { planId: string; revision: number; text: string }[] {
    const consumed = [...this.#pendingFeedback];
    this.#pendingFeedback.length = 0;
    return Object.freeze(consumed);
  }

  get mode(): SessionExecutionMode {
    return this.#ports.mode.current();
  }

  get now(): number {
    return (this.#ports.now ?? Date.now)();
  }
}

function revisionKey(planId: string, revision: number): string {
  return `${planId}:${revision}`;
}
