import { canSendFollowUpDuringRecovery } from "@/agentMode/session/RecoveryPolicy";
import type { RecoveryStateUpdate } from "@/agentMode/session/types";

describe("RecoveryPolicy", () => {
  describe("canSendFollowUpDuringRecovery()", () => {
    it("permits a completed segment to receive requirements but rejects unfinished or unresolved recovery https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const safe: RecoveryStateUpdate = {
        status: "available",
        continuationAvailable: true,
        crashLoopTripped: false,
        pendingMutationIds: [],
        pendingPermissionIds: [],
        pendingQuestionIds: [],
      };
      expect(canSendFollowUpDuringRecovery(safe)).toBe(true);
      for (const unsafe of [
        { ...safe, continuationAvailable: undefined },
        { ...safe, status: "interrupted" as const },
        { ...safe, status: "none" as const },
        { ...safe, crashLoopTripped: true },
        { ...safe, pendingMutationIds: ["mutation"] },
        { ...safe, pendingPermissionIds: ["permission"] },
        { ...safe, pendingQuestionIds: ["question"] },
      ])
        expect(canSendFollowUpDuringRecovery(unsafe)).toBe(false);
    });
  });
});
