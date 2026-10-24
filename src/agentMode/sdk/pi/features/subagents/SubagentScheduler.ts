// 子任务等待自己的后代时让出执行位置；持久任务及请求预算仍分别由 SDK 和共同模型入口负责：
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const SUBAGENT_MAX_CONCURRENT_PER_ROOT = 3;
export const SUBAGENT_MAX_DEPTH = 2;

export type SubagentScheduleState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type SubagentBlockReason = "permission_revoked" | "depth_limit";

export interface ScheduledSubagent {
  readonly taskId: string;
  readonly rootId: string;
  readonly profileId: string;
  readonly depth: number;
  readonly state: SubagentScheduleState;
  readonly queuedAtMs: number;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
  readonly blockReason?: SubagentBlockReason;
}

export interface SubagentDispatchResult {
  readonly status: "completed" | "failed" | "cancelled";
}

export interface SubagentSchedulerOptions {
  readonly dispatch: (input: {
    readonly taskId: string;
    readonly rootId: string;
    readonly profileId: string;
    readonly depth: number;
    readonly signal: AbortSignal;
  }) => Promise<SubagentDispatchResult>;
  readonly isPermissionRevoked?: (input: {
    readonly rootId: string;
    readonly profileId: string;
    readonly depth: number;
  }) => boolean | Promise<boolean>;
  readonly maxConcurrent?: number;
  readonly maxDepth?: number;
  readonly now?: () => number;
}

export class SubagentScheduler {
  readonly #options: SubagentSchedulerOptions;
  readonly #maxConcurrent: number;
  readonly #maxDepth: number;
  readonly #now: () => number;
  readonly #records = new Map<string, ScheduledSubagent>();
  readonly #queues = new Map<string, string[]>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #admissions = new Map<string, number>();
  readonly #idleWaiters: Array<() => void> = [];
  readonly #startedTasks = new Set<string>();
  readonly #startWaiters = new Map<string, Array<() => void>>();
  readonly #yielded = new Map<string, number>();
  readonly #resuming = new Map<string, () => void>();

  constructor(options: SubagentSchedulerOptions) {
    this.#options = options;
    this.#maxConcurrent = options.maxConcurrent ?? SUBAGENT_MAX_CONCURRENT_PER_ROOT;
    this.#maxDepth = options.maxDepth ?? SUBAGENT_MAX_DEPTH;
    this.#now = options.now ?? (() => Date.now());
  }

  schedule(input: {
    readonly taskId: string;
    readonly rootId: string;
    readonly profileId: string;
    readonly depth: number;
  }): Promise<ScheduledSubagent> {
    const record: ScheduledSubagent = Object.freeze({
      taskId: input.taskId,
      rootId: input.rootId,
      profileId: input.profileId,
      depth: input.depth,
      state: "queued" as const,
      queuedAtMs: this.#now(),
    });
    if (input.depth > this.#maxDepth) {
      this.#signalStarted(record.taskId);
      return Promise.resolve(
        this.#replace(record, {
          state: "blocked",
          blockReason: "depth_limit",
          endedAtMs: this.#now(),
        })
      );
    }
    this.#records.set(record.taskId, record);
    if (
      this.activeCount(input.rootId) + (this.#admissions.get(input.rootId) ?? 0) >=
      this.#maxConcurrent
    ) {
      const queue = this.#queues.get(input.rootId) ?? [];
      queue.push(record.taskId);
      this.#queues.set(input.rootId, queue);
      return Promise.resolve(record);
    }
    return this.#admitWithSlot(record);
  }

  cancel(taskId: string): Promise<ScheduledSubagent> {
    const record = this.#records.get(taskId);
    if (record === undefined) {
      return Promise.reject(new Error(`No scheduled subagent "${taskId}".`));
    }
    const queue = this.#queues.get(record.rootId) ?? [];
    const queuedIndex = queue.indexOf(taskId);
    if (queuedIndex >= 0) {
      queue.splice(queuedIndex, 1);
      this.#controllers.get(taskId)?.abort();
      this.#resuming.get(taskId)?.();
      this.#resuming.delete(taskId);
      this.#signalStarted(taskId);
      const cancelled = this.#replace(record, {
        state: "cancelled",
        endedAtMs: this.#now(),
      });
      this.#maybeIdle();
      return Promise.resolve(cancelled);
    }
    const controller = this.#controllers.get(taskId);
    if (controller === undefined) {
      // 入场检查还在等待时也必须留下取消终态，之后的检查不能重新启动该任务：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (record.state === "queued") {
        this.#signalStarted(taskId);
        return Promise.resolve(
          this.#replace(record, { state: "cancelled", endedAtMs: this.#now() })
        );
      }
      return Promise.resolve(record);
    }
    controller.abort();
    this.#resuming.get(taskId)?.();
    this.#resuming.delete(taskId);
    return Promise.resolve(this.#records.get(taskId) ?? record);
  }

  /** Resolves once the child's dispatch has actually been invoked (or it ended without dispatching).
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  started(taskId: string): Promise<ScheduledSubagent> {
    const record = this.#records.get(taskId);
    if (record === undefined)
      return Promise.reject(new Error(`No scheduled subagent "${taskId}".`));
    if (this.#startedTasks.has(taskId)) {
      return Promise.resolve(record);
    }
    return new Promise<ScheduledSubagent>((resolve) => {
      const waiters = this.#startWaiters.get(taskId) ?? [];
      waiters.push(() => resolve(this.#records.get(taskId) ?? record));
      this.#startWaiters.set(taskId, waiters);
    });
  }

  list(rootId: string): readonly ScheduledSubagent[] {
    return Object.freeze([...this.#records.values()].filter((record) => record.rootId === rootId));
  }

  activeCount(rootId: string): number {
    return [...this.#records.values()].filter(
      (record) =>
        record.rootId === rootId && record.state === "running" && !this.#yielded.has(record.taskId)
    ).length;
  }

  queuedCount(rootId: string): number {
    return this.#queues.get(rootId)?.length ?? 0;
  }

  canDelegate(depth: number): boolean {
    return depth < this.#maxDepth;
  }

  async yieldWhile<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    const record = this.#records.get(taskId);
    if (!record || record.state !== "running") return action();
    this.#yielded.set(taskId, (this.#yielded.get(taskId) ?? 0) + 1);
    await this.#pump(record.rootId);
    try {
      return await action();
    } finally {
      const count = (this.#yielded.get(taskId) ?? 1) - 1;
      if (count > 0) this.#yielded.set(taskId, count);
      else {
        const controller = this.#controllers.get(taskId);
        if (!controller || controller.signal.aborted) this.#yielded.delete(taskId);
        else {
          await new Promise<void>((resolve) => {
            const queue = this.#queues.get(record.rootId) ?? [];
            this.#resuming.set(taskId, resolve);
            queue.push(taskId);
            this.#queues.set(record.rootId, queue);
            void this.#pump(record.rootId);
          });
        }
      }
    }
  }

  async drain(): Promise<void> {
    while (this.#isBusy()) {
      await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
    }
  }

  // 同一批工具会并发进入调度，异步权限检查前先占名额，避免第四个任务越过队列：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  async #admitWithSlot(record: ScheduledSubagent): Promise<ScheduledSubagent> {
    this.#admissions.set(record.rootId, (this.#admissions.get(record.rootId) ?? 0) + 1);
    try {
      return await this.#admit(record);
    } catch {
      this.#signalStarted(record.taskId);
      return this.#replace(record, { state: "failed", endedAtMs: this.#now() });
    } finally {
      const pending = (this.#admissions.get(record.rootId) ?? 1) - 1;
      if (pending) this.#admissions.set(record.rootId, pending);
      else this.#admissions.delete(record.rootId);
      await this.#pump(record.rootId);
      this.#maybeIdle();
    }
  }

  async #admit(record: ScheduledSubagent): Promise<ScheduledSubagent> {
    const revoked = await this.#options.isPermissionRevoked?.({
      rootId: record.rootId,
      profileId: record.profileId,
      depth: record.depth,
    });
    const latest = this.#records.get(record.taskId);
    if (latest?.state === "cancelled") return latest;
    if (revoked === true) {
      this.#signalStarted(record.taskId);
      const blocked = this.#replace(record, {
        state: "blocked",
        blockReason: "permission_revoked",
        endedAtMs: this.#now(),
      });
      return blocked;
    }
    const controller = new AbortController();
    this.#controllers.set(record.taskId, controller);
    const running = this.#replace(record, { state: "running", startedAtMs: this.#now() });
    void this.#execute(running, controller).catch(() => undefined);
    return running;
  }

  async #execute(record: ScheduledSubagent, controller: AbortController): Promise<void> {
    this.#signalStarted(record.taskId);
    try {
      const result = await this.#options.dispatch({
        taskId: record.taskId,
        rootId: record.rootId,
        profileId: record.profileId,
        depth: record.depth,
        signal: controller.signal,
      });
      this.#replace(record, {
        state: controller.signal.aborted ? "cancelled" : result.status,
        endedAtMs: this.#now(),
      });
    } catch {
      this.#replace(record, {
        state: controller.signal.aborted ? "cancelled" : "failed",
        endedAtMs: this.#now(),
      });
    } finally {
      this.#yielded.delete(record.taskId);
      this.#resuming.get(record.taskId)?.();
      this.#resuming.delete(record.taskId);
      this.#controllers.delete(record.taskId);
      await this.#pump(record.rootId);
      this.#maybeIdle();
    }
  }

  async #pump(rootId: string): Promise<void> {
    const queue = this.#queues.get(rootId) ?? [];
    while (
      queue.length > 0 &&
      this.activeCount(rootId) + (this.#admissions.get(rootId) ?? 0) < this.#maxConcurrent
    ) {
      const nextId = queue.shift();
      if (nextId === undefined) break;
      const record = this.#records.get(nextId);
      if (record === undefined) continue;
      const resume = this.#resuming.get(nextId);
      if (resume) {
        this.#resuming.delete(nextId);
        this.#yielded.delete(nextId);
        resume();
      } else if (record.state === "queued") await this.#admitWithSlot(record);
    }
    if (queue.length === 0) this.#queues.delete(rootId);
  }

  #signalStarted(taskId: string): void {
    this.#startedTasks.add(taskId);
    const waiters = this.#startWaiters.get(taskId) ?? [];
    this.#startWaiters.delete(taskId);
    for (const resolve of waiters) resolve();
  }

  #replace(record: ScheduledSubagent, patch: Partial<ScheduledSubagent>): ScheduledSubagent {
    const next: ScheduledSubagent = Object.freeze({ ...record, ...patch });
    this.#records.set(next.taskId, next);
    return next;
  }

  #isBusy(): boolean {
    if (this.#admissions.size > 0 || this.#controllers.size > 0) return true;
    for (const record of this.#records.values()) {
      if (record.state === "running") return true;
    }
    for (const queue of this.#queues.values()) {
      if (queue.length > 0) return true;
    }
    return false;
  }

  #maybeIdle(): void {
    if (this.#isBusy()) return;
    const waiters = this.#idleWaiters.splice(0, this.#idleWaiters.length);
    for (const resolve of waiters) resolve();
  }
}
