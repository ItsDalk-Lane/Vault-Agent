import { ReportDelivery } from "@/agentMode/sdk/pi/features/subagents/ReportDelivery";
import type { ReportDeliveryRecord } from "@/agentMode/sdk/pi/features/subagents/ReportDelivery";
import { MutationRecovery } from "@/agentMode/sdk/pi/storage/MutationRecovery";
import type { RecoveryEntry, RecoveredReceipt } from "@/agentMode/sdk/pi/storage/MutationRecovery";
import { RecoveryCoordinator } from "@/agentMode/sdk/pi/storage/RecoveryCoordinator";
import type {
  RecoveryInspection,
  RecoveryPolicySnapshot,
} from "@/agentMode/sdk/pi/storage/RecoveryCoordinator";
import { FailureSupervisor } from "@/agentMode/sdk/pi/runtime/FailureSupervisor";
import { PathLockPool } from "@/agentMode/sdk/pi/tools/PathLockPool";
import { MutationCoordinator } from "@/agentMode/sdk/pi/tools/MutationCoordinator";
import type {
  MutationBlobStore,
  MutationLedger,
} from "@/agentMode/sdk/pi/tools/MutationCoordinator";
import { sha256 } from "@/utils/hash";

// 回归只覆盖实际运行仍调用的变更核对、恢复和后台报告；摘要取消由生产 SDK 场景验证。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const BEFORE = "before content\n";
const AFTER = "after content\n";
const BEFORE_HASH = sha256(BEFORE);
const AFTER_HASH = sha256(AFTER);

interface VaultState {
  content: string | null;
  writes: number;
  receipts: RecoveredReceipt[];
  entries: RecoveryEntry[];
}

function makeCrashState(): VaultState {
  return { content: BEFORE, writes: 0, receipts: [], entries: [] };
}

function makeMutationCoordinator(state: VaultState, options: { failReceipt?: boolean } = {}) {
  const blobs: MutationBlobStore = {
    put: async (content) => sha256(content),
    flush: async () => undefined,
  };
  const ledger: MutationLedger = {
    saveIntent: async (intent) => {
      state.entries.push({
        operationId: intent.operationId,
        path: intent.targetPath,
        kind: "write",
        replay: "safe",
        beforeHash: BEFORE_HASH,
        afterHash: AFTER_HASH,
      });
    },
    saveReceipt: async (receipt) => {
      if (options.failReceipt) throw new Error("receipt store unavailable");
      state.receipts.push({
        operationId: receipt.operationId,
        path: receipt.targetPath,
        status: "committed",
        afterHash: AFTER_HASH,
        recoveredAtMs: 1,
      });
    },
  };
  return new MutationCoordinator({
    locks: new PathLockPool(),
    blobs,
    ledger,
    now: () => 1_700_000_000_000,
  });
}

const writer = (state: VaultState) => ({
  write: async (input: { readonly targetPath: string; readonly content: string }) => {
    state.writes += 1;
    state.content = input.content;
    return { afterHash: sha256(input.content) };
  },
});

function makeRecovery(state: VaultState) {
  return new MutationRecovery({
    ledger: {
      listEntries: async () => state.entries,
      findReceipt: async (operationId) =>
        state.receipts.find((receipt) => receipt.operationId === operationId),
      saveReceipt: async (receipt) => {
        state.receipts.push(receipt);
      },
    },
    vault: {
      fileExists: async () => state.content !== null,
      read: async () => state.content,
    },
    now: () => 1_700_000_000_500,
  });
}

async function approvedMutation(
  coordinator: MutationCoordinator,
  operationId: string
): Promise<void> {
  await coordinator.prepare({
    operationId,
    targetPath: "Notes/Agent.md",
    before: BEFORE,
    after: AFTER,
  });
  await coordinator.beginApproval(operationId);
  await coordinator.approve(operationId, "approval-1");
}

describe("crashRecovery", () => {
  describe("crashRecovery", () => {
    describe("MutationCoordinator", () => {
      it("reports effect_unknown when the write succeeded but the receipt could not be saved", async () => {
        const state = makeCrashState();
        const coordinator = makeMutationCoordinator(state, { failReceipt: true });
        await approvedMutation(coordinator, "op-unknown");

        const applied = await coordinator.apply("op-unknown", writer(state));

        expect(applied).toEqual({
          ok: false,
          code: "EFFECT_UNKNOWN",
          message:
            "The write succeeded but the receipt could not be saved; treat the effect as unknown.",
          wrote: true,
        });
        expect(coordinator.getState("op-unknown")).toBe("effect_unknown");
        expect(state.content).toBe(AFTER);
        expect(state.writes).toBe(1);
        expect(state.receipts).toHaveLength(0);
      });

      it("keeps a failed write failed without touching the file", async () => {
        const state = makeCrashState();
        const coordinator = makeMutationCoordinator(state);
        await approvedMutation(coordinator, "op-failed");

        const applied = await coordinator.apply("op-failed", {
          write: async () => {
            throw new Error("disk full");
          },
        });

        expect(applied).toMatchObject({ ok: false, code: "WRITE_FAILED" });
        expect(coordinator.getState("op-failed")).toBe("failed");
        expect(state.content).toBe(BEFORE);
        expect(state.writes).toBe(0);
        expect(state.receipts).toHaveLength(0);
      });

      it("commits the write and receipt exactly once on the normal path", async () => {
        const state = makeCrashState();
        const coordinator = makeMutationCoordinator(state);
        await approvedMutation(coordinator, "op-committed");

        const applied = await coordinator.apply("op-committed", writer(state));

        expect(applied.ok).toBe(true);
        expect(coordinator.getState("op-committed")).toBe("committed");
        expect(state.content).toBe(AFTER);
        expect(state.writes).toBe(1);
        expect(state.receipts).toHaveLength(1);
      });
    });

    describe("MutationRecovery", () => {
      it("completes a missing receipt once without repeating the vault write", async () => {
        const state = makeCrashState();
        const coordinator = makeMutationCoordinator(state, { failReceipt: true });
        await approvedMutation(coordinator, "op-crash");
        await coordinator.apply("op-crash", writer(state));
        expect(state.writes).toBe(1);
        expect(state.receipts).toHaveLength(0);

        const recovery = makeRecovery(state);
        const first = await recovery.reconcile();
        const second = await recovery.reconcile();

        expect(first.decisions).toEqual([
          {
            operationId: "op-crash",
            path: "Notes/Agent.md",
            state: "committed",
            action: "complete_receipt",
            canReapprove: false,
            canContinue: true,
            receiptWritten: true,
          },
        ]);
        expect(second.decisions[0]).toMatchObject({
          state: "committed",
          action: "none",
          receiptWritten: false,
        });
        expect(state.receipts).toHaveLength(1);
        expect(state.writes).toBe(1);
        expect(state.content).toBe(AFTER);
      });

      it("offers a safe reapproval when the write never happened", async () => {
        const state = makeCrashState();
        state.entries.push({
          operationId: "op-prepared",
          path: "Notes/Agent.md",
          kind: "write",
          replay: "safe",
          beforeHash: BEFORE_HASH,
          afterHash: AFTER_HASH,
        });

        const decisions = (await makeRecovery(state).reconcile()).decisions;

        expect(decisions).toEqual([
          {
            operationId: "op-prepared",
            path: "Notes/Agent.md",
            state: "prepared",
            action: "reapprove",
            canReapprove: true,
            canContinue: true,
            receiptWritten: false,
          },
        ]);
        expect(state.receipts).toHaveLength(0);
        expect(state.writes).toBe(0);
        expect(state.content).toBe(BEFORE);
      });

      it("never replays an unsafe operation whose effect is unknown", async () => {
        const state = makeCrashState();
        state.entries.push({
          operationId: "op-unsafe",
          path: "Notes/Agent.md",
          kind: "write",
          replay: "unsafe",
          beforeHash: BEFORE_HASH,
          afterHash: AFTER_HASH,
        });

        const decisions = (await makeRecovery(state).reconcile()).decisions;

        expect(decisions[0]).toMatchObject({
          state: "unsafe_blocked",
          action: "manual",
          canReapprove: false,
          canContinue: false,
          receiptWritten: false,
        });
        expect(state.receipts).toHaveLength(0);
        expect(state.writes).toBe(0);
        expect(state.content).toBe(BEFORE);
      });

      it("marks a receipt/effect mismatch as needs_reconciliation and stays read-only", async () => {
        const state = makeCrashState();
        state.content = "edited by the user\n";
        state.receipts.push({
          operationId: "op-mismatch",
          path: "Notes/Agent.md",
          status: "committed",
          afterHash: AFTER_HASH,
          recoveredAtMs: 1,
        });
        state.entries.push({
          operationId: "op-mismatch",
          path: "Notes/Agent.md",
          kind: "write",
          replay: "safe",
          beforeHash: BEFORE_HASH,
          afterHash: AFTER_HASH,
        });

        const decisions = (await makeRecovery(state).reconcile()).decisions;

        expect(decisions[0]).toMatchObject({
          state: "needs_reconciliation",
          action: "manual",
          canContinue: false,
          receiptWritten: false,
        });
        expect(state.writes).toBe(0);
        expect(state.content).toBe("edited by the user\n");
      });
    });

    describe("RecoveryCoordinator", () => {
      function makeInspection(overrides: Partial<RecoveryInspection> = {}): RecoveryInspection {
        return {
          run: { runId: "run-1", status: "in_progress", startedAtMs: 1 },
          pendingApprovals: [],
          pendingQuestions: 0,
          unknownEffectMutations: [{ operationId: "mcp-op-1", status: "effect_unknown" }],
          ...overrides,
        };
      }

      function makePolicy(overrides: Partial<RecoveryPolicySnapshot> = {}): RecoveryPolicySnapshot {
        return {
          scopeId: "global",
          policyVersion: 1,
          fileHashes: { "Notes/Agent.md": BEFORE_HASH },
          bindingHashes: { "approval-1": sha256("binding-1") },
          ...overrides,
        };
      }

      function makeCoordinator(input: {
        inspection: RecoveryInspection;
        policy?: RecoveryPolicySnapshot;
        reconciled?: { value: boolean };
        supervisor?: FailureSupervisor;
      }) {
        const calls = { resume: 0, abort: 0, reconcile: 0 };
        const reconciledState = input.reconciled ?? { value: true };
        const coordinator = new RecoveryCoordinator({
          inspect: async () => input.inspection,
          supervisor: input.supervisor ?? new FailureSupervisor(),
          reloadCredentialsAndPolicy: async () => input.policy ?? makePolicy(),
          reconcileUnknownEffects: async () => {
            calls.reconcile += 1;
            return { reconciled: reconciledState.value };
          },
          resume: async () => {
            calls.resume += 1;
          },
          abort: async () => {
            calls.abort += 1;
          },
        });
        return { coordinator, calls, reconciledState };
      }

      it("blocks continue until an unknown effect is explicitly reconciled", async () => {
        const { coordinator, calls, reconciledState } = makeCoordinator({
          inspection: makeInspection(),
          reconciled: { value: false },
        });
        const opened = await coordinator.inspectAfterOpen();
        expect(opened.kind).toBe("needs_recovery");

        const blocked = await coordinator.continueAfterUserChoice();
        expect(blocked).toEqual({ kind: "blocked", reasons: ["needs_reconciliation"] });
        expect(calls.resume).toBe(0);

        reconciledState.value = true;
        const resumed = await coordinator.continueAfterUserChoice();

        expect(resumed).toEqual({ kind: "resumed", validApprovals: 0 });
        expect(calls.resume).toBe(1);
        expect(calls.reconcile).toBe(2);
        expect(calls.abort).toBe(0);
      });

      it("revokes an approval whose file baseline changed after the crash", async () => {
        const { coordinator, calls } = makeCoordinator({
          inspection: makeInspection({
            pendingApprovals: [
              {
                requestId: "approval-1",
                bindingHash: sha256("binding-1"),
                scopeId: "global",
                policyVersion: 1,
                beforeHashes: { "Notes/Agent.md": BEFORE_HASH },
                state: "approved",
              },
            ],
          }),
          policy: makePolicy({ fileHashes: { "Notes/Agent.md": sha256("user edit\n") } }),
        });
        await coordinator.inspectAfterOpen();

        const result = await coordinator.continueAfterUserChoice();

        expect(result).toEqual({
          kind: "blocked",
          reasons: ["invalid_approvals"],
          revokedApprovals: ["approval-1"],
          validApprovals: 0,
        });
        expect(calls.resume).toBe(0);
      });

      it("keeps a matching approval and resumes only after the user continue", async () => {
        const { coordinator, calls } = makeCoordinator({
          inspection: makeInspection({
            unknownEffectMutations: [],
            pendingApprovals: [
              {
                requestId: "approval-1",
                bindingHash: sha256("binding-1"),
                scopeId: "global",
                policyVersion: 1,
                beforeHashes: { "Notes/Agent.md": BEFORE_HASH },
                state: "approved",
              },
            ],
          }),
          policy: makePolicy(),
        });
        await coordinator.inspectAfterOpen();

        const result = await coordinator.continueAfterUserChoice();

        expect(result).toEqual({ kind: "resumed", validApprovals: 1 });
        expect(calls.resume).toBe(1);
      });

      it("opens read-only after an abnormal-open crash loop without starting work", async () => {
        const { coordinator, calls } = makeCoordinator({
          inspection: makeInspection(),
          supervisor: new FailureSupervisor({ initialAbnormalOpens: 3 }),
        });
        const opened = await coordinator.inspectAfterOpen();
        const blocked = await coordinator.continueAfterUserChoice();

        expect(opened.kind).toBe("read_only");
        expect(blocked).toEqual({ kind: "blocked", reasons: ["crash_loop_read_only"] });
        expect(calls.resume).toBe(0);
        expect(calls.reconcile).toBe(0);
      });
    });

    describe("ReportDelivery", () => {
      function makeReportPorts() {
        const state = {
          entries: [] as { entryId: string; text: string }[],
          contextWrites: [] as { text: string; entryId: string }[],
          cards: [] as string[],
          checkpoints: [] as ReportDeliveryRecord[],
          hostOpen: true,
          cancelEpoch: 7,
          aborted: false,
          budget: true,
          contextAllowed: true,
        };
        const ports = {
          entries: {
            append: async (entry: { text: string }) => {
              const entryId = `entry-${state.entries.length + 1}`;
              state.entries.push({ entryId, text: entry.text });
              return { entryId };
            },
            findByAnswer: async () => undefined,
          },
          roots: {
            cancelEpoch: async () => state.cancelEpoch,
            isAborted: () => state.aborted,
            budgetAllows: async () => state.budget,
            deliverContext: async (input: { text: string; entryId: string }) => {
              state.contextWrites.push({ text: input.text, entryId: input.entryId });
              return { delivered: state.contextAllowed };
            },
          },
          cards: {
            updateParentCard: async (input: { parentToolCallId: string }) => {
              state.cards.push(input.parentToolCallId);
            },
          },
          host: { isOpen: () => state.hostOpen },
          checkpoints: {
            save: async (record: ReportDeliveryRecord) => {
              state.checkpoints.push(record);
            },
            list: async () => state.checkpoints,
          },
          now: () => 1_700_000_002_000,
        };
        return { ports, state };
      }

      const request = {
        rootId: "root-1",
        parentRunId: "run-1",
        parentToolCallId: "tool-1",
        childConversationId: "child-1",
        answerEntryId: "answer-1",
        text: "child result",
        epochAtStart: 7,
        status: "completed" as const,
      };

      it("delivers background context once without a standalone model input", async () => {
        const { ports, state } = makeReportPorts();
        const delivery = new ReportDelivery(ports);

        const first = await delivery.deliver(request);

        expect(first.state).toBe("context_delivered");
        expect(first.followUpStarted).toBe(false);
        expect(state.entries).toHaveLength(1);
        expect(state.contextWrites).toHaveLength(1);
        expect(state.cards).toHaveLength(1);

        const second = await delivery.deliver(request);

        expect(second.state).toBe("stored_duplicate");
        expect(second.entryId).toBe(first.entryId);
        expect(state.entries).toHaveLength(1);
        expect(state.contextWrites).toHaveLength(1);
      });

      it("reopening restores report state without delivering context again", async () => {
        const { ports, state } = makeReportPorts();
        const delivery = new ReportDelivery(ports);
        await delivery.deliver(request);

        state.hostOpen = false;
        const reopened = new ReportDelivery(ports);
        const restored = await reopened.deliver(request);

        expect(restored.state).toBe("stored_duplicate");
        expect(restored.followUpStarted).toBe(false);
        expect(state.contextWrites).toHaveLength(1);
        expect(state.entries).toHaveLength(1);
      });

      it("stores a cancelled root's report without waking the parent", async () => {
        const { ports, state } = makeReportPorts();
        state.cancelEpoch = 8;
        const delivery = new ReportDelivery(ports);

        const result = await delivery.deliver(request);

        expect(result.state).toBe("stored_cancelled");
        expect(result.followUpStarted).toBe(false);
        expect(state.contextWrites).toHaveLength(0);
        expect(state.entries).toHaveLength(0);
      });
    });
  });
});
