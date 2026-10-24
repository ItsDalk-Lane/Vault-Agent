import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeCompactionBoundaries", () => {
  describe("PiRuntime", () => {
    describe("runPrompt()", () => {
      it("rejects a late stale background summary, persists skipped after reopen and limits a real overflow to one compaction and one retry https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const report = JSON.parse(
          execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "compactionBoundaries"], {
            cwd: path.resolve(__dirname, "../../../../.."),
            encoding: "utf8",
            timeout: 60_000,
          })
        ) as {
          status: string;
          overflow: { generations: number; summaries: number; providerCalls: number };
          checks: string[];
        };
        expect(report.status).toBe("passed");
        expect(report.overflow).toEqual({ generations: 2, summaries: 1, providerCalls: 3 });
        expect(report.checks).toHaveLength(5);
      });
    });
  });
});
