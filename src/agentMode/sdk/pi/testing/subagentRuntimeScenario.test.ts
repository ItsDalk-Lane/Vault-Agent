import { execFileSync } from "node:child_process";

describe("subagentRuntimeScenario", () => {
  describe("runSubagentRuntimeScenario()", () => {
    it("uses the real backend for child model selection, results and saved replay https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report: {
        status: string;
        modelCalls: readonly string[];
        reopenedWithoutRequests: boolean;
      } = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "subagents"], {
          encoding: "utf8",
          timeout: 60_000,
        })
      );
      expect(report).toMatchObject({
        status: "passed",
        modelCalls: ["fixture-model", "fixture-child", "fixture-model"],
        reopenedWithoutRequests: true,
        modelChoicesVisible: true,
        coldFollowup: { sameWorkItem: true, backgroundStarted: true },
        idleBackgroundStop: {
          childAborted: true,
          stopCalls: 1,
          nextInputAfterStop: true,
          passiveReports: true,
        },
        writerCheckpoint: {
          fileWrites: 1,
          originalInputPreserved: true,
          sameWorkItem: true,
          revokedWriteDenied: true,
          revokedModelReadOnly: true,
        },
      });
    }, 60_000);
  });
});
