import { sha256 } from "@/utils/hash";
import { PathResolver, PathResolverError } from "@/agentMode/sdk/pi/policy/PathResolver";
import { defineToolManifest, type ToolManifest } from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import {
  prepareExactPatch,
  type ExactPatchEdit,
  type ExactPatchErrorCode,
} from "@/agentMode/sdk/pi/tools/ExactPatch";

// create never overwrites; edit re-checks the baseline hash inside the synchronous Vault.process
// callback, runs the final gateway/cancel check before writing, verifies the real content after the
// write, stores a receipt so a replayed operation id never applies the patch twice, and only a
// verified+persisted result is marked safe:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface VaultWriteAdapter {
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  create(path: string, content: string): Promise<void>;
  process(path: string, callback: (current: string) => string): Promise<void>;
}

export interface VaultWriteReceipt {
  readonly operationId: string;
  readonly path: string;
  readonly kind: "create" | "edit";
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly edits: number;
  readonly approvalRef?: string;
  readonly safe: true;
  readonly committedAtMs: number;
}

export interface VaultWriteReceiptStore {
  save(receipt: VaultWriteReceipt): Promise<void>;
  find(operationId: string): Promise<VaultWriteReceipt | undefined>;
}

export interface VaultWriteToolContext {
  readonly isPathInScope?: (relativePath: string) => boolean;
  readonly signal?: AbortSignal;
  readonly operationId?: string;
  readonly approvalRef?: string;
}

export interface VaultWriteToolsOptions {
  readonly vault: VaultWriteAdapter;
  readonly pathResolver: PathResolver;
  readonly receipts?: VaultWriteReceiptStore;
  readonly authorize?: (input: {
    readonly path: string;
    readonly kind: "create" | "edit";
    readonly operationId: string;
  }) => Promise<boolean>;
  readonly now?: () => number;
  readonly maxInputBytes?: number;
}

export type VaultWriteErrorCode =
  | "INVALID_ARGUMENT"
  | "PATH_OUT_OF_SCOPE"
  | "PROTECTED_PATH"
  | "STALE_BASELINE"
  | "ALREADY_EXISTS"
  | "CANCELLED"
  | "PERMISSION_DENIED"
  | "AFTER_HASH_MISMATCH"
  | "EFFECT_UNKNOWN"
  | "WRITE_FAILED"
  | "READ_FAILED"
  | ExactPatchErrorCode;

export type VaultWriteResult =
  | {
      readonly ok: true;
      readonly safe: true;
      readonly receipt: VaultWriteReceipt;
      readonly alreadyApplied?: true;
    }
  | {
      readonly ok: false;
      readonly code: VaultWriteErrorCode;
      readonly message: string;
      readonly wrote?: boolean;
    };

const DEFAULT_MAX_INPUT_BYTES = 1 * 1_024 * 1_024;

const CREATE_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    content: { type: "string", maxLength: 2 * 1_024 * 1_024 },
  },
  required: ["path", "content"],
  additionalProperties: false,
} as const;

const EDIT_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    fileVersion: {
      type: "string",
      minLength: 64,
      maxLength: 64,
      description: "Copy fileVersion from vault_read for this file; never use the range sha256.",
    },
    expectedHash: {
      type: "string",
      minLength: 64,
      maxLength: 64,
      description: "Legacy alias for fileVersion; must represent the whole file.",
    },
    edits: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          oldText: { type: "string", minLength: 1 },
          newText: { type: "string" },
          occurrence: { type: "integer", minimum: 1 },
        },
        required: ["oldText", "newText"],
        additionalProperties: false,
      },
    },
  },
  required: ["path", "edits"],
  // 真实写入必需完整版本，声明也必须提前拒绝缺参，同时保留已有 expectedHash 调用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  anyOf: [{ required: ["fileVersion"] }, { required: ["expectedHash"] }],
  additionalProperties: false,
} as const;

type ResolvedVaultPath =
  | { readonly ok: true; readonly value: { readonly relative: string; readonly canonical: string } }
  | {
      readonly ok: false;
      readonly code: VaultWriteErrorCode;
      readonly message: string;
      readonly wrote?: boolean;
    };

class StaleBaselineError extends Error {
  readonly code = "STALE_BASELINE";
}

export class VaultWriteTools {
  readonly manifests: readonly ToolManifest[];
  private readonly vault: VaultWriteAdapter;
  private readonly pathResolver: PathResolver;
  private readonly receipts: VaultWriteReceiptStore | undefined;
  private readonly authorize: VaultWriteToolsOptions["authorize"];
  private readonly now: () => number;
  private readonly maxInputBytes: number;

  constructor(options: VaultWriteToolsOptions) {
    this.vault = options.vault;
    this.pathResolver = options.pathResolver;
    this.receipts = options.receipts;
    this.authorize = options.authorize;
    this.now = options.now ?? Date.now;
    this.maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
    this.manifests = Object.freeze([
      defineToolManifest({
        toolId: "vault_create",
        description:
          "Create a new note at a vault-relative path with content; never overwrite an existing file. Parent folders are prepared by the host. Check the committed receipt; if the effect is unknown, request reconciliation instead of retrying.",
        family: "vault",
        effects: ["create"],
        parameters: CREATE_PARAMETERS,
        extractTargets: (args) => targetsOf(args),
        implementationVersion: 2,
        schemaVersion: 2,
        replayPolicy: "idempotent",
        allowedCallers: ["root", "subagent"],
        maxOutputBytes: 64 * 1_024,
      }),
      defineToolManifest({
        toolId: "vault_edit",
        description:
          "Apply exact text replacements to an existing vault note. Read it first and copy its whole-file fileVersion, not the range sha256. A stale baseline requires a fresh read and approval. Success includes a verified receipt; unknown effects must be reconciled before retrying.",
        family: "vault",
        effects: ["write"],
        parameters: EDIT_PARAMETERS,
        extractTargets: (args) => targetsOf(args),
        implementationVersion: 3,
        schemaVersion: 3,
        replayPolicy: "idempotent",
        allowedCallers: ["root", "subagent"],
        maxOutputBytes: 64 * 1_024,
      }),
    ]);
  }

  register(registry: ToolRegistry, gateway?: ToolGateway): void {
    for (const manifest of this.manifests) {
      registry.register(manifest, "host");
      gateway?.registerTool({
        toolId: manifest.toolId,
        manifest,
        execute: async (args, context) => {
          const result =
            manifest.toolId === "vault_create"
              ? await this.create(args, context)
              : await this.edit(args, context);
          return { content: JSON.stringify(result), isError: result.ok === false };
        },
      });
    }
  }

  async create(
    rawArgs: Record<string, unknown>,
    context: VaultWriteToolContext
  ): Promise<VaultWriteResult> {
    const requestedPath = rawArgs.path;
    const content = rawArgs.content;
    if (typeof requestedPath !== "string" || requestedPath.length === 0) {
      return invalid("path is required.");
    }
    if (typeof content !== "string") return invalid("content is required.");
    const operationId =
      context.operationId ?? sha256(`create\0${requestedPath}\0${content}`).slice(0, 24);
    const replayed = await this.findReceipt(operationId);
    if (replayed !== undefined)
      return { ok: true, safe: true, receipt: replayed, alreadyApplied: true };

    const resolved = await this.resolve(requestedPath, context);
    if (!resolved.ok) return resolved;
    let exists: boolean;
    try {
      exists = await this.vault.exists(resolved.value.relative);
    } catch {
      return { ok: false, code: "WRITE_FAILED", message: "The Vault could not check the target." };
    }
    if (exists) {
      return {
        ok: false,
        code: "ALREADY_EXISTS",
        message: `The note "${requestedPath}" already exists; create never overwrites.`,
      };
    }
    const finalCheck = await this.finalCheck(
      resolved.value.relative,
      "create",
      operationId,
      context
    );
    if (finalCheck !== undefined) return finalCheck;
    try {
      await this.vault.create(resolved.value.relative, content);
    } catch (error) {
      // 宿主已开始创建后可能丢失确认，必须保留未知效果以便恢复先核对：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if ((error as { code?: string }).code === "EFFECT_UNKNOWN")
        return { ok: false, code: "EFFECT_UNKNOWN", message: "创建结果尚未确认，请先核对文件。" };
      if ((error as { code?: string }).code === "EEXIST") {
        return {
          ok: false,
          code: "ALREADY_EXISTS",
          message: `The note "${requestedPath}" already exists; create never overwrites.`,
        };
      }
      return { ok: false, code: "WRITE_FAILED", message: "The Vault create failed." };
    }
    const afterHash = await this.readHash(resolved.value.relative);
    if (afterHash === null || afterHash !== sha256(content)) {
      return {
        ok: false,
        code: "AFTER_HASH_MISMATCH",
        message: "The created content does not match what was approved.",
        wrote: true,
      };
    }
    return this.commitReceipt({
      operationId,
      path: resolved.value.relative,
      kind: "create",
      beforeHash: sha256(""),
      afterHash,
      edits: 0,
      ...(context.approvalRef !== undefined ? { approvalRef: context.approvalRef } : {}),
    });
  }

  async edit(
    rawArgs: Record<string, unknown>,
    context: VaultWriteToolContext
  ): Promise<VaultWriteResult> {
    const requestedPath = rawArgs.path;
    const expectedHash = rawArgs.fileVersion ?? rawArgs.expectedHash;
    const edits = rawArgs.edits;
    if (typeof requestedPath !== "string" || requestedPath.length === 0) {
      return invalid("path is required.");
    }
    if (typeof expectedHash !== "string" || expectedHash.length === 0) {
      return invalid("fileVersion is required.");
    }
    if (!Array.isArray(edits) || edits.length === 0) {
      return invalid("edits must contain at least one edit.");
    }
    const operationId =
      context.operationId ??
      sha256(`edit\0${requestedPath}\0${expectedHash}\0${JSON.stringify(edits)}`).slice(0, 24);
    const replayed = await this.findReceipt(operationId);
    if (replayed !== undefined)
      return { ok: true, safe: true, receipt: replayed, alreadyApplied: true };

    const resolved = await this.resolve(requestedPath, context);
    if (!resolved.ok) return resolved;
    const before = await this.readContent(resolved.value.relative);
    if (before === null) {
      return { ok: false, code: "READ_FAILED", message: `Cannot read "${requestedPath}".` };
    }
    if (sha256(before) !== expectedHash) {
      return {
        ok: false,
        code: "STALE_BASELINE",
        message: "The note changed since it was read; re-read and ask for a fresh diff.",
      };
    }
    const patch = prepareExactPatch({
      before,
      edits: edits as readonly ExactPatchEdit[],
      maxInputBytes: this.maxInputBytes,
    });
    if (!patch.ok) {
      return { ok: false, code: patch.code, message: patch.message };
    }
    const finalCheck = await this.finalCheck(resolved.value.relative, "edit", operationId, context);
    if (finalCheck !== undefined) return finalCheck;
    try {
      await this.vault.process(resolved.value.relative, (latest) => {
        if (sha256(latest) !== expectedHash) throw new StaleBaselineError();
        return patch.proposal.after;
      });
    } catch (error) {
      // CAS 通过后宿主仍可能在写入完成时拒绝，不能把这种结果降成未写入：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if ((error as { code?: string }).code === "EFFECT_UNKNOWN")
        return { ok: false, code: "EFFECT_UNKNOWN", message: "修改结果尚未确认，请先核对文件。" };
      if (
        error instanceof StaleBaselineError ||
        (error as { code?: string }).code === "STALE_BASELINE"
      ) {
        return {
          ok: false,
          code: "STALE_BASELINE",
          message: "The note changed during approval; nothing was written.",
        };
      }
      return { ok: false, code: "WRITE_FAILED", message: "The Vault edit failed." };
    }
    const afterHash = await this.readHash(resolved.value.relative);
    if (afterHash === null || afterHash !== patch.proposal.afterHash) {
      return {
        ok: false,
        code: "AFTER_HASH_MISMATCH",
        message: "The written content does not match the approved after hash.",
        wrote: true,
      };
    }
    return this.commitReceipt({
      operationId,
      path: resolved.value.relative,
      kind: "edit",
      beforeHash: expectedHash,
      afterHash,
      edits: patch.proposal.edits.length,
      ...(context.approvalRef !== undefined ? { approvalRef: context.approvalRef } : {}),
    });
  }

  private async commitReceipt(
    input: Omit<VaultWriteReceipt, "safe" | "committedAtMs">
  ): Promise<VaultWriteResult> {
    const receipt: VaultWriteReceipt = Object.freeze({
      ...input,
      safe: true,
      committedAtMs: this.now(),
    });
    if (this.receipts === undefined) return { ok: true, safe: true, receipt };
    try {
      await this.receipts.save(receipt);
    } catch {
      return {
        ok: false,
        code: "EFFECT_UNKNOWN",
        message:
          "The write succeeded but the receipt could not be saved; treat the effect as unknown.",
        wrote: true,
      };
    }
    return { ok: true, safe: true, receipt };
  }

  private async findReceipt(operationId: string): Promise<VaultWriteReceipt | undefined> {
    return this.receipts?.find(operationId);
  }

  private async finalCheck(
    path: string,
    kind: "create" | "edit",
    operationId: string,
    context: VaultWriteToolContext
  ): Promise<VaultWriteResult | undefined> {
    if (context.signal?.aborted === true) {
      return {
        ok: false,
        code: "CANCELLED",
        message: "The operation was cancelled before writing.",
      };
    }
    if (this.authorize !== undefined) {
      const allowed = await this.authorize({ path, kind, operationId });
      if (!allowed) {
        return {
          ok: false,
          code: "PERMISSION_DENIED",
          message: "The final gateway check denied this write.",
        };
      }
    }
    return undefined;
  }

  private async resolve(
    requested: string,
    context: VaultWriteToolContext
  ): Promise<ResolvedVaultPath> {
    try {
      const resolved = await this.pathResolver.resolveVaultPath(requested);
      if (context.isPathInScope !== undefined && !context.isPathInScope(resolved.relative)) {
        return outOfScope(requested);
      }
      return { ok: true, value: { relative: resolved.relative, canonical: resolved.canonical } };
    } catch (error) {
      if (error instanceof PathResolverError) {
        if (error.code === "PROTECTED_PATH") {
          return { ok: false, code: "PROTECTED_PATH", message: error.message };
        }
        if (error.code === "INVALID_ARGUMENT") {
          return { ok: false, code: "INVALID_ARGUMENT", message: error.message };
        }
        return outOfScope(requested);
      }
      return { ok: false, code: "READ_FAILED", message: `Cannot resolve "${requested}".` };
    }
  }

  private async readContent(relative: string): Promise<string | null> {
    try {
      return await this.vault.read(relative);
    } catch {
      return null;
    }
  }

  private async readHash(relative: string): Promise<string | null> {
    const content = await this.readContent(relative);
    return content === null ? null : sha256(content);
  }
}

function targetsOf(args: unknown): readonly { kind: "vault_path"; value: string }[] {
  if (typeof args !== "object" || args === null) return [];
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" ? [{ kind: "vault_path", value: path }] : [];
}

function invalid(message: string): VaultWriteResult {
  return { ok: false, code: "INVALID_ARGUMENT", message };
}

function outOfScope(requested: string): ResolvedVaultPath {
  return {
    ok: false,
    code: "PATH_OUT_OF_SCOPE",
    message: `The path "${requested}" is outside the approved Vault scope.`,
  };
}
