import { execFileSync } from "node:child_process";
import path from "node:path";

describe("backgroundReportRuntimeScenario", () => {
  describe("runBackgroundReportRuntimeScenario()", () => {
    it("stores idle reports without waking execution and consumes active wait reports once and preserves exact report crash checkpoints across normal shutdown and explicit recovery https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(
          process.execPath,
          [path.join(process.cwd(), "scripts/test-pi-runtime.mjs"), "backgroundReport"],
          {
            encoding: "utf8",
            timeout: 60_000,
          }
        )
      );
      expect(report.status).toBe("passed");
      expect(report.calls.length).toBeGreaterThan(0);
      expect(report.foreground).toMatchObject({
        childCount: 1,
        providerCalls: 2,
        requestIds: [expect.stringMatching(/^delegate:/)],
      });
      expect(report.reportEntries).toBe(1);
      expect(report.summaries).toBe(0);
      expect(report.compactionRequests).toBeGreaterThan(0);
      expect(report.recovery).toEqual({
        afterReportContinueCalls: 0,
        afterSynthesisContinueCalls: 0,
        readCalls: 0,
      });
      expect(report.checks).toEqual([
        "finished_original_run_stores_report_without_new_model_request",
        "explicit_wait_consumes_actual_report_without_an_additional_followup",
        "new_explicit_input_after_cold_open_receives_original_pending_report",
        "background_report_and_actual_context_compaction_share_the_same_task_tree",
        "report_entry_is_tool_sourced_and_does_not_create_another_user_message",
        "busy_original_run_receives_report_without_creating_a_second_input",
        "real_process_exits_after_report_append_before_report_checkpoint",
        "read_only_reopen_preserves_report_and_does_not_start_model",
        "explicit_continue_restores_report_without_creating_another_model_input",
        "second_reopen_keeps_one_report_and_zero_automatic_requests",
        "completed_synthesis_before_report_checkpoint_is_not_dispatched_again",
        "unknown_reporter_kind_and_future_version_remain_readable_and_block_continue",
        "real_report_checkpoint_storage_failure_stops_before_report_or_followup",
        "foreground_create_before_submit_crash_restores_same_child_and_fixed_request_once",
        "foreground_read_only_reopen_and_normal_shutdown_never_start_child",
      ]);
    }, 60_000);
  });
});
