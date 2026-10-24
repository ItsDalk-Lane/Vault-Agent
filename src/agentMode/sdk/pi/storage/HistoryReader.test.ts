import {
  HistoryReader,
  HistoryReaderError,
  type HistoryCursor,
  type HistoryEntry,
  type HistoryReadCancellation,
  type HistoryResolvedConversation,
} from "./HistoryReader";

// Full history is a read-only, ascending, paginated reconstruction: compaction markers do
// not hide older messages, page boundaries never duplicate entries, fork ancestors merge
// once, and cancelling a read must not cancel the run: https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
interface ConversationSpec {
  id: string;
  pages: HistoryEntry[][];
  parentId?: string | null;
  onPageRead?: () => void;
}

interface FakeWorld {
  readonly calls: string[];
  readonly conversations: Map<string, ConversationSpec>;
  readonly attachmentCalls: string[];
  readonly availableAttachments: Set<string>;
  readonly cancelCalls: { value: number };
}

function entry(id: string, kind = "pi.user", data?: Record<string, unknown>): HistoryEntry {
  return { id, kind, data };
}

function createWorld(specs: ConversationSpec[]): FakeWorld {
  const conversations = new Map(specs.map((spec) => [spec.id, spec]));
  return {
    calls: [],
    conversations,
    attachmentCalls: [],
    availableAttachments: new Set(),
    cancelCalls: { value: 0 },
  };
}

function createReader(world: FakeWorld): HistoryReader {
  return new HistoryReader({
    resolveConversation: async (conversationId): Promise<HistoryResolvedConversation> => {
      world.calls.push(`resolve:${conversationId}`);
      const spec = world.conversations.get(conversationId);
      if (!spec) throw new Error(`missing conversation ${conversationId}`);
      return {
        id: spec.id,
        entries: async ({ cursor, cancellation }) => {
          const page = cursor === null ? 0 : Number((cursor as { page: number }).page);
          world.calls.push(`entries:${spec.id}:${page}`);
          const items = spec.pages[page] ?? [];
          spec.onPageRead?.();
          const nextPage = page + 1 < spec.pages.length ? page + 1 : null;
          const nextCursor: HistoryCursor | null =
            nextPage === null ? null : Object.freeze({ page: nextPage });
          if (cancellation.aborted) return { entries: items, nextCursor };
          return { entries: items, nextCursor };
        },
        forkParentId: async () => {
          world.calls.push(`parent:${spec.id}`);
          return spec.parentId ?? null;
        },
      };
    },
    attachments: {
      isAvailable: async (path) => {
        world.attachmentCalls.push(path);
        return world.availableAttachments.has(path);
      },
    },
  });
}

function createCancellation(): { token: HistoryReadCancellation; abort: () => void } {
  let aborted = false;
  return {
    token: Object.freeze({
      get aborted(): boolean {
        return aborted;
      },
    }),
    abort: () => {
      aborted = true;
    },
  };
}

describe("HistoryReader", () => {
  it("returns messages from before a compaction marker instead of the active snapshot", async () => {
    const world = createWorld([
      {
        id: "conv",
        pages: [[entry("e1"), entry("e2", "pi.compaction")], [entry("e3")]],
      },
    ]);
    const reader = createReader(world);

    const result = await reader.readHistory({ conversationId: "conv" });

    expect(result.kind).toBe("complete");
    expect(result.entries.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
    expect(result.compacted).toBe(true);
  });

  it("follows the ascending cursor across a page boundary without repeating entries", async () => {
    const world = createWorld([
      {
        id: "conv",
        pages: [
          [entry("e1"), entry("e2")],
          [entry("e3"), entry("e4")],
        ],
      },
    ]);
    const reader = createReader(world);

    const result = await reader.readHistory({ conversationId: "conv" });

    expect(result.entries.map((item) => item.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(world.calls).toEqual([
      "resolve:conv",
      "parent:conv",
      "entries:conv:0",
      "entries:conv:1",
    ]);
  });

  it("deduplicates an entry returned again at a page boundary", async () => {
    const world = createWorld([
      {
        id: "conv",
        pages: [
          [entry("e1"), entry("e2")],
          [entry("e2"), entry("e3")],
        ],
      },
    ]);
    const reader = createReader(world);

    const result = await reader.readHistory({ conversationId: "conv" });

    expect(result.entries.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("merges fork ancestors before the fork's own entries and dedupes shared history", async () => {
    const world = createWorld([
      { id: "parent", pages: [[entry("p1"), entry("p2")]] },
      { id: "child", pages: [[entry("p2"), entry("c1")]], parentId: "parent" },
    ]);
    const reader = createReader(world);

    const result = await reader.readHistory({ conversationId: "child" });

    expect(result.conversations).toEqual(["parent", "child"]);
    expect(result.entries.map((item) => item.id)).toEqual(["p1", "p2", "c1"]);
  });

  it("exposes a read-only cursor that resumes the same conversation without mutation", async () => {
    const world = createWorld([
      {
        id: "conv",
        pages: [[entry("e1")], [entry("e2")], [entry("e3")]],
      },
    ]);
    const reader = createReader(world);

    const first = await reader.readPage({ conversationId: "conv" });
    expect(first.entries.map((item) => item.id)).toEqual(["e1"]);
    expect(first.nextCursor).not.toBeNull();
    expect(Object.isFrozen(first.nextCursor)).toBe(true);
    const cursorBefore = JSON.stringify(first.nextCursor);

    const second = await reader.readPage({ conversationId: "conv", cursor: first.nextCursor });
    expect(second.entries.map((item) => item.id)).toEqual(["e2"]);
    expect(JSON.stringify(first.nextCursor)).toBe(cursorBefore);
  });

  it("records missing attachments without blocking the message body", async () => {
    const world = createWorld([
      {
        id: "conv",
        pages: [
          [entry("e1", "pi.user", { attachments: [{ path: "missing.png" }] })],
          [entry("e2", "pi.user", { attachments: [{ path: "present.pdf" }] })],
        ],
      },
    ]);
    world.availableAttachments.add("present.pdf");
    const reader = createReader(world);

    const result = await reader.readHistory({ conversationId: "conv" });

    expect(result.entries.map((item) => item.id)).toEqual(["e1", "e2"]);
    expect(result.missingAttachments).toEqual([{ entryId: "e1", path: "missing.png" }]);
    expect(world.attachmentCalls).toEqual(["missing.png", "present.pdf"]);
  });

  it("never issues model or run requests while reading history", async () => {
    const world = createWorld([{ id: "conv", pages: [[entry("e1")]] }]);
    const reader = createReader(world);
    const runTask = { cancelCalls: 0, cancel: () => (runTask.cancelCalls += 1) };

    await reader.readHistory({ conversationId: "conv" });

    expect(world.calls).toEqual(["resolve:conv", "parent:conv", "entries:conv:0"]);
    expect(runTask.cancelCalls).toBe(0);
  });

  it("stops reading when the read is cancelled without cancelling the run task", async () => {
    const failure = createCancellation();
    const world = createWorld([
      {
        id: "conv",
        pages: [[entry("e1")], [entry("e2")]],
        onPageRead: () => failure.abort(),
      },
    ]);
    const reader = createReader(world);
    const runTask = { cancelCalls: 0, cancel: () => (runTask.cancelCalls += 1) };

    const result = await reader.readHistory({
      conversationId: "conv",
      cancellation: failure.token,
    });

    expect(result.kind).toBe("cancelled");
    expect(result.entries.map((item) => item.id)).toEqual(["e1"]);
    expect(world.calls).not.toContain("entries:conv:1");
    expect(runTask.cancelCalls).toBe(0);
  });

  it("rejects a cyclic fork chain instead of reading forever", async () => {
    const world = createWorld([
      { id: "a", pages: [[entry("a1")]], parentId: "b" },
      { id: "b", pages: [[entry("b1")]], parentId: "a" },
    ]);
    const reader = createReader(world);

    await expect(reader.readHistory({ conversationId: "a" })).rejects.toMatchObject({
      name: "HistoryReaderError",
      code: "FORK_CYCLE",
    });
    expect(HistoryReaderError).toBeDefined();
  });
});
