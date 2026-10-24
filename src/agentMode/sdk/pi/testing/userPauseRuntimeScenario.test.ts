import { execFileSync } from "node:child_process";

describe("userPauseRuntimeScenario", () => {
  describe("runUserPauseRuntimeScenario()", () => {
    it("saves an explicit streaming pause and cold-resumes the same SDK work only after Continue https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "userPause"], {
          encoding: "utf8",
          timeout: 90_000,
        })
      );
      expect(report).toMatchObject({
        status: "passed",
        providerCalls: 18,
        backgroundClose: { parentCalls: 2, childCalls: 2, originalChildInputPreserved: true },
      });
      expect(report.checks).toContain("goal_and_user_input_not_duplicated");
      expect(report.checks).toContain(
        "completed_recovery_clears_live_and_cold_session_state_and_repeat_continue_is_noop"
      );
      expect(report.checks).toContain(
        "host_release_preserves_active_and_already_paused_question_tasks"
      );
      expect(report.checks).toContain("pause_and_shutdown_keep_pending_edit_and_plan_approvals");
      expect(report.checks).toContain(
        "pause_and_shutdown_keep_original_pending_question_without_live_window"
      );
      expect(report.checks).toContain(
        "continue_consumes_saved_answer_at_original_sdk_tool_checkpoint"
      );
    });
  });
});
