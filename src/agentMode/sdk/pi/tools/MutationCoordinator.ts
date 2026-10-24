import { sha256 } from "@/utils/hash";
import { PathLockPool, type PathLockLease } from "@/agentMode/sdk/pi/tools/PathLockPool";

// Mutation ledger and short-lived path locks. The state machine is fixed, before/after content is
// flushed to private content-addressed blobs before the intent exists, approval waits without a
// lock, locks are acquired in canonical order after approval, and a write whose receipt cannot be
// persisted is reported as effect_unknown rather than "nothing happened":
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type MutationState =
  | "prepared"
  | "awaiting_approval"
  | "approved"
  | "applying"
  | "committed"
  | "rejected"
  | "cancelled"
  | "stale"
  | "failed"
  | "effect_unknown"
  | "needs_reconciliation";

export interface MutationIntent {
  readonly operationId: string;
  readonly targetPath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly beforeBlobRef: string;
  readonly afterBlobRef: string;
  readonly createdAtMs: number;
}

export interface MutationReceipt {
  readonly operationId: string;
  readonly targetPath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly beforeBlobRef: string;
  readonly afterBlobRef: string;
  readonly approvalRef: string;
  readonly status: "committed";
  readonly committedAtMs: number;
}

export interface MutationBlobStore {
  put(content: string): Promise<string>;
  flush(): Promise<void>;
}

export interface MutationLedger {
  saveIntent(intent: MutationIntent): Promise<void>;
  saveReceipt(receipt: MutationReceipt): Promise<void>;
  saveState?(operationId: string, state: MutationState, errorCode?: string): Promise<void>;
}

export interface MutationWriter {
  write(input: {
    readonly targetPath: string;
    readonly content: string;
    readonly expectedBeforeHash: string;
  }): Promise<{ readonly afterHash: string }>;
}

export type MutationErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_STATE"
  | "BLOB_WRITE_FAILED"
  | "INTENT_WRITE_FAILED"
  | "STALE_BASELINE"
  | "WRITE_FAILED"
  | "CANCELLED"
  | "AFTER_HASH_MISMATCH"
  | "EFFECT_UNKNOWN";

export type PrepareMutationResult =
  | { readonly ok: true; readonly intent: MutationIntent }
  | { readonly ok: false; readonly code: MutationErrorCode; readonly message: string };

export type ApplyMutationResult =
  | { readonly ok: true; readonly receipt: MutationReceipt }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly wrote?: boolean;
    };

export interface MutationCoordinatorOptions {
  readonly locks: PathLockPool;
  readonly blobs: MutationBlobStore;
  readonly ledger: MutationLedger;
  readonly now?: () => number;
}

export interface PrepareMutationInput {
  readonly operationId?: string;
  readonly targetPath: string;
  readonly before: string;
  readonly after: string;
}

const TRANSITIONS: Readonly<Record<MutationState, readonly MutationState[]>> = {
  prepared: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["approved", "rejected", "cancelled"],
  approved: ["applying", "cancelled"],
  applying: ["committed", "stale", "failed", "effect_unknown", "needs_reconciliation"],
  committed: [],
  rejected: [],
  cancelled: [],
  stale: [],
  failed: [],
  effect_unknown: [],
  needs_reconciliation: [],
};

interface ActiveMutation {
  readonly intent: MutationIntent;
  readonly afterContent: string;
  state: MutationState;
  approvalRef?: string;
}

export class MutationError extends Error {
  readonly code: MutationErrorCode;

  constructor(code: MutationErrorCode, message: string) {
    super(message);
    this.name = "MutationError";
    this.code = code;
  }
}

export class MutationCoordinator {
  readonly locks: PathLockPool;
  private readonly blobs: MutationBlobStore;
  private readonly ledger: MutationLedger;
  private readonly now: () => number;
  private readonly mutations = new Map<string, ActiveMutation>();

  constructor(options: MutationCoordinatorOptions) {
    this.locks = options.locks;
    this.blobs = options.blobs;
    this.ledger = options.ledger;
    this.now = options.now ?? Date.now;
  }

  async prepare(input: PrepareMutationInput): Promise<PrepareMutationResult> {
    if (typeof input.targetPath !== "string" || input.targetPath.length === 0) {
      return { ok: false, code: "INVALID_ARGUMENT", message: "targetPath is required." };
    }
    if (typeof input.before !== "string" || typeof input.after !== "string") {
      return { ok: false, code: "INVALID_ARGUMENT", message: "before/after must be strings." };
    }
    const beforeHash = sha256(input.before);
    const afterHash = sha256(input.after);
    const operationId =
      input.operationId ?? sha256(`${input.targetPath}\0${beforeHash}\0${afterHash}`).slice(0, 24);
    if (this.mutations.has(operationId)) {
      return {
        ok: false,
        code: "INVALID_ARGUMENT",
        message: `The operation "${operationId}" already exists.`,
      };
    }
    let beforeBlobRef: string;
    let afterBlobRef: string;
    try {
      beforeBlobRef = await this.blobs.put(input.before);
      afterBlobRef = await this.blobs.put(input.after);
      await this.blobs.flush();
    } catch {
      return {
        ok: false,
        code: "BLOB_WRITE_FAILED",
        message: "The before/after blobs could not be flushed; no mutation was started.",
      };
    }
    const intent: MutationIntent = Object.freeze({
      operationId,
      targetPath: input.targetPath,
      beforeHash,
      afterHash,
      beforeBlobRef,
      afterBlobRef,
      createdAtMs: this.now(),
    });
    try {
      await this.ledger.saveIntent(intent);
    } catch {
      return {
        ok: false,
        code: "INTENT_WRITE_FAILED",
        message: "The mutation intent could not be persisted; no mutation was started.",
      };
    }
    this.mutations.set(operationId, { intent, afterContent: input.after, state: "prepared" });
    return { ok: true, intent };
  }

  async beginApproval(operationId: string): Promise<void> {
    await this.transition(operationId, "awaiting_approval");
  }

  async approve(operationId: string, approvalRef: string): Promise<void> {
    await this.transition(operationId, "approved");
    const mutation = this.requireMutation(operationId);
    mutation.approvalRef = approvalRef;
  }

  async reject(operationId: string): Promise<void> {
    await this.transition(operationId, "rejected");
  }

  async cancel(operationId: string): Promise<void> {
    await this.transition(operationId, "cancelled");
  }

  getState(operationId: string): MutationState | undefined {
    return this.mutations.get(operationId)?.state;
  }

  getIntent(operationId: string): MutationIntent | undefined {
    return this.mutations.get(operationId)?.intent;
  }

  async apply(operationId: string, writer: MutationWriter): Promise<ApplyMutationResult> {
    const mutation = this.requireMutation(operationId);
    if (mutation.state !== "approved") {
      throw new MutationError(
        "INVALID_STATE",
        `The mutation "${operationId}" is ${mutation.state}, not approved.`
      );
    }
    const approvalRef = mutation.approvalRef;
    if (approvalRef === undefined) {
      throw new MutationError(
        "INVALID_STATE",
        `The mutation "${operationId}" has no approval reference.`
      );
    }
    let lease: PathLockLease | undefined;
    try {
      lease = await this.locks.acquire([mutation.intent.targetPath]);
      await this.transition(operationId, "applying");
      let afterHash: string;
      try {
        const written = await writer.write({
          targetPath: mutation.intent.targetPath,
          content: mutation.afterContent,
          expectedBeforeHash: mutation.intent.beforeHash,
        });
        afterHash = written.afterHash;
      } catch (error) {
        const code = (error as { code?: string }).code;
        // 宿主可能已写入后才丢失确认；这种异常不能显示“未应用”或允许盲目重试：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (code === "EFFECT_UNKNOWN") {
          await this.setState(mutation, "effect_unknown", "EFFECT_UNKNOWN");
          return {
            ok: false,
            code: "EFFECT_UNKNOWN",
            message: "写入可能已经发生，但无法确认结果；请先核对实际文件。",
          };
        }
        const failureCode = code ?? "WRITE_FAILED";
        await this.setState(
          mutation,
          failureCode === "STALE_BASELINE"
            ? "stale"
            : failureCode === "CANCELLED"
              ? "cancelled"
              : "failed",
          failureCode
        );
        return {
          ok: false,
          code: failureCode,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (afterHash !== mutation.intent.afterHash) {
        await this.setState(mutation, "needs_reconciliation", "AFTER_HASH_MISMATCH");
        return {
          ok: false,
          code: "AFTER_HASH_MISMATCH",
          message: "The written content does not match the approved after hash.",
          wrote: true,
        };
      }
      const receipt: MutationReceipt = Object.freeze({
        operationId,
        targetPath: mutation.intent.targetPath,
        beforeHash: mutation.intent.beforeHash,
        afterHash,
        beforeBlobRef: mutation.intent.beforeBlobRef,
        afterBlobRef: mutation.intent.afterBlobRef,
        approvalRef,
        status: "committed",
        committedAtMs: this.now(),
      });
      try {
        await this.ledger.saveReceipt(receipt);
      } catch {
        await this.setState(mutation, "effect_unknown", "EFFECT_UNKNOWN");
        return {
          ok: false,
          code: "EFFECT_UNKNOWN",
          message:
            "The write succeeded but the receipt could not be saved; treat the effect as unknown.",
          wrote: true,
        };
      }
      mutation.state = "committed";
      return { ok: true, receipt };
    } finally {
      lease?.release();
    }
  }

  private requireMutation(operationId: string): ActiveMutation {
    const mutation = this.mutations.get(operationId);
    if (mutation === undefined) {
      throw new MutationError("INVALID_ARGUMENT", `Unknown mutation "${operationId}".`);
    }
    return mutation;
  }

  private async transition(operationId: string, next: MutationState): Promise<void> {
    const mutation = this.requireMutation(operationId);
    if (!TRANSITIONS[mutation.state].includes(next)) {
      throw new MutationError(
        "INVALID_STATE",
        `Cannot move "${operationId}" from ${mutation.state} to ${next}.`
      );
    }
    await this.setState(mutation, next);
  }

  private async setState(
    mutation: ActiveMutation,
    next: MutationState,
    errorCode?: string
  ): Promise<void> {
    mutation.state = next;
    try {
      await this.ledger.saveState?.(mutation.intent.operationId, next, errorCode);
    } catch (error) {
      // 未知结果的附加记录失败也不能遮蔽已发生的副作用，原applying意图仍供重开核对。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (next !== "effect_unknown" && next !== "needs_reconciliation") throw error;
    }
  }
}
