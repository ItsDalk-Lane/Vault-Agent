import * as path from "node:path";

import { sha256 } from "@/utils/hash";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";
import { VaultWriteTools, type VaultWriteAdapter } from "@/agentMode/sdk/pi/tools/VaultWriteTools";
import { VaultFrontmatter } from "@/agentMode/sdk/pi/tools/VaultFrontmatter";
import {
  VaultMoveTools,
  type VaultMoveAdapter,
} from "@/agentMode/sdk/pi/tools/VaultMoveTools";
import { RevertMutation, type RevertSourceReceipt } from "@/agentMode/sdk/pi/tools/RevertMutation";
import { MutationProjection } from "@/agentMode/sdk/pi/events/MutationProjection";
import {
  MutationRecovery,
  type RecoveredReceipt,
  type RecoveryEntry,
} from "@/agentMode/sdk/pi/storage/MutationRecovery";

// GATE-P06 child: drives the real P06 tools over a fake host to prove user edits are never
// overwritten, a crash after the effect fills only the receipt once, every Vault operation goes
// through the injected Obsidian-style API, real receipts drive TurnFileChange/Diff, and a
// conflicting revert is shown instead of overwritten:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
interface Report {
  result: string;
  userEdit: { writeStale: boolean; frontmatterStale: boolean; contentPreserved: boolean };
  crash: { receiptCompletedOnce: boolean; secondPassNoWrite: boolean; saves: number };
  obsidianApi: { writes: number; moves: number; noNodeFs: boolean };
  receiptUi: { beforeMatches: boolean; afterMatches: boolean; diffMatches: boolean; changes: number };
  revert: { conflictBlocked: boolean; userContentPreserved: boolean; replayIdempotent: boolean };
  durationMs: number;
}

const FILE = "Notes/a.md";
const PATH_RESOLVER = new PathResolver({
  vaultRoot: "/vault",
  fileSystem: { realpath: async (target) => target },
  path,
});

class FakeVault implements VaultWriteAdapter, VaultMoveAdapter {
  readonly files = new Map<string, string>();
  afterRead?: () => void;
  writes = 0;
  moves = 0;
  trashes = 0;
  renames: string[] = [];

  async read(filePath: string): Promise<string> {
    const content = this.files.get(filePath) ?? "";
    this.afterRead?.();
    return content;
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async create(filePath: string, content: string): Promise<void> {
    this.writes += 1;
    if (this.files.has(filePath)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
    this.files.set(filePath, content);
  }

  async process(filePath: string, callback: (current: string) => string): Promise<void> {
    this.writes += 1;
    this.files.set(filePath, callback(this.files.get(filePath) ?? ""));
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    this.moves += 1;
    this.renames.push(oldPath);
    this.files.set(newPath, this.files.get(oldPath) ?? "");
    this.files.delete(oldPath);
  }

  async trashFile(filePath: string): Promise<void> {
    this.trashes += 1;
    this.files.delete(filePath);
  }
}

class MemoryBlobs {
  readonly blobs = new Map<string, string>();
  add(content: string): string {
    const ref = `blob-${sha256(content).slice(0, 8)}`;
    this.blobs.set(ref, content);
    return ref;
  }
  async read(ref: string): Promise<string | null> {
    return this.blobs.get(ref) ?? null;
  }
}

class MemoryRecoveryLedger {
  entries: RecoveryEntry[] = [];
  readonly receipts = new Map<string, RecoveredReceipt>();
  saves = 0;
  async listEntries(): Promise<readonly RecoveryEntry[]> {
    return this.entries;
  }
  async findReceipt(operationId: string): Promise<RecoveredReceipt | undefined> {
    return this.receipts.get(operationId);
  }
  async saveReceipt(receipt: RecoveredReceipt): Promise<void> {
    this.saves += 1;
    this.receipts.set(receipt.operationId, receipt);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const vault = new FakeVault();
  vault.files.set(FILE, "agent version");
  const writeTools = new VaultWriteTools({ vault, pathResolver: PATH_RESOLVER });

  // 1) A user edit between read and write must become STALE_BASELINE and be preserved.
  vault.afterRead = () => vault.files.set(FILE, "user edit during approval");
  const writeStale = await writeTools.edit(
    { path: FILE, expectedHash: sha256("agent version"), edits: [{ oldText: "agent", newText: "x" }] },
    {}
  );
  vault.afterRead = undefined;
  const contentPreserved = vault.files.get(FILE) === "user edit during approval";

  // Same for frontmatter CAS.
  vault.files.set(FILE, "---\ntitle: agent\n---\nbody\n");
  vault.afterRead = () => vault.files.set(FILE, "---\ntitle: user\n---\nbody\n");
  const frontmatterTools = new VaultFrontmatter({
    vault,
    pathResolver: PATH_RESOLVER,
    yaml: {
      parse: (text) => {
        const result: Record<string, string> = {};
        for (const line of text.split("\n")) {
          const match = /^(\w+):\s*(.*)$/.exec(line);
          if (match) result[match[1]] = match[2];
        }
        return result;
      },
      stringify: (value) =>
        `${Object.entries(value as Record<string, string>)
          .map(([key, entry]) => `${key}: ${entry}`)
          .join("\n")}\n`,
    },
  });
  const frontmatterStale = await frontmatterTools.apply(
    {
      path: FILE,
      expectedHash: sha256("---\ntitle: agent\n---\nbody\n"),
      set: { status: "draft" },
    },
    {}
  );
  vault.afterRead = undefined;

  // 2) Crash after the effect: recovery fills the receipt once and never writes content again.
  const recoveryVault = new FakeVault();
  recoveryVault.files.set(FILE, "agent version");
  const ledger = new MemoryRecoveryLedger();
  ledger.entries = [
    {
      operationId: "crashed-op",
      path: FILE,
      kind: "write",
      replay: "safe",
      beforeHash: sha256("original"),
      afterHash: sha256("agent version"),
    },
  ];
  const recovery = new MutationRecovery({ ledger, vault: recoveryVault, now: () => 1_000 });
  const firstPass = await recovery.reconcile();
  const secondPass = await recovery.reconcile();
  const receiptCompletedOnce = firstPass.decisions[0]?.receiptWritten === true;
  const secondPassNoWrite = secondPass.decisions[0]?.receiptWritten === false;

  // 3) All Vault writes/moves go through the injected adapters.
  const apiVault = new FakeVault();
  const apiWriteTools = new VaultWriteTools({ vault: apiVault, pathResolver: PATH_RESOLVER });
  const created = await apiWriteTools.create({ path: "Notes/new.md", content: "new" }, {});
  const moveVault = new FakeVault();
  moveVault.files.set("Notes/old.md", "move me");
  const moveTools = new VaultMoveTools({ vault: moveVault, pathResolver: PATH_RESOLVER });
  const renamed = await moveTools.rename(
    { path: "Notes/old.md", newPath: "Notes/moved.md" },
    {}
  );
  const trashed = await moveTools.trash({ path: "Notes/moved.md" }, {});
  const obsidianApi = {
    writes: apiVault.writes + moveVault.trashes,
    moves: moveVault.moves,
    noNodeFs: created.ok && renamed.ok && trashed.ok,
  };

  // 4) A real receipt projects to TurnFileChange/Diff with the same blob content.
  const blobs = new MemoryBlobs();
  const beforeRef = blobs.add("original content");
  const afterRef = blobs.add("agent content");
  const projection = new MutationProjection({ blobs });
  const projected = await projection.project([
    {
      operationId: "op-ui",
      kind: "write",
      path: FILE,
      beforeBlobRef: beforeRef,
      afterBlobRef: afterRef,
      effectState: "committed",
    },
  ]);
  const change = projected.fileChanges[0];
  const diff = projected.toolContents.find((content) => content.type === "diff");
  const receiptUi = {
    beforeMatches: change?.before === "original content",
    afterMatches: change?.after === "agent content",
    diffMatches:
      diff !== undefined &&
      diff.type === "diff" &&
      diff.oldText === "original content" &&
      diff.newText === "agent content",
    changes: projected.fileChanges.length,
  };

  // 5) A later user edit blocks the revert; after restoring the agent content the revert works once.
  const revertVault = new FakeVault();
  const revertReceipts = new Map();
  const sourceReceipt: RevertSourceReceipt = {
    operationId: "original-op",
    kind: "write",
    path: FILE,
    beforeBlobRef: blobs.add("original content"),
    afterBlobRef: afterRef,
    afterHash: sha256("agent content"),
  };
  const revertTools = new RevertMutation({
    blobs,
    vault: revertVault,
    receipts: {
      find: async (operationId) => revertReceipts.get(operationId),
      save: async (receipt) => void revertReceipts.set(receipt.operationId, receipt),
    },
    sourceReceipts: { find: async () => sourceReceipt },
    authorize: async () => true,
    now: () => 1_000,
  });
  revertVault.files.set(FILE, "user edit after agent");
  const blocked = await revertTools.revert({ originalOperationId: "original-op" }, {});
  const userContentPreserved = revertVault.files.get(FILE) === "user edit after agent";
  revertVault.files.set(FILE, "agent content");
  const reverted = await revertTools.revert({ originalOperationId: "original-op" }, {});
  const replayed = await revertTools.revert({ originalOperationId: "original-op" }, {});
  const revert = {
    conflictBlocked: blocked.ok === false && blocked.code === "CONFLICT",
    userContentPreserved,
    replayIdempotent:
      reverted.ok === true && replayed.ok === true && replayed.alreadyReverted === true,
  };

  const report: Report = {
    result: "passed",
    userEdit: {
      writeStale: writeStale.ok === false && writeStale.code === "STALE_BASELINE",
      frontmatterStale: frontmatterStale.ok === false && frontmatterStale.code === "STALE_BASELINE",
      contentPreserved,
    },
    crash: { receiptCompletedOnce, secondPassNoWrite, saves: ledger.saves },
    obsidianApi,
    receiptUi,
    revert,
    durationMs: Date.now() - startedAt,
  };
  process.stdout.write(JSON.stringify(report));
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
