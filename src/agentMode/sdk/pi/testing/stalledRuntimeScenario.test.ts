import { execFileSync } from "node:child_process";

describe("stalledRuntimeScenario", () => {
  describe("runStalledRuntimeScenario()", () => {
    it("pauses three repeated failures in the real SDK and resumes the original generation only after explicit continue https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "stalled"], {
          encoding: "utf8",
          timeout: 90_000,
        })
      );
      expect(report).toMatchObject({ status: "passed", providerCalls: 4 });
      expect(report.checks).toEqual(
        expect.arrayContaining([
          "three_identical_failures_pause_without_another_request",
          "reopen_does_not_resume_work",
          "explicit_continue_resumes_original_generation",
          "goal_and_user_input_not_duplicated",
        ])
      );
    });
  });
});
