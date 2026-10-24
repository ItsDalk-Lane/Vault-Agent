import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeSelectionMutation", () => {
  describe("PiRuntime", () => {
    describe("prompt()", () => {
      it("persists actual selection edits as reversible mutations, guards the last CAS boundary, and never rewrites stopped or uncertain edits after reopening https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const output = execFileSync(
          process.execPath,
          ["scripts/test-pi-runtime.mjs", "selectionMutation"],
          { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8", timeout: 60_000 }
        );
        const report = JSON.parse(output) as {
          status: string;
          checks: string[];
          fileWrites: number;
          directEditorWrites: number;
        };
        expect(report.status).toBe("passed");
        expect(report.directEditorWrites).toBe(0);
        expect(report.fileWrites).toBe(5);
        expect(report.checks).toEqual([
          "actual_selection_write_uses_vault_cas_and_committed_receipt",
          "cold_reopen_keeps_same_receipt_without_model_or_rewrite",
          "auto_rollback_requires_new_approval_and_restores_original_content",
          "cas_rechecks_leaf_range_full_buffer_and_disk_baseline",
          "unsaved_buffer_is_not_overwritten",
          "another_unsaved_editor_blocks_selection_disk_write",
          "stop_at_actual_cas_and_reopen_never_apply_stale_operation",
          "lost_host_ack_blocks_dispatch_and_reconciles_same_receipt_without_write",
          "lost_receipt_blocks_dispatch_and_reopen_preserves_original_operation_id",
        ]);
      });
    });
  });
});
