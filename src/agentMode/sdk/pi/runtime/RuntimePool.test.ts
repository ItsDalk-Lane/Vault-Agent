import {
  STORE_SIZE_STOP_BYTES,
  STORE_SIZE_WARN_BYTES,
  StoreSizePolicy,
  canAcceptNewRun,
  classifyStoreSize,
} from "@/agentMode/sdk/pi/storage/StoreSizePolicy";
import {
  RuntimePool,
  RuntimePoolError,
  type PooledRuntime,
  type RuntimeActivity,
} from "./RuntimePool";

// The pool keeps one writer per root, at most two active root stores, closes idle stores
// after 60 seconds, and refuses new runs at the 32 MiB store limit while still allowing
// cancellation and archive only at a task boundary:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const MiB = 1024 * 1024;
const IDLE_MS = 60_000;

interface FakeTimer {
  readonly delayMs: number;
  readonly callback: () => void | Promise<void>;
  cancelled: boolean;
}

interface FakeWorld {
  readonly opened: string[];
  readonly closed: string[];
  readonly cancelled: string[];
  readonly archived: string[];
  readonly activity: Map<string, RuntimeActivity>;
  readonly bytes: Map<string, number>;
  readonly timers: FakeTimer[];
  readonly measureCalls: string[];
  readonly pools: RuntimePool[];
}

function createWorld(): FakeWorld {
  const opened: string[] = [];
  const closed: string[] = [];
  const cancelled: string[] = [];
  const archived: string[] = [];
  const activity = new Map<string, RuntimeActivity>();
  const bytes = new Map<string, number>();
  const timers: FakeTimer[] = [];
  const measureCalls: string[] = [];
  const pools: RuntimePool[] = [];

  const idleActivity: RuntimeActivity = { activeForegroundTasks: 0, activeBackgroundTasks: 0 };
  const sizePolicy = new StoreSizePolicy({
    measureBytes: async (rootKey) => {
      measureCalls.push(rootKey);
      return bytes.get(rootKey) ?? 0;
    },
  });

  const pool = new RuntimePool({
    openRuntime: async (rootKey): Promise<PooledRuntime> => {
      opened.push(rootKey);
      return { rootKey, handle: `handle:${rootKey}` };
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
    activity: async (rootKey) => activity.get(rootKey) ?? idleActivity,
    sizePolicy,
    now: () => 1_000,
    setTimer: (delayMs, callback) => {
      const timer: FakeTimer = { delayMs, callback, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  pools.push(pool);
  return { opened, closed, cancelled, archived, activity, bytes, timers, measureCalls, pools };
}

function setActivity(world: FakeWorld, rootKey: string, activity: Partial<RuntimeActivity>): void {
  world.activity.set(rootKey, {
    activeForegroundTasks: 0,
    activeBackgroundTasks: 0,
    ...activity,
  });
}

describe("StoreSizePolicy", () => {
  it("classifies the 16 MiB warning and 32 MiB stop boundaries", () => {
    expect(STORE_SIZE_WARN_BYTES).toBe(16 * MiB);
    expect(STORE_SIZE_STOP_BYTES).toBe(32 * MiB);
    expect(classifyStoreSize(0)).toBe("ok");
    expect(classifyStoreSize(16 * MiB - 1)).toBe("ok");
    expect(classifyStoreSize(16 * MiB)).toBe("suggest_new_session");
    expect(classifyStoreSize(32 * MiB - 1)).toBe("suggest_new_session");
    expect(classifyStoreSize(32 * MiB)).toBe("stop_new_runs");
  });

  it("measures the real store bytes on every status read instead of caching", async () => {
    let realBytes = 10 * MiB;
    const policy = new StoreSizePolicy({ measureBytes: async () => realBytes });

    const first = await policy.status("root-1");
    realBytes = 34 * MiB;
    const second = await policy.status("root-1");

    expect(first).toMatchObject({ bytes: 10 * MiB, verdict: "ok" });
    expect(second).toMatchObject({ bytes: 34 * MiB, verdict: "stop_new_runs" });
  });

  it("does not pretend compaction shrank the on-disk JSONL file", async () => {
    const sizes = [20 * MiB, 34 * MiB];
    const calls: number[] = [];
    const policy = new StoreSizePolicy({
      measureBytes: async () => {
        const size = sizes[Math.min(calls.length, sizes.length - 1)];
        calls.push(size);
        return size;
      },
    });

    const before = await policy.status("root-1");
    const afterCompaction = await policy.status("root-1");

    expect(before).toMatchObject({ bytes: 20 * MiB, verdict: "suggest_new_session" });
    expect(afterCompaction.bytes).toBe(34 * MiB);
    expect(afterCompaction.verdict).toBe("stop_new_runs");
    expect(afterCompaction.bytes).toBeGreaterThan(before.bytes);
  });

  it("exposes whether a new run may start", () => {
    expect(canAcceptNewRun("ok")).toBe(true);
    expect(canAcceptNewRun("suggest_new_session")).toBe(true);
    expect(canAcceptNewRun("stop_new_runs")).toBe(false);
  });
});

describe("RuntimePool", () => {
  describe("acquire() concurrency", () => {
    it("releases an observed idle writer for a new request without cancelling its chat https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const world = createWorld();
      const pool = world.pools[0];
      await pool.acquire("root-visible-first");
      await pool.acquire("root-visible-second");
      await expect(pool.acquire("root-new", { waitForCapacity: false })).resolves.toMatchObject({
        rootKey: "root-new",
      });
      expect(world.closed).toEqual(["root-visible-first"]);
      expect(world.cancelled).toEqual([]);
    });

    it("keeps a new run reserved while size measurement is pending after an idle probe started https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let probeStarted!: () => void;
      let finishProbe!: () => void;
      let measureStarted!: () => void;
      let finishMeasure!: () => void;
      const probing = new Promise<void>((resolve) => {
        probeStarted = resolve;
      });
      const probe = new Promise<void>((resolve) => {
        finishProbe = resolve;
      });
      const measuring = new Promise<void>((resolve) => {
        measureStarted = resolve;
      });
      const measurement = new Promise<void>((resolve) => {
        finishMeasure = resolve;
      });
      const closed: string[] = [];
      const pool = new RuntimePool({
        maxActive: 1,
        openRuntime: async (rootKey) => ({ rootKey, handle: rootKey }),
        closeRuntime: async (runtime) => {
          closed.push(runtime.rootKey);
        },
        activity: async () => {
          probeStarted();
          await probe;
          return { activeForegroundTasks: 0, activeBackgroundTasks: 0 };
        },
        sizePolicy: new StoreSizePolicy({
          measureBytes: async () => {
            measureStarted();
            await measurement;
            return 0;
          },
        }),
        setTimer: () => () => undefined,
      });
      await pool.acquire("root-first");
      await pool.release("root-first");
      const waiting = pool.acquire("root-second", { waitForCapacity: false }).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error })
      );
      await probing;
      const admission = pool.admitRun("root-first").then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error })
      );
      await measuring;
      finishProbe();
      const waited = await waiting;
      finishMeasure();
      const admitted = await admission;
      expect(waited.error).toMatchObject({ code: "RUNTIME_BUSY" });
      expect(admitted.error).toBeNull();
      expect(admitted.value?.kind).toBe("accepted");
      expect(closed).toEqual([]);
    });

    it("keeps a short SDK operation that starts during an idle probe and drains the original queue when it ends https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let beginProbe!: () => void;
      let releaseProbe!: () => void;
      const probing = new Promise<void>((resolve) => {
        beginProbe = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseProbe = resolve;
      });
      let inUse = false;
      const closed: string[] = [];
      const pool = new RuntimePool({
        maxActive: 1,
        openRuntime: async (rootKey) => ({ rootKey, handle: rootKey }),
        closeRuntime: async (runtime, reason) => {
          closed.push(`${runtime.rootKey}:${reason}`);
        },
        isInUse: () => inUse,
        activity: async () => {
          beginProbe();
          await released;
          return { activeForegroundTasks: 0, activeBackgroundTasks: 0 };
        },
        setTimer: () => () => undefined,
      });
      await pool.acquire("first");
      const waiting = pool.acquire("second", { waitForCapacity: false }).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error })
      );
      await probing;
      inUse = true;
      releaseProbe();
      expect((await waiting).error).toMatchObject({ code: "RUNTIME_BUSY" });
      expect(closed).toEqual([]);
      const queued = pool.acquire("second");
      inUse = false;
      await pool.notifyCapacityAvailable();
      expect((await queued).rootKey).toBe("second");
      expect(closed).toEqual(["first:capacity"]);
    });

    it("counts roots still opening against the two-writer limit https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const opened: string[] = [];
      let finishFirst!: () => void;
      const firstOpened = new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      const timers: Array<() => void | Promise<void>> = [];
      const pool = new RuntimePool({
        openRuntime: async (rootKey) => {
          opened.push(rootKey);
          if (rootKey === "root-1") await firstOpened;
          return { rootKey, handle: rootKey };
        },
        closeRuntime: async () => undefined,
        setTimer: (_delay, callback) => {
          timers.push(callback);
          return () => undefined;
        },
      });
      const first = pool.acquire("root-1");
      const second = pool.acquire("root-2");
      const third = pool.acquire("root-3");
      const initialOpenCount = opened.length;
      finishFirst();
      await first;
      await second;
      expect(initialOpenCount).toBeLessThanOrEqual(2);
      expect(opened).toHaveLength(2);
      await pool.release("root-1");
      await timers[0]?.();
      expect((await third).rootKey).toBe("root-3");
    });
  });
  it("reuses the same runtime for repeated opens and popout observers", async () => {
    const world = createWorld();
    const pool = world.pools[0];

    const first = await pool.acquire("root-1");
    const second = await pool.acquire("root-1");
    const popout = pool.observe("root-1");

    expect(world.opened).toEqual(["root-1"]);
    expect(world.closed).toEqual([]);
    expect(first).toBe(second);
    expect(popout).toBe(first);
    expect(popout.handle).toBe("handle:root-1");
  });

  it("closes an idle runtime 60 seconds after the last observer leaves", async () => {
    const world = createWorld();
    const pool = world.pools[0];
    await pool.acquire("root-1");

    await pool.release("root-1");

    expect(world.timers).toHaveLength(1);
    expect(world.timers[0].delayMs).toBe(IDLE_MS);
    await world.timers[0].callback();

    expect(world.closed).toEqual(["root-1"]);
    expect(world.opened).toEqual(["root-1"]);
  });

  it("keeps a runtime with active work and reschedules the idle check", async () => {
    const world = createWorld();
    const pool = world.pools[0];
    await pool.acquire("root-1");
    setActivity(world, "root-1", { activeForegroundTasks: 1 });
    await pool.release("root-1");

    await world.timers[0].callback();

    expect(world.closed).toEqual([]);
    expect(world.timers).toHaveLength(2);
    expect(world.timers[1].delayMs).toBe(IDLE_MS);
  });

  it("queues beyond two active roots instead of opening a third writer", async () => {
    const world = createWorld();
    const pool = world.pools[0];
    await pool.acquire("root-1");
    await pool.acquire("root-2");

    const pending = pool.acquire("root-3");
    expect(world.opened).toEqual(["root-1", "root-2"]);

    await pool.release("root-1");
    await world.timers[0].callback();
    const third = await pending;

    expect(world.opened).toEqual(["root-1", "root-2", "root-3"]);
    expect(third.handle).toBe("handle:root-3");
    expect(world.closed).toEqual(["root-1"]);
  });

  it("rejects a nonwaiting history acquisition immediately when both writers are occupied and opens only after an explicit retry https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
    const world = createWorld();
    const pool = world.pools[0];
    await pool.acquire("root-1");
    await pool.acquire("root-2");
    setActivity(world, "root-1", { activeForegroundTasks: 1 });
    setActivity(world, "root-2", { activeForegroundTasks: 1 });
    await expect(pool.acquire("root-history", { waitForCapacity: false })).rejects.toMatchObject({
      code: "RUNTIME_BUSY",
    });
    expect(world.opened).toEqual(["root-1", "root-2"]);
    await pool.close("root-1");
    expect(world.opened).toEqual(["root-1", "root-2"]);
    expect((await pool.acquire("root-history", { waitForCapacity: false })).rootKey).toBe(
      "root-history"
    );
  });

  it("evicts an idle root for capacity but never one with active work", async () => {
    const world = createWorld();
    const pool = world.pools[0];
    await pool.acquire("root-active");
    await pool.acquire("root-idle");
    setActivity(world, "root-active", { activeForegroundTasks: 1 });
    setActivity(world, "root-idle", {});
    await pool.release("root-active");
    await pool.release("root-idle");

    const third = await pool.acquire("root-new");

    expect(third.handle).toBe("handle:root-new");
    expect(world.closed).toEqual(["root-idle"]);
    expect(world.closed).not.toContain("root-active");
    expect(world.opened).toEqual(["root-active", "root-idle", "root-new"]);
  });

  it("refuses new runs at 32 MiB but still allows cancelling an active run", async () => {
    const world = createWorld();
    const pool = world.pools[0];
    await pool.acquire("root-1");
    world.bytes.set("root-1", 10 * MiB);

    const accepted = await pool.admitRun("root-1");
    expect(accepted).toMatchObject({ kind: "accepted", warning: false, status: { verdict: "ok" } });

    world.bytes.set("root-1", 33 * MiB);
    const blocked = await pool.admitRun("root-1");
    expect(blocked).toMatchObject({
      kind: "blocked",
      code: "STORE_SIZE_LIMIT",
      suggestion: "summarize_and_new_session",
      status: { bytes: 33 * MiB, verdict: "stop_new_runs" },
    });

    await expect(pool.cancelRun("root-1")).resolves.toEqual({ kind: "cancelled" });
    expect(world.cancelled).toEqual(["root-1"]);
  });

  it("archives only after foreground and background tasks have ended", async () => {
    const world = createWorld();
    const pool = world.pools[0];
    await pool.acquire("root-1");
    setActivity(world, "root-1", { activeForegroundTasks: 1, activeBackgroundTasks: 1 });

    await expect(pool.requestArchive("root-1")).resolves.toEqual({
      kind: "deferred",
      reasons: ["foreground_tasks", "background_tasks"],
    });
    expect(world.archived).toEqual([]);

    setActivity(world, "root-1", { activeForegroundTasks: 1 });
    await expect(pool.notifyTaskBoundary("root-1")).resolves.toEqual({
      kind: "deferred",
      reasons: ["foreground_tasks"],
    });
    expect(world.archived).toEqual([]);

    setActivity(world, "root-1", {});
    await expect(pool.notifyTaskBoundary("root-1")).resolves.toEqual({ kind: "archived" });
    await expect(pool.notifyTaskBoundary("root-1")).resolves.toEqual({ kind: "noop" });
    expect(world.archived).toEqual(["root-1"]);
  });

  it("rejects observing a root that has no open runtime", () => {
    const world = createWorld();
    const pool = world.pools[0];

    expect(() => pool.observe("root-missing")).toThrow(RuntimePoolError);
  });
  describe("release()", () => {
    it("does not let an old idle check close a replacement writer with the same session ID https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let probeStarted!: () => void;
      let releaseProbe!: () => void;
      const probing = new Promise<void>((resolve) => {
        probeStarted = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseProbe = resolve;
      });
      const timers: Array<() => void | Promise<void>> = [];
      const closed: string[] = [];
      let probes = 0;
      const pool = new RuntimePool({
        maxActive: 1,
        openRuntime: async (rootKey) => ({ rootKey, handle: rootKey }),
        closeRuntime: async (runtime) => {
          closed.push(runtime.rootKey);
        },
        activity: async () => {
          if (++probes === 1) {
            probeStarted();
            await released;
          }
          return { activeForegroundTasks: 0, activeBackgroundTasks: 0 };
        },
        setTimer: (_delay, callback) => {
          timers.push(callback);
          return () => undefined;
        },
      });
      await pool.acquire("first");
      await pool.release("first");
      const oldIdleCheck = timers[0]();
      await probing;
      await pool.acquire("second");
      await pool.acquire("first");
      releaseProbe();
      await oldIdleCheck;
      expect(closed).toEqual(["first", "second"]);
      expect((await pool.acquire("first")).rootKey).toBe("first");
    });
  });

  describe("finishRun()", () => {
    it("returns a completed run to the idle lifecycle so its writer can be closed https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const world = createWorld();
      const pool = world.pools[0];
      await pool.acquire("root-1");
      await pool.admitRun("root-1");
      await pool.release("root-1");
      expect(world.timers).toHaveLength(0);
      await pool.finishRun("root-1");
      await world.timers[0].callback();
      expect(world.closed).toEqual(["root-1"]);
      await pool.finishRun("root-1");
    });
  });

  describe("close()", () => {
    it("rejects a queued open for the closed root and allows a later explicit reopen https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const world = createWorld();
      const pool = world.pools[0];
      await pool.acquire("root-1");
      await pool.acquire("root-2");
      setActivity(world, "root-1", { activeForegroundTasks: 1 });
      setActivity(world, "root-2", { activeForegroundTasks: 1 });
      const queued = pool.acquire("root-3");
      const rejection = expect(queued).rejects.toMatchObject({ code: "RUNTIME_CLOSING" });
      await pool.close("root-3");
      await rejection;
      await pool.close("root-1");
      expect((await pool.acquire("root-3")).rootKey).toBe("root-3");
      expect(world.closed).toEqual(["root-1"]);
    });

    it("keeps a closing writer in the capacity count until its close actually finishes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let finishClose!: () => void;
      const closed = new Promise<void>((resolve) => {
        finishClose = resolve;
      });
      const opened: string[] = [];
      const pool = new RuntimePool({
        openRuntime: async (rootKey) => {
          opened.push(rootKey);
          return { rootKey, handle: rootKey };
        },
        closeRuntime: () => closed,
      });
      await pool.acquire("root-1");
      await pool.acquire("root-2");
      const third = pool.acquire("root-3");
      const closing = pool.close("root-1");
      expect(opened).toEqual(["root-1", "root-2"]);
      finishClose();
      await closing;
      expect((await third).rootKey).toBe("root-3");
      expect(opened).toHaveLength(3);
    });
  });

  describe("shutdown()", () => {
    it("rejects queued and late-opening roots and closes the writer that finishes opening during shutdown https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let finishOpen!: () => void;
      const opening = new Promise<void>((resolve) => {
        finishOpen = resolve;
      });
      const closed: string[] = [];
      const pool = new RuntimePool({
        openRuntime: async (rootKey) => {
          await opening;
          return { rootKey, handle: rootKey };
        },
        closeRuntime: async (runtime) => {
          closed.push(runtime.rootKey);
        },
      });
      const first = pool.acquire("root-1");
      const second = pool.acquire("root-2");
      const firstRejection = expect(first).rejects.toMatchObject({ code: "RUNTIME_POOL_CLOSED" });
      const secondRejection = expect(second).rejects.toMatchObject({ code: "RUNTIME_POOL_CLOSED" });
      const shutdown = pool.shutdown();
      finishOpen();
      await shutdown;
      await firstRejection;
      await secondRejection;
      expect(closed).toEqual(["root-1"]);
      await expect(pool.acquire("root-late")).rejects.toMatchObject({
        code: "RUNTIME_POOL_CLOSED",
      });
    });
  });
});
