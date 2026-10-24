import {
  BudgetProjectionTracker,
  projectBudget,
} from "@/agentMode/sdk/pi/features/BudgetProjection";
import type { SessionUsage } from "@/agentMode/session/types";

// A BYOK provider reports cumulative usage but no subscription windows, so no fake Claude/plan quota
// may appear. Repeated snapshots replace (never add) the totals; local budget windows are labeled as
// local; an unknown price quota stays unknown; and no budget means no fabricated 0% limit:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function usage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    usedTokens: 1_000,
    contextWindow: 200_000,
    inputTokens: 120,
    outputTokens: 30,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("BudgetProjection", () => {
  describe("projectBudget()", () => {
    it("shows no fake subscription quota for a BYOK provider with usage only", () => {
      const projection = projectBudget({ usage: usage() });

      expect(projection).toMatchObject({
        source: "provider",
        planUsage: null,
        localBudget: null,
        hasBudget: false,
        quota: "none",
      });
      expect(projection.windows).toEqual([]);
      const rendered = JSON.stringify(projection).toLowerCase();
      expect(rendered).not.toContain("claude");
      expect(rendered).not.toContain("subscription");
    });

    it("keeps the current context and cumulative usage as separate facts", () => {
      const projection = projectBudget({ usage: usage() });

      expect(projection.context).toEqual({
        usedTokens: 1_000,
        contextWindow: 200_000,
        percent: 1,
        hasContextWindow: true,
      });
      expect(projection.cumulative).toMatchObject({
        inputTokens: 120,
        outputTokens: 30,
        totalKnownTokens: 150,
      });
    });

    it("does not show a 0% budget when there is no budget or context window", () => {
      const projection = projectBudget({
        usage: { usedTokens: 500, inputTokens: 10, updatedAt: 1_000 },
      });

      expect(projection.context).toMatchObject({ percent: null, hasContextWindow: false });
      expect(projection.localBudget).toBeNull();
      expect(projection.windows).toEqual([]);
      expect(projection.hasBudget).toBe(false);
      expect(projection.quota).toBe("none");
    });

    it("labels local budget windows and keeps reported provider windows separate", () => {
      const projection = projectBudget({
        usage: usage(),
        localLimits: { requestLimit: 32, toolLimit: 64, activeMsLimit: 900_000 },
        counters: { requests: 8, tools: 16, activeMs: 180_000 },
        planUsage: {
          windows: [{ id: "provider-plan", label: "Provider plan", percent: 40 }],
          updatedAt: 1_000,
        },
      });

      expect(projection.source).toBe("local_budget");
      expect(projection.hasBudget).toBe(true);
      expect(projection.localBudget?.label).toBe("Local budget");
      expect(projection.localBudget?.windows.map((window) => window.label)).toEqual([
        "Local budget · requests",
        "Local budget · tools",
        "Local budget · active time",
      ]);
      expect(projection.localBudget?.windows.map((window) => window.percent)).toEqual([25, 25, 20]);
      expect(
        projection.localBudget?.windows.every((window) => window.source === "local_budget")
      ).toBe(true);
      expect(projection.windows.find((window) => window.source === "provider")).toMatchObject({
        id: "provider-plan",
        label: "Provider plan",
        percent: 40,
      });
      expect(projection.planUsage?.windows).toHaveLength(1);
    });

    it("marks an unknown price/cost quota as unknown instead of 0% and only shows cost when known", () => {
      const unknown = projectBudget({
        localLimits: { costLimitUsd: 5 },
        costSpentUsd: 2.5,
        costRatesKnown: false,
      });
      expect(unknown.quota).toBe("unknown");
      expect(unknown.windows.some((window) => window.id === "local_cost")).toBe(false);
      expect(unknown.hasBudget).toBe(false);

      const known = projectBudget({
        localLimits: { costLimitUsd: 5 },
        costSpentUsd: 2.5,
        costRatesKnown: true,
      });
      expect(known.quota).toBe("known");
      expect(known.windows.find((window) => window.id === "local_cost")).toMatchObject({
        label: "Local budget · cost (estimate)",
        percent: 50,
        source: "local_budget",
      });
    });

    it("uses the explicit budget source and drops stale provider windows", () => {
      const tracker = new BudgetProjectionTracker({ now: () => 1_000 });
      tracker.applyPlanUsage({
        windows: [{ id: "plan", label: "Provider plan", percent: 40 }],
        updatedAt: 1_000,
      });
      expect(tracker.project().windows).toHaveLength(1);

      tracker.applyPlanUsage(null);
      tracker.applyBudget({ source: "local_budget", usage: null, updatedAt: 2_000 });

      const projection = tracker.project();
      expect(projection.windows).toEqual([]);
      expect(projection.planUsage).toBeNull();
      expect(projection.source).toBe("local_budget");
    });
  });

  describe("BudgetProjectionTracker", () => {
    it("replaces usage snapshots instead of adding them again", () => {
      const tracker = new BudgetProjectionTracker();

      const first = tracker.applyUsage(usage());
      const sameSnapshot = tracker.applyUsage(usage());
      const updated = tracker.applyUsage(
        usage({ usedTokens: 2_000, inputTokens: 200, outputTokens: 50 })
      );

      expect(first.cumulative.inputTokens).toBe(120);
      expect(sameSnapshot.cumulative.inputTokens).toBe(120);
      expect(sameSnapshot.context.usedTokens).toBe(1_000);
      expect(updated.cumulative).toMatchObject({
        inputTokens: 200,
        outputTokens: 50,
        totalKnownTokens: 250,
      });
      expect(updated.context.usedTokens).toBe(2_000);
    });

    it("shows cost only after the tracker learns the rates are known", () => {
      const tracker = new BudgetProjectionTracker();
      tracker.setLocalBudget({ costLimitUsd: 5 }, { requests: 0, tools: 0, activeMs: 0 });
      tracker.setCostSpent(2.5, false);
      expect(tracker.project().quota).toBe("unknown");

      tracker.setCostSpent(2.5, true);
      expect(tracker.project().quota).toBe("known");
      expect(tracker.project().windows.some((window) => window.id === "local_cost")).toBe(true);
    });
  });
});
