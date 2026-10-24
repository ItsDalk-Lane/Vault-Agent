import { sha256 } from "@/utils/hash";
import {
  RevertMutation,
  type RevertBlobReader,
  type RevertReceipt,
  type RevertReceiptStore,
  type RevertSourceReceipt,
  type RevertVaultAdapter,
} from "@/agentMode/sdk/pi/tools/RevertMutation";

// Revert is a new approved operation, never a raw fs write: the current content hash must equal
// the original receipt's afterHash, a user edit makes it a conflict that is shown but not
// overwritten, a repeated revert does not write again, created notes are reverted through the
// recycle API, rename side effects only compensate attributable+hash-matching files, and partial
// failures are explicit:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryBlobs implements RevertBlobReader {
  readonly blobs = new Map<string, string>();

  async read(ref: string): Promise<string | null> {
    return this.blobs.get(ref) ?? null;
  }
}

class FakeVault implements RevertVaultAdapter {
  readonly files = new Map<string, string>();
  readonly processed: string[] = [];
  readonly trashed: string[] = [];
  readonly created: string[] = [];
  permanentDeleteCalls = 0;
  failProcessAt?: string;

  async read(filePath: string): Promise<string> {
    return this.files.get(filePath) ?? "";
  }

  async fileExists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async process(filePath: string, callback: (current: string) => string): Promise<void> {
    this.processed.push(filePath);
    if (this.failProcessAt === filePath) throw new Error("process failed");
    const next = callback(this.files.get(filePath) ?? "");
    this.files.set(filePath, next);
  }

  async trashFile(filePath: string): Promise<void> {
    this.trashed.push(filePath);
    this.files.delete(filePath);
  }

  async create(filePath: string, content: string): Promise<void> {
    if (this.files.has(filePath)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
    this.files.set(filePath, content);
    this.created.push(filePath);
  }

  deletePermanently(): void {
    this.permanentDeleteCalls += 1;
  }
}

class MemoryReceipts implements RevertReceiptStore {
  readonly saved: RevertReceipt[] = [];
  readonly byOperation = new Map<string, RevertReceipt>();

  async find(operationId: string): Promise<RevertReceipt | undefined> {
    return this.byOperation.get(operationId);
  }

  async save(receipt: RevertReceipt): Promise<void> {
    this.saved.push(receipt);
    this.byOperation.set(receipt.operationId, receipt);
  }
}

function sourceReceipt(overrides: Partial<RevertSourceReceipt> = {}): RevertSourceReceipt {
  return {
    operationId: "original-op",
    kind: "write",
    path: "Notes/a.md",
    beforeBlobRef: "before-a",
    afterBlobRef: "after-a",
    afterHash: sha256("agent version"),
    ...overrides,
  };
}

interface Harness {
  readonly vault: FakeVault;
  readonly blobs: MemoryBlobs;
  readonly receipts: MemoryReceipts;
  readonly tools: RevertMutation;
  readonly writes: string[];
}

function harness(source: RevertSourceReceipt = sourceReceipt()): Harness {
  const vault = new FakeVault();
  const blobs = new MemoryBlobs();
  const receipts = new MemoryReceipts();
  const writes: string[] = [];
  blobs.blobs.set("before-a", "original version");
  blobs.blobs.set("after-a", "agent version");
  const tools = new RevertMutation({
    blobs,
    vault,
    receipts,
    sourceReceipts: {
      find: async (operationId) => (operationId === source.operationId ? source : undefined),
    },
    authorize: async () => {
      writes.push("authorized");
      return true;
    },
  });
  return { vault, blobs, receipts, tools, writes };
}

describe("RevertMutation", () => {
  describe("revert()", () => {
    it.each(["write", "create", "trash"] as const)(
      "stops a %s rollback when cancellation arrives during baseline or backup reads https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (kind) => {
        const subject = harness(sourceReceipt({ kind }));
        const controller = new AbortController();
        if (kind !== "trash") subject.vault.files.set("Notes/a.md", "agent version");
        if (kind === "trash") {
          const read = subject.blobs.read.bind(subject.blobs);
          jest.spyOn(subject.blobs, "read").mockImplementation(async (ref) => {
            const result = await read(ref);
            controller.abort();
            return result;
          });
        } else {
          const read = subject.vault.read.bind(subject.vault);
          jest.spyOn(subject.vault, "read").mockImplementation(async (target) => {
            const result = await read(target);
            controller.abort();
            return result;
          });
        }
        const result = await subject.tools.revert(
          { originalOperationId: "original-op" },
          { signal: controller.signal }
        );
        expect(result).toMatchObject({ ok: false, code: "CANCELLED" });
        expect(subject.vault.processed).toEqual([]);
        expect(subject.vault.trashed).toEqual([]);
        expect(subject.vault.created).toEqual([]);
        expect(subject.receipts.saved).toEqual([]);
      }
    );
    it("does not overwrite a user edit made after the agent change", async () => {
      const harnessed = harness();
      harnessed.vault.files.set("Notes/a.md", "user edited after agent");

      const result = await harnessed.tools.revert({ originalOperationId: "original-op" }, {});

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ code: "CONFLICT" });
      if (result.ok) return;
      expect(result.conflicts?.[0]).toMatchObject({
        path: "Notes/a.md",
        currentHash: sha256("user edited after agent"),
        expectedHash: sha256("agent version"),
      });
      expect(harnessed.vault.files.get("Notes/a.md")).toBe("user edited after agent");
      expect(harnessed.vault.processed).toEqual([]);
      expect(harnessed.receipts.saved).toEqual([]);
    });

    it("restores the before blob through the CAS process and does not repeat on replay", async () => {
      const harnessed = harness();
      harnessed.vault.files.set("Notes/a.md", "agent version");

      const first = await harnessed.tools.revert({ originalOperationId: "original-op" }, {});
      const second = await harnessed.tools.revert({ originalOperationId: "original-op" }, {});

      expect(first.ok).toBe(true);
      expect(harnessed.vault.files.get("Notes/a.md")).toBe("original version");
      expect(harnessed.vault.processed).toEqual(["Notes/a.md"]);
      expect(harnessed.receipts.saved).toHaveLength(1);
      expect(second).toMatchObject({ ok: true, alreadyReverted: true });
      expect(harnessed.vault.processed).toEqual(["Notes/a.md"]);
    });

    it("reverts a created note through the recycle API instead of permanent delete", async () => {
      const harnessed = harness(
        sourceReceipt({
          kind: "create",
          path: "Notes/new.md",
          beforeBlobRef: null,
          afterBlobRef: "after-new",
          afterHash: sha256("created content"),
        })
      );
      harnessed.vault.files.set("Notes/new.md", "created content");

      const result = await harnessed.tools.revert({ originalOperationId: "original-op" }, {});

      expect(result.ok).toBe(true);
      expect(harnessed.vault.trashed).toEqual(["Notes/new.md"]);
      expect(harnessed.vault.permanentDeleteCalls).toBe(0);
      expect(harnessed.vault.files.has("Notes/new.md")).toBe(false);
      expect(harnessed.receipts.saved[0]).toMatchObject({ mode: "recycle" });
    });

    it("compensates rename files only when every attributable hash matches", async () => {
      const harnessed = harness(
        sourceReceipt({
          kind: "rename",
          path: "Notes/a.md",
          files: [
            {
              path: "Notes/a.md",
              attributable: true,
              beforeBlobRef: "rename-old-a",
              afterHash: sha256("a new"),
            },
            {
              path: "Notes/b.md",
              attributable: false,
              beforeBlobRef: "rename-old-b",
              afterHash: sha256("b new"),
            },
          ],
        })
      );
      harnessed.blobs.blobs.set("rename-old-a", "a old");
      harnessed.blobs.blobs.set("rename-old-b", "b old");
      harnessed.vault.files.set("Notes/a.md", "a new");
      harnessed.vault.files.set("Notes/b.md", "b new");

      const result = await harnessed.tools.revert({ originalOperationId: "original-op" }, {});

      expect(result).toMatchObject({ ok: false, code: "PARTIAL" });
      if (result.ok) return;
      expect(result.compensated).toEqual([]);
      expect(harnessed.vault.processed).toEqual([]);
      expect(harnessed.vault.files.get("Notes/a.md")).toBe("a new");
    });

    it("reports partial compensation explicitly when one file write fails", async () => {
      const harnessed = harness(
        sourceReceipt({
          kind: "rename",
          path: "Notes/a.md",
          files: [
            {
              path: "Notes/a.md",
              attributable: true,
              beforeBlobRef: "rename-old-a",
              afterHash: sha256("a new"),
            },
            {
              path: "Notes/b.md",
              attributable: true,
              beforeBlobRef: "rename-old-b",
              afterHash: sha256("b new"),
            },
          ],
        })
      );
      harnessed.blobs.blobs.set("rename-old-a", "a old");
      harnessed.blobs.blobs.set("rename-old-b", "b old");
      harnessed.vault.files.set("Notes/a.md", "a new");
      harnessed.vault.files.set("Notes/b.md", "b new");
      harnessed.vault.failProcessAt = "Notes/b.md";

      const result = await harnessed.tools.revert({ originalOperationId: "original-op" }, {});

      expect(result).toMatchObject({ ok: false, code: "PARTIAL" });
      if (result.ok) return;
      expect(result.compensated).toEqual(["Notes/a.md"]);
      expect(result.conflicts?.map((conflict) => conflict.path)).toContain("Notes/b.md");
      expect(harnessed.vault.files.get("Notes/a.md")).toBe("a old");
      expect(harnessed.vault.files.get("Notes/b.md")).toBe("b new");
    });

    it("stops rename compensation after the first restored file and keeps an uncertain write distinct from cancellation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const subject = harness(
        sourceReceipt({
          kind: "rename",
          files: [
            {
              path: "Notes/a.md",
              attributable: true,
              beforeBlobRef: "before-a",
              afterHash: sha256("a new"),
            },
            {
              path: "Notes/b.md",
              attributable: true,
              beforeBlobRef: "before-b",
              afterHash: sha256("b new"),
            },
          ],
        })
      );
      subject.vault.files.set("Notes/a.md", "a new");
      subject.vault.files.set("Notes/b.md", "b new");
      subject.blobs.blobs.set("before-b", "b old");
      const controller = new AbortController();
      const process = subject.vault.process.bind(subject.vault);
      jest.spyOn(subject.vault, "process").mockImplementation(async (target, update) => {
        await process(target, update);
        controller.abort();
      });
      expect(
        await subject.tools.revert(
          { originalOperationId: "original-op" },
          { signal: controller.signal }
        )
      ).toMatchObject({ ok: false, code: "CANCELLED", compensated: ["Notes/a.md"], wrote: true });
      expect(subject.vault.processed).toEqual(["Notes/a.md"]);
      expect(subject.vault.files.get("Notes/b.md")).toBe("b new");
      expect(subject.receipts.saved).toEqual([]);

      const unknown = harness();
      unknown.vault.files.set("Notes/a.md", "agent version");
      const stop = new AbortController();
      jest.spyOn(unknown.vault, "process").mockImplementation(async () => {
        stop.abort();
        throw Object.assign(new Error("lost acknowledgement"), { code: "EFFECT_UNKNOWN" });
      });
      expect(
        await unknown.tools.revert({ originalOperationId: "original-op" }, { signal: stop.signal })
      ).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN" });
    });

    it("restores a deleted note only when the target is absent", async () => {
      const harnessed = harness(
        sourceReceipt({
          kind: "trash",
          path: "Notes/deleted.md",
          beforeBlobRef: "deleted-backup",
          afterBlobRef: null,
          afterHash: sha256(""),
        })
      );
      harnessed.blobs.blobs.set("deleted-backup", "deleted content");

      const absent = await harnessed.tools.revert({ originalOperationId: "original-op" }, {});
      expect(absent.ok).toBe(true);
      expect(harnessed.vault.created).toEqual(["Notes/deleted.md"]);
      expect(harnessed.vault.files.get("Notes/deleted.md")).toBe("deleted content");

      const recreated = harness(
        sourceReceipt({
          kind: "trash",
          path: "Notes/deleted.md",
          beforeBlobRef: "deleted-backup",
          afterBlobRef: null,
          afterHash: sha256(""),
        })
      );
      recreated.blobs.blobs.set("deleted-backup", "deleted content");
      recreated.vault.files.set("Notes/deleted.md", "new user file");

      const conflict = await recreated.tools.revert({ originalOperationId: "original-op" }, {});
      expect(conflict).toMatchObject({ ok: false, code: "CONFLICT" });
      expect(recreated.vault.created).toEqual([]);
      expect(recreated.vault.files.get("Notes/deleted.md")).toBe("new user file");
    });

    it("fails closed without approval and cancels before writing", async () => {
      const harnessed = harness();
      harnessed.vault.files.set("Notes/a.md", "agent version");
      const controller = new AbortController();
      controller.abort();

      const noApproval = new RevertMutation({
        blobs: harnessed.blobs,
        vault: harnessed.vault,
        receipts: harnessed.receipts,
        sourceReceipts: { find: async () => sourceReceipt() },
      });
      const cancelled = await harnessed.tools.revert(
        { originalOperationId: "original-op" },
        { signal: controller.signal }
      );

      expect(await noApproval.revert({ originalOperationId: "original-op" }, {})).toMatchObject({
        ok: false,
        code: "APPROVAL_UNAVAILABLE",
      });
      expect(cancelled).toMatchObject({ ok: false, code: "CANCELLED" });
      expect(harnessed.vault.processed).toEqual([]);
    });
  });
});
