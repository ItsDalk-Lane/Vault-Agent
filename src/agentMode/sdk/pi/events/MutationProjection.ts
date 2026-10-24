import type { ToolCallContent, TurnFileChange } from "@/agentMode/session/types";
import { buildTurnFileChange } from "@/agentMode/session/turnFileChanges";

// Receipts are the only source of turn file changes: before/after content comes from the ledger
// blobs, multiple writes to one path in a turn merge into one first-before/last-after change,
// effect_unknown is surfaced as an explicit marker instead of a fabricated rollbackable diff, and
// already committed changes stay visible when the turn is cancelled:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type MutationProjectionEffectState = "committed" | "partial" | "effect_unknown" | "rejected";

export type MutationProjectionKind = "write" | "create" | "frontmatter" | "rename" | "trash";

export interface MutationReceiptForProjection {
  readonly operationId: string;
  readonly kind: MutationProjectionKind;
  readonly path: string;
  readonly newPath?: string;
  readonly beforeBlobRef?: string | null;
  readonly afterBlobRef?: string | null;
  readonly effectState: MutationProjectionEffectState;
  readonly approvalRef?: string;
  readonly occurredAtMs?: number;
}

export interface MutationBlobReader {
  read(ref: string): Promise<string | null>;
}

export interface MutationProjectionOptions {
  readonly blobs: MutationBlobReader;
}

export interface MutationProjectionProjectOptions {
  readonly cancelled?: boolean;
}

export interface MutationProjectionResult {
  readonly fileChanges: readonly TurnFileChange[];
  readonly toolContents: readonly ToolCallContent[];
  readonly unknownPaths: readonly string[];
  readonly partialPaths: readonly string[];
  readonly cancelled: boolean;
}

interface MergedPath {
  firstBeforeRef: string | null | undefined;
  lastAfterRef: string | null | undefined;
  partial: boolean;
  operationIds: string[];
}

export class MutationProjection {
  private readonly blobs: MutationBlobReader;

  constructor(options: MutationProjectionOptions) {
    this.blobs = options.blobs;
  }

  async project(
    receipts: readonly MutationReceiptForProjection[],
    options: MutationProjectionProjectOptions = {}
  ): Promise<MutationProjectionResult> {
    const merged = new Map<string, MergedPath>();
    const unknownPaths: string[] = [];
    const partialPaths: string[] = [];
    for (const receipt of receipts) {
      if (receipt.effectState === "rejected") continue;
      if (receipt.effectState === "effect_unknown") {
        unknownPaths.push(receipt.path);
        continue;
      }
      if (receipt.effectState === "partial") partialPaths.push(receipt.path);
      const existing = merged.get(receipt.path);
      if (existing === undefined) {
        merged.set(receipt.path, {
          firstBeforeRef: receipt.beforeBlobRef,
          lastAfterRef: receipt.afterBlobRef,
          partial: receipt.effectState === "partial",
          operationIds: [receipt.operationId],
        });
      } else {
        existing.lastAfterRef = receipt.afterBlobRef;
        if (!existing.operationIds.includes(receipt.operationId))
          existing.operationIds.push(receipt.operationId);
        if (receipt.effectState === "partial") existing.partial = true;
      }
    }

    const fileChanges: TurnFileChange[] = [];
    for (const [path, entry] of merged) {
      if (entry.firstBeforeRef === undefined || entry.lastAfterRef === undefined) {
        unknownPaths.push(path);
        continue;
      }
      const before = await this.readBlob(entry.firstBeforeRef);
      const after = await this.readBlob(entry.lastAfterRef);
      if (before === undefined || after === undefined) {
        unknownPaths.push(path);
        continue;
      }
      const change = buildTurnFileChange(path, before, after);
      if (change !== null)
        fileChanges.push({ ...change, mutationOperationIds: Object.freeze(entry.operationIds) });
    }

    const toolContents: ToolCallContent[] = [];
    for (const change of fileChanges) {
      toolContents.push({
        type: "diff",
        path: change.path,
        oldText: change.before,
        newText: change.after ?? "",
      });
    }
    for (const path of [...new Set(unknownPaths)]) {
      toolContents.push({
        type: "content",
        content: {
          type: "text",
          text: `Mutation effect unknown for ${path}; review the note manually before retrying.`,
        },
      });
    }
    return {
      fileChanges: Object.freeze(fileChanges),
      toolContents: Object.freeze(toolContents),
      unknownPaths: Object.freeze([...new Set(unknownPaths)]),
      partialPaths: Object.freeze([...new Set(partialPaths)]),
      cancelled: options.cancelled === true,
    };
  }

  private async readBlob(ref: string | null): Promise<string | null | undefined> {
    if (ref === null) return null;
    const content = await this.blobs.read(ref);
    return content === null ? undefined : content;
  }
}
