import {
  PRODUCT_DOC_KINDS,
  PRODUCT_DOC_VERSION,
  PRODUCT_FORK_POLICIES,
  createProductDoc,
  forkProductDocs,
  parseProductDoc,
  type ProductDoc,
  type ProductDocKind,
} from "./ProductDocs";
import {
  ProductEntryError,
  commitProductDocChange,
  type ProductCommitPort,
  type ProductStateEntry,
} from "./ProductEntries";

// Product state stays reconstructible from versioned docs plus the va.* passive entries
// written in the same commit; forks never inherit approvals or run state:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const NOW = 1700000000000;

function createDocs(): Partial<Record<ProductDocKind, ProductDoc>> {
  return {
    "va.session": createProductDoc("va.session", { now: NOW, rootId: "root-1" }),
    "va.run": createProductDoc("va.run", { now: NOW, runId: "run-1", requestId: "req-1" }),
    "va.todos": createProductDoc("va.todos", { now: NOW }),
    "va.plan": createProductDoc("va.plan", { now: NOW }),
    "va.approvals": createProductDoc("va.approvals", { now: NOW }),
    "va.questions": createProductDoc("va.questions", { now: NOW }),
    "va.mutations": createProductDoc("va.mutations", { now: NOW }),
    "va.subagents": createProductDoc("va.subagents", { now: NOW }),
    "va.fanout": createProductDoc("va.fanout", { now: NOW }),
    "va.skills": createProductDoc("va.skills", { now: NOW }),
    "va.budget": createProductDoc("va.budget", { now: NOW }),
  };
}

describe("ProductDocs", () => {
  it("defines the version 1 kinds from design 04", () => {
    expect(PRODUCT_DOC_VERSION).toBe(1);
    expect([...PRODUCT_DOC_KINDS].sort()).toEqual(
      [
        "va.approvals",
        "va.budget",
        "va.fanout",
        "va.mutations",
        "va.plan",
        "va.questions",
        "va.run",
        "va.session",
        "va.skills",
        "va.subagents",
        "va.todos",
      ].sort()
    );
    expect(Object.keys(PRODUCT_FORK_POLICIES).sort()).toEqual([...PRODUCT_DOC_KINDS].sort());
  });

  describe("createProductDoc()", () => {
    it("creates every kind as a valid version 1 document at revision 1", () => {
      for (const doc of Object.values(createDocs())) {
        expect(doc.version).toBe(PRODUCT_DOC_VERSION);
        expect(doc.revision).toBe(1);
        expect(doc.updatedAtMs).toBe(NOW);
        expect(parseProductDoc(doc)).toEqual({ kind: "ok", doc });
      }
    });

    it("requires the host-minted ids that a session or run document needs", () => {
      expect(() => createProductDoc("va.session", { now: NOW })).toThrow(/rootId/);
      expect(() => createProductDoc("va.run", { now: NOW, runId: "run-1" })).toThrow(/requestId/);
    });
  });

  describe("parseProductDoc()", () => {
    it("accepts every created document", () => {
      for (const doc of Object.values(createDocs())) {
        const parsed = parseProductDoc(doc);
        expect(parsed.kind).toBe("ok");
      }
    });

    it("rejects an unknown kind or malformed document", () => {
      expect(parseProductDoc({ kind: "va.unknown", version: 1 })).toEqual({
        kind: "invalid",
        reason: "unknown-kind",
      });
      expect(parseProductDoc(null)).toEqual({ kind: "invalid", reason: "not-an-object" });
      expect(
        parseProductDoc({ kind: "va.todos", version: 1, revision: 1, updatedAtMs: NOW })
      ).toEqual({ kind: "invalid", reason: "invalid-shape" });
    });

    it("reports an unknown schema version as unsupported instead of guessing", () => {
      expect(
        parseProductDoc({ kind: "va.todos", version: 2, revision: 1, updatedAtMs: NOW, items: [] })
      ).toEqual({ kind: "unsupported", foundVersion: 2 });
    });

    it("rejects a document whose kind does not match the requested shape", () => {
      const session = createDocs()["va.session"] as ProductDoc;
      expect(parseProductDoc({ ...session, rootId: 42 })).toEqual({
        kind: "invalid",
        reason: "invalid-shape",
      });
    });
  });

  describe("forkProductDocs()", () => {
    function populatedParent(): Partial<Record<ProductDocKind, ProductDoc>> {
      const docs = createDocs();
      docs["va.todos"] = {
        ...(docs["va.todos"] as ProductDoc & { kind: "va.todos" }),
        items: [
          { id: "todo-1", text: "first", status: "completed", priority: "high" },
          { id: "todo-2", text: "second", status: "pending", priority: "low" },
        ],
      };
      docs["va.plan"] = {
        ...(docs["va.plan"] as ProductDoc & { kind: "va.plan" }),
        plan: { planId: "plan-1", title: "Plan", body: "Body", permissionGated: true },
        approval: "approved",
        feedback: "looks good",
      };
      docs["va.approvals"] = {
        ...(docs["va.approvals"] as ProductDoc & { kind: "va.approvals" }),
        items: [
          {
            requestId: "req-approval",
            bindingHash: "hash-1",
            state: "approved",
            expiresAtMs: NOW + 1000,
            decidedAtMs: NOW,
            consumedAtMs: NOW,
          },
        ],
      };
      docs["va.questions"] = {
        ...(docs["va.questions"] as ProductDoc & { kind: "va.questions" }),
        items: [{ requestId: "req-question", prompt: "Which?", answers: ["A"], delivered: true }],
      };
      docs["va.mutations"] = {
        ...(docs["va.mutations"] as ProductDoc & { kind: "va.mutations" }),
        items: [
          {
            operationId: "op-1",
            status: "committed",
            files: [{ path: "Notes/A.md", beforeHash: "a", afterHash: "b", status: "modified" }],
            startedAtMs: NOW,
            endedAtMs: NOW,
          },
        ],
      };
      docs["va.subagents"] = {
        ...(docs["va.subagents"] as ProductDoc & { kind: "va.subagents" }),
        items: [
          {
            childConversationId: "conv-child",
            parentConversationId: "conv-parent",
            ownerTaskId: "task-1",
            profileId: "explore",
            status: "completed",
            resultConsumed: false,
          },
        ],
      };
      docs["va.fanout"] = {
        ...(docs["va.fanout"] as ProductDoc & { kind: "va.fanout" }),
        items: [{ candidateId: "candidate-1", status: "evaluated", answerEntryId: "entry-1" }],
      };
      docs["va.skills"] = {
        ...(docs["va.skills"] as ProductDoc & { kind: "va.skills" }),
        selections: [
          {
            skillId: "skill-1",
            contentHash: "sha",
            trust: "trusted",
            sourcePath: "Skills/skill-1",
            verifiedAtMs: NOW,
          },
        ],
      };
      docs["va.budget"] = {
        ...(docs["va.budget"] as ProductDoc & { kind: "va.budget" }),
        spent: { inputTokens: 100, outputTokens: 50, usd: 0.25, unknownCost: false },
        thresholds: { warnAtUsd: 1, stopAtUsd: 2 },
      };
      return docs;
    }

    it("copies fork-safe history: session, todos, mutations, fanout and skills", () => {
      const parent = populatedParent();
      const fork = forkProductDocs(parent, { now: NOW + 500 });
      const parentSession = parent["va.session"] as ProductDoc & { kind: "va.session" };
      const forkSession = fork["va.session"] as (ProductDoc & { kind: "va.session" }) | undefined;
      const forkTodos = fork["va.todos"] as (ProductDoc & { kind: "va.todos" }) | undefined;
      const forkFanout = fork["va.fanout"] as (ProductDoc & { kind: "va.fanout" }) | undefined;
      const forkSkills = fork["va.skills"] as (ProductDoc & { kind: "va.skills" }) | undefined;
      const forkMutations = fork["va.mutations"] as
        | (ProductDoc & { kind: "va.mutations" })
        | undefined;

      expect(forkSession?.rootId).toBe(parentSession.rootId);
      expect(forkTodos?.items).toEqual(
        (parent["va.todos"] as ProductDoc & { kind: "va.todos" }).items
      );
      expect(forkFanout?.items).toEqual(
        (parent["va.fanout"] as ProductDoc & { kind: "va.fanout" }).items
      );
      expect(forkMutations?.items).toEqual(
        (parent["va.mutations"] as ProductDoc & { kind: "va.mutations" }).items
      );
      expect(forkSkills?.selections[0]?.verifiedAtMs).toBeNull();
    });

    it("never inherits one-time authorizations, run state, questions or subagents", () => {
      const parent = populatedParent();
      const fork = forkProductDocs(parent, { now: NOW + 500 });

      expect(fork["va.approvals"]).toBeUndefined();
      expect(fork["va.questions"]).toBeUndefined();
      expect(fork["va.run"]).toBeUndefined();
      expect(fork["va.subagents"]).toBeUndefined();
    });

    it("copies the plan body but resets its approval and feedback", () => {
      const parent = populatedParent();
      const fork = forkProductDocs(parent, { now: NOW + 500 });
      const forkPlan = fork["va.plan"] as ProductDoc & { kind: "va.plan" };

      expect(forkPlan.plan).toEqual((parent["va.plan"] as ProductDoc & { kind: "va.plan" }).plan);
      expect(forkPlan.approval).toBe("unapproved");
      expect(forkPlan.feedback).toBeNull();
    });

    it("starts a fresh budget instead of repeating historical consumption", () => {
      const parent = populatedParent();
      const fork = forkProductDocs(parent, { now: NOW + 500 });
      const forkBudget = fork["va.budget"] as ProductDoc & { kind: "va.budget" };

      expect(forkBudget.spent).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        usd: 0,
        unknownCost: false,
      });
      expect(forkBudget.thresholds).toEqual({ warnAtUsd: 1, stopAtUsd: 2 });
    });
  });
});

describe("ProductEntries", () => {
  interface FakeStore {
    docs: Map<ProductDocKind, ProductDoc>;
    entries: ProductStateEntry[];
    calls: string[];
  }

  function createStore(): FakeStore {
    return { docs: new Map(), entries: [], calls: [] };
  }

  function reader(store: FakeStore) {
    return async (kind: ProductDocKind): Promise<ProductDoc | null> => {
      store.calls.push(`read:${kind}`);
      return store.docs.get(kind) ?? null;
    };
  }

  function committer(store: FakeStore, failWith: Error | null = null): ProductCommitPort {
    return async (change) => {
      store.calls.push(`commit:${change.doc.kind}`);
      if (failWith) throw failWith;
      store.docs.set(change.doc.kind, change.doc);
      store.entries.push(change.entry);
    };
  }

  it("reads the committed state, then writes the document and its va.state entry together", async () => {
    const store = createStore();
    const previous = createProductDoc("va.todos", { now: NOW });
    store.docs.set("va.todos", previous);

    const result = await commitProductDocChange({
      kind: "va.todos",
      reader: reader(store),
      commit: committer(store),
      build: () => ({ ...previous, items: [] }),
      now: () => NOW + 10,
    });

    expect(store.calls).toEqual(["read:va.todos", "commit:va.todos"]);
    expect(result.doc.revision).toBe(previous.revision + 1);
    expect(result.doc.updatedAtMs).toBe(NOW + 10);
    expect(result.entry).toEqual({
      kind: "va.state",
      data: {
        docKind: "va.todos",
        revision: result.doc.revision,
        change: "updated",
        atMs: NOW + 10,
      },
    });
    expect(store.entries).toEqual([result.entry]);
    expect(store.docs.get("va.todos")).toBe(result.doc);
  });

  it("starts a new document at revision 1 with a created entry", async () => {
    const store = createStore();

    const result = await commitProductDocChange({
      kind: "va.todos",
      reader: reader(store),
      commit: committer(store),
      build: () => createProductDoc("va.todos", { now: NOW }),
      now: () => NOW,
    });

    expect(result.doc.revision).toBe(1);
    expect(result.entry.data.change).toBe("created");
    expect(result.entry.data.revision).toBe(1);
  });

  it("leaves no partial state when the commit fails", async () => {
    const store = createStore();
    const previous = createProductDoc("va.plan", { now: NOW });
    store.docs.set("va.plan", previous);

    await expect(
      commitProductDocChange({
        kind: "va.plan",
        reader: reader(store),
        commit: committer(store, new Error("transaction aborted")),
        build: () => ({ ...previous, approval: "approved" }),
        now: () => NOW + 10,
      })
    ).rejects.toThrow("transaction aborted");

    expect(store.docs.get("va.plan")).toBe(previous);
    expect(store.entries).toEqual([]);
  });

  it("rejects a builder that returns a different kind or an invalid shape without committing", async () => {
    const store = createStore();
    store.docs.set("va.todos", createProductDoc("va.todos", { now: NOW }));

    await expect(
      commitProductDocChange({
        kind: "va.todos",
        reader: reader(store),
        commit: committer(store),
        build: () => createProductDoc("va.approvals", { now: NOW }),
        now: () => NOW,
      })
    ).rejects.toBeInstanceOf(ProductEntryError);

    expect(store.calls).toEqual(["read:va.todos"]);
    expect(store.entries).toEqual([]);
  });

  it("propagates a read failure before any write", async () => {
    const store = createStore();

    await expect(
      commitProductDocChange({
        kind: "va.todos",
        reader: async () => {
          throw new Error("storage unavailable");
        },
        commit: committer(store),
        build: () => createProductDoc("va.todos", { now: NOW }),
        now: () => NOW,
      })
    ).rejects.toThrow("storage unavailable");

    expect(store.calls).toEqual([]);
    expect(store.entries).toEqual([]);
  });
});
