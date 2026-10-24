import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimePool", () => {
  describe("production pool integration", () => {
    it("keeps real writer leases within capacity and reopens evicted sessions through public backend calls https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const output = execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "pool"], {
        cwd: path.resolve(__dirname, "../../../../.."),
        encoding: "utf8",
        timeout: 60_000,
      });
      const report = JSON.parse(output) as {
        status: string;
        checks: readonly string[];
        providerCalls: number;
      };
      expect(report.status).toBe("passed");
      expect(report.providerCalls).toBe(2);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          "pre_registered_observer_keeps_writer",
          "only_two_real_writers",
          "observed_idle_releases_capacity",
          "configuration_commit_retains_writer",
          "actual_session_observed_idle_dispatch",
          "eviction_preserves_visible_history",
          "cold_pending_question_releases_capacity",
          "cold_pending_question_reopens_without_model",
          "evicted_session_api_reopens_metadata",
          "shutdown_releases_all_leases",
        ])
      );
    }, 65_000);
  });
});
