import { sha256 } from "@/utils/hash";
import {
  MutationRecovery,
  type RecoveredReceipt,
  type RecoveryEntry,
  type RecoveryLedger,
  type RecoveryVaultAdapter,
} from "@/agentMode/sdk/pi/storage/MutationRecovery";

// Crash reconciliation compares the ledger's before/after hashes with the current file and only
// fills a missing receipt when the effect already happened; a matching before stays re-approvable,
// an unrecognized current state becomes needs_reconciliation (never overwritten), unsafe operations
// are never re-executed, and reconciliation never calls a model or retries a write:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeRecoveryVault implements RecoveryVaultAdapter {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];

  async fileExists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async read(filePath: string): Promise<string | null> {
    return this.files.get(filePath) ?? null;
  }

  recordWrite(filePath: string): void {
    this.writes.push(filePath);
  }
}

class MemoryLedger implements RecoveryLedger {
  entries: RecoveryEntry[] = [];
  readonly receipts = new Map<string, RecoveredReceipt>();
  readonly saves: RecoveredReceipt[] = [];
  failReceipt = false;

  async listEntries(): Promise<readonly RecoveryEntry[]> {
    return this.entries;
  }

  async findReceipt(operationId: string): Promise<RecoveredReceipt | undefined> {
    return this.receipts.get(operationId);
  }

  async saveReceipt(receipt: RecoveredReceipt): Promise<void> {
    this.saves.push(receipt);
    if (this.failReceipt) throw new Error("receipt storage unavailable");
    this.receipts.set(receipt.operationId, receipt);
  }
}

function entry(overrides: Partial<RecoveryEntry> = {}): RecoveryEntry {
  return {
    operationId: "op-1",
    path: "Notes/a.md",
    kind: "write",
    replay: "safe",
    beforeHash: sha256("old"),
    afterHash: sha256("new"),
    ...overrides,
  };
}

interface Harness {
  readonly vault: FakeRecoveryVault;
  readonly ledger: MemoryLedger;
  readonly tools: MutationRecovery;
}

function harness(entries: RecoveryEntry[] = [entry()]): Harness {
  const vault = new FakeRecoveryVault();
  const ledger = new MemoryLedger();
  ledger.entries = entries;
  const tools = new MutationRecovery({ ledger, vault, now: () => 1_000 });
  return { vault, ledger, tools };
}

describe("MutationRecovery", () => {
  describe("reconcile()", () => {
    it("completes only the missing receipt when the effect already happened", async () => {
      const harnessed = harness();
      harnessed.vault.files.set("Notes/a.md", "new");

      const first = await harnessed.tools.reconcile();
      const second = await harnessed.tools.reconcile();

      expect(first.decisions[0]).toMatchObject({
        operationId: "op-1",
        state: "committed",
        action: "complete_receipt",
        receiptWritten: true,
        canContinue: true,
      });
      expect(harnessed.ledger.saves).toHaveLength(1);
      expect(harnessed.ledger.saves[0]).toMatchObject({
        operationId: "op-1",
        path: "Notes/a.md",
        afterHash: sha256("new"),
      });
      expect(second.decisions[0]).toMatchObject({ action: "none", receiptWritten: false });
      expect(harnessed.ledger.saves).toHaveLength(1);
      expect(harnessed.vault.writes).toEqual([]);
    });

    it("keeps a matching before state re-approvable without writing", async () => {
      const harnessed = harness();
      harnessed.vault.files.set("Notes/a.md", "old");

      const result = await harnessed.tools.reconcile();

      expect(result.decisions[0]).toMatchObject({
        state: "prepared",
        action: "reapprove",
        canReapprove: true,
        canContinue: true,
        receiptWritten: false,
      });
      expect(harnessed.ledger.saves).toEqual([]);
      expect(harnessed.vault.writes).toEqual([]);
    });

    it("blocks continuation when an observed effect cannot be durably receipted https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = harness();
      harnessed.vault.files.set("Notes/a.md", "new");
      harnessed.ledger.failReceipt = true;
      expect((await harnessed.tools.reconcile()).decisions[0]).toMatchObject({
        state: "needs_reconciliation",
        canContinue: false,
        canReapprove: false,
        receiptWritten: false,
      });
      expect(harnessed.vault.files.get("Notes/a.md")).toBe("new");
      expect(harnessed.vault.writes).toEqual([]);
      harnessed.ledger.failReceipt = false;
      expect((await harnessed.tools.reconcile()).decisions[0]).toMatchObject({
        state: "committed",
        canContinue: true,
        receiptWritten: true,
      });
    });

    it("marks an unrecognized current state as needs_reconciliation instead of overwriting", async () => {
      const harnessed = harness();
      harnessed.vault.files.set("Notes/a.md", "user edited");

      const result = await harnessed.tools.reconcile();

      expect(result.decisions[0]).toMatchObject({
        state: "needs_reconciliation",
        action: "manual",
        canContinue: false,
        receiptWritten: false,
      });
      expect(harnessed.vault.files.get("Notes/a.md")).toBe("user edited");
      expect(harnessed.ledger.saves).toEqual([]);
    });

    it("blocks an unsafe prepared operation from being re-executed", async () => {
      const harnessed = harness([entry({ kind: "rename", replay: "unsafe" })]);
      harnessed.vault.files.set("Notes/a.md", "old");

      const result = await harnessed.tools.reconcile();

      expect(result.decisions[0]).toMatchObject({
        state: "unsafe_blocked",
        action: "manual",
        canReapprove: false,
        canContinue: false,
      });
      expect(harnessed.vault.writes).toEqual([]);
    });

    it("treats a created note as prepared when it is still absent", async () => {
      const harnessed = harness([entry({ kind: "create", beforeHash: null, afterHash: null })]);

      const result = await harnessed.tools.reconcile();

      expect(result.decisions[0]).toMatchObject({ state: "prepared", action: "reapprove" });
    });

    it("never calls a model or retries a write during reconciliation", async () => {
      const harnessed = harness([
        entry({ operationId: "op-a" }),
        entry({ operationId: "op-b", path: "Notes/b.md", replay: "unsafe", kind: "trash" }),
      ]);
      harnessed.vault.files.set("Notes/a.md", "new");
      harnessed.vault.files.set("Notes/b.md", "unknown state");

      const result = await harnessed.tools.reconcile();

      expect(result.decisions.map((decision) => decision.action)).toEqual([
        "complete_receipt",
        "manual",
      ]);
      expect("execute" in harnessed.tools).toBe(false);
      expect("retry" in harnessed.tools).toBe(false);
      expect(harnessed.vault.writes).toEqual([]);
    });
  });
});
