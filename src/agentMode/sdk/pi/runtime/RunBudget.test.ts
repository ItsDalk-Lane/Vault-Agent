import { RunBudget, createAttemptId } from "@/agentMode/sdk/pi/runtime/RunBudget";

// Every real provider dispatch reserves one attempt on the root budget; a nested child reports its
// usage with a usageId so aggregating it in the parent does not double count it, while a failed
// durable reserve admits nothing:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
describe("RunBudget", () => {
  describe("RunBudget", () => {
    describe("constructor()", () => {
      it("restores known spend once and retains unknown cost for an unpriced saved attempt https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const budget = new RunBudget({
          initialReservations: [
            { attemptId: "known", runId: "work", purpose: "root", reservedAtMs: 1 },
            { attemptId: "unpriced", runId: "work", purpose: "subagent", reservedAtMs: 2 },
          ],
          initialUsage: { known: { usd: 0.5 }, unrelated: { usd: 0.25 } },
        });
        expect(budget.snapshot).toMatchObject({
          modelAttempts: 2,
          spentUsd: 0.75,
          unknownCost: true,
          activeSubagents: 0,
        });
        await budget.recordUsage("known", { usd: 0.5, usageId: "known" });
        expect(budget.snapshot.spentUsd).toBe(0.75);
        await budget.recordUsage("unpriced", { usd: 0.1, usageId: "unpriced" });
        expect(budget.snapshot.unknownCost).toBe(false);
        expect(budget.snapshot.spentUsd).toBeCloseTo(0.85);
      });

      it("preserves missing historical pricing as unknown and enforces restored monetary limits https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const historical = new RunBudget({
          initialReservations: [
            { attemptId: "old", runId: "work", purpose: "root", reservedAtMs: 1 },
          ],
        });
        expect(historical.snapshot.unknownCost).toBe(true);
        const capped = new RunBudget({
          initialUsage: { old: { usd: 1 } },
          limits: { maxBudgetUsd: 1 },
        });
        await expect(
          capped.reserve({ attemptId: "new", runId: "work", purpose: "root" })
        ).resolves.toMatchObject({ kind: "denied", code: "BUDGET_EXCEEDED" });
      });
    });
    describe("reserve()", () => {
      it("restores committed attempts after reopening and never grants a fan-out run a fresh allowance https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const budget = new RunBudget(
          Object.assign(
            { limits: { maxModelAttempts: 2 } },
            {
              initialReservations: [1, 2].map((number) => ({
                attemptId: `saved-${number}`,
                runId: "fanout",
                purpose: "fanout" as const,
                reservedAtMs: number,
              })),
            }
          )
        );
        expect(budget.snapshot.modelAttempts).toBe(2);
        await expect(
          budget.reserve({ attemptId: "saved-1", runId: "fanout", purpose: "fanout" })
        ).resolves.toMatchObject({ kind: "already_reserved" });
        await expect(
          budget.reserve({ attemptId: "new", runId: "fanout", purpose: "fanout" })
        ).resolves.toMatchObject({ kind: "denied", code: "BUDGET_EXCEEDED" });
      });
    });
    describe("recordUsage()", () => {
      it("counts repeated delivery for the same attempt once when no separate usage id is supplied https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const budget = new RunBudget();
        await budget.recordUsage("one", { usd: 0.2 });
        await budget.recordUsage("one", { usd: 0.2 });
        expect(budget.snapshot.spentUsd).toBe(0.2);
      });
      it("counts a nested usageId once even when the child and the parent both report it", async () => {
        const budget = new RunBudget({ limits: { maxModelAttempts: 8 } });
        const attemptId = createAttemptId({ runId: "run-1", purpose: "subagent", sequence: 1 });
        await budget.reserve({ attemptId, runId: "run-1", purpose: "subagent" });

        await budget.recordUsage(attemptId, { usd: 0.25, usageId: "usage-child-1" });
        await budget.recordUsage(attemptId, { usd: 0.25, usageId: "usage-child-1" });
        await budget.recordUsage(attemptId, { usd: 0.1, usageId: "usage-child-2" });

        expect(budget.snapshot.spentUsd).toBeCloseTo(0.35);
        expect(budget.snapshot.unknownCost).toBe(false);
      });

      it("keeps unknown cost visible and admits nothing when the durable reserve fails", async () => {
        const budget = new RunBudget({
          limits: { maxModelAttempts: 2 },
          persistReserve: async () => ({ accepted: false, message: "no durable row" }),
        });
        const attemptId = createAttemptId({ runId: "run-1", purpose: "root", sequence: 1 });

        const denied = await budget.reserve({ attemptId, runId: "run-1", purpose: "root" });
        expect(denied).toMatchObject({ kind: "denied", code: "BUDGET_EXCEEDED" });
        expect(budget.snapshot.modelAttempts).toBe(0);

        const accepting = new RunBudget({ limits: { maxModelAttempts: 2 } });
        const second = createAttemptId({ runId: "run-1", purpose: "subagent", sequence: 1 });
        await accepting.reserve({ attemptId: second, runId: "run-1", purpose: "subagent" });
        await accepting.recordUsage(second, { usd: null });
        expect(accepting.snapshot).toMatchObject({ activeSubagents: 1, unknownCost: true });
      });
    });
    describe("refund()", () => {
      it("commits a cancellation refund before making its allowance reusable and retains it on storage failure https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let rejectRefund = true;
        const persistRefund = jest.fn(async () => {
          if (rejectRefund) throw new Error("disk failure");
        });
        const budget = new RunBudget({ limits: { maxModelAttempts: 1 }, persistRefund });
        await budget.reserve({
          attemptId: "cancelled-before-network",
          runId: "work",
          purpose: "root",
        });
        await expect(budget.refund("cancelled-before-network")).rejects.toThrow("disk failure");
        expect(budget.snapshot.modelAttempts).toBe(1);
        rejectRefund = false;
        await budget.refund("cancelled-before-network");
        expect(persistRefund).toHaveBeenCalledWith("cancelled-before-network");
        expect(budget.snapshot.modelAttempts).toBe(0);
      });
    });
  });
});
