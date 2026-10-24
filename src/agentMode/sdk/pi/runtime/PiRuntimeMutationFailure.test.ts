import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeMutationFailure", () => {
  describe("PiRuntime", () => {
    describe("openRoot()", () => {
      it("pauses the actual runtime after receipt persistence fails, preserves reading and export, and only completes the receipt on reopen without rewriting https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "mutationFailure"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60_000 }
        );
        const report = JSON.parse(output) as { status: string; checks: string[] };
        expect(report.status).toBe("passed");
        expect(report.checks).toEqual([
          "actual_effect_once_receipt_write_failed",
          "live_runtime_readonly_before_next_provider_or_tool",
          "blind_retry_rejected",
          "failed_receipt_reopen_readonly_and_exportable",
          "reopen_completes_receipt_without_rewriting_or_provider",
          "unknown_during_deferred_budget_blocks_final_provider_open",
        ]);
      });
    });
  });
});
