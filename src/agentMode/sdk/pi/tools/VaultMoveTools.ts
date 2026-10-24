import { sha256 } from "@/utils/hash";
import { PathResolver, PathResolverError } from "@/agentMode/sdk/pi/policy/PathResolver";
import { defineToolManifest, type ToolManifest } from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import {
  LinkedChangeCapture,
  type CapturedFileChange,
  type MoveEventSource,
} from "@/agentMode/sdk/pi/tools/LinkedChangeCapture";

// Rename/trash review both endpoints and inbound-link candidates, use the injected Obsidian
// FileManager/trash APIs (never Node fs and never permanent delete), attribute only the changes
// this operation is expected to make, keep concurrent unknown edits unattributed, record
// partial/effect_unknown instead of auto-retrying, and both tools replay unsafe:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type { MoveEventSource, MoveFileEvent } from "@/agentMode/sdk/pi/tools/LinkedChangeCapture";

export interface VaultMoveAdapter {
  fileExists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  trashFile(path: string): Promise<void>;
}

export interface MoveLinkCache {
  readonly resolvedLinks: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface MoveReceipt {
  readonly operationId: string;
  readonly path: string;
  readonly newPath?: string;
  readonly kind: "rename" | "trash";
  readonly replay: "unsafe";
  readonly safe: false;
  readonly inboundCandidates: readonly string[];
  readonly agentChanges: readonly CapturedFileChange[];
  readonly unattributedChanges: readonly CapturedFileChange[];
  readonly approvalRef?: string;
  readonly committedAtMs: number;
}

export interface MoveReceiptStore {
  save(receipt: MoveReceipt): Promise<void>;
  find(operationId: string): Promise<MoveReceipt | undefined>;
}

export interface VaultMoveContext {
  readonly isPathInScope?: (relativePath: string) => boolean;
  readonly signal?: AbortSignal;
  readonly operationId?: string;
  readonly approvalRef?: string;
}

export interface VaultMoveToolsOptions {
  readonly vault: VaultMoveAdapter;
  readonly pathResolver: PathResolver;
  readonly linkCache?: MoveLinkCache;
  readonly events?: MoveEventSource;
  readonly receipts?: MoveReceiptStore;
  readonly authorize?: (input: {
    readonly kind: "rename" | "trash";
    readonly path: string;
    readonly newPath?: string;
  }) => Promise<boolean>;
  readonly now?: () => number;
}

export type VaultMoveErrorCode =
  | "INVALID_ARGUMENT"
  | "PATH_OUT_OF_SCOPE"
  | "PROTECTED_PATH"
  | "STALE_BASELINE"
  | "ALREADY_EXISTS"
  | "CANCELLED"
  | "PERMISSION_DENIED"
  | "MOVE_FAILED"
  | "TRASH_FAILED"
  | "PARTIAL"
  | "EFFECT_UNKNOWN"
  | "READ_FAILED"
  | "NOT_FOUND"
  | "PATH_RECREATED";

export interface LinkUpdatePreview {
  readonly path: string;
  readonly mayHaveUpdatedLinks: true;
}

export interface RenameSuccess {
  readonly ok: true;
  readonly kind: "rename";
  readonly safe: false;
  readonly oldPath: string;
  readonly newPath: string;
  readonly inboundCandidates: readonly string[];
  readonly linkUpdates: readonly LinkUpdatePreview[];
  readonly agentChanges: readonly CapturedFileChange[];
  readonly unattributedChanges: readonly CapturedFileChange[];
  readonly receipt: MoveReceipt;
}

export interface TrashSuccess {
  readonly ok: true;
  readonly kind: "trash";
  readonly safe: false;
  readonly path: string;
  readonly agentChanges: readonly CapturedFileChange[];
  readonly unattributedChanges: readonly CapturedFileChange[];
  readonly receipt: MoveReceipt;
}

export interface VaultMoveFailure {
  readonly ok: false;
  readonly code: VaultMoveErrorCode;
  readonly message: string;
  readonly partial?: boolean;
  readonly wrote?: boolean;
}

export type VaultMoveResult = RenameSuccess | TrashSuccess | VaultMoveFailure;

export type RollbackTrashResult =
  | { readonly ok: true; readonly status: "already_absent"; readonly deleted: false }
  | {
      readonly ok: false;
      readonly code: "PATH_RECREATED" | "NOT_FOUND" | "INVALID_ARGUMENT";
      readonly message: string;
      readonly deleted: false;
    };

const RENAME_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    newPath: { type: "string", minLength: 1, maxLength: 1_024 },
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
  },
  required: ["path", "newPath"],
  additionalProperties: false,
} as const;

const TRASH_PARAMETERS = {
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
  },
  required: ["path"],
  additionalProperties: false,
} as const;

interface ResolvedMovePath {
  readonly ok: boolean;
  readonly relative?: string;
  readonly code?: VaultMoveErrorCode;
  readonly message?: string;
}

export class VaultMoveTools {
  readonly manifests: readonly ToolManifest[];
  private readonly vault: VaultMoveAdapter;
  private readonly pathResolver: PathResolver;
  private readonly linkCache: MoveLinkCache | undefined;
  private readonly events: MoveEventSource | undefined;
  private readonly receipts: MoveReceiptStore | undefined;
  private readonly authorize: VaultMoveToolsOptions["authorize"];
  private readonly now: () => number;

  constructor(options: VaultMoveToolsOptions) {
    this.vault = options.vault;
    this.pathResolver = options.pathResolver;
    this.linkCache = options.linkCache;
    this.events = options.events;
    this.receipts = options.receipts;
    this.authorize = options.authorize;
    this.now = options.now ?? Date.now;
    this.manifests = Object.freeze([
      defineToolManifest({
        toolId: "vault_rename",
        description:
          "Move or rename a vault note using Obsidian so links can be updated. Pass a vault-relative newPath and the fileVersion from vault_read. Both endpoints and affected notes must be authorized. Partial or unknown results require reconciliation, never blind retries.",
        family: "vault",
        effects: ["rename"],
        parameters: RENAME_PARAMETERS,
        extractTargets: (args) => targetsOf(args, true),
        implementationVersion: 2,
        schemaVersion: 2,
        replayPolicy: "unsafe",
        allowedCallers: ["root", "subagent"],
        maxOutputBytes: 64 * 1_024,
      }),
      defineToolManifest({
        toolId: "vault_trash",
        description:
          "Move a vault note to recoverable trash, never permanently delete it. Use the fileVersion from vault_read when checking an observed note. Requires the current deletion permission; cancellation does not undo an already completed operation.",
        family: "vault",
        effects: ["delete"],
        parameters: TRASH_PARAMETERS,
        extractTargets: (args) => targetsOf(args, false),
        implementationVersion: 2,
        schemaVersion: 2,
        replayPolicy: "unsafe",
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
            manifest.toolId === "vault_rename"
              ? await this.rename(args, context)
              : await this.trash(args, context);
          return { content: JSON.stringify(result), isError: result.ok === false };
        },
      });
    }
  }

  async rename(
    rawArgs: Record<string, unknown>,
    context: VaultMoveContext
  ): Promise<VaultMoveResult> {
    const requestedPath = rawArgs.path;
    const newPath = rawArgs.newPath;
    if (typeof requestedPath !== "string" || requestedPath.length === 0) {
      return invalid("path is required.");
    }
    if (typeof newPath !== "string" || newPath.length === 0) {
      return invalid("newPath is required.");
    }
    const oldResolved = await this.resolve(requestedPath, context);
    if (!oldResolved.ok) return failure(oldResolved);
    const newResolved = await this.resolve(newPath, context);
    if (!newResolved.ok) return failure(newResolved);
    const oldRelative = oldResolved.relative ?? requestedPath;
    const newRelative = newResolved.relative ?? newPath;
    let oldExists: boolean;
    let newExists: boolean;
    try {
      oldExists = await this.vault.fileExists(oldRelative);
      newExists = await this.vault.fileExists(newRelative);
    } catch {
      return {
        ok: false,
        code: "READ_FAILED",
        message: "The Vault could not check the endpoints.",
      };
    }
    if (!oldExists) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `The source "${requestedPath}" does not exist.`,
      };
    }
    if (newExists) {
      return {
        ok: false,
        code: "ALREADY_EXISTS",
        message: `The destination "${newPath}" already exists.`,
      };
    }
    const before = await this.readContent(oldRelative);
    if (before === null) {
      return { ok: false, code: "READ_FAILED", message: `Cannot read "${requestedPath}".` };
    }
    const expectedHash = rawArgs.fileVersion ?? rawArgs.expectedHash;
    if (typeof expectedHash === "string" && sha256(before) !== expectedHash) {
      return {
        ok: false,
        code: "STALE_BASELINE",
        message: "The note changed since it was read; re-read and ask for a fresh diff.",
      };
    }
    const operationId =
      context.operationId ??
      sha256(`rename\0${oldRelative}\0${newRelative}\0${sha256(before)}`).slice(0, 24);
    const inboundCandidates = this.inboundCandidates(oldRelative);
    const baselines = new Map<string, string>([[oldRelative, sha256(before)]]);
    for (const candidate of inboundCandidates) {
      const content = await this.readContent(candidate);
      if (content !== null) baselines.set(candidate, sha256(content));
    }
    const finalCheck = await this.finalCheck("rename", oldRelative, newRelative, context);
    if (finalCheck !== undefined) return finalCheck;

    const capture = this.startCapture(baselines);
    try {
      await this.vault.renameFile(oldRelative, newRelative);
    } catch (error) {
      capture?.dispose();
      const code = (error as { code?: string } | null)?.code;
      const wrote = (error as { wrote?: boolean } | null)?.wrote === true;
      if (code === "EFFECT_UNKNOWN" || code === "STALE_BASELINE" || code === "CANCELLED")
        return {
          ok: false,
          code,
          message:
            code === "EFFECT_UNKNOWN"
              ? "The host effect is unconfirmed; reconcile before any retry."
              : code === "STALE_BASELINE"
                ? "The note changed before execution; re-read and prepare a fresh operation."
                : "The operation was cancelled before execution.",
          ...(code === "EFFECT_UNKNOWN" || wrote ? { wrote: true } : {}),
        };
      const partial = await this.safeFileExists(newRelative);
      return {
        ok: false,
        code: partial ? "PARTIAL" : "MOVE_FAILED",
        message: "The Vault rename failed; reconcile manually instead of retrying.",
        partial,
        ...(wrote ? { wrote: true } : {}),
      };
    }
    const settled = await capture?.stop([oldRelative, newRelative, ...inboundCandidates]);
    const agentChanges = settled?.attributed ?? [];
    const unattributedChanges = settled?.unattributed ?? [];
    const receipt: MoveReceipt = Object.freeze({
      operationId,
      path: oldRelative,
      newPath: newRelative,
      kind: "rename",
      replay: "unsafe",
      safe: false,
      inboundCandidates: Object.freeze([...inboundCandidates]),
      agentChanges: Object.freeze([...agentChanges]),
      unattributedChanges: Object.freeze([...unattributedChanges]),
      ...(context.approvalRef !== undefined ? { approvalRef: context.approvalRef } : {}),
      committedAtMs: this.now(),
    });
    const receiptFailure = await this.saveReceipt(receipt);
    if (receiptFailure !== undefined) return receiptFailure;
    return {
      ok: true,
      kind: "rename",
      safe: false,
      oldPath: oldRelative,
      newPath: newRelative,
      inboundCandidates: Object.freeze([...inboundCandidates]),
      linkUpdates: Object.freeze(
        inboundCandidates.map((candidate) => ({
          path: candidate,
          mayHaveUpdatedLinks: true as const,
        }))
      ),
      agentChanges: Object.freeze([...agentChanges]),
      unattributedChanges: Object.freeze([...unattributedChanges]),
      receipt,
    };
  }

  async trash(
    rawArgs: Record<string, unknown>,
    context: VaultMoveContext
  ): Promise<VaultMoveResult> {
    const requestedPath = rawArgs.path;
    if (typeof requestedPath !== "string" || requestedPath.length === 0) {
      return invalid("path is required.");
    }
    const resolved = await this.resolve(requestedPath, context);
    if (!resolved.ok) return failure(resolved);
    const relative = resolved.relative ?? requestedPath;
    const exists = await this.safeFileExists(relative);
    if (!exists) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `The note "${requestedPath}" does not exist.`,
      };
    }
    const before = await this.readContent(relative);
    if (before === null) {
      return { ok: false, code: "READ_FAILED", message: `Cannot read "${requestedPath}".` };
    }
    const expectedHash = rawArgs.fileVersion ?? rawArgs.expectedHash;
    if (typeof expectedHash === "string" && sha256(before) !== expectedHash) {
      return {
        ok: false,
        code: "STALE_BASELINE",
        message: "The note changed since it was read; re-read and ask for a fresh diff.",
      };
    }
    const operationId =
      context.operationId ?? sha256(`trash\0${relative}\0${sha256(before)}`).slice(0, 24);
    const finalCheck = await this.finalCheck("trash", relative, undefined, context);
    if (finalCheck !== undefined) return finalCheck;
    const capture = this.startCapture(new Map([[relative, sha256(before)]]));
    try {
      await this.vault.trashFile(relative);
    } catch (error) {
      capture?.dispose();
      const code = (error as { code?: string } | null)?.code;
      if (code === "EFFECT_UNKNOWN" || code === "STALE_BASELINE" || code === "CANCELLED")
        return {
          ok: false,
          code,
          message:
            code === "EFFECT_UNKNOWN"
              ? "The host effect is unconfirmed; reconcile before any retry."
              : code === "STALE_BASELINE"
                ? "The note changed before execution; re-read and prepare a fresh operation."
                : "The operation was cancelled before execution.",
          ...(code === "EFFECT_UNKNOWN" ? { wrote: true } : {}),
        };
      return {
        ok: false,
        code: "TRASH_FAILED",
        message: "The Vault recycle operation failed; reconcile manually instead of retrying.",
        partial: await this.safeFileExists(relative),
      };
    }
    const settled = await capture?.stop([relative]);
    const agentChanges = settled?.attributed ?? [];
    const unattributedChanges = settled?.unattributed ?? [];
    const receipt: MoveReceipt = Object.freeze({
      operationId,
      path: relative,
      kind: "trash",
      replay: "unsafe",
      safe: false,
      inboundCandidates: Object.freeze([]),
      agentChanges: Object.freeze([...agentChanges]),
      unattributedChanges: Object.freeze([...unattributedChanges]),
      ...(context.approvalRef !== undefined ? { approvalRef: context.approvalRef } : {}),
      committedAtMs: this.now(),
    });
    const receiptFailure = await this.saveReceipt(receipt);
    if (receiptFailure !== undefined) return receiptFailure;
    return {
      ok: true,
      kind: "trash",
      safe: false,
      path: relative,
      agentChanges: Object.freeze([...agentChanges]),
      unattributedChanges: Object.freeze([...unattributedChanges]),
      receipt,
    };
  }

  async rollbackTrash(
    rawArgs: Record<string, unknown>,
    context: VaultMoveContext
  ): Promise<RollbackTrashResult> {
    const operationId = rawArgs.operationId;
    const requestedPath = rawArgs.path;
    if (typeof operationId !== "string" || operationId.length === 0) {
      return {
        ok: false,
        code: "INVALID_ARGUMENT",
        message: "operationId is required.",
        deleted: false,
      };
    }
    if (typeof requestedPath !== "string" || requestedPath.length === 0) {
      return { ok: false, code: "INVALID_ARGUMENT", message: "path is required.", deleted: false };
    }
    const receipt = await this.receipts?.find(operationId);
    if (receipt === undefined) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `No receipt for "${operationId}".`,
        deleted: false,
      };
    }
    if (receipt.kind !== "trash") {
      return {
        ok: false,
        code: "INVALID_ARGUMENT",
        message: "Only a trash receipt can be rolled back here.",
        deleted: false,
      };
    }
    const resolved = await this.resolve(requestedPath, context);
    if (!resolved.ok) {
      return {
        ok: false,
        code: "INVALID_ARGUMENT",
        message: resolved.message ?? "The path cannot be resolved.",
        deleted: false,
      };
    }
    const relative = resolved.relative ?? requestedPath;
    const exists = await this.safeFileExists(relative);
    if (exists) {
      return {
        ok: false,
        code: "PATH_RECREATED",
        message: "A new file already exists at this path; it is not deleted automatically.",
        deleted: false,
      };
    }
    return { ok: true, status: "already_absent", deleted: false };
  }

  private inboundCandidates(target: string): readonly string[] {
    if (this.linkCache === undefined) return [];
    return Object.entries(this.linkCache.resolvedLinks)
      .filter(([, targets]) => Object.prototype.hasOwnProperty.call(targets, target))
      .map(([source]) => source)
      .sort();
  }

  private startCapture(baselines: ReadonlyMap<string, string>): LinkedChangeCapture | undefined {
    if (this.events === undefined) return undefined;
    const capture = new LinkedChangeCapture({ events: this.events, vault: this.vault });
    capture.start(baselines);
    return capture;
  }

  private async finalCheck(
    kind: "rename" | "trash",
    path: string,
    newPath: string | undefined,
    context: VaultMoveContext
  ): Promise<VaultMoveFailure | undefined> {
    if (context.signal?.aborted === true) {
      return {
        ok: false,
        code: "CANCELLED",
        message: "The operation was cancelled before writing.",
      };
    }
    if (this.authorize !== undefined) {
      const allowed = await this.authorize({
        kind,
        path,
        ...(newPath !== undefined ? { newPath } : {}),
      });
      if (!allowed) {
        return {
          ok: false,
          code: "PERMISSION_DENIED",
          message: "The final gateway check denied this move.",
        };
      }
    }
    return undefined;
  }

  private async saveReceipt(receipt: MoveReceipt): Promise<VaultMoveFailure | undefined> {
    if (this.receipts === undefined) return undefined;
    try {
      await this.receipts.save(receipt);
      return undefined;
    } catch {
      return {
        ok: false,
        code: "EFFECT_UNKNOWN",
        message:
          "The move succeeded but the receipt could not be saved; treat the effect as unknown.",
        wrote: true,
      };
    }
  }

  private async resolve(requested: string, context: VaultMoveContext): Promise<ResolvedMovePath> {
    try {
      const resolved = await this.pathResolver.resolveVaultPath(requested);
      if (context.isPathInScope !== undefined && !context.isPathInScope(resolved.relative)) {
        return {
          ok: false,
          code: "PATH_OUT_OF_SCOPE",
          message: `The path "${requested}" is outside the approved Vault scope.`,
        };
      }
      return { ok: true, relative: resolved.relative };
    } catch (error) {
      if (error instanceof PathResolverError) {
        if (error.code === "PROTECTED_PATH") {
          return { ok: false, code: "PROTECTED_PATH", message: error.message };
        }
        if (error.code === "INVALID_ARGUMENT") {
          return { ok: false, code: "INVALID_ARGUMENT", message: error.message };
        }
        return {
          ok: false,
          code: "PATH_OUT_OF_SCOPE",
          message: `The path "${requested}" is outside the approved Vault scope.`,
        };
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

  private async safeFileExists(relative: string): Promise<boolean> {
    try {
      return await this.vault.fileExists(relative);
    } catch {
      return false;
    }
  }
}

function failure(result: ResolvedMovePath): VaultMoveFailure {
  return {
    ok: false,
    code: result.code ?? "INVALID_ARGUMENT",
    message: result.message ?? "The move is not allowed.",
  };
}

function invalid(message: string): VaultMoveFailure {
  return { ok: false, code: "INVALID_ARGUMENT", message };
}

function targetsOf(
  args: unknown,
  includeDestination: boolean
): readonly { kind: "vault_path"; value: string }[] {
  if (typeof args !== "object" || args === null) return [];
  const { path, newPath } = args as { path?: unknown; newPath?: unknown };
  // 移动的批准清单必须包含目的位置，不能只批准源文件后再临时创建外部目标。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  return [path, ...(includeDestination ? [newPath] : [])]
    .filter((value): value is string => typeof value === "string")
    .map((value) => ({ kind: "vault_path", value }));
}
