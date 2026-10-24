import { execFileSync } from "node:child_process";

describe("queuedFanoutRuntimeScenario", () => {
  describe("runQueuedFanoutRuntimeScenario()", () => {
    it("preserves the queued input across close and cold open, and explicitly continues the same fanout without duplicate requests https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "queuedFanout"], {
          encoding: "utf8",
          timeout: 60_000,
        })
      );
      expect(report).toMatchObject({
        status: "passed",
        checks: expect.arrayContaining([
          "cold_open_does_not_request_models",
          "explicit_continue_preserves_original_fanout_identity",
          "each_candidate_and_summary_runs_once",
          "temporary_draft_removed_after_durable_handoff",
          "fanout_image_cached_and_selected_source_restored",
          "commit_before_metadata_clear_cold_reconciles_without_restart",
        ]),
      });
    }, 65_000);
  });
});
