import { sha256 } from "@/utils/hash";
import type { AgentPlanEntry, SessionTodoItem, SessionTodoUpdate } from "@/agentMode/session/types";

// Versioned todos live in the va.todos document: every write checks expectedRevision, commits the
// new list plus one va.todos.changed event in the same transaction, and a replayed tool task returns
// its committed result instead of bumping revision again. New item ids are host-generated and stable
// for that call; text is never used as a key. The same fact projects into the session todo getter and
// the existing plan part/PlanPill so the project popover shows real progress:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type TodoStatus = "pending" | "in_progress" | "completed";

export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  readonly id: string;
  readonly text: string;
  readonly status: TodoStatus;
  readonly priority: TodoPriority;
}

export interface TodoState {
  readonly revision: number;
  readonly items: readonly TodoItem[];
}

export interface TodoInputItem {
  readonly id?: string;
  readonly text: string;
  readonly status: TodoStatus;
  readonly priority: TodoPriority;
}

export interface TodoSetInput {
  readonly callId: string;
  readonly expectedRevision: number;
  readonly items: readonly TodoInputItem[];
}

export interface TodoProgress {
  readonly total: number;
  readonly completed: number;
  readonly inProgress: number;
  readonly pending: number;
}

export interface TodoSetResult {
  readonly revision: number;
  readonly items: readonly TodoItem[];
  readonly progress: TodoProgress;
  readonly duplicate: boolean;
}

export interface TodoChangedEvent {
  readonly type: "va.todos.changed";
  readonly revision: number;
  readonly items: readonly TodoItem[];
}

export interface TodoStoreCommitInput {
  readonly callId: string;
  readonly expectedRevision: number;
  readonly next: TodoState;
  readonly event: TodoChangedEvent;
  readonly result: TodoSetResult;
}

export interface TodoStore {
  read(): Promise<TodoState>;
  findResult(callId: string): Promise<TodoSetResult | undefined>;
  commit(input: TodoStoreCommitInput): Promise<void>;
}

export type TodoErrorCode =
  | "TODO_REVISION_CONFLICT"
  | "TODO_INVALID_ARGUMENT"
  | "TODO_UNKNOWN_ID"
  | "TODO_TOO_MANY_ITEMS"
  | "TODO_MULTIPLE_IN_PROGRESS";

export class TodoError extends Error {
  readonly code: TodoErrorCode;
  readonly latest: TodoState | undefined;

  constructor(code: TodoErrorCode, message: string, latest?: TodoState) {
    super(message);
    this.name = "TodoError";
    this.code = code;
    this.latest = latest;
  }
}

export const MAX_TODO_ITEMS = 50;
export const MAX_TODO_TEXT_LENGTH = 500;

export const TODO_SET_SCHEMA = {
  type: "object",
  properties: {
    expectedRevision: {
      type: "integer",
      minimum: 0,
      description:
        "Copy the revision from todo_get. After a conflict, read the latest list and revision before retrying.",
    },
    items: {
      type: "array",
      maxItems: MAX_TODO_ITEMS,
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Copy an existing id from todo_get when updating an item. Omit id for a new item; the host assigns and returns its stable identifier.",
          },
          text: { type: "string", minLength: 1, maxLength: MAX_TODO_TEXT_LENGTH },
          status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["text", "status", "priority"],
        additionalProperties: false,
      },
    },
  },
  required: ["expectedRevision", "items"],
  additionalProperties: false,
} as const;

export class Todos {
  readonly #store: TodoStore;
  readonly #generateId: (callId: string, index: number, text: string) => string;

  constructor(options: {
    store: TodoStore;
    generateId?: (callId: string, index: number, text: string) => string;
  }) {
    this.#store = options.store;
    this.#generateId =
      options.generateId ??
      ((callId, index, text) => `todo-${sha256(`${callId}\0${index}\0${text}`).slice(0, 8)}`);
  }

  async setTodos(input: TodoSetInput): Promise<TodoSetResult> {
    if (typeof input.callId !== "string" || input.callId.length === 0) {
      throw new TodoError("TODO_INVALID_ARGUMENT", "callId is required.");
    }
    const replayed = await this.#store.findResult(input.callId);
    if (replayed !== undefined) {
      return Object.freeze({ ...replayed, duplicate: true });
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new TodoError(
        "TODO_INVALID_ARGUMENT",
        "expectedRevision must be a non-negative integer."
      );
    }
    if (!Array.isArray(input.items)) {
      throw new TodoError("TODO_INVALID_ARGUMENT", "items must be an array.");
    }
    const rawItems: readonly unknown[] = input.items;
    if (rawItems.length > MAX_TODO_ITEMS) {
      throw new TodoError("TODO_TOO_MANY_ITEMS", `At most ${MAX_TODO_ITEMS} todos are allowed.`);
    }
    const state = await this.#store.read();
    if (input.expectedRevision !== state.revision) {
      throw new TodoError(
        "TODO_REVISION_CONFLICT",
        "The todo list changed; read the latest revision and retry.",
        state
      );
    }
    const knownIds = new Set(state.items.map((item) => item.id));
    const usedIds = new Set<string>();
    const items: TodoItem[] = [];
    let inProgress = 0;
    for (let index = 0; index < rawItems.length; index += 1) {
      const rawItem = rawItems[index];
      if (!isRecord(rawItem)) {
        throw new TodoError("TODO_INVALID_ARGUMENT", "Each todo must be an object.");
      }
      const text = typeof rawItem.text === "string" ? rawItem.text.trim() : "";
      if (text.length === 0 || text.length > MAX_TODO_TEXT_LENGTH) {
        throw new TodoError(
          "TODO_INVALID_ARGUMENT",
          `Each todo text must be 1-${MAX_TODO_TEXT_LENGTH} characters.`
        );
      }
      const status = rawItem.status;
      const priority = rawItem.priority;
      if (!isStatus(status) || !isPriority(priority)) {
        throw new TodoError("TODO_INVALID_ARGUMENT", "Todo status or priority is invalid.");
      }
      if (status === "in_progress") inProgress += 1;
      const providedId = rawItem.id;
      if (providedId !== undefined && typeof providedId !== "string") {
        throw new TodoError("TODO_INVALID_ARGUMENT", "Todo id must be a string.");
      }
      let id: string;
      if (providedId !== undefined) {
        if (!knownIds.has(providedId)) {
          throw new TodoError(
            "TODO_UNKNOWN_ID",
            `The id "${providedId}" is not in the current todo list. To add a new item, omit id; to update one, copy its existing id from todo_get.`,
            state
          );
        }
        id = providedId;
      } else {
        id = this.#generateId(input.callId, index, text);
      }
      if (usedIds.has(id)) {
        throw new TodoError("TODO_INVALID_ARGUMENT", `Duplicate todo id "${id}".`);
      }
      usedIds.add(id);
      items.push(Object.freeze({ id, text, status, priority }));
    }
    if (inProgress > 1) {
      throw new TodoError("TODO_MULTIPLE_IN_PROGRESS", "At most one todo may be in_progress.");
    }
    const next: TodoState = Object.freeze({
      revision: state.revision + 1,
      items: Object.freeze(items),
    });
    const result: TodoSetResult = Object.freeze({
      revision: next.revision,
      items: next.items,
      progress: progressOf(next.items),
      duplicate: false,
    });
    await this.#store.commit({
      callId: input.callId,
      expectedRevision: input.expectedRevision,
      next,
      event: Object.freeze({
        type: "va.todos.changed",
        revision: next.revision,
        items: next.items,
      }),
      result,
    });
    return result;
  }

  async getCurrent(): Promise<TodoState> {
    return this.#store.read();
  }

  toSessionUpdate(source: TodoState | TodoSetResult): SessionTodoUpdate {
    return {
      revision: source.revision,
      items: source.items.map(
        (item): SessionTodoItem => ({
          id: item.id,
          text: item.text,
          status: item.status,
          priority: item.priority,
        })
      ),
    };
  }

  toPlanEntries(source: TodoState | TodoSetResult): AgentPlanEntry[] {
    return source.items.map((item) => ({
      content: item.text,
      priority: item.priority,
      status: item.status,
    }));
  }
}

function progressOf(items: readonly TodoItem[]): TodoProgress {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  for (const item of items) {
    if (item.status === "completed") completed += 1;
    else if (item.status === "in_progress") inProgress += 1;
    else pending += 1;
  }
  return { total: items.length, completed, inProgress, pending };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStatus(value: unknown): value is TodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function isPriority(value: unknown): value is TodoPriority {
  return value === "high" || value === "medium" || value === "low";
}
