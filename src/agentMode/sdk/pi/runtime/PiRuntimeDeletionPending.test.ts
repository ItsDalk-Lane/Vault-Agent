import { execFileSync } from "node:child_process";
import path from "node:path";

describe("PiRuntimeDeletionPending", () => {
  describe("PiRuntime", () => {
    let report: { status: string; checks: string[]; listedSessions: number; queuedCalls: number };
    beforeAll(() => {
      report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "deletionPending"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 60_000,
        })
      );
      expect(report.status).toBe("passed");
    }, 65_000);

    describe("deleteSession()", () => {
      it("withdraws a pending approval and removes its session without writing the note or continuing the model https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.checks).toContain(
          "pending_approval_delete_cancels_window_without_write_or_model_continuation"
        );
      });

      it("deletes durable queued input without running it when execution slots are released or the backend restarts https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.queuedCalls).toBe(0);
        expect(report.checks).toEqual(
          expect.arrayContaining([
            "queued_input_delete_removes_saved_request_and_never_runs_after_slots_free",
            "deleted_pending_sessions_remain_missing_after_cold_restart",
          ])
        );
      });
    });

    describe("list()", () => {
      it("lists every disk record beyond 500 entries and rebuilds the complete index without opening SDK sessions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(report.listedSessions).toBe(507);
        expect(report.checks).toContain(
          "disk_listing_and_rebuilt_index_include_every_record_beyond_500"
        );
      });
    });
  });
});
