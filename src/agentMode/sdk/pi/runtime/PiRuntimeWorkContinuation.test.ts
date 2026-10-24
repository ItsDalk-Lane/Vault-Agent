import { execFileSync } from "node:child_process";
import path from "node:path";
describe("PiRuntimeWorkContinuation", () => {
  describe("PiRuntime", () => {
    describe("recoverSession()", () => {
      it("continues a finished SDK segment only after an explicit user decision and preserves the original goal and cumulative budget https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "workContinuation"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60000 }
        );
        const report = JSON.parse(output) as { status: string; checks: string[] };
        expect(report.status).toBe("passed");
        expect(report.checks).toHaveLength(7);
      });
    });
  });
});
