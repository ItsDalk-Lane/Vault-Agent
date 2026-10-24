import { execFileSync } from "node:child_process";

describe("queuedRootInputRuntimeScenario", () => {
  describe("runQueuedRootInputRuntimeScenario()", () => {
    it("preserves queued input through manager close and unload, resumes it once, keeps Stop final, and releases other writers before reporting a failed save https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "queuedRootInput"], {
          encoding: "utf8",
          timeout: 90_000,
        })
      );
      expect(report).toMatchObject({ status: "passed", continuedCalls: 3 });
      expect(report.checks).toEqual([
        "close_cold_zero_original_input_and_request_identity",
        "stop_cold_zero_original_input_and_request_identity",
        "shutdown_cold_zero_original_input_and_request_identity",
        "slot-release_cold_zero_original_input_and_request_identity",
        "failed_pending_save_reports_original_error_after_releasing_all_writers",
        "crash_work-item_cold_zero_single_original_handoff",
        "crash_run-record_cold_zero_single_original_handoff",
        "crash_sdk-input_cold_zero_single_original_handoff",
        "second_writer_cannot_replace_metadata_outside_store_lease",
        "new_tab_close_settles_queued_ready_without_provider",
      ]);
    });
  });
});
