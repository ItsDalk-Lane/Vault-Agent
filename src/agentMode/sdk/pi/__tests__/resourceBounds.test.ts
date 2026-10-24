import { RuntimePool } from "@/agentMode/sdk/pi/runtime/RuntimePool";
import { RunBudget } from "@/agentMode/sdk/pi/runtime/RunBudget";
import {
  STORE_SIZE_STOP_BYTES,
  STORE_SIZE_WARN_BYTES,
  StoreSizePolicy,
  classifyStoreSize,
} from "@/agentMode/sdk/pi/storage/StoreSizePolicy";

describe("resourceBounds", () => {
  describe("resourceBounds", () => {
    describe("RunBudget", () => {
      it("caps active subagents at three without throwing", async () => {
        const budget = new RunBudget({ limits: { maxActiveSubagents: 3, maxModelAttempts: 32 } });
        const reserved: string[] = [];
        for (let index = 0; index < 3; index += 1) {
          const result = await budget.reserve({
            attemptId: `attempt-sub-${index}`,
            runId: "run-1",
            purpose: "subagent",
          });
          if (result.kind === "reserved") reserved.push(result.attemptId);
        }
        const denied = await budget.reserve({
          attemptId: "attempt-sub-4",
          runId: "run-1",
          purpose: "subagent",
        });

        expect(reserved).toHaveLength(3);
        expect(denied).toMatchObject({ kind: "denied", code: "SUBAGENT_LIMIT" });
        expect(budget.snapshot.activeSubagents).toBe(3);
      });

      it("denies an exhausted attempt budget without crashing and refunds a freed slot", async () => {
        const budget = new RunBudget({ limits: { maxModelAttempts: 2 } });
        await budget.reserve({ attemptId: "attempt-1", runId: "run-1", purpose: "root" });
        await budget.reserve({ attemptId: "attempt-2", runId: "run-1", purpose: "root" });
        const denied = await budget.reserve({
          attemptId: "attempt-3",
          runId: "run-1",
          purpose: "root",
        });

        expect(denied).toMatchObject({ kind: "denied", code: "BUDGET_EXCEEDED" });
        await budget.refund("attempt-1");
        const retried = await budget.reserve({
          attemptId: "attempt-4",
          runId: "run-1",
          purpose: "root",
        });
        expect(retried.kind).toBe("reserved");
        expect(budget.snapshot.modelAttempts).toBe(2);
      });
    });

    describe("RuntimePool", () => {
      function makePool(
        options: {
          maxActive?: number;
          activity?: () => Promise<{
            activeForegroundTasks: number;
            activeBackgroundTasks: number;
          }>;
          bytes?: number;
        } = {}
      ) {
        const timers: {
          delayMs: number;
          callback: () => void | Promise<void>;
          cancelled: boolean;
        }[] = [];
        const opened: string[] = [];
        const closed: string[] = [];
        const archived: string[] = [];
        const cancelled: string[] = [];
        const pool = new RuntimePool({
          maxActive: options.maxActive ?? 2,
          idleTimeoutMs: 60_000,
          openRuntime: async (rootKey) => {
            opened.push(rootKey);
            return { rootKey, handle: {} };
          },
          closeRuntime: async (runtime) => {
            closed.push(runtime.rootKey);
          },
          cancelRuntime: async (runtime) => {
            cancelled.push(runtime.rootKey);
          },
          archiveRuntime: async (runtime) => {
            archived.push(runtime.rootKey);
          },
          activity:
            options.activity ??
            (async () => ({ activeForegroundTasks: 0, activeBackgroundTasks: 0 })),
          sizePolicy: new StoreSizePolicy({ measureBytes: async () => options.bytes ?? 0 }),
          setTimer: (delayMs, callback) => {
            const timer = { delayMs, callback, cancelled: false };
            timers.push(timer);
            return () => {
              timer.cancelled = true;
            };
          },
        });
        return { pool, timers, opened, closed, archived, cancelled };
      }

      it("warns at 16 MiB and stops new runs at 32 MiB without crashing", async () => {
        expect(classifyStoreSize(STORE_SIZE_WARN_BYTES - 1)).toBe("ok");
        expect(classifyStoreSize(STORE_SIZE_WARN_BYTES)).toBe("suggest_new_session");
        expect(classifyStoreSize(STORE_SIZE_STOP_BYTES)).toBe("stop_new_runs");

        const mode = makePool({ bytes: STORE_SIZE_WARN_BYTES });
        await mode.pool.acquire("root-a");
        const warned = await mode.pool.admitRun("root-a");
        expect(warned).toMatchObject({ kind: "accepted", warning: true });

        const stopped = makePool({ bytes: STORE_SIZE_STOP_BYTES });
        await stopped.pool.acquire("root-b");
        const blocked = await stopped.pool.admitRun("root-b");
        expect(blocked).toMatchObject({ kind: "blocked", code: "STORE_SIZE_LIMIT" });
        await expect(stopped.pool.cancelRun("root-b")).resolves.toEqual({ kind: "cancelled" });
        expect(stopped.cancelled).toEqual(["root-b"]);
      });

      it("keeps at most two root stores and queues the third", async () => {
        const { pool, opened, timers } = makePool();
        const first = await pool.acquire("root-a");
        await pool.acquire("root-b");
        let thirdResolved = false;
        const third = pool.acquire("root-c").then((runtime) => {
          thirdResolved = true;
          return runtime;
        });

        await Promise.resolve();
        expect(thirdResolved).toBe(false);
        expect(opened).toEqual(["root-a", "root-b"]);

        await pool.release("root-b");
        await pool.release("root-a");
        expect(first.rootKey).toBe("root-a");
        for (const timer of timers) {
          if (!timer.cancelled) await timer.callback();
        }
        const thirdRuntime = await third;
        expect(thirdRuntime.rootKey).toBe("root-c");
        expect(thirdResolved).toBe(true);
      });

      it("closes an idle store after the timeout and cancels a re-acquired timer", async () => {
        const { pool, timers, closed } = makePool();
        await pool.acquire("root-a");
        await pool.release("root-a");
        expect(timers).toHaveLength(1);

        await pool.acquire("root-a");
        expect(timers[0]?.cancelled).toBe(true);
        await pool.release("root-a");

        const timer = timers[timers.length - 1];
        await timer.callback();

        expect(closed).toEqual(["root-a"]);
      });

      it("defers the JSONL archive while a run is active and rolls once at the boundary", async () => {
        let foregroundTasks = 1;
        const { pool, archived } = makePool({
          activity: async () => ({
            activeForegroundTasks: foregroundTasks,
            activeBackgroundTasks: 0,
          }),
        });
        await pool.acquire("root-a");
        await pool.admitRun("root-a");

        const deferred = await pool.requestArchive("root-a");

        expect(deferred).toEqual({ kind: "deferred", reasons: ["foreground_tasks"] });
        expect(archived).toEqual([]);
        foregroundTasks = 0;
        await pool.release("root-a");
        const boundary = await pool.notifyTaskBoundary("root-a");
        expect(boundary).toEqual({ kind: "archived" });
        expect(archived).toEqual(["root-a"]);
      });
    });
  });
});
