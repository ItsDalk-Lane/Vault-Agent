import { toCurrentPlan } from "@/agentMode/sdk/pi/events/PlanProjection";
import { sha256 } from "@/utils/hash";
import type { CurrentPlan } from "@/agentMode/session/plan";

// The plan proposal is a durable fact: a stable planId, a revision per body change, the exact body
// the model proposed, and the pending tool call. A new revision replaces the pending text, an
// approval for an older revision is invalid, the pending card can be restored after a restart, and
// an oversized body is rejected before any document/event write. The body is passed to the existing
// card unchanged; nothing here parses old Claude SDK output:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const MAX_PLAN_BODY_BYTES = 32 * 1024;

export type PlanDecision = CurrentPlan["decision"];

export type PlanDecisionAction = "approve" | "reject" | "feedback";

export interface PlanDocument {
  readonly planId: string;
  readonly revision: number;
  readonly title: string;
  readonly body: string;
  readonly steps: readonly string[];
  readonly decision: PlanDecision;
  readonly permissionGated: boolean;
  readonly pendingToolCallId: string;
  readonly sourceFilePath?: string;
  readonly feedback?: string;
  readonly bodySource: "propose_plan";
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface PlanEvent {
  readonly type: "plan_proposal_update";
  readonly plan: CurrentPlan;
}

export interface PlanCommitInput {
  readonly plan: PlanDocument;
  readonly event: PlanEvent;
}

export interface PlanStore {
  read(): Promise<PlanDocument | null>;
  commit(input: PlanCommitInput): Promise<void>;
}

export interface ProposePlanInput {
  readonly title: string;
  readonly body: string;
  readonly steps: readonly string[];
  readonly pendingToolCallId: string;
  readonly sourceFilePath?: string;
}

export interface PlanDecisionInput {
  readonly planId: string;
  readonly revision: number;
  readonly action: PlanDecisionAction;
  readonly feedback?: string;
}

export type PlanErrorCode =
  | "PLAN_TOO_LARGE"
  | "PLAN_INVALID_ARGUMENT"
  | "PLAN_REVISION_CONFLICT"
  | "PLAN_NOT_PENDING";

export class PlanError extends Error {
  readonly code: PlanErrorCode;
  readonly latest: PlanDocument | null;

  constructor(code: PlanErrorCode, message: string, latest?: PlanDocument | null) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.latest = latest ?? null;
  }
}

export class Plans {
  readonly #store: PlanStore;
  readonly #now: () => number;
  readonly #maxBodyBytes: number;

  constructor(options: { store: PlanStore; now?: () => number; maxBodyBytes?: number }) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#maxBodyBytes = options.maxBodyBytes ?? MAX_PLAN_BODY_BYTES;
  }

  async propose(input: ProposePlanInput): Promise<PlanDocument> {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (title.length === 0) {
      throw new PlanError("PLAN_INVALID_ARGUMENT", "A plan title is required.");
    }
    const body = typeof input.body === "string" ? input.body : "";
    if (body.length === 0) {
      throw new PlanError("PLAN_INVALID_ARGUMENT", "A plan body is required.");
    }
    if (utf8Length(body) > this.#maxBodyBytes) {
      throw new PlanError(
        "PLAN_TOO_LARGE",
        `The plan body exceeds ${this.#maxBodyBytes} bytes; it was not stored or shown.`
      );
    }
    if (!Array.isArray(input.steps) || input.steps.some((step) => typeof step !== "string")) {
      throw new PlanError("PLAN_INVALID_ARGUMENT", "Plan steps must be strings.");
    }
    if (typeof input.pendingToolCallId !== "string" || input.pendingToolCallId.length === 0) {
      throw new PlanError("PLAN_INVALID_ARGUMENT", "pendingToolCallId is required.");
    }
    const existing = await this.#store.read();
    const timestamp = this.#now();
    if (existing !== null && existing.decision === "pending") {
      const unchanged =
        existing.title === title &&
        existing.body === body &&
        existing.steps.length === input.steps.length &&
        existing.steps.every((step, index) => step === input.steps[index]) &&
        existing.pendingToolCallId === input.pendingToolCallId &&
        existing.sourceFilePath === input.sourceFilePath;
      if (unchanged) return existing;
      const revised: PlanDocument = Object.freeze({
        ...existing,
        title,
        body,
        steps: Object.freeze([...input.steps]),
        revision: existing.revision + 1,
        decision: "pending",
        permissionGated: true,
        pendingToolCallId: input.pendingToolCallId,
        ...(input.sourceFilePath !== undefined ? { sourceFilePath: input.sourceFilePath } : {}),
        updatedAtMs: timestamp,
      });
      await this.#commit(revised);
      return revised;
    }
    const planId = `plan-${sha256(`${title}\0${body}\0${input.pendingToolCallId}\0${timestamp}`).slice(0, 12)}`;
    const plan: PlanDocument = Object.freeze({
      planId,
      revision: 1,
      title,
      body,
      steps: Object.freeze([...input.steps]),
      decision: "pending",
      permissionGated: true,
      pendingToolCallId: input.pendingToolCallId,
      ...(input.sourceFilePath !== undefined ? { sourceFilePath: input.sourceFilePath } : {}),
      bodySource: "propose_plan",
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
    });
    await this.#commit(plan);
    return plan;
  }

  async decide(input: PlanDecisionInput): Promise<PlanDocument> {
    const current = await this.#store.read();
    if (current === null || current.planId !== input.planId) {
      throw new PlanError("PLAN_NOT_PENDING", "No plan matches this planId.", current);
    }
    if (input.revision !== current.revision) {
      throw new PlanError(
        "PLAN_REVISION_CONFLICT",
        "A newer plan revision replaced this one; review the latest revision.",
        current
      );
    }
    if (current.decision !== "pending") {
      throw new PlanError("PLAN_NOT_PENDING", "This plan was already decided.", current);
    }
    if (input.action === "feedback" && (input.feedback ?? "").trim().length === 0) {
      throw new PlanError("PLAN_INVALID_ARGUMENT", "Feedback text is required.");
    }
    const decision: PlanDecision =
      input.action === "approve"
        ? "approved"
        : input.action === "reject"
          ? "rejected"
          : "rejected_with_feedback";
    const decided: PlanDocument = Object.freeze({
      ...current,
      decision,
      permissionGated: false,
      ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
      updatedAtMs: this.#now(),
    });
    await this.#commit(decided);
    return decided;
  }

  async getPending(): Promise<PlanDocument | null> {
    const current = await this.#store.read();
    return current !== null && current.decision === "pending" ? current : null;
  }

  async #commit(plan: PlanDocument): Promise<void> {
    await this.#store.commit({
      plan,
      event: Object.freeze({ type: "plan_proposal_update", plan: toCurrentPlan(plan) }),
    });
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}
