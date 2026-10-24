import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiMcpRuntime", () => {
  describe("production MCP integration", () => {
    it("loads real HTTP tools, keeps echoed catalog credentials out of history, denies child writes and cancels stale approvals https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const output = execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "mcp"], {
        cwd: path.resolve(__dirname, "../../../../.."),
        encoding: "utf8",
        timeout: 60_000,
      });
      const report = JSON.parse(output) as {
        status: string;
        calls: number;
        approvals: number;
        checks: readonly string[];
      };
      expect(report.status).toBe("passed");
      expect(report.calls).toBe(9);
      expect(report.approvals).toBe(9);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          "real_http_tool_call",
          "reused_provider_call_id_keeps_independent_mcp_approvals_and_progress_cards",
          "actual_server_progress",
          "read_only_child_cannot_borrow_parent_permissions",
          "stop_pending_permission",
          "disable_revokes_pending_approval",
          "lazy_deferred_connect",
          "native_deferred_tool_search",
          "catalog_bearer_echo_redacted_in_durable_history",
          "single_authorization_header_for_real_http_auth",
          "deferred_tools_restored_on_next_prompt_without_search_or_external_call_replay",
          "real_http_image_result_reaches_selected_vision_model",
          "switch_to_text_only_model_explains_omitted_mcp_image",
          "real_sdk_failed_loaded_tools_commit_and_snapshot_publish_no_external_registration",
          "remote_effect_then_disconnect_blocks_same_tree_operations_across_cold_reopen",
          "reconciliation_reads_facts_without_reconnect_or_retry_clearing_unknown",
          "host_verified_readonly_http_status_query_does_not_clear_unknown_effects",
        ])
      );
    }, 65_000);
  });
});
