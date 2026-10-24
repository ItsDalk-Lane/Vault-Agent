import { execFileSync } from "node:child_process";
import path from "node:path";

function runFixture(scenario) {
  return JSON.parse(
    execFileSync(process.execPath, [path.join(__dirname, "test-esbuild-runtime.mjs"), scenario], {
      encoding: "utf8",
    })
  );
}

describe("esbuildRuntime", () => {
  describe("runtimeBuildOptions()", () => {
    it("loads computed Node builtins using the installed Pi SDK helper without invoking browser ESM https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(runFixture("computed")).toEqual({ status: "passed" });
    });
    it("keeps bundled imports lazy and preserves their exports https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(runFixture("lazy")).toEqual({ status: "passed" });
    });
    it("loads literal external imports and rejects missing modules asynchronously https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(runFixture("external")).toEqual({ status: "passed" });
    });
  });
});
