import { execFileSync } from "node:child_process";

describe("nativeRuntimeScenario", () => {
  describe("runNativeRuntimeScenario()", () => {
    it("uses the real backend for authorized external writes and explicit supervised commands https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report: {
        status: string;
        approvals: number;
        checks: readonly string[];
        auditFailure: {
          effectWrites: number;
          modelRequests: number;
          injectedFailures: number;
          readOnlyExport: boolean;
        };
      } = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "native"], {
          encoding: "utf8",
          timeout: 60_000,
        })
      );
      expect(report).toMatchObject({
        status: "passed",
        approvals: 3,
        auditFailure: { effectWrites: 1, modelRequests: 1, readOnlyExport: true },
      });
      expect(report.auditFailure.injectedFailures).toBeGreaterThan(0);
      expect(report.checks).toEqual([
        "official_external_write_via_production_backend",
        "concrete_diff_permission",
        "plan_denies_external_write",
        "strict_spawns_nothing",
        "strict_command_rejection_is_persisted_by_the_sdk",
        "trusted_single_approval_runs_supervised_process",
        "stop_pending_write_blocks_late_permission",
        "private_durable_audit_records_effects_and_cancellation_without_arguments_or_secrets",
        "actual_audit_storage_failure_stops_runtime_after_one_effect_and_keeps_read_only_export",
      ]);
    }, 60_000);
  });
});
