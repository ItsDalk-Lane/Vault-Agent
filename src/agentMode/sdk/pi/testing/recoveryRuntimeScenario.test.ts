import { execFileSync } from "node:child_process";

describe("recoveryRuntimeScenario", () => {
  describe("runRecoveryRuntimeScenario()", () => {
    it("uses real crash, reopen, explicit recovery, corruption and failed storage paths without replaying old writes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "recovery"], {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 120_000,
        })
      );
      expect(report).toEqual({ status: "passed", phase: "all", history: true, exported: true });
    }, 150_000);
  });
});
