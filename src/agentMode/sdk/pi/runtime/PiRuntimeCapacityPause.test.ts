import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeCapacityPause", () => {
  describe("PiRuntime", () => {
    describe("prompt()", () => {
      it("reserves finalization space, pauses before model and write dispatch, and carries the goal into an explicit continuation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "capacityPause"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60_000 }
        );
        const report = JSON.parse(output) as { status: string; checks: string[] };
        expect(report.status).toBe("passed");
        expect(report.checks).toEqual([
          "capacity_reserves_space_and_pauses_before_model",
          "explicit_rollover_preserves_goal_without_autorun",
          "old_store_remains_read_only",
          "growth_after_model_pauses_before_host_write",
        ]);
      });
    });
  });
});
