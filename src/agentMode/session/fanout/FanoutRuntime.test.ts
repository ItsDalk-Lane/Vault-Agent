import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("FanoutRuntime", () => {
  describe("production fanout integration", () => {
    it("uses two saved models with one shared store and budget, and reopens without another model request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const output = execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "fanout"], {
        cwd: path.resolve(__dirname, "../../../.."),
        encoding: "utf8",
        timeout: 60_000,
      });
      const report = JSON.parse(output) as {
        status: string;
        providerCalls: number;
        checks: readonly string[];
      };
      expect(report.status).toBe("passed");
      expect(report.providerCalls).toBe(3);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          "fanout_reads_lists_links_searches_with_scope_and_no_write_shell_or_delegate",
          "completed_candidate_does_not_pause_peer_read_and_followup_generation",
          "slow_candidate_survives_legacy_five_minute_deadline_and_reaches_summary",
          "actual_session_stop_cancels_both_candidates_without_summary",
          "actual_sourced_failure_truncation_and_injection_boundary",
          "actual_candidate_role_is_separate_from_host_summary_role",
          "two_saved_models_reach_real_runtime",
          "single_parent_durable_store",
          "shared_persisted_budget",
          "stored_read_only_survives_predicate_removal",
          "recover_completed_request_without_model_call",
          "parent_export_preserves_visible_question_and_results_without_optional_note",
          "native_reopen_restores_one_fanout_card_without_model_call",
          "ordinary_followup_receives_persisted_summary_once",
          "subsequent_reopen_does_not_reinject_consumed_comparison",
        ])
      );
    }, 65_000);
  });
});
