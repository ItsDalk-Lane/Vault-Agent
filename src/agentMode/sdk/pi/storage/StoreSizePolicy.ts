// The product limit for a single root store is measured from the real Durable files:
// 16 MiB suggests a fresh session and 32 MiB stops admitting new runs while cancel,
// pending-approval completion, export and reading stay allowed. Internal entry compaction
// appends more JSONL, so it never makes the measured store smaller:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const STORE_SIZE_WARN_BYTES = 16 * 1024 * 1024;
export const STORE_SIZE_STOP_BYTES = 32 * 1024 * 1024;
export const STORE_SIZE_FINALIZE_RESERVE_BYTES = 1024 * 1024;
export const STORE_SIZE_PAUSE_BYTES = STORE_SIZE_STOP_BYTES - STORE_SIZE_FINALIZE_RESERVE_BYTES;

export type StoreSizeVerdict = "ok" | "suggest_new_session" | "stop_new_runs";

export interface StoreSizeStatus {
  readonly bytes: number;
  readonly verdict: StoreSizeVerdict;
  readonly warnAtBytes: number;
  readonly stopAtBytes: number;
}

export interface StoreSizePolicyOptions {
  measureBytes: (rootKey: string) => Promise<number>;
}

export function classifyStoreSize(bytes: number): StoreSizeVerdict {
  if (bytes >= STORE_SIZE_STOP_BYTES) return "stop_new_runs";
  if (bytes >= STORE_SIZE_WARN_BYTES) return "suggest_new_session";
  return "ok";
}

export function canAcceptNewRun(verdict: StoreSizeVerdict): boolean {
  return verdict !== "stop_new_runs";
}

export class StoreSizePolicy {
  private readonly measureBytes: (rootKey: string) => Promise<number>;

  constructor(options: StoreSizePolicyOptions) {
    this.measureBytes = options.measureBytes;
  }

  async status(rootKey: string): Promise<StoreSizeStatus> {
    const bytes = await this.measureBytes(rootKey);
    return {
      bytes,
      verdict: classifyStoreSize(bytes),
      warnAtBytes: STORE_SIZE_WARN_BYTES,
      stopAtBytes: STORE_SIZE_STOP_BYTES,
    };
  }
}
