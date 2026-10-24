import { sha256 } from "@/utils/hash";

// Revert is a new approved mutation, never a raw filesystem write. It only proceeds when the
// current content still equals the original receipt's afterHash; a later user edit becomes a
// CONFLICT that is shown but never overwritten, a repeated revert is idempotent, created notes go
// to the recycle API, deleted notes are restored only when the target is absent, and rename
// side-effect compensation stops and lists whatever cannot be proven:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface RevertSourceFile {
  readonly path: string;
  readonly attributable: boolean;
  readonly beforeBlobRef: string | null;
  readonly afterHash: string;
}

export interface RevertSourceReceipt {
  readonly operationId: string;
  readonly kind: "write" | "create" | "frontmatter" | "rename" | "trash";
  readonly path: string;
  readonly newPath?: string;
  readonly beforeBlobRef: string | null;
  readonly afterBlobRef: string | null;
  readonly afterHash: string;
  readonly approvalRef?: string;
  readonly files?: readonly RevertSourceFile[];
}

export interface RevertBlobReader {
  read(ref: string): Promise<string | null>;
}

export interface RevertVaultAdapter {
  read(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  process(path: string, callback: (current: string) => string): Promise<void>;
  trashFile(path: string): Promise<void>;
  create(path: string, content: string): Promise<void>;
}

export interface RevertReceiptFile {
  readonly path: string;
  readonly action: "restored" | "recycled" | "recreated";
}

export interface RevertReceipt {
  readonly operationId: string;
  readonly revertOf: string;
  readonly kind: "revert";
  readonly mode: "restore" | "recycle" | "create";
  readonly files: readonly RevertReceiptFile[];
  readonly approvalRef?: string;
  readonly status: "committed";
  readonly committedAtMs: number;
}

export interface RevertReceiptStore {
  find(operationId: string): Promise<RevertReceipt | undefined>;
  save(receipt: RevertReceipt): Promise<void>;
}

export interface RevertSourceReceiptStore {
  find(operationId: string): Promise<RevertSourceReceipt | undefined>;
}

export interface RevertMutationOptions {
  readonly blobs: RevertBlobReader;
  readonly vault: RevertVaultAdapter;
  readonly receipts: RevertReceiptStore;
  readonly sourceReceipts: RevertSourceReceiptStore;
  readonly authorize?: (request: {
    readonly operationId: string;
    readonly revertOf: string;
    readonly kind: RevertSourceReceipt["kind"];
    readonly path: string;
  }) => Promise<boolean>;
  readonly now?: () => number;
}

export interface RevertConflict {
  readonly path: string;
  readonly currentHash: string;
  readonly expectedHash: string;
  readonly reason?: string;
}

export type RevertErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PARTIAL"
  | "APPROVAL_UNAVAILABLE"
  | "AUDIT_FAILED"
  | "PERMISSION_DENIED"
  | "CANCELLED"
  | "EFFECT_UNKNOWN"
  | "FAILED";

export type RevertResult =
  | {
      readonly ok: true;
      readonly receipt: RevertReceipt;
      readonly alreadyReverted?: true;
      readonly revertedOperationIds?: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: RevertErrorCode;
      readonly message: string;
      readonly conflicts?: readonly RevertConflict[];
      readonly compensated?: readonly string[];
      readonly wrote?: boolean;
      readonly revertedOperationIds?: readonly string[];
    };

export interface RevertInput {
  readonly originalOperationId: string;
  readonly operationId?: string;
}

export interface RevertContext {
  readonly signal?: AbortSignal;
}

class StaleBaselineError extends Error {}

export class RevertMutation {
  private readonly blobs: RevertBlobReader;
  private readonly vault: RevertVaultAdapter;
  private readonly receipts: RevertReceiptStore;
  private readonly sourceReceipts: RevertSourceReceiptStore;
  private readonly authorize: RevertMutationOptions["authorize"];
  private readonly now: () => number;

  constructor(options: RevertMutationOptions) {
    this.blobs = options.blobs;
    this.vault = options.vault;
    this.receipts = options.receipts;
    this.sourceReceipts = options.sourceReceipts;
    this.authorize = options.authorize;
    this.now = options.now ?? Date.now;
  }

  async revert(input: RevertInput, context: RevertContext): Promise<RevertResult> {
    if (typeof input.originalOperationId !== "string" || input.originalOperationId.length === 0) {
      return failure("INVALID_ARGUMENT", "originalOperationId is required.");
    }
    const source = await this.sourceReceipts.find(input.originalOperationId);
    if (source === undefined) {
      return failure("NOT_FOUND", `No receipt for "${input.originalOperationId}".`);
    }
    const operationId = input.operationId ?? sha256(`revert\0${source.operationId}`).slice(0, 24);
    const previous = await this.receipts.find(operationId);
    if (previous !== undefined) {
      return { ok: true, receipt: previous, alreadyReverted: true };
    }
    if (isAborted(context)) {
      return failure("CANCELLED", "The revert was cancelled before approval.");
    }
    if (this.authorize === undefined) {
      return failure("APPROVAL_UNAVAILABLE", "No approval prompt is available for this revert.");
    }
    const approved = await this.authorize({
      operationId,
      revertOf: source.operationId,
      kind: source.kind,
      path: source.path,
    });
    if (isAborted(context)) {
      return failure("CANCELLED", "The revert was cancelled before writing.");
    }
    if (!approved) {
      return failure("PERMISSION_DENIED", "The revert was not approved.");
    }
    if (source.kind === "create") return this.revertCreate(source, operationId, context);
    if (source.kind === "trash") return this.revertTrash(source, operationId, context);
    if (source.kind === "rename") return this.revertRename(source, operationId, context);
    return this.revertWrite(source, operationId, context);
  }

  private async revertWrite(
    source: RevertSourceReceipt,
    operationId: string,
    context: RevertContext
  ): Promise<RevertResult> {
    const current = await this.vault.read(source.path);
    const currentHash = sha256(current);
    if (currentHash !== source.afterHash) {
      return conflict(source.path, currentHash, source.afterHash);
    }
    const before = await this.readBlob(source.beforeBlobRef);
    // 基线和备份读取也会等待 I/O，停止必须在等待后及 CAS 回调内重新检查：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (isAborted(context)) return failure("CANCELLED", "回退已停止，文件没有继续修改。");
    if (before === undefined || before === null) {
      return failure("FAILED", "The before blob is missing; the revert cannot be prepared.");
    }
    try {
      await this.vault.process(source.path, (latest) => {
        if (isAborted(context))
          throw Object.assign(new Error("回退已停止。"), { code: "CANCELLED" });
        if (sha256(latest) !== source.afterHash) throw new StaleBaselineError();
        return before;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "EFFECT_UNKNOWN")
        return failure("EFFECT_UNKNOWN", "回退可能已经写入，请先核对实际文件。");
      if (isAborted(context)) return failure("CANCELLED", "回退已停止。");
      if (error instanceof StaleBaselineError) {
        const latest = await this.vault.read(source.path);
        return conflict(source.path, sha256(latest), source.afterHash);
      }
      return failure("FAILED", "The revert could not be written.");
    }
    return this.commit(operationId, source, "restore", [{ path: source.path, action: "restored" }]);
  }

  private async revertCreate(
    source: RevertSourceReceipt,
    operationId: string,
    context: RevertContext
  ): Promise<RevertResult> {
    const exists = await this.vault.fileExists(source.path);
    if (!exists) {
      return failure("CONFLICT", "The created note no longer exists.", [
        { path: source.path, currentHash: sha256(""), expectedHash: source.afterHash },
      ]);
    }
    const currentHash = sha256(await this.vault.read(source.path));
    if (isAborted(context)) return failure("CANCELLED", "回退已停止，文件没有继续修改。");
    if (currentHash !== source.afterHash) {
      return conflict(source.path, currentHash, source.afterHash);
    }
    try {
      await this.vault.trashFile(source.path);
    } catch (error) {
      if ((error as { code?: string }).code === "EFFECT_UNKNOWN")
        return failure("EFFECT_UNKNOWN", "回收可能已经发生，请先核对实际文件。");
      return failure("FAILED", "The recycle operation failed.");
    }
    return this.commit(operationId, source, "recycle", [{ path: source.path, action: "recycled" }]);
  }

  private async revertTrash(
    source: RevertSourceReceipt,
    operationId: string,
    context: RevertContext
  ): Promise<RevertResult> {
    const exists = await this.vault.fileExists(source.path);
    if (exists) {
      return failure("CONFLICT", "A file already exists at this path; it is not overwritten.", [
        {
          path: source.path,
          currentHash: sha256(await this.vault.read(source.path)),
          expectedHash: source.afterHash,
        },
      ]);
    }
    const backup = await this.readBlob(source.beforeBlobRef);
    if (isAborted(context)) return failure("CANCELLED", "回退已停止，文件没有继续修改。");
    if (backup === undefined || backup === null) {
      return failure("FAILED", "The deleted note has no restorable backup.");
    }
    try {
      await this.vault.create(source.path, backup);
    } catch (error) {
      if ((error as { code?: string }).code === "EFFECT_UNKNOWN")
        return failure("EFFECT_UNKNOWN", "恢复文件可能已经发生，请先核对实际文件。");
      return failure("FAILED", "The deleted note could not be restored.");
    }
    return this.commit(operationId, source, "create", [{ path: source.path, action: "recreated" }]);
  }

  private async revertRename(
    source: RevertSourceReceipt,
    operationId: string,
    context: RevertContext
  ): Promise<RevertResult> {
    const files = source.files ?? [];
    const conflicts: RevertConflict[] = [];
    for (const file of files) {
      if (isAborted(context)) return failure("CANCELLED", "回退已停止，未继续补偿其他文件。");
      if (!file.attributable) {
        conflicts.push({
          path: file.path,
          currentHash: sha256(await this.vault.read(file.path)),
          expectedHash: file.afterHash,
          reason: "unattributed",
        });
        continue;
      }
      const currentHash = sha256(await this.vault.read(file.path));
      if (currentHash !== file.afterHash) {
        conflicts.push({ path: file.path, currentHash, expectedHash: file.afterHash });
      }
    }
    if (conflicts.length > 0) {
      return {
        ok: false,
        code: "PARTIAL",
        message: "Rename compensation stopped: some files are not attributable or changed.",
        conflicts: Object.freeze(conflicts),
        compensated: Object.freeze([]),
      };
    }
    const compensated: string[] = [];
    for (const file of files) {
      const before = await this.readBlob(file.beforeBlobRef);
      if (isAborted(context))
        return {
          ok: false,
          code: "CANCELLED",
          message: "回退已停止，已完成的补偿已保留。",
          compensated: Object.freeze(compensated),
          wrote: compensated.length > 0,
        };
      if (before === undefined || before === null) {
        conflicts.push({
          path: file.path,
          currentHash: sha256(await this.vault.read(file.path)),
          expectedHash: file.afterHash,
          reason: "missing_blob",
        });
        break;
      }
      try {
        await this.vault.process(file.path, (latest) => {
          if (isAborted(context))
            throw Object.assign(new Error("回退已停止。"), { code: "CANCELLED" });
          if (sha256(latest) !== file.afterHash) throw new StaleBaselineError();
          return before;
        });
        compensated.push(file.path);
      } catch (error) {
        // 停止与宿主回执丢失可能同时发生，不能把可能已写入的结果描述为未执行：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if ((error as { code?: string }).code === "EFFECT_UNKNOWN" || isAborted(context))
          return {
            ok: false,
            code:
              (error as { code?: string }).code === "EFFECT_UNKNOWN"
                ? "EFFECT_UNKNOWN"
                : "CANCELLED",
            message: "回退已停止；请核对已完成及结果未知的补偿。",
            compensated: Object.freeze(compensated),
            wrote: compensated.length > 0 || (error as { code?: string }).code === "EFFECT_UNKNOWN",
          };
        conflicts.push({
          path: file.path,
          currentHash: sha256(await this.vault.read(file.path)),
          expectedHash: file.afterHash,
          reason: "write_failed",
        });
        break;
      }
    }
    if (conflicts.length > 0) {
      return {
        ok: false,
        code: "PARTIAL",
        message: "Rename compensation stopped after a partial change.",
        conflicts: Object.freeze(conflicts),
        compensated: Object.freeze(compensated),
        wrote: compensated.length > 0,
      };
    }
    return this.commit(
      operationId,
      source,
      "restore",
      files.map((file) => ({ path: file.path, action: "restored" as const }))
    );
  }

  private async commit(
    operationId: string,
    source: RevertSourceReceipt,
    mode: RevertReceipt["mode"],
    files: readonly RevertReceiptFile[]
  ): Promise<RevertResult> {
    const receipt: RevertReceipt = Object.freeze({
      operationId,
      revertOf: source.operationId,
      kind: "revert",
      mode,
      files: Object.freeze([...files]),
      ...(source.approvalRef !== undefined ? { approvalRef: source.approvalRef } : {}),
      status: "committed",
      committedAtMs: this.now(),
    });
    try {
      await this.receipts.save(receipt);
    } catch {
      return {
        ok: false,
        code: "EFFECT_UNKNOWN",
        message: "The revert succeeded but its receipt could not be saved.",
        wrote: true,
      };
    }
    return { ok: true, receipt };
  }

  private async readBlob(ref: string | null): Promise<string | null | undefined> {
    if (ref === null) return null;
    const content = await this.blobs.read(ref);
    return content === null ? undefined : content;
  }
}

function isAborted(context: RevertContext): boolean {
  return context.signal?.aborted === true;
}

function failure(
  code: RevertErrorCode,
  message: string,
  conflicts?: readonly RevertConflict[]
): RevertResult {
  return {
    ok: false,
    code,
    message,
    ...(conflicts !== undefined ? { conflicts } : {}),
  };
}

function conflict(path: string, currentHash: string, expectedHash: string): RevertResult {
  return {
    ok: false,
    code: "CONFLICT",
    message: `The note "${path}" changed after the agent write; the revert was not applied.`,
    conflicts: [{ path, currentHash, expectedHash }],
  };
}
