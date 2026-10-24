import { sha256 } from "@/utils/hash";

// Crash reconciliation is read-only against the Vault: it compares the ledger's before/after hashes
// with the current content and only fills a missing receipt when the effect already happened. A
// matching before stays re-approvable, anything else becomes needs_reconciliation (never
// overwritten), unsafe operations are never re-executed, and reconciliation never calls a model or
// retries a write:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type RecoveryKind = "write" | "create" | "frontmatter" | "rename" | "trash";

export type RecoveryReplay = "safe" | "unsafe";

export interface RecoveryEntry {
  readonly operationId: string;
  readonly path: string;
  readonly kind: RecoveryKind;
  readonly replay: RecoveryReplay;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
}

export interface RecoveredReceipt {
  readonly operationId: string;
  readonly path: string;
  readonly status: "committed";
  readonly afterHash: string | null;
  readonly recoveredAtMs: number;
}

export interface RecoveryLedger {
  listEntries(): Promise<readonly RecoveryEntry[]>;
  findReceipt(operationId: string): Promise<RecoveredReceipt | undefined>;
  saveReceipt(receipt: RecoveredReceipt): Promise<void>;
}

export interface RecoveryVaultAdapter {
  fileExists(path: string): Promise<boolean>;
  read(path: string): Promise<string | null>;
}

export interface RecoveryOptions {
  readonly ledger: RecoveryLedger;
  readonly vault: RecoveryVaultAdapter;
  readonly now?: () => number;
}

export type RecoveryState = "prepared" | "committed" | "needs_reconciliation" | "unsafe_blocked";

export type RecoveryAction = "reapprove" | "complete_receipt" | "manual" | "none";

export interface RecoveryDecision {
  readonly operationId: string;
  readonly path: string;
  readonly state: RecoveryState;
  readonly action: RecoveryAction;
  readonly canReapprove: boolean;
  readonly canContinue: boolean;
  readonly receiptWritten: boolean;
}

export interface RecoveryResult {
  readonly decisions: readonly RecoveryDecision[];
}

export class MutationRecovery {
  private readonly ledger: RecoveryLedger;
  private readonly vault: RecoveryVaultAdapter;
  private readonly now: () => number;

  constructor(options: RecoveryOptions) {
    this.ledger = options.ledger;
    this.vault = options.vault;
    this.now = options.now ?? Date.now;
  }

  async reconcile(): Promise<RecoveryResult> {
    const decisions: RecoveryDecision[] = [];
    for (const entry of await this.ledger.listEntries()) {
      decisions.push(await this.reconcileEntry(entry));
    }
    return { decisions: Object.freeze(decisions) };
  }

  private async reconcileEntry(entry: RecoveryEntry): Promise<RecoveryDecision> {
    const exists = await this.vault.fileExists(entry.path);
    const current = exists ? await this.vault.read(entry.path) : null;
    const currentHash = current === null ? null : sha256(current);
    const receipt = await this.ledger.findReceipt(entry.operationId);
    if (receipt !== undefined) {
      const consistent = matchesAfter(entry, currentHash);
      return decision(
        entry,
        consistent ? "committed" : "needs_reconciliation",
        consistent ? "none" : "manual",
        false,
        consistent,
        false
      );
    }
    if (matchesAfter(entry, currentHash)) {
      const saved = await this.writeReceipt(entry);
      // 文件一致仍不代表记录已经保存；补存失败必须继续阻挡执行，不能丢失副作用归属：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      return decision(
        entry,
        saved ? "committed" : "needs_reconciliation",
        saved ? "complete_receipt" : "manual",
        false,
        saved,
        saved
      );
    }
    if (matchesBefore(entry, currentHash)) {
      if (entry.replay === "unsafe") {
        return decision(entry, "unsafe_blocked", "manual", false, false, false);
      }
      return decision(entry, "prepared", "reapprove", true, true, false);
    }
    return decision(entry, "needs_reconciliation", "manual", false, false, false);
  }

  private async writeReceipt(entry: RecoveryEntry): Promise<boolean> {
    try {
      await this.ledger.saveReceipt({
        operationId: entry.operationId,
        path: entry.path,
        status: "committed",
        afterHash: entry.afterHash,
        recoveredAtMs: this.now(),
      });
      return true;
    } catch {
      return false;
    }
  }
}

function matchesAfter(entry: RecoveryEntry, currentHash: string | null): boolean {
  if (entry.kind === "create") {
    return entry.afterHash !== null && currentHash !== null && currentHash === entry.afterHash;
  }
  if (entry.kind === "trash") {
    return entry.afterHash === null && currentHash === null;
  }
  return currentHash !== null && entry.afterHash !== null && currentHash === entry.afterHash;
}

function matchesBefore(entry: RecoveryEntry, currentHash: string | null): boolean {
  if (entry.beforeHash === null) return currentHash === null;
  return currentHash !== null && currentHash === entry.beforeHash;
}

function decision(
  entry: RecoveryEntry,
  state: RecoveryState,
  action: RecoveryAction,
  canReapprove: boolean,
  canContinue: boolean,
  receiptWritten: boolean
): RecoveryDecision {
  return {
    operationId: entry.operationId,
    path: entry.path,
    state,
    action,
    canReapprove,
    canContinue,
    receiptWritten,
  };
}
