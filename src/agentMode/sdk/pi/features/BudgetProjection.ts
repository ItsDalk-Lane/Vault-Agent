import type { BudgetUpdate, SessionUsage, UsageSource } from "@/agentMode/session/types";
import type { PlanUsage, UsageWindow } from "@/agentMode/session/planUsage";

// Usage has two different facts: the current context window (usedTokens/contextWindow) and the
// cumulative provider token counts. Provider subscription windows are rendered only when the
// provider actually reports them (BYOK has none, so no fake Claude/plan quota appears); local budget
// windows are labeled as local; an unknown price/cost quota stays "unknown" rather than 0%; and a
// snapshot replaces the previous one instead of being added again:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface LocalBudgetLimits {
  readonly requestLimit?: number | null;
  readonly toolLimit?: number | null;
  readonly activeMsLimit?: number | null;
  readonly costLimitUsd?: number | null;
}

export interface BudgetCounters {
  readonly requests: number;
  readonly tools: number;
  readonly activeMs: number;
}

export interface ContextUsageView {
  readonly usedTokens: number | null;
  readonly contextWindow?: number;
  readonly percent: number | null;
  readonly hasContextWindow: boolean;
}

export interface CumulativeUsageView {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly totalKnownTokens: number | null;
}

export interface BudgetWindowProjection extends UsageWindow {
  readonly source: "provider" | "local_budget";
  readonly known: boolean;
}

export type QuotaState = "known" | "unknown" | "none";

export interface BudgetProjectionResult {
  readonly source: UsageSource;
  readonly context: ContextUsageView;
  readonly cumulative: CumulativeUsageView;
  readonly windows: readonly BudgetWindowProjection[];
  readonly planUsage: PlanUsage | null;
  readonly localBudget: {
    readonly label: string;
    readonly windows: readonly BudgetWindowProjection[];
  } | null;
  readonly quota: QuotaState;
  readonly hasBudget: boolean;
}

export interface BudgetProjectionInput {
  readonly usage?: SessionUsage | null;
  readonly budget?: BudgetUpdate | null;
  readonly localLimits?: LocalBudgetLimits | null;
  readonly counters?: BudgetCounters | null;
  readonly planUsage?: PlanUsage | null;
  readonly costSpentUsd?: number | null;
  readonly costRatesKnown?: boolean;
}

export class BudgetProjectionTracker {
  readonly #now: () => number;
  #usage: SessionUsage | null = null;
  #budget: BudgetUpdate | null = null;
  #planUsage: PlanUsage | null = null;
  #localLimits: LocalBudgetLimits | null = null;
  #counters: BudgetCounters | null = null;
  #costSpentUsd: number | null = null;
  #costRatesKnown = false;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  applyUsage(usage: SessionUsage): BudgetProjectionResult {
    this.#usage = usage;
    return this.project();
  }

  applyBudget(update: BudgetUpdate): BudgetProjectionResult {
    this.#budget = update;
    return this.project();
  }

  applyPlanUsage(planUsage: PlanUsage | null): BudgetProjectionResult {
    this.#planUsage = planUsage;
    return this.project();
  }

  setLocalBudget(limits: LocalBudgetLimits | null, counters: BudgetCounters | null): void {
    this.#localLimits = limits;
    this.#counters = counters;
  }

  setCostSpent(costSpentUsd: number | null, costRatesKnown = false): void {
    this.#costSpentUsd = costSpentUsd;
    this.#costRatesKnown = costRatesKnown;
  }

  project(): BudgetProjectionResult {
    return projectBudget({
      usage: this.#usage,
      budget: this.#budget,
      planUsage: this.#planUsage,
      localLimits: this.#localLimits,
      counters: this.#counters,
      costSpentUsd: this.#costSpentUsd,
      costRatesKnown: this.#costRatesKnown,
    });
  }

  get now(): number {
    return this.#now();
  }
}

export function projectBudget(input: BudgetProjectionInput = {}): BudgetProjectionResult {
  const context = contextUsage(input.usage ?? null);
  const cumulative = cumulativeUsage(input.usage ?? null);
  const providerWindows: BudgetWindowProjection[] = (input.planUsage?.windows ?? []).map(
    (window) => ({
      ...window,
      source: "provider",
      known: Number.isFinite(window.percent),
    })
  );
  const localWindows = localBudgetWindows(input.localLimits ?? null, input.counters ?? null);
  const quota = quotaState(input);
  const costLimit = input.localLimits?.costLimitUsd;
  if (
    quota === "known" &&
    typeof costLimit === "number" &&
    typeof input.costSpentUsd === "number"
  ) {
    localWindows.push(
      Object.freeze({
        id: "local_cost",
        label: "Local budget · cost (estimate)",
        percent: Math.min(100, Math.round((input.costSpentUsd / costLimit) * 100)),
        source: "local_budget" as const,
        known: true,
      })
    );
  }
  const windows = Object.freeze([...providerWindows, ...localWindows]);
  const localBudget =
    localWindows.length > 0
      ? Object.freeze({ label: "Local budget", windows: Object.freeze(localWindows) })
      : null;
  return Object.freeze({
    source: sourceOf(input, windows.length > 0),
    context,
    cumulative,
    windows,
    planUsage: input.planUsage ?? null,
    localBudget,
    quota,
    hasBudget: windows.length > 0,
  });
}

function contextUsage(usage: SessionUsage | null): ContextUsageView {
  const contextWindow = usage?.contextWindow;
  const usedTokens = usage?.usedTokens ?? null;
  const hasContextWindow = typeof contextWindow === "number" && contextWindow > 0;
  const percent =
    hasContextWindow && usedTokens !== null
      ? Math.min(100, Math.round((usedTokens / contextWindow) * 100))
      : null;
  return {
    usedTokens,
    ...(hasContextWindow ? { contextWindow } : {}),
    percent,
    hasContextWindow,
  };
}

function cumulativeUsage(usage: SessionUsage | null): CumulativeUsageView {
  const inputTokens = finiteOrNull(usage?.inputTokens);
  const outputTokens = finiteOrNull(usage?.outputTokens);
  const cacheReadTokens = finiteOrNull(usage?.cacheReadTokens);
  const cacheWriteTokens = finiteOrNull(usage?.cacheWriteTokens);
  const totalKnownTokens =
    inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalKnownTokens };
}

function localBudgetWindows(
  limits: LocalBudgetLimits | null,
  counters: BudgetCounters | null
): BudgetWindowProjection[] {
  if (limits === null || counters === null) return [];
  const windows: BudgetWindowProjection[] = [];
  addWindow(
    windows,
    "local_requests",
    "Local budget · requests",
    limits.requestLimit,
    counters.requests
  );
  addWindow(windows, "local_tools", "Local budget · tools", limits.toolLimit, counters.tools);
  addWindow(
    windows,
    "local_active_ms",
    "Local budget · active time",
    limits.activeMsLimit,
    counters.activeMs
  );
  return windows;
}

function addWindow(
  windows: BudgetWindowProjection[],
  id: string,
  label: string,
  limit: number | null | undefined,
  used: number
): void {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return;
  windows.push(
    Object.freeze({
      id,
      label,
      percent: Math.min(100, Math.round((used / limit) * 100)),
      source: "local_budget" as const,
      known: true,
    })
  );
}

function quotaState(input: BudgetProjectionInput): QuotaState {
  const costLimit = input.localLimits?.costLimitUsd;
  if (typeof costLimit !== "number" || !Number.isFinite(costLimit) || costLimit <= 0) return "none";
  if (
    input.costRatesKnown !== true ||
    input.costSpentUsd === null ||
    input.costSpentUsd === undefined
  ) {
    return "unknown";
  }
  return "known";
}

function sourceOf(input: BudgetProjectionInput, hasWindows: boolean): UsageSource {
  if (input.budget?.source !== undefined && input.budget.source !== "unknown") {
    return input.budget.source;
  }
  if (input.localLimits !== null && input.localLimits !== undefined) return "local_budget";
  if (input.usage !== null && input.usage !== undefined) return "provider";
  if (hasWindows) return "provider";
  return "unavailable";
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
