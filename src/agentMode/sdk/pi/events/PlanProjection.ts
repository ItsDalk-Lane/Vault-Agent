import type { CurrentPlan } from "@/agentMode/session/plan";
import type { SessionUpdate } from "@/agentMode/session/types";

// The plan document projects into the existing CurrentPlan/card shape with its body untouched: the
// host passes the proposed text through rather than parsing a Claude SDK transcript, and the card's
// permissionGated flag mirrors the durable decision state:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface PlanProjectionInput {
  readonly planId: string;
  readonly revision: number;
  readonly title: string;
  readonly body: string;
  readonly decision: CurrentPlan["decision"];
  readonly permissionGated: boolean;
  readonly pendingToolCallId?: string;
  readonly sourceFilePath?: string;
}

export function toCurrentPlan(plan: PlanProjectionInput): CurrentPlan {
  return {
    id: plan.planId,
    revision: plan.revision,
    body: plan.body,
    title: plan.title,
    ...(plan.sourceFilePath !== undefined ? { sourceFilePath: plan.sourceFilePath } : {}),
    permissionGated: plan.permissionGated,
    ...(plan.pendingToolCallId !== undefined ? { pendingToolCallId: plan.pendingToolCallId } : {}),
    decision: plan.decision,
  };
}

export type PlanProposalUpdate = Extract<SessionUpdate, { sessionUpdate: "plan_proposal_update" }>;

export function toPlanProposalUpdate(plan: PlanProjectionInput): PlanProposalUpdate {
  return { sessionUpdate: "plan_proposal_update", plan: toCurrentPlan(plan) };
}
