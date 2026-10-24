import type { RecoveryStateUpdate } from "@/agentMode/session/types";

export function canSendFollowUpDuringRecovery(recovery: RecoveryStateUpdate): boolean {
  return (
    recovery.continuationAvailable === true &&
    recovery.status === "available" &&
    !recovery.crashLoopTripped &&
    recovery.pendingMutationIds.length === 0 &&
    recovery.pendingPermissionIds.length === 0 &&
    recovery.pendingQuestionIds.length === 0
  );
}
