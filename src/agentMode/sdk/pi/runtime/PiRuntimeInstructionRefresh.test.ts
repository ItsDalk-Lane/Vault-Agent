import { execFileSync } from "node:child_process";
import path from "node:path";
describe("PiRuntimeInstructionRefresh", () => {
  describe("PiRuntime", () => {
    describe("beforeRequest()", () => {
      it("replaces changed or withdrawn instruction sources at the next real SDK step while preserving child role and file boundaries https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "instructionRefresh"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60000 }
        );
        const report = JSON.parse(output) as { status: string; checks: string[] };
        expect(report.status).toBe("passed");
        expect(report.checks).toHaveLength(4);
      });
    });
  });
});
