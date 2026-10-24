import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeBudgetPause", () => {
  describe("PiRuntime", () => {
    describe("prompt()", () => {
      it("preserves an exhausted SDK generation across close and continues it once with another explicit grant https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "budgetPause"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60_000 }
        );
        const report = JSON.parse(output) as { status: string; checks: string[] };
        expect(report.status).toBe("passed");
        expect(report.checks).toEqual([
          "budget_exhaustion_pauses_owner_without_terminal_failure",
          "reopen_does_not_resume_work",
          "explicit_continue_adds_one_grant_and_resumes_original_generation",
          "goal_and_user_input_not_duplicated",
        ]);
      });
    });
  });
});
