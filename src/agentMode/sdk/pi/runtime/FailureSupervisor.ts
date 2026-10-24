// Storage failures and crash loops stop host work immediately: nothing is reported as
// saved, no in-memory store replaces the failed one, and three abnormal opens in a row
// switch recovery to read-only until the user explicitly stops or retries:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface StorageFailure {
  readonly code: "STORAGE_FAILED";
  readonly message: string;
}

export type FailureSupervisorMode = "normal" | "read_only";

export interface FailureSupervisorState {
  readonly mode: FailureSupervisorMode;
  readonly consecutiveAbnormalOpens: number;
  readonly maxAbnormalOpens: number;
  readonly readOnly: boolean;
  readonly hostIoBlocked: boolean;
  readonly storageFailure: StorageFailure | null;
}

export type StartWorkBlockedReason = "crash_loop_read_only" | "storage_failed";

export type FailureSupervisorErrorCode = "START_WORK_BLOCKED";

export class FailureSupervisorError extends Error {
  readonly code: FailureSupervisorErrorCode;
  readonly reason: StartWorkBlockedReason;

  constructor(code: FailureSupervisorErrorCode, reason: StartWorkBlockedReason) {
    super(`Cannot start work: ${reason}.`);
    this.name = "FailureSupervisorError";
    this.code = code;
    this.reason = reason;
  }
}

export interface FailureSupervisorOptions {
  maxAbnormalOpens?: number;
  initialAbnormalOpens?: number;
  persist?: (state: FailureSupervisorState) => void | Promise<void>;
}

const DEFAULT_MAX_ABNORMAL_OPENS = 3;

export class FailureSupervisor {
  private readonly maxAbnormalOpens: number;
  private readonly persistState:
    | ((state: FailureSupervisorState) => void | Promise<void>)
    | undefined;
  private state: FailureSupervisorState;

  constructor(options: FailureSupervisorOptions = {}) {
    this.maxAbnormalOpens = options.maxAbnormalOpens ?? DEFAULT_MAX_ABNORMAL_OPENS;
    this.persistState = options.persist;
    const initialAbnormalOpens = Math.max(0, options.initialAbnormalOpens ?? 0);
    const readOnly = initialAbnormalOpens >= this.maxAbnormalOpens;
    this.state = {
      mode: readOnly ? "read_only" : "normal",
      consecutiveAbnormalOpens: initialAbnormalOpens,
      maxAbnormalOpens: this.maxAbnormalOpens,
      readOnly,
      hostIoBlocked: false,
      storageFailure: null,
    };
  }

  getState(): FailureSupervisorState {
    return { ...this.state };
  }

  isReadOnly(): boolean {
    return this.state.readOnly;
  }

  canStartWork(): boolean {
    return !this.state.readOnly && !this.state.hostIoBlocked;
  }

  assertCanStartWork(): void {
    if (this.state.readOnly) {
      throw new FailureSupervisorError("START_WORK_BLOCKED", "crash_loop_read_only");
    }
    if (this.state.hostIoBlocked) {
      throw new FailureSupervisorError("START_WORK_BLOCKED", "storage_failed");
    }
  }

  async recordAbnormalOpen(): Promise<{
    consecutiveAbnormalOpens: number;
    readOnly: boolean;
  }> {
    const consecutiveAbnormalOpens = this.state.consecutiveAbnormalOpens + 1;
    const readOnly = this.state.readOnly || consecutiveAbnormalOpens >= this.state.maxAbnormalOpens;
    this.state = {
      ...this.state,
      consecutiveAbnormalOpens,
      readOnly,
      mode: readOnly ? "read_only" : "normal",
    };
    await this.persist();
    return { consecutiveAbnormalOpens, readOnly };
  }

  async recordSafeBoundary(): Promise<void> {
    this.state = {
      ...this.state,
      consecutiveAbnormalOpens: 0,
      readOnly: false,
      mode: "normal",
    };
    await this.persist();
  }

  async recordStorageFailure(failure: StorageFailure): Promise<StorageFailure> {
    this.state = {
      ...this.state,
      hostIoBlocked: true,
      storageFailure: failure,
    };
    await this.persist();
    return failure;
  }

  async recordStorageRecovered(): Promise<void> {
    this.state = {
      ...this.state,
      hostIoBlocked: false,
      storageFailure: null,
    };
    await this.persist();
  }

  async resumeAfterExplicitUserRetry(): Promise<void> {
    this.state = {
      ...this.state,
      consecutiveAbnormalOpens: 0,
      readOnly: false,
      mode: "normal",
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (this.persistState) await this.persistState(this.getState());
  }
}
