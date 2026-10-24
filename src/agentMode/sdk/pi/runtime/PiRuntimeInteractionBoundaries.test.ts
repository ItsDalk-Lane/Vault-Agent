import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeInteractionBoundaries", () => {
  describe("PiRuntime", () => {
    describe("prompt()", () => {
      it("keeps an existing project approval in its original root after switching projects and asks for a separate write approval after approving a plan within the same real prompt https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "interactionBoundaries"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60_000 }
        );
        const report = JSON.parse(output) as {
          status: string;
          checks: string[];
          actualFileWrites: string[];
        };
        expect(report.status).toBe("passed");
        expect(report.checks).toEqual([
          "SC-P12-T06-01-switch-project-does-not-write-b",
          "SC-P12-T06-02-old-approval-keeps-original-session-target-and-scope",
          "other-root-cannot-reuse-original-scope-or-decision",
          "SC-P08-T03-01-same-prompt-plan-approval-still-needs-new-file-approval",
        ]);
        expect(report.actualFileWrites).toEqual([
          "projects/alpha/approved.md",
          "plan-separate-write.md",
        ]);
      });
    });
  });
});
