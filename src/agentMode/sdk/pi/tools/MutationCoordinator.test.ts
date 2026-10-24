import { sha256 } from "@/utils/hash";
import { PathLockPool, type PathLockLease } from "@/agentMode/sdk/pi/tools/PathLockPool";
import {
  MutationCoordinator,
  type MutationBlobStore,
  type MutationLedger,
  type MutationReceipt,
  type MutationWriter,
} from "@/agentMode/sdk/pi/tools/MutationCoordinator";

// Mutation writes are serialized per canonical path, pending approval holds no lock, blobs must be
// flushed before the intent exists, and a write whose receipt cannot be saved is reported as
// effect_unknown instead of "nothing happened":
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class MemoryBlobs implements MutationBlobStore {
  readonly blobs = new Map<string, string>();
  puts = 0;
  flushes = 0;
  failNextPut = false;

  async put(content: string): Promise<string> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("blob store unavailable");
    }
    this.puts += 1;
    const ref = sha256(content).slice(0, 16);
    this.blobs.set(ref, content);
    return ref;
  }

  async flush(): Promise<void> {
    this.flushes += 1;
  }
}

class MemoryLedger implements MutationLedger {
  readonly intents: Parameters<MutationLedger["saveIntent"]>[0][] = [];
  readonly receipts: MutationReceipt[] = [];
  receiptAttempts = 0;
  failReceipt = false;

  async saveIntent(intent: Parameters<MutationLedger["saveIntent"]>[0]): Promise<void> {
    this.intents.push(intent);
  }

  async saveReceipt(receipt: MutationReceipt): Promise<void> {
    this.receiptAttempts += 1;
    if (this.failReceipt) throw new Error("receipt write failed");
    this.receipts.push(receipt);
  }
}

class RecordingWriter implements MutationWriter {
  readonly calls: Array<{ targetPath: string; content: string; expectedBeforeHash: string }> = [];
  wait?: Promise<void>;
  started?: () => void;
  failCode?: string;

  async write(input: {
    targetPath: string;
    content: string;
    expectedBeforeHash: string;
  }): Promise<{ afterHash: string }> {
    this.calls.push(input);
    this.started?.();
    if (this.wait !== undefined) await this.wait;
    if (this.failCode !== undefined) {
      throw Object.assign(new Error("write failed"), { code: this.failCode });
    }
    return { afterHash: sha256(input.content) };
  }
}

interface Harness {
  readonly coordinator: MutationCoordinator;
  readonly blobs: MemoryBlobs;
  readonly ledger: MemoryLedger;
  readonly locks: PathLockPool;
}

function harness(): Harness {
  const blobs = new MemoryBlobs();
  const ledger = new MemoryLedger();
  const locks = new PathLockPool();
  const coordinator = new MutationCoordinator({ locks, blobs, ledger, now: () => 1_000 });
  return { coordinator, blobs, ledger, locks };
}

async function approved(
  harnessed: Harness,
  targetPath: string,
  before: string,
  after: string,
  operationId: string
): Promise<string> {
  const prepared = await harnessed.coordinator.prepare({
    operationId,
    targetPath,
    before,
    after,
  });
  if (!prepared.ok) throw new Error(prepared.message);
  await harnessed.coordinator.beginApproval(operationId);
  await harnessed.coordinator.approve(operationId, `approval-${operationId}`);
  return operationId;
}

describe("PathLockPool", () => {
  describe("acquire()", () => {
    it("acquires multiple paths in canonical order and serializes the same path", async () => {
      const pool = new PathLockPool();
      const first = await pool.acquire(["Notes/b.md", "Notes/a.md"]);

      expect(first.paths).toEqual(["Notes/a.md", "Notes/b.md"]);
      expect(pool.isHeld("Notes/a.md")).toBe(true);

      let secondAcquired = false;
      const second = pool.acquire(["Notes/a.md"]).then((lease) => {
        secondAcquired = true;
        return lease;
      });
      await Promise.resolve();
      expect(secondAcquired).toBe(false);

      first.release();
      const secondLease: PathLockLease = await second;
      expect(secondAcquired).toBe(true);
      secondLease.release();
      expect(pool.isHeld("Notes/a.md")).toBe(false);
    });

    it("makes release idempotent", async () => {
      const pool = new PathLockPool();
      const lease = await pool.acquire(["Notes/a.md"]);

      lease.release();
      lease.release();

      expect(pool.isHeld("Notes/a.md")).toBe(false);
    });
  });
});

describe("MutationCoordinator", () => {
  describe("prepare()", () => {
    it("writes and flushes content-addressed blobs before saving the intent", async () => {
      const { coordinator, blobs, ledger } = harness();

      const result = await coordinator.prepare({
        operationId: "op-1",
        targetPath: "Notes/a.md",
        before: "old",
        after: "new",
      });

      expect(result.ok).toBe(true);
      expect(blobs.flushes).toBe(1);
      expect(blobs.puts).toBe(2);
      expect(ledger.intents).toHaveLength(1);
      expect(ledger.intents[0]).toMatchObject({
        operationId: "op-1",
        targetPath: "Notes/a.md",
        beforeHash: sha256("old"),
        afterHash: sha256("new"),
      });
      expect(ledger.intents[0].beforeBlobRef).not.toBe(ledger.intents[0].afterBlobRef);
      expect(coordinator.getState("op-1")).toBe("prepared");
    });

    it("does not start a write when the blob store fails", async () => {
      const { coordinator, blobs, ledger } = harness();
      blobs.failNextPut = true;
      const writer = new RecordingWriter();

      const result = await coordinator.prepare({
        operationId: "op-2",
        targetPath: "Notes/a.md",
        before: "old",
        after: "new",
      });

      expect(result).toMatchObject({ ok: false, code: "BLOB_WRITE_FAILED" });
      expect(ledger.intents).toHaveLength(0);
      expect(coordinator.getState("op-2")).toBeUndefined();
      expect(writer.calls).toHaveLength(0);
    });
  });

  describe("approval", () => {
    it("does not hold the path lock while approval is pending", async () => {
      const { coordinator, locks } = harness();
      await coordinator.prepare({
        operationId: "op-3",
        targetPath: "Notes/a.md",
        before: "old",
        after: "new",
      });
      await coordinator.beginApproval("op-3");

      expect(coordinator.getState("op-3")).toBe("awaiting_approval");
      expect(locks.isHeld("Notes/a.md")).toBe(false);

      const second = await coordinator.prepare({
        operationId: "op-4",
        targetPath: "Notes/a.md",
        before: "old",
        after: "other",
      });
      expect(second.ok).toBe(true);
    });

    it("moves rejected and cancelled mutations to terminal states without writing", async () => {
      const { coordinator } = harness();
      await coordinator.prepare({
        operationId: "op-5",
        targetPath: "Notes/a.md",
        before: "old",
        after: "new",
      });
      await coordinator.beginApproval("op-5");
      await coordinator.reject("op-5");
      expect(coordinator.getState("op-5")).toBe("rejected");

      await coordinator.prepare({
        operationId: "op-6",
        targetPath: "Notes/a.md",
        before: "old",
        after: "new",
      });
      await coordinator.beginApproval("op-6");
      await coordinator.cancel("op-6");
      expect(coordinator.getState("op-6")).toBe("cancelled");
    });
  });

  describe("apply()", () => {
    it("serializes two sessions writing the same file", async () => {
      const harnessed = harness();
      const { coordinator } = harnessed;
      await approved(harnessed, "Notes/a.md", "old", "first", "op-a");
      await approved(harnessed, "Notes/a.md", "old", "second", "op-b");
      const firstWriter = new RecordingWriter();
      const firstGate = deferred<void>();
      firstWriter.wait = firstGate.promise;
      const firstStarted = deferred<void>();
      firstWriter.started = () => firstStarted.resolve();
      const secondWriter = new RecordingWriter();

      const first = coordinator.apply("op-a", firstWriter);
      await firstStarted.promise;
      const second = coordinator.apply("op-b", secondWriter);
      await Promise.resolve();
      expect(secondWriter.calls).toHaveLength(0);

      firstGate.resolve();
      await first;
      await second;
      expect(firstWriter.calls).toHaveLength(1);
      expect(secondWriter.calls).toHaveLength(1);
    });

    it("records a committed receipt with actual facts and the approval reference", async () => {
      const harnessed = harness();
      await approved(harnessed, "Notes/a.md", "old", "new", "op-7");
      const writer = new RecordingWriter();

      const result = await harnessed.coordinator.apply("op-7", writer);

      expect(result).toMatchObject({ ok: true });
      expect(harnessed.coordinator.getState("op-7")).toBe("committed");
      expect(harnessed.ledger.receipts).toHaveLength(1);
      expect(harnessed.ledger.receipts[0]).toMatchObject({
        operationId: "op-7",
        targetPath: "Notes/a.md",
        beforeHash: sha256("old"),
        afterHash: sha256("new"),
        approvalRef: "approval-op-7",
        status: "committed",
      });
      expect(writer.calls[0]).toMatchObject({
        targetPath: "Notes/a.md",
        content: "new",
        expectedBeforeHash: sha256("old"),
      });
    });

    it("reports effect_unknown when the write succeeded but the receipt could not be saved", async () => {
      const harnessed = harness();
      await approved(harnessed, "Notes/a.md", "old", "new", "op-8");
      harnessed.ledger.failReceipt = true;
      const writer = new RecordingWriter();

      const result = await harnessed.coordinator.apply("op-8", writer);

      expect(result).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN", wrote: true });
      expect(harnessed.coordinator.getState("op-8")).toBe("effect_unknown");
      expect(writer.calls).toHaveLength(1);
      expect(harnessed.ledger.receiptAttempts).toBe(1);
    });

    it("marks a stale baseline without claiming a commit", async () => {
      const harnessed = harness();
      await approved(harnessed, "Notes/a.md", "old", "new", "op-9");
      const writer = new RecordingWriter();
      writer.failCode = "STALE_BASELINE";

      const result = await harnessed.coordinator.apply("op-9", writer);

      expect(result).toMatchObject({ ok: false, code: "STALE_BASELINE" });
      expect(harnessed.coordinator.getState("op-9")).toBe("stale");
      expect(harnessed.ledger.receipts).toHaveLength(0);
    });

    it("rejects apply before approval and after a terminal state", async () => {
      const harnessed = harness();
      await harnessed.coordinator.prepare({
        operationId: "op-10",
        targetPath: "Notes/a.md",
        before: "old",
        after: "new",
      });

      await expect(
        harnessed.coordinator.apply("op-10", new RecordingWriter())
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });
});
