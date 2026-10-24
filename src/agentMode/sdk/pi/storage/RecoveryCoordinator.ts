import {
  type FailureSupervisor,
  type FailureSupervisorState,
  type StorageFailure,
} from "@/agentMode/sdk/pi/runtime/FailureSupervisor";

// Opening a store inspects and reports recovery state only; no scheduler, resume, submit
// or wait runs until the user explicitly continues, and approvals only survive when their
// binding, scope, policy version and file baseline still match:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type RecoveryApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "consumed";

export interface RecoveryApproval {
  readonly requestId: string;
  readonly bindingHash: string;
  readonly scopeId: string;
  readonly policyVersion: number;
  readonly beforeHashes: Readonly<Record<string, string | null>>;
  readonly state: RecoveryApprovalState;
}

export interface RecoveryRunSummary {
  readonly runId: string;
  readonly requestId?: string;
  readonly status: string;
  readonly startedAtMs: number;
}

export interface RecoveryUnknownMutation {
  readonly operationId: string;
  readonly status: "effect_unknown" | "needs_reconciliation";
}

export interface RecoveryInspection {
  readonly run: RecoveryRunSummary | null;
  readonly pendingApprovals: readonly RecoveryApproval[];
  readonly pendingQuestions: number;
  readonly pendingQuestionIds?: readonly string[];
  readonly unknownEffectMutations: readonly RecoveryUnknownMutation[];
}

export interface RecoveryPolicySnapshot {
  readonly scopeId: string;
  readonly policyVersion: number;
  readonly fileHashes: Readonly<Record<string, string | null>>;
  readonly bindingHashes: Readonly<Record<string, string>>;
}

export interface RecoveryReconciliation {
  readonly reconciled: boolean;
}

export type RecoveryBlockedReason =
  | "inspection_required"
  | "crash_loop_read_only"
  | "storage_unavailable"
  | "needs_reconciliation"
  | "invalid_approvals";

export type RecoveryContinueResult =
  | { kind: "resumed"; validApprovals: number }
  | {
      kind: "blocked";
      reasons: readonly RecoveryBlockedReason[];
      revokedApprovals?: readonly string[];
      validApprovals?: number;
    };

export interface RecoveryStateBase {
  readonly crashLoop: FailureSupervisorState;
}

export type RecoveryState =
  | (RecoveryStateBase & { kind: "clean" })
  | (RecoveryStateBase & {
      kind: "needs_recovery";
      run: RecoveryRunSummary | null;
      pendingApprovals: readonly RecoveryApproval[];
      pendingQuestions: number;
      pendingQuestionIds?: readonly string[];
      unknownEffectMutations: readonly RecoveryUnknownMutation[];
    })
  | (RecoveryStateBase & {
      kind: "read_only";
      run: RecoveryRunSummary | null;
      pendingApprovals: readonly RecoveryApproval[];
      pendingQuestionIds?: readonly string[];
      unknownEffectMutations: readonly RecoveryUnknownMutation[];
    })
  | (RecoveryStateBase & { kind: "storage_failed"; failure: StorageFailure });

export interface RecoveryCoordinatorOptions {
  inspect: () => Promise<RecoveryInspection>;
  supervisor: FailureSupervisor;
  reloadCredentialsAndPolicy: () => Promise<RecoveryPolicySnapshot>;
  reconcileUnknownEffects: () => Promise<RecoveryReconciliation>;
  resume: () => Promise<void>;
  abort: () => Promise<void>;
}

const EMPTY_APPROVALS: readonly RecoveryApproval[] = Object.freeze([]);
const EMPTY_REVOKED: readonly string[] = Object.freeze([]);
const EMPTY_UNKNOWN: readonly RecoveryUnknownMutation[] = Object.freeze([]);

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) === true;
}

export function revalidateRecoveryApprovals(
  approvals: readonly RecoveryApproval[],
  policy: RecoveryPolicySnapshot
): { valid: readonly RecoveryApproval[]; revoked: readonly string[] } {
  const valid: RecoveryApproval[] = [];
  const revoked: string[] = [];
  for (const approval of approvals) {
    const stateAllowsRecovery = approval.state === "pending" || approval.state === "approved";
    const bindingMatches = hasOwn(policy.bindingHashes, approval.requestId)
      ? policy.bindingHashes[approval.requestId] === approval.bindingHash
      : false;
    const scopeMatches =
      policy.scopeId === approval.scopeId && policy.policyVersion === approval.policyVersion;
    const baselineMatches = Object.entries(approval.beforeHashes).every(
      ([path, beforeHash]) =>
        hasOwn(policy.fileHashes, path) && policy.fileHashes[path] === beforeHash
    );
    if (stateAllowsRecovery && bindingMatches && scopeMatches && baselineMatches) {
      valid.push(approval);
    } else {
      revoked.push(approval.requestId);
    }
  }
  return {
    valid: valid.length === 0 ? EMPTY_APPROVALS : Object.freeze(valid),
    revoked: revoked.length === 0 ? EMPTY_REVOKED : Object.freeze(revoked),
  };
}

export class RecoveryCoordinator {
  private readonly inspectStore: () => Promise<RecoveryInspection>;
  private readonly supervisor: FailureSupervisor;
  private readonly reloadCredentialsAndPolicy: () => Promise<RecoveryPolicySnapshot>;
  private readonly reconcileUnknownEffects: () => Promise<RecoveryReconciliation>;
  private readonly resumeWork: () => Promise<void>;
  private readonly abortWork: () => Promise<void>;
  private inspection: RecoveryInspection | null = null;

  constructor(options: RecoveryCoordinatorOptions) {
    this.inspectStore = options.inspect;
    this.supervisor = options.supervisor;
    this.reloadCredentialsAndPolicy = options.reloadCredentialsAndPolicy;
    this.reconcileUnknownEffects = options.reconcileUnknownEffects;
    this.resumeWork = options.resume;
    this.abortWork = options.abort;
  }

  async inspectAfterOpen(): Promise<RecoveryState> {
    let inspection: RecoveryInspection;
    try {
      inspection = await this.inspectStore();
    } catch (error) {
      const failure: StorageFailure = {
        code: "STORAGE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      };
      await this.supervisor.recordStorageFailure(failure);
      return { kind: "storage_failed", failure, crashLoop: this.supervisor.getState() };
    }

    this.inspection = inspection;
    if (
      inspection.run &&
      !inspection.run.status.startsWith("paused_") &&
      inspection.run.status !== "waiting_user"
    )
      await this.supervisor.recordAbnormalOpen();
    const crashLoop = this.supervisor.getState();
    const base = {
      run: inspection.run,
      pendingApprovals: inspection.pendingApprovals,
      pendingQuestions: inspection.pendingQuestions,
      pendingQuestionIds: inspection.pendingQuestionIds ?? EMPTY_REVOKED,
      unknownEffectMutations: inspection.unknownEffectMutations,
    };

    if (crashLoop.readOnly) return { kind: "read_only", ...base, crashLoop };
    if (
      inspection.run === null &&
      inspection.pendingApprovals.length === 0 &&
      inspection.unknownEffectMutations.length === 0
    ) {
      return { kind: "clean", crashLoop };
    }
    return { kind: "needs_recovery", ...base, crashLoop };
  }

  async continueAfterUserChoice(): Promise<RecoveryContinueResult> {
    if (!this.inspection) {
      return { kind: "blocked", reasons: ["inspection_required"] };
    }
    const supervisorState = this.supervisor.getState();
    if (supervisorState.readOnly) {
      return { kind: "blocked", reasons: ["crash_loop_read_only"] };
    }
    if (supervisorState.hostIoBlocked) {
      return { kind: "blocked", reasons: ["storage_unavailable"] };
    }

    const policy = await this.reloadCredentialsAndPolicy();
    // 重开后的用户决定可能已替换或撤销旧审批，继续前必须读取最新记录，不能永久卡在打开时的快照：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    this.inspection = await this.inspectStore();
    const reconciliation = await this.reconcileUnknownEffects();
    if (!reconciliation.reconciled) {
      return { kind: "blocked", reasons: ["needs_reconciliation"] };
    }

    const { valid, revoked } = revalidateRecoveryApprovals(
      this.inspection.pendingApprovals,
      policy
    );
    if (revoked.length > 0) {
      return {
        kind: "blocked",
        reasons: ["invalid_approvals"],
        revokedApprovals: revoked,
        validApprovals: valid.length,
      };
    }

    this.supervisor.assertCanStartWork();
    await this.resumeWork();
    return { kind: "resumed", validApprovals: valid.length };
  }

  async reconcileAfterUserChoice(): Promise<RecoveryReconciliation> {
    const result = await this.reconcileUnknownEffects();
    this.inspection = await this.inspectStore();
    return result;
  }

  async stopAfterUserChoice(): Promise<void> {
    await this.abortWork();
    await this.supervisor.recordSafeBoundary();
    if (this.inspection) {
      this.inspection = {
        ...this.inspection,
        pendingApprovals: EMPTY_APPROVALS,
        unknownEffectMutations: EMPTY_UNKNOWN,
      };
    }
  }
}
