// One writer per root, at most two open root stores, idle stores closed after 60 seconds
// with no observers or work, and rolling archive only at a task boundary:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface PooledRuntime {
  readonly rootKey: string;
  readonly handle: unknown;
}

export interface RuntimeActivity {
  readonly activeForegroundTasks: number;
  readonly activeBackgroundTasks: number;
}

export type RuntimePoolErrorCode =
  | "RUNTIME_NOT_OPEN"
  | "RUNTIME_POOL_CLOSED"
  | "RUNTIME_CLOSING"
  | "RUNTIME_BUSY";

export class RuntimePoolError extends Error {
  readonly code: RuntimePoolErrorCode;

  constructor(code: RuntimePoolErrorCode, message: string) {
    super(message);
    this.name = "RuntimePoolError";
    this.code = code;
  }
}

export interface AdmitRunResult {
  readonly kind: "accepted";
}

export type CancelRunResult = { readonly kind: "cancelled" };

export type ArchiveReason = "foreground_tasks" | "background_tasks";

export type ArchiveResult =
  | { kind: "archived" }
  | { kind: "deferred"; reasons: readonly ArchiveReason[] };

export type ArchiveBoundaryResult = ArchiveResult | { kind: "noop" };

export interface RuntimePoolOptions {
  openRuntime: (rootKey: string) => Promise<PooledRuntime>;
  closeRuntime: (runtime: PooledRuntime, reason: "capacity" | "idle" | "close") => Promise<void>;
  cancelRuntime?: (runtime: PooledRuntime) => Promise<void>;
  archiveRuntime?: (runtime: PooledRuntime) => Promise<void>;
  activity?: (rootKey: string) => Promise<RuntimeActivity>;
  isInUse?: (rootKey: string) => boolean;
  now?: () => number;
  setTimer?: (delayMs: number, callback: () => void | Promise<void>) => () => void;
  idleTimeoutMs?: number;
  maxActive?: number;
}

interface PoolEntry {
  readonly rootKey: string;
  readonly runtime: PooledRuntime;
  observers: number;
  activeRuns: number;
  lastUsedAt: number;
  idleTimer: (() => void) | null;
  pendingArchive: boolean;
  closing: Promise<void> | null;
}

interface QueueWaiter {
  readonly rootKey: string;
  readonly waitForCapacity: boolean;
  readonly resolve: (runtime: PooledRuntime) => void;
  readonly reject: (error: unknown) => void;
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ACTIVE = 2;
const IDLE_ACTIVITY: RuntimeActivity = Object.freeze({
  activeForegroundTasks: 0,
  activeBackgroundTasks: 0,
});

function isBusy(activity: RuntimeActivity): boolean {
  return activity.activeForegroundTasks > 0 || activity.activeBackgroundTasks > 0;
}

function archiveReasons(activity: RuntimeActivity): ArchiveReason[] {
  const reasons: ArchiveReason[] = [];
  if (activity.activeForegroundTasks > 0) reasons.push("foreground_tasks");
  if (activity.activeBackgroundTasks > 0) reasons.push("background_tasks");
  return reasons;
}

export class RuntimePool {
  private readonly openRuntime: (rootKey: string) => Promise<PooledRuntime>;
  private readonly closeRuntime: RuntimePoolOptions["closeRuntime"];
  private readonly cancelRuntime: ((runtime: PooledRuntime) => Promise<void>) | undefined;
  private readonly archiveRuntime: ((runtime: PooledRuntime) => Promise<void>) | undefined;
  private readonly isInUse: (rootKey: string) => boolean;
  private readonly activityProbe: (rootKey: string) => Promise<RuntimeActivity>;
  private readonly now: () => number;
  private readonly setTimer: (delayMs: number, callback: () => void | Promise<void>) => () => void;
  private readonly idleTimeoutMs: number;
  private readonly maxActive: number;
  private readonly entries = new Map<string, PoolEntry>();
  private readonly waiters: QueueWaiter[] = [];
  private draining = false;
  private closed = false;
  private readonly closingRoots = new Set<string>();
  private opening: { readonly rootKey: string; readonly done: Promise<void> } | undefined;

  constructor(options: RuntimePoolOptions) {
    this.openRuntime = options.openRuntime;
    this.closeRuntime = options.closeRuntime;
    this.cancelRuntime = options.cancelRuntime;
    this.archiveRuntime = options.archiveRuntime;
    this.isInUse = options.isInUse ?? (() => false);
    this.activityProbe = options.activity ?? (async () => IDLE_ACTIVITY);
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((delayMs, callback) => {
        const timer = window.setTimeout(() => {
          void callback();
        }, delayMs);
        return () => window.clearTimeout(timer);
      });
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxActive = options.maxActive ?? DEFAULT_MAX_ACTIVE;
  }

  async acquire(
    rootKey: string,
    options?: { readonly waitForCapacity?: boolean }
  ): Promise<PooledRuntime> {
    if (this.closed)
      throw new RuntimePoolError("RUNTIME_POOL_CLOSED", "The runtime pool is closed.");
    if (this.closingRoots.has(rootKey))
      throw new RuntimePoolError("RUNTIME_CLOSING", `The runtime for ${rootKey} is closing.`);
    const existing = this.entries.get(rootKey);
    if (existing && !existing.closing) return this.observe(rootKey);
    // 历史读取不能排在执行队列中无限等待；没有空位时由调用方显示已有只读快照。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (options?.waitForCapacity === false && (this.draining || this.waiters.length > 0))
      throw new RuntimePoolError("RUNTIME_BUSY", "其他聊天正在运行，暂时没有可用的执行位置。");
    // 打开中的存储也占用名额；统一队列防止并行打开突破两个写入者上限。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    return new Promise<PooledRuntime>((resolve, reject) => {
      this.waiters.push({
        rootKey,
        resolve,
        reject,
        waitForCapacity: options?.waitForCapacity !== false,
      });
      void this.drainQueue();
    });
  }

  observe(rootKey: string): PooledRuntime {
    const entry = this.requireEntry(rootKey);
    if (entry.closing || this.closed || this.closingRoots.has(rootKey))
      throw new RuntimePoolError("RUNTIME_CLOSING", `The runtime for ${rootKey} is closing.`);
    entry.observers += 1;
    entry.lastUsedAt = this.now();
    this.cancelIdleCheck(entry);
    return entry.runtime;
  }

  async release(rootKey: string): Promise<void> {
    const entry = this.entries.get(rootKey);
    if (!entry) return;
    if (entry.observers > 0) entry.observers -= 1;
    entry.lastUsedAt = this.now();
    if (entry.observers === 0 && entry.activeRuns === 0) {
      this.scheduleIdleCheck(entry);
    }
    await this.drainQueue();
  }

  async admitRun(rootKey: string): Promise<AdmitRunResult> {
    const entry = this.requireEntry(rootKey);
    if (this.closed || entry.closing || this.closingRoots.has(rootKey))
      throw new RuntimePoolError("RUNTIME_CLOSING", `The runtime for ${rootKey} is closing.`);
    entry.activeRuns += 1;
    this.cancelIdleCheck(entry);
    return { kind: "accepted" };
  }

  async finishRun(rootKey: string): Promise<void> {
    const entry = this.entries.get(rootKey);
    if (!entry) return;
    if (entry.activeRuns > 0) entry.activeRuns -= 1;
    entry.lastUsedAt = this.now();
    await this.notifyTaskBoundary(rootKey);
    await this.drainQueue();
  }

  async notifyCapacityAvailable(): Promise<void> {
    await this.drainQueue();
  }

  async close(rootKey: string): Promise<void> {
    this.closingRoots.add(rootKey);
    const error = new RuntimePoolError("RUNTIME_CLOSING", `The runtime for ${rootKey} was closed.`);
    this.rejectWaiters((waiter) => waiter.rootKey === rootKey, error);
    try {
      if (this.opening?.rootKey === rootKey) await this.opening.done;
      const entry = this.entries.get(rootKey);
      if (entry) {
        if (this.cancelRuntime) await this.cancelRuntime(entry.runtime);
        await this.closeEntry(entry);
      }
    } finally {
      this.closingRoots.delete(rootKey);
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.rejectWaiters(
      () => true,
      new RuntimePoolError("RUNTIME_POOL_CLOSED", "The runtime pool was shut down.")
    );
    await this.opening?.done;
    const results = await Promise.allSettled(
      [...this.entries.keys()].map((rootKey) => this.close(rootKey))
    );
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }

  async cancelRun(rootKey: string): Promise<CancelRunResult> {
    const entry = this.requireEntry(rootKey);
    if (this.cancelRuntime) await this.cancelRuntime(entry.runtime);
    return { kind: "cancelled" };
  }

  async requestArchive(rootKey: string): Promise<ArchiveResult> {
    const entry = this.requireEntry(rootKey);
    const activity = await this.activityProbe(rootKey);
    const reasons = archiveReasons(activity);
    if (reasons.length > 0) {
      entry.pendingArchive = true;
      return { kind: "deferred", reasons };
    }
    await this.runArchive(entry);
    return { kind: "archived" };
  }

  async notifyTaskBoundary(rootKey: string): Promise<ArchiveBoundaryResult> {
    try {
      const entry = this.entries.get(rootKey);
      if (!entry) return { kind: "noop" };
      const activity = await this.activityProbe(rootKey);
      const reasons = archiveReasons(activity);
      if (entry.pendingArchive && reasons.length > 0) {
        return { kind: "deferred", reasons };
      }
      if (entry.pendingArchive) {
        entry.pendingArchive = false;
        await this.runArchive(entry);
        return { kind: "archived" };
      }
      if (entry.observers === 0 && entry.activeRuns === 0) {
        this.scheduleIdleCheck(entry);
      }
      return { kind: "noop" };
    } finally {
      await this.drainQueue();
    }
  }

  private requireEntry(rootKey: string): PoolEntry {
    const entry = this.entries.get(rootKey);
    if (!entry) {
      throw new RuntimePoolError("RUNTIME_NOT_OPEN", `No runtime is open for ${rootKey}.`);
    }
    return entry;
  }

  private async runArchive(entry: PoolEntry): Promise<void> {
    if (this.archiveRuntime) await this.archiveRuntime(entry.runtime);
  }

  private async openEntry(rootKey: string): Promise<PooledRuntime> {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.opening = { rootKey, done };
    try {
      const runtime = await this.openRuntime(rootKey);
      if (this.closed || this.closingRoots.has(rootKey)) {
        await this.closeRuntime(runtime, "close");
        throw new RuntimePoolError(
          this.closed ? "RUNTIME_POOL_CLOSED" : "RUNTIME_CLOSING",
          `The runtime for ${rootKey} was closed while opening.`
        );
      }
      this.entries.set(rootKey, {
        rootKey,
        runtime,
        observers: 1,
        activeRuns: 0,
        lastUsedAt: this.now(),
        idleTimer: null,
        pendingArchive: false,
        closing: null,
      });
      return runtime;
    } finally {
      this.opening = undefined;
      finish();
    }
  }

  private cancelIdleCheck(entry: PoolEntry): void {
    if (entry.idleTimer) {
      entry.idleTimer();
      entry.idleTimer = null;
    }
  }

  private scheduleIdleCheck(entry: PoolEntry): void {
    this.cancelIdleCheck(entry);
    if (this.closed || entry.closing) return;
    entry.idleTimer = this.setTimer(this.idleTimeoutMs, () => this.handleIdleTimeout(entry));
  }

  private async handleIdleTimeout(entry: PoolEntry): Promise<void> {
    entry.idleTimer = null;
    if (this.entries.get(entry.rootKey) !== entry) return;
    const activity = await this.activityProbe(entry.rootKey);
    if (this.entries.get(entry.rootKey) !== entry || entry.closing) return;
    if (
      isBusy(activity) ||
      this.isInUse(entry.rootKey) ||
      entry.observers > 0 ||
      entry.activeRuns > 0
    ) {
      this.scheduleIdleCheck(entry);
      return;
    }
    await this.closeEntry(entry, "idle");
  }

  private async closeEntry(
    entry: PoolEntry,
    reason: "capacity" | "idle" | "close" = "close"
  ): Promise<void> {
    if (entry.closing) return entry.closing;
    this.cancelIdleCheck(entry);
    // 关闭完成前仍保留占位，避免旧写入者未退出就放入新的存储。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const closing = this.closeRuntime(entry.runtime, reason).then(() => {
      if (this.entries.get(entry.rootKey) === entry) this.entries.delete(entry.rootKey);
    });
    entry.closing = closing;
    try {
      await closing;
    } finally {
      entry.closing = null;
      await this.drainQueue();
    }
  }

  private async evictIdleForCapacity(): Promise<boolean> {
    const candidates = [...this.entries.values()]
      .filter((entry) => !entry.closing && entry.activeRuns === 0)
      .sort(
        (left, right) =>
          Number(left.observers > 0) - Number(right.observers > 0) ||
          left.lastUsedAt - right.lastUsedAt
      );
    for (const candidate of candidates) {
      const activity = await this.activityProbe(candidate.rootKey);
      if (
        isBusy(activity) ||
        this.isInUse(candidate.rootKey) ||
        candidate.activeRuns > 0 ||
        candidate.closing ||
        this.entries.get(candidate.rootKey) !== candidate
      )
        continue;
      // 可见历史由会话缓存保存，观察者不是执行任务；两张空白或闲置页面不能占满执行名额。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      await this.closeEntry(candidate, "capacity");
      return true;
    }
    return false;
  }

  private rejectWaiters(matches: (waiter: QueueWaiter) => boolean, error: RuntimePoolError): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (matches(waiter)) {
        this.waiters.splice(index, 1);
        waiter.reject(error);
      }
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.draining || this.closed) return;
    this.draining = true;
    try {
      while (!this.closed && this.waiters.length > 0) {
        const waiter = this.waiters[0];
        const existing = this.entries.get(waiter.rootKey);
        if (existing?.closing) break;
        if (existing) {
          this.waiters.shift();
          waiter.resolve(this.observe(waiter.rootKey));
          continue;
        }
        if (this.entries.size >= this.maxActive && !(await this.evictIdleForCapacity())) {
          if (waiter.waitForCapacity) break;
          this.waiters.shift();
          waiter.reject(
            new RuntimePoolError("RUNTIME_BUSY", "其他聊天正在运行，暂时没有可用的执行位置。")
          );
          continue;
        }
        this.waiters.shift();
        try {
          waiter.resolve(await this.openEntry(waiter.rootKey));
        } catch (error) {
          waiter.reject(error);
        }
      }
    } catch (error) {
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    } finally {
      this.draining = false;
    }
  }
}
