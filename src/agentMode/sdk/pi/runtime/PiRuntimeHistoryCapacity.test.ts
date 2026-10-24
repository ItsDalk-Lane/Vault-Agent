import { execFileSync } from "node:child_process";
import path from "node:path";

describe("PiRuntimeHistoryCapacity", () => {
  describe("loadSession()", () => {
    it("shows saved history immediately with two busy SDK roots and reloads records only after an explicit retry without continuing work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "historyCapacity"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60000,
        })
      ) as { status: string; checks: string[]; providerCalls: number };
      expect(report).toMatchObject({ status: "passed", providerCalls: 6 });
      expect(report.checks).toHaveLength(5);
    }, 65000);
  });
});
