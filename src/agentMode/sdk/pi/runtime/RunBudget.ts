// One root run owns an explicit budget: every real provider dispatch reserves one model
// attempt (including title, compaction, subagent and fan-out requests) with a stable
// attemptId before the network stream may exist; concurrent reservations are serialized,
// unknown cost stays unknown, and a failed durable reserve admits nothing:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type ModelRequestPurpose = "root" | "title" | "compaction" | "subagent" | "fanout";

export interface RunBudgetLimits {
  readonly maxModelAttempts: number;
  readonly maxActiveSubagents: number;
  readonly maxBudgetUsd: number | null;
}

export interface RunBudgetSnapshot {
  readonly modelAttempts: number;
  readonly activeSubagents: number;
  readonly spentUsd: number;
  readonly unknownCost: boolean;
  readonly limits: RunBudgetLimits;
}

export interface BudgetReserveRecord {
  readonly attemptId: string;
  readonly runId: string;
  readonly purpose: ModelRequestPurpose;
  readonly reservedAtMs: number;
}

export type BudgetDeniedCode = "BUDGET_EXCEEDED" | "SUBAGENT_LIMIT";

export type ReserveResult =
  | { readonly kind: "reserved"; readonly attemptId: string; readonly purpose: ModelRequestPurpose }
  | { readonly kind: "already_reserved"; readonly attemptId: string }
  | { readonly kind: "denied"; readonly code: BudgetDeniedCode; readonly message: string };

export interface ReserveCommitResult {
  readonly accepted: boolean;
  readonly code?: BudgetDeniedCode;
  readonly message?: string;
}

export interface RunBudgetOptions {
  readonly initialReservations?: readonly BudgetReserveRecord[];
  readonly initialUsage?: Readonly<Record<string, { readonly usd: number | null }>>;
  readonly limits?: Partial<RunBudgetLimits>;
  readonly persistReserve?: (record: BudgetReserveRecord) => Promise<ReserveCommitResult>;
  readonly persistRefund?: (attemptId: string) => Promise<void>;
  readonly now?: () => number;
}

export const DEFAULT_MODEL_ATTEMPTS = 32;

const DEFAULT_LIMITS: RunBudgetLimits = Object.freeze({
  maxModelAttempts: DEFAULT_MODEL_ATTEMPTS,
  maxActiveSubagents: 3,
  maxBudgetUsd: null,
});

export function createAttemptId(input: {
  readonly runId: string;
  readonly purpose: ModelRequestPurpose;
  readonly sequence: number;
}): string {
  if (input.runId.length === 0) throw new Error("A run id is required to create an attempt id.");
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error("An attempt sequence must be a positive integer.");
  }
  return `attempt-${encodeURIComponent(input.runId)}-${input.purpose}-${input.sequence}`;
}

interface Reservation {
  readonly record: BudgetReserveRecord;
  state: "reserved" | "settled";
}

export class RunBudget {
  private readonly limits: RunBudgetLimits;
  private readonly persistReserve:
    | ((record: BudgetReserveRecord) => Promise<ReserveCommitResult>)
    | undefined;
  private readonly now: () => number;
  private readonly persistRefund: RunBudgetOptions["persistRefund"];
  private readonly reservations = new Map<string, Reservation>();
  /** Nested children report their own usage and the parent may aggregate it; a usageId is counted once.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  private readonly usageCosts = new Map<string, number | null>();
  private readonly unpricedAttempts = new Set<string>();
  private attempts = 0;
  private activeSubagents = 0;
  private spentUsd = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: RunBudgetOptions = {}) {
    this.limits = {
      maxModelAttempts: options.limits?.maxModelAttempts ?? DEFAULT_LIMITS.maxModelAttempts,
      maxActiveSubagents: options.limits?.maxActiveSubagents ?? DEFAULT_LIMITS.maxActiveSubagents,
      maxBudgetUsd:
        options.limits?.maxBudgetUsd === undefined
          ? DEFAULT_LIMITS.maxBudgetUsd
          : options.limits.maxBudgetUsd,
    };
    this.persistReserve = options.persistReserve;
    this.persistRefund = options.persistRefund;
    this.now = options.now ?? Date.now;
    for (const record of options.initialReservations ?? []) {
      if (this.reservations.has(record.attemptId)) continue;
      this.reservations.set(record.attemptId, { record, state: "settled" });
      this.attempts += 1;
    }
    for (const [usageId, usage] of Object.entries(options.initialUsage ?? {})) {
      this.usageCosts.set(usageId, usage.usd);
      if (usage.usd !== null) this.spentUsd += usage.usd;
    }
    for (const attemptId of this.reservations.keys()) {
      if (!this.usageCosts.has(attemptId)) this.unpricedAttempts.add(attemptId);
    }
  }

  get snapshot(): RunBudgetSnapshot {
    return {
      modelAttempts: this.attempts,
      activeSubagents: this.activeSubagents,
      spentUsd: this.spentUsd,
      unknownCost:
        this.unpricedAttempts.size > 0 || [...this.usageCosts.values()].some((usd) => usd === null),
      limits: this.limits,
    };
  }

  reserve(input: {
    readonly attemptId: string;
    readonly runId: string;
    readonly purpose: ModelRequestPurpose;
  }): Promise<ReserveResult> {
    return this.serialize(async () => {
      if (this.reservations.has(input.attemptId)) {
        return { kind: "already_reserved", attemptId: input.attemptId };
      }
      if (!this.canAdmit()) {
        return { kind: "denied", code: "BUDGET_EXCEEDED", message: "The run budget is exhausted." };
      }
      if (input.purpose === "subagent" && this.activeSubagents >= this.limits.maxActiveSubagents) {
        return {
          kind: "denied",
          code: "SUBAGENT_LIMIT",
          message: "The active subagent limit is reached.",
        };
      }

      const record: BudgetReserveRecord = {
        attemptId: input.attemptId,
        runId: input.runId,
        purpose: input.purpose,
        reservedAtMs: this.now(),
      };
      if (this.persistReserve) {
        let commit: ReserveCommitResult;
        try {
          commit = await this.persistReserve(record);
        } catch {
          return {
            kind: "denied",
            code: "BUDGET_EXCEEDED",
            message: "The durable budget reserve did not commit.",
          };
        }
        if (!commit.accepted) {
          return {
            kind: "denied",
            code: commit.code ?? "BUDGET_EXCEEDED",
            message: commit.message ?? "The durable budget reserve did not commit.",
          };
        }
      }

      this.attempts += 1;
      if (input.purpose === "subagent") this.activeSubagents += 1;
      this.reservations.set(input.attemptId, { record, state: "reserved" });
      return { kind: "reserved", attemptId: input.attemptId, purpose: input.purpose };
    });
  }

  refund(attemptId: string): Promise<void> {
    return this.serialize(async () => {
      const reservation = this.reservations.get(attemptId);
      if (!reservation || reservation.state !== "reserved") return;
      await this.persistRefund?.(attemptId);
      this.reservations.delete(attemptId);
      this.unpricedAttempts.delete(attemptId);
      this.attempts = Math.max(0, this.attempts - 1);
      if (reservation.record.purpose === "subagent") {
        this.activeSubagents = Math.max(0, this.activeSubagents - 1);
      }
    });
  }

  settle(attemptId: string, outcome: { readonly kind: "completed" | "failed" }): Promise<void> {
    return this.serialize(async () => {
      const reservation = this.reservations.get(attemptId);
      if (!reservation) return;
      if (reservation.state === "settled") return;
      reservation.state = "settled";
      if (reservation.record.purpose === "subagent") {
        this.activeSubagents = Math.max(0, this.activeSubagents - 1);
      }
      void outcome;
    });
  }

  recordUsage(
    attemptId: string,
    usage: { readonly usd: number | null; readonly usageId?: string }
  ): Promise<void> {
    return this.serialize(async () => {
      const usageId = usage.usageId ?? attemptId;
      if (
        this.usageCosts.has(usageId) &&
        (this.usageCosts.get(usageId) !== null || usage.usd === null)
      )
        return;
      this.usageCosts.set(usageId, usage.usd);
      this.unpricedAttempts.delete(attemptId);
      if (usage.usd !== null) {
        this.spentUsd += usage.usd;
      }
    });
  }

  private canAdmit(): boolean {
    if (this.attempts >= this.limits.maxModelAttempts) return false;
    if (this.limits.maxBudgetUsd !== null && this.spentUsd >= this.limits.maxBudgetUsd) {
      return false;
    }
    return true;
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.catch(() => undefined).then(task);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
