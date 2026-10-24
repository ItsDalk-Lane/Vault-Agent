import {
  MAX_TODO_TEXT_LENGTH,
  TODO_SET_SCHEMA,
  Todos,
  TodoError,
  type TodoChangedEvent,
  type TodoSetResult,
  type TodoState,
  type TodoStore,
  type TodoStoreCommitInput,
} from "@/agentMode/sdk/pi/features/Todos";

// Todos is versioned and transactional: a stale expectedRevision conflicts without losing the list,
// a replayed tool call returns its committed result without another revision, generated ids stay
// stable for that call, and the same fact projects into the session getter plus the existing plan
// part so the popover shows progress rather than only a TodoWrite tool card:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryTodoStore implements TodoStore {
  state: TodoState;
  readonly results = new Map<string, TodoSetResult>();
  readonly commits: TodoStoreCommitInput[] = [];
  readonly events: TodoChangedEvent[] = [];
  concurrentRevision?: number;
  enforceRevision = true;

  constructor(items: TodoState["items"] = [], revision = 0) {
    this.state = { revision, items: [...items] };
  }

  async read(): Promise<TodoState> {
    return this.state;
  }

  async findResult(callId: string): Promise<TodoSetResult | undefined> {
    return this.results.get(callId);
  }

  async commit(input: TodoStoreCommitInput): Promise<void> {
    if (this.concurrentRevision !== undefined) {
      this.state = { ...this.state, revision: this.concurrentRevision };
      this.concurrentRevision = undefined;
    }
    if (this.enforceRevision && input.expectedRevision !== this.state.revision) {
      throw new TodoError("TODO_REVISION_CONFLICT", "changed", this.state);
    }
    this.commits.push(input);
    this.events.push(input.event);
    this.results.set(input.callId, input.result);
    this.state = input.next;
  }
}

function todo(text: string, status: "pending" | "in_progress" | "completed" = "pending") {
  return { text, status, priority: "medium" as const };
}

describe("Todos", () => {
  describe("setTodos()", () => {
    it("returns TODO_REVISION_CONFLICT with the latest list and writes nothing", async () => {
      const store = new MemoryTodoStore(
        [{ id: "a", text: "existing", status: "pending", priority: "high" }],
        2
      );
      store.enforceRevision = false;
      const todos = new Todos({ store });

      await expect(
        todos.setTodos({ callId: "call-1", expectedRevision: 1, items: [todo("new")] })
      ).rejects.toMatchObject({
        code: "TODO_REVISION_CONFLICT",
        latest: { revision: 2, items: [{ id: "a", text: "existing" }] },
      });
      expect(store.state.items).toEqual([
        { id: "a", text: "existing", status: "pending", priority: "high" },
      ]);
      expect(store.commits).toEqual([]);
    });

    it("returns the committed result for a replayed call without a second revision", async () => {
      const store = new MemoryTodoStore();
      const todos = new Todos({ store });

      const first = await todos.setTodos({
        callId: "call-1",
        expectedRevision: 0,
        items: [todo("read the plan"), todo("write code", "in_progress")],
      });
      const replay = await todos.setTodos({
        callId: "call-1",
        expectedRevision: 0,
        items: [todo("read the plan"), todo("write code", "in_progress")],
      });

      expect(first).toMatchObject({ revision: 1, duplicate: false });
      expect(replay).toMatchObject({ revision: 1, duplicate: true, items: first.items });
      expect(store.state.revision).toBe(1);
      expect(store.commits).toHaveLength(1);
      expect(store.events).toHaveLength(1);
    });

    it("keeps the same list after a restart and a new tool instance", async () => {
      const store = new MemoryTodoStore();
      const first = new Todos({ store });
      const committed = await first.setTodos({
        callId: "call-1",
        expectedRevision: 0,
        items: [todo("one"), todo("two", "completed")],
      });

      const restarted = new Todos({ store });
      const current = await restarted.getCurrent();

      expect(current).toEqual({ revision: committed.revision, items: committed.items });
      expect(restarted.toSessionUpdate(current)).toEqual(first.toSessionUpdate(committed));
      expect(restarted.toPlanEntries(current)).toEqual(first.toPlanEntries(committed));
    });

    it("generates stable host ids and never uses text as the key", async () => {
      const store = new MemoryTodoStore();
      const todos = new Todos({ store });

      const first = await todos.setTodos({
        callId: "call-1",
        expectedRevision: 0,
        items: [todo("same text"), todo("same text")],
      });
      const replay = await todos.setTodos({
        callId: "call-1",
        expectedRevision: 0,
        items: [todo("same text"), todo("same text")],
      });

      expect(first.items).toHaveLength(2);
      expect(first.items[0]?.id).toMatch(/^todo-/);
      expect(first.items[0]?.id).not.toBe(first.items[1]?.id);
      expect(replay.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    });

    it("rejects invented ids with the latest list and explains how to add a new item https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const store = new MemoryTodoStore();
      const todos = new Todos({ store });

      await expect(
        todos.setTodos({
          callId: "call-1",
          expectedRevision: 0,
          items: [{ id: "missing", ...todo("new") }],
        })
      ).rejects.toMatchObject({
        code: "TODO_UNKNOWN_ID",
        latest: { revision: 0 },
        message: expect.stringContaining("omit id"),
      });
      expect(TODO_SET_SCHEMA.properties.items.items.properties.id).toMatchObject({
        description: expect.stringContaining("Omit id"),
      });
    });

    it("validates the item limit, text length and the single in_progress rule", async () => {
      const store = new MemoryTodoStore();
      const todos = new Todos({ store });

      await expect(
        todos.setTodos({
          callId: "call-1",
          expectedRevision: 0,
          items: Array.from({ length: 51 }, (_, index) => todo(`item-${index}`)),
        })
      ).rejects.toMatchObject({ code: "TODO_TOO_MANY_ITEMS" });
      await expect(
        todos.setTodos({
          callId: "call-2",
          expectedRevision: 0,
          items: [todo("x".repeat(MAX_TODO_TEXT_LENGTH + 1))],
        })
      ).rejects.toMatchObject({ code: "TODO_INVALID_ARGUMENT" });
      await expect(
        todos.setTodos({
          callId: "call-3",
          expectedRevision: 0,
          items: [todo("a", "in_progress"), todo("b", "in_progress")],
        })
      ).rejects.toMatchObject({ code: "TODO_MULTIPLE_IN_PROGRESS" });
    });

    it("lets an explicit new list remove a completed item while keeping the history event", async () => {
      const store = new MemoryTodoStore();
      const todos = new Todos({ store });
      const first = await todos.setTodos({
        callId: "call-1",
        expectedRevision: 0,
        items: [todo("one", "completed"), todo("two")],
      });

      await todos.setTodos({
        callId: "call-2",
        expectedRevision: first.revision,
        items: [todo("two", "completed")],
      });

      expect(store.events).toHaveLength(2);
      expect(store.events[0]?.items.map((item) => item.text)).toEqual(["one", "two"]);
      expect(store.state.items.map((item) => item.text)).toEqual(["two"]);
    });

    it("propagates a concurrent revision change at commit time", async () => {
      const store = new MemoryTodoStore();
      store.concurrentRevision = 3;
      const todos = new Todos({ store });

      await expect(
        todos.setTodos({ callId: "call-1", expectedRevision: 0, items: [todo("one")] })
      ).rejects.toMatchObject({ code: "TODO_REVISION_CONFLICT" });
      expect(store.commits).toEqual([]);
    });
  });

  describe("toSessionUpdate()", () => {
    it("projects every item and status so the session getter and plan part are not empty", async () => {
      const store = new MemoryTodoStore();
      const todos = new Todos({ store });
      const result = await todos.setTodos({
        callId: "call-1",
        expectedRevision: 0,
        items: [
          { text: "read the plan", status: "completed", priority: "high" },
          { text: "write code", status: "in_progress", priority: "medium" },
          { text: "run tests", status: "pending", priority: "low" },
        ],
      });

      const update = todos.toSessionUpdate(result);

      expect(update.revision).toBe(result.revision);
      expect(update.items).toEqual([
        {
          id: expect.any(String) as string,
          text: "read the plan",
          status: "completed",
          priority: "high",
        },
        {
          id: expect.any(String) as string,
          text: "write code",
          status: "in_progress",
          priority: "medium",
        },
        { id: expect.any(String) as string, text: "run tests", status: "pending", priority: "low" },
      ]);
      expect(todos.toPlanEntries(result)).toEqual([
        { content: "read the plan", priority: "high", status: "completed" },
        { content: "write code", priority: "medium", status: "in_progress" },
        { content: "run tests", priority: "low", status: "pending" },
      ]);
      expect(result.progress).toEqual({ total: 3, completed: 1, inProgress: 1, pending: 1 });
    });
  });
});
