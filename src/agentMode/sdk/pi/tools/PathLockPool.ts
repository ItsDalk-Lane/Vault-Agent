// A single lock pool coordinates plugin writes across sessions, subagents, fan-out and rollback.
// Paths are deduplicated and acquired in canonical (sorted) order so multi-path writes cannot
// deadlock; reads never acquire this pool, so a pending approval blocks no read:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface PathLockLease {
  readonly paths: readonly string[];
  release(): void;
}

export class PathLockPool {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly heldCounts = new Map<string, number>();

  async acquire(paths: readonly string[]): Promise<PathLockLease> {
    const sorted = [...new Set(paths)].sort();
    const releases: Array<() => void> = [];
    for (const path of sorted) {
      const previous = this.tails.get(path) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.tails.set(
        path,
        previous.then(() => gate)
      );
      await previous;
      this.heldCounts.set(path, (this.heldCounts.get(path) ?? 0) + 1);
      releases.push(() => {
        const next = Math.max(0, (this.heldCounts.get(path) ?? 1) - 1);
        this.heldCounts.set(path, next);
        release();
      });
    }
    let released = false;
    return {
      paths: Object.freeze(sorted),
      release: () => {
        if (released) return;
        released = true;
        for (const releasePath of releases.reverse()) releasePath();
      },
    };
  }

  isHeld(path: string): boolean {
    return (this.heldCounts.get(path) ?? 0) > 0;
  }
}
