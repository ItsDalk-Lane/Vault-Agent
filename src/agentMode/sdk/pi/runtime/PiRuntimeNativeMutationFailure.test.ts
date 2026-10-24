import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeNativeMutationFailure", () => {
  describe("PiRuntime", () => {
    describe("openRoot()", () => {
      it("pauses after an actual external write loses its receipt, stays readable when reopened, and reconciles without another write or model request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "nativeMutationFailure"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60_000 }
        );
        const report = JSON.parse(output) as { status: string; checks: string[] };
        expect(report.status).toBe("passed");
        expect(report.checks).toEqual([
          "actual_native_effect_once_receipt_failed",
          "live_native_unknown_closes_provider_and_new_turn",
          "native_unknown_reopen_readonly_and_exportable",
          "saved_native_effect_unknown_stays_blocking_without_overwrite",
          "native_receipt_reconciled_without_rewrite_or_model",
          "native_host_ack_failure_blocks_after_one_actual_write",
        ]);
      });
    });
  });
});
