import { execFileSync } from "node:child_process";
import path from "node:path";

describe("PiRuntimeCompaction", () => {
  describe("production compaction", () => {
    it("actually summarizes an 8k conversation, verifies placement and preserves all original history after reopen https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "compaction"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        })
      ) as {
        status: string;
        providerCalls: number;
        mainCalls: number;
        summaryCalls: number;
        checks: string[];
      };
      expect(report).toMatchObject({ status: "passed", mainCalls: 4 });
      expect(report.summaryCalls).toBeGreaterThan(0);
      expect(report.providerCalls).toBe(report.mainCalls + report.summaryCalls);
      expect(report.checks).toContain("summary_placed_as_context_head");
      expect(report.checks).toContain(
        "summary_receives_owned_persisted_checkpoint_and_operation_evidence"
      );
      expect(report.checks).toContain("manual_compact_preserves_goal_grants_and_cumulative_budget");
      expect(report.checks).toContain("cold_continue_after_compact_uses_original_goal");
    }, 65_000);
  });
});
