import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeCheckpointToolBoundary", () => {
  describe("PiRuntime", () => {
    describe("prompt()", () => {
      it("waits for the prior committed todo checkpoint before the next actual file effect in the same SDK model batch https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const report = JSON.parse(
          execFileSync(
            process.execPath,
            ["scripts/test-pi-runtime.mjs", "checkpointToolBoundary"],
            { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60_000 }
          )
        );
        expect(report).toEqual({
          status: "passed",
          checks: [
            "same_model_batch_todo_checkpoint_precedes_actual_file_write",
            "execution_gate_waits_actual_commit_without_self_deadlock",
          ],
          writes: 1,
          providerCalls: 2,
        });
      });
    });
  });
});
