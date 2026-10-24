import { execFileSync } from "node:child_process";
import path from "node:path";

describe("PiRuntimeSteer", () => {
  describe("steerSession()", () => {
    it("adds text after the current real SDK tool round under the same goal and budget, survives reopen, and refuses stop and final-boundary races https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "steer"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60000,
        })
      );
      expect(report).toMatchObject({ status: "passed", providerCalls: 9 });
      expect(report.checks).toHaveLength(8);
    }, 65000);
  });
});
