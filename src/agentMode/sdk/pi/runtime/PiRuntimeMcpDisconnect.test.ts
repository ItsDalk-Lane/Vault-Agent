import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeMcpDisconnect", () => {
  describe("PiRuntime", () => {
    describe("openRoot()", () => {
      it("never resends an unsafe MCP operation received by a real HTTP server before the Backend process dies, and Continue stays blocked until its unknown outcome can be verified https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "mcpDisconnect"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60_000 }
        );
        const report = JSON.parse(output) as PhaseReport;
        expect(report.status).toBe("passed");
        expect(report.externalCalls).toBe(1);
        expect(report.modelCalls).toBe(0);
        expect(report.approvals).toBe(0);
        expect(report.checks).toEqual([
          "actual_http_request_received_before_reply_and_process_killed",
          "cold_open_and_export_do_not_resend_external_request_or_start_model",
          "explicit_continue_is_blocked_until_the_remote_effect_can_be_proven",
          "unknown_effect_recovery_is_visible_without_another_model_request",
          "second_cold_open_preserves_unknown_effect_with_zero_external_or_model_replay",
        ]);
      });
    });
  });
});

interface PhaseReport {
  readonly status: string;
  readonly externalCalls: number;
  readonly modelCalls: number;
  readonly approvals: number;
  readonly checks: readonly string[];
}
