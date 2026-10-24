import { execFileSync } from "node:child_process";
import path from "node:path";

describe("initializationRuntimeScenario", () => {
  describe("runInitializationRuntimeScenario()", () => {
    it("shows each real entry once during UI initialization and preserves optimistic selection identity through later projections https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "initialization"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        })
      ) as { status: string; providerCalls: number; checks: string[] };
      expect(report.status).toBe("passed");
      expect(report.providerCalls).toBe(2);
      expect(report.checks).toEqual([
        "actual_entry_arrives_before_ui_initialization_finishes_once",
        "history_reload_does_not_duplicate_the_initializing_entry",
        "actual_projection_preserves_optimistic_user_id_and_selection_identity",
        "repeat_reload_preserves_display_order_and_ids",
        "actual_local_command_has_no_model_request_or_false_empty_answer_error",
      ]);
    }, 65_000);
  });
});
