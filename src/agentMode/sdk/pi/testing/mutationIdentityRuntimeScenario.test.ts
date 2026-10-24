import { execFileSync } from "node:child_process";

describe("mutationIdentityRuntimeScenario", () => {
  describe("runMutationIdentityRuntimeScenario()", () => {
    it("keeps two writes, receipts and reopened tool cards when a provider reuses a call id https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "mutationIdentity"], {
          encoding: "utf8",
          timeout: 60_000,
        })
      ) as { status: string; checks: string[]; providerCalls: number };
      expect(report).toEqual({
        status: "passed",
        checks: [
          "reused_provider_call_id_has_two_actual_effects",
          "distinct_durable_mutation_receipts",
          "two_independent_completed_historical_cards",
          "cold_reopen_does_not_replay_effects",
          "sdk_edit_and_frontmatter_accept_real_read_version_and_legacy_alias",
          "sdk_missing_whole_file_version_rejected_before_host_execution",
          "sdk_unicode_read_preserves_json_version_and_cursor_before_edit",
        ],
        providerCalls: 31,
      });
    });
  });
});
