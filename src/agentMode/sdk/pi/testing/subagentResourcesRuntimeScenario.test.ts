import { execFileSync } from "node:child_process";

describe("subagentResourcesRuntimeScenario", () => {
  describe("runSubagentResourcesRuntimeScenario()", () => {
    it("lets three parents wait for nested children, stops their whole tree and resumes one child across the shared budget without duplicating input https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "subagentResources"], {
          encoding: "utf8",
          timeout: 60_000,
        })
      );
      expect(report).toEqual({
        status: "passed",
        scenario: "production-subagent-resources",
        nestedThreeParents: { firstLevelCalls: 3, leafCalls: 3, sharedSlots: true },
        stoppedWaitingParents: { parents: 3, leaves: 3, aborted: 3, coldDispatches: 0 },
        longChildBudget: { childCalls: 35, parentCalls: 2, coldDispatches: 0, totalRequests: 37 },
      });
    }, 60_000);
  });
});
