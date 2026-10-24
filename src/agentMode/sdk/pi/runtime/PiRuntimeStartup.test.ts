import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeStartup", () => {
  describe("production session lifecycle", () => {
    it("isolates one creation failure without restarting other chats, releases its lease and retries without model calls https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const output = execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "startup"], {
        cwd: path.resolve(__dirname, "../../../../.."),
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(JSON.parse(output)).toEqual({
        status: "passed",
        checks: [
          "no_ghost_index",
          "individual_creation_failure_does_not_restart_runtime",
          "other_chat_remains_usable",
          "retry_releases_lease",
          "load_without_model",
          "double_shutdown",
        ],
        modelCalls: 0,
      });
    }, 65_000);
  });
});
