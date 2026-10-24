import {
  RuntimePool,
  RuntimePoolError,
  type PooledRuntime,
  type RuntimeActivity,
} from "./RuntimePool";

// The pool keeps one writer per root, at most two active root stores, closes idle stores
// after 60 seconds, while allowing
// cancellation and archive only at a task boundary:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
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
  readonly timers: FakeTimer[];
  readonly pools: RuntimePool[];
}

function createWorld(): FakeWorld {
  const opened: string[] = [];
  const closed: string[] = [];
  const cancelled: string[] = [];
  const archived: string[] = [];
  const activity = new Map<string, RuntimeActivity>();
  const timers: FakeTimer[] = [];
  const pools: RuntimePool[] = [];

  const idleActivity: RuntimeActivity = { activeForegroundTasks: 0, activeBackgroundTasks: 0 };
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
  return { opened, closed, cancelled, archived, activity, timers, pools };
}

function setActivity(world: FakeWorld, rootKey: string, activity: Partial<RuntimeActivity>): void {
  world.activity.set(rootKey, {
    activeForegroundTasks: 0,
    activeBackgroundTasks: 0,
    ...activity,
  });
}

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
