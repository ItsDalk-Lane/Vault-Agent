import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeRollover", () => {
  describe("PiRuntime", () => {
    describe("rolloverSession()", () => {
      it("rolls an actual oversized durable root into an official summary and a new root while preserving readonly history and failed-start safety https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "rollover"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        });
        const report = JSON.parse(output) as { status: string; checks: string[] };
        expect(report.status).toBe("passed");
        expect(report.checks).toEqual(
          expect.arrayContaining([
            "failed_new_root_does_not_archive_or_publish_ghost",
            "actual_32_mib_jsonl_blocks_new_work_but_allows_explicit_rollover",
            "official_sdk_summary_carried_to_new_root_with_source",
            "old_store_readonly_and_bytes_preserved",
            "archived_reopen_has_no_provider_call",
            "new_root_accepts_new_work",
            "first_request_keeps_recent_user_and_assistant_tail",
            "new_root_preserves_source_execution_mode",
          ])
        );
      });
    });
  });
});
