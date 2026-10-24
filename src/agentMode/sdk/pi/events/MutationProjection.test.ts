import { diffLines } from "diff";

import {
  MutationProjection,
  type MutationBlobReader,
  type MutationReceiptForProjection,
} from "@/agentMode/sdk/pi/events/MutationProjection";

// MutationProjection turns real mutation receipts into the existing turn-file-change and
// tool-content shapes. before/after come from the ledger blobs, never from model text; receipts
// for the same file in one turn merge into one first-before/last-after change; effect_unknown is
// marked and never faked into a rollbackable diff; committed changes stay visible after a cancel:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryBlobReader implements MutationBlobReader {
  readonly blobs = new Map<string, string>();
  readonly reads: string[] = [];

  async read(ref: string): Promise<string | null> {
    this.reads.push(ref);
    return this.blobs.get(ref) ?? null;
  }
}

function receipt(
  overrides: Partial<MutationReceiptForProjection> &
    Pick<MutationReceiptForProjection, "path" | "effectState">
): MutationReceiptForProjection {
  return {
    operationId: "op-1",
    kind: "write",
    ...overrides,
  };
}

function counts(before: string, after: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(before, after)) {
    if (part.added) additions += part.count ?? 0;
    else if (part.removed) deletions += part.count ?? 0;
  }
  return { additions, deletions };
}

describe("MutationProjection", () => {
  describe("project()", () => {
    it("keeps the committed operation order on a merged file so rollback uses real receipts https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const blobs = new MemoryBlobReader();
      blobs.blobs.set("before", "one");
      blobs.blobs.set("middle", "two");
      blobs.blobs.set("after", "three");
      const projection = new MutationProjection({ blobs });
      const result = await projection.project([
        {
          operationId: "first",
          kind: "write",
          path: "a.md",
          beforeBlobRef: "before",
          afterBlobRef: "middle",
          effectState: "committed",
        },
        {
          operationId: "second",
          kind: "write",
          path: "a.md",
          beforeBlobRef: "middle",
          afterBlobRef: "after",
          effectState: "committed",
        },
        {
          operationId: "second",
          kind: "write",
          path: "a.md",
          beforeBlobRef: "middle",
          afterBlobRef: "after",
          effectState: "committed",
        },
      ]);
      expect(result.fileChanges).toEqual([
        expect.objectContaining({
          before: "one",
          after: "three",
          mutationOperationIds: ["first", "second"],
        }),
      ]);
    });
    it("builds file changes and diff content from the ledger blobs", async () => {
      const blobs = new MemoryBlobReader();
      blobs.blobs.set("before-1", "hello\nworld");
      blobs.blobs.set("after-1", "hello\nvault\nworld");
      const projection = new MutationProjection({ blobs });

      const result = await projection.project([
        receipt({
          path: "Notes/a.md",
          effectState: "committed",
          beforeBlobRef: "before-1",
          afterBlobRef: "after-1",
        }),
      ]);

      expect(result.fileChanges).toHaveLength(1);
      expect(result.fileChanges[0]).toMatchObject({
        path: "Notes/a.md",
        status: "modified",
        before: "hello\nworld",
        after: "hello\nvault\nworld",
        ...counts("hello\nworld", "hello\nvault\nworld"),
      });
      const diffContent = result.toolContents.find((content) => content.type === "diff");
      expect(diffContent).toMatchObject({
        type: "diff",
        path: "Notes/a.md",
        oldText: "hello\nworld",
        newText: "hello\nvault\nworld",
      });
      expect(result.unknownPaths).toEqual([]);
      expect(result.cancelled).toBe(false);
    });

    it("merges multiple receipts for the same path into one first-before/last-after change", async () => {
      const blobs = new MemoryBlobReader();
      blobs.blobs.set("one", "A");
      blobs.blobs.set("two", "A\nB");
      blobs.blobs.set("three", "A\nB\nC");
      const projection = new MutationProjection({ blobs });

      const result = await projection.project([
        receipt({
          path: "Notes/a.md",
          effectState: "committed",
          beforeBlobRef: "one",
          afterBlobRef: "two",
          operationId: "op-1",
        }),
        receipt({
          path: "Notes/a.md",
          effectState: "committed",
          beforeBlobRef: "two",
          afterBlobRef: "three",
          operationId: "op-2",
        }),
      ]);

      expect(result.fileChanges).toHaveLength(1);
      expect(result.fileChanges[0]).toMatchObject({
        before: "A",
        after: "A\nB\nC",
        ...counts("A", "A\nB\nC"),
      });
      expect(result.toolContents.filter((content) => content.type === "diff")).toHaveLength(1);
      expect(result.toolContents.filter((content) => content.type === "diff")[0]).toMatchObject({
        oldText: "A",
        newText: "A\nB\nC",
      });
    });

    it("marks effect_unknown without fabricating a rollbackable diff", async () => {
      const blobs = new MemoryBlobReader();
      blobs.blobs.set("before-u", "old");
      blobs.blobs.set("after-u", "maybe new");
      const projection = new MutationProjection({ blobs });

      const result = await projection.project([
        receipt({
          path: "Notes/unknown.md",
          effectState: "effect_unknown",
          beforeBlobRef: "before-u",
          afterBlobRef: "after-u",
        }),
      ]);

      expect(result.fileChanges).toEqual([]);
      expect(result.unknownPaths).toEqual(["Notes/unknown.md"]);
      expect(result.toolContents).toHaveLength(1);
      const content = result.toolContents[0];
      expect(content.type).toBe("content");
      if (content.type === "content") expect(content.content.text).toContain("effect unknown");
    });

    it("keeps committed changes visible after a cancelled turn", async () => {
      const blobs = new MemoryBlobReader();
      blobs.blobs.set("before-c", "one");
      blobs.blobs.set("after-c", "two");
      const projection = new MutationProjection({ blobs });

      const result = await projection.project(
        [
          receipt({
            path: "Notes/a.md",
            effectState: "committed",
            beforeBlobRef: "before-c",
            afterBlobRef: "after-c",
          }),
        ],
        { cancelled: true }
      );

      expect(result.cancelled).toBe(true);
      expect(result.fileChanges).toHaveLength(1);
      expect(result.fileChanges[0]).toMatchObject({ before: "one", after: "two" });
    });

    it("reports created and deleted statuses from the blob presence", async () => {
      const blobs = new MemoryBlobReader();
      blobs.blobs.set("new-only", "new content");
      blobs.blobs.set("old-only", "old content");
      const projection = new MutationProjection({ blobs });

      const created = await projection.project([
        receipt({
          path: "Notes/new.md",
          kind: "create",
          effectState: "committed",
          beforeBlobRef: null,
          afterBlobRef: "new-only",
        }),
      ]);
      const deleted = await projection.project([
        receipt({
          path: "Notes/old.md",
          kind: "trash",
          effectState: "committed",
          beforeBlobRef: "old-only",
          afterBlobRef: null,
        }),
      ]);

      expect(created.fileChanges[0]).toMatchObject({
        status: "created",
        before: null,
        after: "new content",
      });
      expect(deleted.fileChanges[0]).toMatchObject({
        status: "deleted",
        before: "old content",
        after: null,
      });
    });

    it("marks a missing ledger blob as unknown instead of inventing content", async () => {
      const blobs = new MemoryBlobReader();
      const projection = new MutationProjection({ blobs });

      const result = await projection.project([
        receipt({
          path: "Notes/missing.md",
          effectState: "committed",
          beforeBlobRef: "missing-before",
          afterBlobRef: "missing-after",
        }),
      ]);

      expect(result.fileChanges).toEqual([]);
      expect(result.unknownPaths).toEqual(["Notes/missing.md"]);
      expect(blobs.reads).toEqual(["missing-before", "missing-after"]);
    });
  });
});
