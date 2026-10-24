import { execFileSync } from "node:child_process";
import path from "node:path";

describe("PiRuntimeSdkValidation", () => {
  describe("production SDK validation boundaries", () => {
    it("pauses three invalid real tasks with the same provider call ID and preserves exact rejection evidence through reopen and correction https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "sdkValidation"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60000,
        })
      ) as { status: string; providerCalls: number };
      expect(report).toMatchObject({ status: "passed", providerCalls: 5 });
    }, 65000);
  });
});
