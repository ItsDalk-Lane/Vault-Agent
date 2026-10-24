// 提交完成不等于显示事件已消费，重放按真实记录编号等待，不能靠延时猜测：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export class PiRuntimeEventBarrier {
  private consumed = 0;
  private failure: Error | null = null;
  private readonly waiting = new Set<{
    entryId: number;
    resolve: () => void;
    reject: (error: Error) => void;
  }>();

  waitFor(entryId: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.consumed >= entryId) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiting.add({ entryId, resolve, reject }));
  }

  advance(entryIds: readonly number[]): void {
    for (const entryId of entryIds) this.consumed = Math.max(this.consumed, entryId);
    for (const waiter of this.waiting)
      if (waiter.entryId <= this.consumed) {
        this.waiting.delete(waiter);
        waiter.resolve();
      }
  }

  close(error = new Error("The history event stream closed before replay finished.")): void {
    this.failure = error;
    for (const waiter of this.waiting) waiter.reject(error);
    this.waiting.clear();
  }
}
