import { execFileSync } from "node:child_process";

describe("projectInstructionsRuntimeScenario", () => {
  describe("runProjectInstructionsRuntimeScenario()", () => {
    it("delivers scoped Chinese AGENTS despite QA exclusions, applies independent policy, and replaces active rules in real HTTP serialization while preserving assistant history https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "projectInstructions"], {
          encoding: "utf8",
          timeout: 60000,
        })
      );
      expect(report).toMatchObject({ status: "passed", providerCalls: 4, wireProviderCalls: 8 });
      expect(report.wireProviders).toEqual([
        { id: "generic", modelId: "model", requests: 2 },
        { id: "go-url", modelId: "deepseek-v4.1-flash", requests: 2 },
        { id: "go-declared", modelId: "deepseek-v4.1-flash", requests: 2 },
        { id: "lm-studio", modelId: "qwen/qwen3.8-27b", requests: 2 },
      ]);
      expect(report.checks).toHaveLength(7);
    }, 65000);
  });
});
