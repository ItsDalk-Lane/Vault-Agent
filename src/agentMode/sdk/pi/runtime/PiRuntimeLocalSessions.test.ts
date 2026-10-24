import { execFileSync } from "node:child_process";
import * as path from "node:path";

describe("PiRuntimeLocalSessions", () => {
  describe("PiRuntime", () => {
    let report: { status: string; checks: string[] };
    beforeAll(() => {
      report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "localSessions"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        })
      );
      expect(report.status).toBe("passed");
    }, 65_000);
    describe("prompt()", () => {
      it("completes a queued tool turn beyond 64 MiB and reopens it cold without storage interruption https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toEqual(
          expect.arrayContaining([
            "large_transcript_runs_without_storage_pause",
            "large_transcript_queued_tool_turn_completes_and_reopens_cold",
          ])
        );
      });
    });
    describe("forkSession()", () => {
      it("copies a stable session without model execution and survives deletion of its source https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toEqual(
          expect.arrayContaining([
            "fork_is_independent_and_does_not_run",
            "completed_child_fork_history_is_independent_without_rewriting_transcript",
          ])
        );
      });
    });
    describe("load()", () => {
      it("rejects a missing transcript without creating a blank replacement or changing its saved metadata and snapshot https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toContain(
          "missing_transcript_restore_rejects_without_replacing_saved_metadata_or_snapshot"
        );
      });
    });
    describe("deleteSession()", () => {
      it("stops owned active work before permanent deletion and rejects another live writer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toEqual(
          expect.arrayContaining([
            "remote_writer_blocks_delete",
            "active_delete_stops_work_and_removes_all_data",
            "index_failure_does_not_reopen_deleted_chat_or_repeat_at_shutdown",
            "cold_child_open_cannot_recreate_deleted_parent",
            "active_child_delete_aborts_provider_and_cleans_parent",
          ])
        );
      });
    });
    describe("writeSessionDiagnostic()", () => {
      it("stores reports under their readonly session and waits for report writes before deleting them https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toContain(
          "diagnostics_belong_to_readonly_session_and_delete_waits_for_writes"
        );
      });
      it("removes a partially written report and preserves the original disk failure https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toContain("failed_diagnostic_write_removes_its_partial_report");
      });
    });
    describe("updateSessionMetadata()", () => {
      it("persists recent-list metadata and rebuilds the external index https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toContain("metadata_and_index_are_external");
      });
    });
    describe("subscribeStorageChanges()", () => {
      it("notifies observers after persistence and deletion https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toContain("storage_changes_are_observable");
      });
    });
  });
});
