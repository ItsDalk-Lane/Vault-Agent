import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("streamFailureRuntimeScenario", () => {
  describe("runStreamFailureRuntimeScenario()", () => {
    it("preserves partial answers and original input across real SDK retries, explicit Stop cancellation and paused close with zero-call cold reopen https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const stdout = execFileSync(
        process.execPath,
        [path.join(process.cwd(), "scripts/test-pi-runtime.mjs"), "streamFailure"],
        { encoding: "utf8", timeout: 60_000 }
      );
      const report = JSON.parse(stdout);

      expect(report.status).toBe("passed");
      expect(report.mainCalls).toBe(6);
      expect(report.providerCalls).toBe(report.mainCalls + report.summaryCalls);
      expect(report.actualAborts).toBe(2);
      expect(report.failedRequestStates).toEqual(["running", "failed"]);
      expect(report.retriedRequestStates).toEqual(["running", "completed"]);
      expect(report.checks).toEqual([
        "partial_text_is_preserved_with_original_final_error",
        "failed_request_never_reports_completed",
        "two_actual_sdk_retries_preserve_partial_attempts",
        "single_request_has_one_durable_user_entry",
        "retry_finishes_once_with_three_attempts",
        "prompt_resolves_after_final_projection",
        "reopen_and_export_preserve_all_partial_text_without_model_call",
        "same_request_id_after_reopen_does_not_dispatch_or_duplicate_user",
        "active_stream_rejects_model_and_effort_changes_without_partial_update",
        "stop_aborts_actual_stream_and_preserves_visible_partial_text",
        "repeated_stop_does_not_restart_or_abort_twice",
        "closing_active_session_pauses_original_input_and_cold_reopen_preserves_partials_without_dispatch",
      ]);
    }, 60_000);
  });
});
