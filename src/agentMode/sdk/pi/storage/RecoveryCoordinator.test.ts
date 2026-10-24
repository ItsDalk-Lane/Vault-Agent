import {
  FailureSupervisor,
  FailureSupervisorError,
  type StorageFailure,
} from "@/agentMode/sdk/pi/runtime/FailureSupervisor";
import {
  RecoveryCoordinator,
  revalidateRecoveryApprovals,
  type RecoveryApproval,
  type RecoveryInspection,
  type RecoveryPolicySnapshot,
} from "./RecoveryCoordinator";

// Recovery is read-only until the user explicitly continues: opening a store inspects and
// reports, but never starts work; storage failures stop host I/O without claiming success;
// three abnormal opens in a row force read-only recovery:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function createInspection(overrides: Partial<RecoveryInspection> = {}): RecoveryInspection {
  return {
    run: {
      runId: "run-incomplete",
      status: "running",
      startedAtMs: 1,
    },
    pendingApprovals: [],
    pendingQuestions: 0,
    unknownEffectMutations: [],
    ...overrides,
  };
}

function createApproval(overrides: Partial<RecoveryApproval> = {}): RecoveryApproval {
  return {
    requestId: "req-1",
    bindingHash: "binding-hash-1",
    scopeId: "scope-1",
    policyVersion: 3,
    beforeHashes: { "Notes/A.md": "hash-a" },
    state: "pending",
    ...overrides,
  };
}

function createPolicySnapshot(
  overrides: Partial<RecoveryPolicySnapshot> = {}
): RecoveryPolicySnapshot {
  return {
    scopeId: "scope-1",
    policyVersion: 3,
    fileHashes: { "Notes/A.md": "hash-a" },
    bindingHashes: { "req-1": "binding-hash-1" },
    ...overrides,
  };
}

describe("FailureSupervisor", () => {
  it("enters read-only recovery and blocks start-work after three abnormal opens", async () => {
    const persisted: number[] = [];
    const supervisor = new FailureSupervisor({
      persist: async (state) => {
        persisted.push(state.consecutiveAbnormalOpens);
      },
    });

    expect((await supervisor.recordAbnormalOpen()).readOnly).toBe(false);
    expect((await supervisor.recordAbnormalOpen()).readOnly).toBe(false);
    const third = await supervisor.recordAbnormalOpen();

    expect(third).toMatchObject({ consecutiveAbnormalOpens: 3, readOnly: true });
    expect(supervisor.canStartWork()).toBe(false);
    expect(() => supervisor.assertCanStartWork()).toThrow(FailureSupervisorError);
    expect(persisted).toEqual([1, 2, 3]);
  });

  it("resets the crash-loop counter and read-only mode at a safe boundary", async () => {
    const supervisor = new FailureSupervisor({ initialAbnormalOpens: 3 });

    expect(supervisor.isReadOnly()).toBe(true);
    await supervisor.recordSafeBoundary();

    expect(supervisor.getState()).toMatchObject({ consecutiveAbnormalOpens: 0, readOnly: false });
    expect(supervisor.canStartWork()).toBe(true);
  });

  it("stops host I/O on a storage failure and never reports success", async () => {
    const supervisor = new FailureSupervisor();
    const failure: StorageFailure = {
      code: "STORAGE_FAILED",
      message: "JSONL write failed",
    };

    const recorded = await supervisor.recordStorageFailure(failure);

    expect(recorded).toEqual(failure);
    expect(supervisor.getState().storageFailure).toEqual(failure);
    expect(supervisor.canStartWork()).toBe(false);
    expect(() => supervisor.assertCanStartWork()).toThrow(/crash_loop_read_only|storage_failed/);
    expect(supervisor.getState()).toMatchObject({ mode: "normal", hostIoBlocked: true });
  });

  it("only leaves a user-retry read-only mode after explicit confirmation and recovery", async () => {
    const supervisor = new FailureSupervisor({ initialAbnormalOpens: 3 });
    await supervisor.recordStorageRecovered();
    expect(supervisor.isReadOnly()).toBe(true);

    await supervisor.resumeAfterExplicitUserRetry();

    expect(supervisor.isReadOnly()).toBe(false);
    expect(supervisor.canStartWork()).toBe(true);
    expect(supervisor.getState().consecutiveAbnormalOpens).toBe(0);
  });
});

describe("RecoveryCoordinator", () => {
  interface FakeHarness {
    readonly calls: string[];
    inspection: RecoveryInspection;
    inspectionFailure: Error | null;
    policy: RecoveryPolicySnapshot;
    unknownEffects: boolean;
    resumeCalls: number;
    abortCalls: number;
    reloadCalls: number;
    reconcileCalls: number;
  }

  function createHarness(): FakeHarness {
    return {
      calls: [],
      inspection: createInspection(),
      inspectionFailure: null,
      policy: createPolicySnapshot(),
      unknownEffects: false,
      resumeCalls: 0,
      abortCalls: 0,
      reloadCalls: 0,
      reconcileCalls: 0,
    };
  }

  function createCoordinator(
    harness: FakeHarness,
    supervisor = new FailureSupervisor()
  ): RecoveryCoordinator {
    return new RecoveryCoordinator({
      inspect: async () => {
        harness.calls.push("inspect");
        if (harness.inspectionFailure) throw harness.inspectionFailure;
        return harness.inspection;
      },
      supervisor,
      reloadCredentialsAndPolicy: async () => {
        harness.calls.push("reload");
        harness.reloadCalls += 1;
        return harness.policy;
      },
      reconcileUnknownEffects: async () => {
        harness.calls.push("reconcile");
        harness.reconcileCalls += 1;
        return harness.unknownEffects ? { reconciled: false } : { reconciled: true };
      },
      resume: async () => {
        harness.calls.push("resume");
        harness.resumeCalls += 1;
      },
      abort: async () => {
        harness.calls.push("abort");
        harness.abortCalls += 1;
      },
    });
  }

  it("inspects an incomplete run without starting, resuming or waiting on it", async () => {
    const harness = createHarness();
    const coordinator = createCoordinator(harness);

    const state = await coordinator.inspectAfterOpen();

    expect(state.kind).toBe("needs_recovery");
    expect(harness.calls).toEqual(["inspect"]);
    expect(harness.resumeCalls).toBe(0);
    expect(harness.abortCalls).toBe(0);
    expect(state.crashLoop.consecutiveAbnormalOpens).toBe(1);
  });

  it("reports a clean store without counting an abnormal open", async () => {
    const harness = createHarness();
    harness.inspection = createInspection({ run: null });
    const coordinator = createCoordinator(harness);

    const state = await coordinator.inspectAfterOpen();

    expect(state.kind).toBe("clean");
    expect(state.crashLoop.consecutiveAbnormalOpens).toBe(0);
  });

  it("surfaces a storage failure on open and leaves no success state", async () => {
    const harness = createHarness();
    harness.inspectionFailure = new Error("JSONL unreadable");
    const supervisor = new FailureSupervisor();
    const coordinator = createCoordinator(harness, supervisor);

    const state = await coordinator.inspectAfterOpen();

    expect(state.kind).toBe("storage_failed");
    expect(supervisor.getState().hostIoBlocked).toBe(true);
    expect(harness.resumeCalls).toBe(0);
  });

  it("resumes only after an explicit user continue that reloads policy and reconciles", async () => {
    const harness = createHarness();
    const coordinator = createCoordinator(harness);
    await coordinator.inspectAfterOpen();

    const result = await coordinator.continueAfterUserChoice();

    expect(result).toEqual({ kind: "resumed", validApprovals: 0 });
    expect(harness.calls).toEqual(["inspect", "reload", "inspect", "reconcile", "resume"]);
    expect(harness.resumeCalls).toBe(1);
  });

  it("does not resume while unknown effects still need reconciliation", async () => {
    const harness = createHarness();
    harness.inspection = createInspection({
      unknownEffectMutations: [{ operationId: "op-1", status: "effect_unknown" }],
    });
    harness.unknownEffects = true;
    const coordinator = createCoordinator(harness);
    await coordinator.inspectAfterOpen();

    const result = await coordinator.continueAfterUserChoice();

    expect(result).toMatchObject({ kind: "blocked", reasons: ["needs_reconciliation"] });
    expect(harness.resumeCalls).toBe(0);
  });

  it("revokes approvals whose binding, scope, policy or file baseline changed", async () => {
    const harness = createHarness();
    harness.inspection = createInspection({ pendingApprovals: [createApproval()] });
    harness.policy = createPolicySnapshot({
      policyVersion: 4,
      bindingHashes: { "req-1": "binding-hash-1" },
    });
    const coordinator = createCoordinator(harness);
    await coordinator.inspectAfterOpen();

    const result = await coordinator.continueAfterUserChoice();

    expect(result).toMatchObject({
      kind: "blocked",
      reasons: ["invalid_approvals"],
      revokedApprovals: ["req-1"],
    });
    expect(harness.resumeCalls).toBe(0);
  });

  it("resumes with approvals that still match the current policy and files", async () => {
    const harness = createHarness();
    harness.inspection = createInspection({ pendingApprovals: [createApproval()] });
    const coordinator = createCoordinator(harness);
    await coordinator.inspectAfterOpen();

    const result = await coordinator.continueAfterUserChoice();

    expect(result).toEqual({ kind: "resumed", validApprovals: 1 });
    expect(harness.resumeCalls).toBe(1);
  });

  it("uses a user decision saved after opening instead of blocking on the old pending snapshot https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
    const harness = createHarness();
    harness.inspection = createInspection({ pendingApprovals: [createApproval()] });
    const coordinator = createCoordinator(harness);
    await coordinator.inspectAfterOpen();
    harness.inspection = createInspection({ pendingApprovals: [] });
    harness.policy = createPolicySnapshot({ bindingHashes: {} });
    expect(await coordinator.continueAfterUserChoice()).toEqual({
      kind: "resumed",
      validApprovals: 0,
    });
    expect(harness.resumeCalls).toBe(1);
  });

  it("blocks automatic work after the crash-loop threshold and recovers after the user stops", async () => {
    const harness = createHarness();
    const supervisor = new FailureSupervisor({ initialAbnormalOpens: 2 });
    const coordinator = createCoordinator(harness, supervisor);

    const state = await coordinator.inspectAfterOpen();
    expect(state.kind).toBe("read_only");

    const blocked = await coordinator.continueAfterUserChoice();
    expect(blocked).toMatchObject({ kind: "blocked", reasons: ["crash_loop_read_only"] });
    expect(harness.resumeCalls).toBe(0);

    await coordinator.stopAfterUserChoice();
    expect(harness.abortCalls).toBe(1);
    expect(supervisor.getState()).toMatchObject({ consecutiveAbnormalOpens: 0, readOnly: false });

    const resumed = await coordinator.continueAfterUserChoice();
    expect(resumed).toMatchObject({ kind: "resumed" });
    expect(harness.resumeCalls).toBe(1);
  });

  it("revalidates allow-once approvals from the recoverable set only", () => {
    const approval = createApproval();
    const valid = revalidateRecoveryApprovals([approval], createPolicySnapshot());
    expect(valid).toEqual({ valid: [approval], revoked: [] });

    const consumed = createApproval({ state: "consumed" });
    const withConsumed = revalidateRecoveryApprovals([consumed], createPolicySnapshot());
    expect(withConsumed.valid).toEqual([]);
    expect(withConsumed.revoked).toEqual(["req-1"]);
  });
});
