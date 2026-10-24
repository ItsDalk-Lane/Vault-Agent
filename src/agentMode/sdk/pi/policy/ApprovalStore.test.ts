import {
  ApprovalStore,
  type ApprovalBindingInput,
  type ApprovalPersistence,
  type ApprovalRequest,
  type ApprovalState,
  type BindingSnapshot,
} from "@/agentMode/sdk/pi/policy/ApprovalStore";
import {
  PermissionRuleError,
  PermissionRules,
  type PermissionRuleInput,
} from "@/agentMode/sdk/pi/policy/PermissionRules";

// Approval bindings are hashes of the exact call: changing arguments, schema, targets, baseline,
// policy or scope invalidates an earlier approval, the once approval expires after ten minutes,
// only option ids from the real prompt are accepted, and consuming an allow_once writes its intent
// in the same commit so it cannot be used twice:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const OPTIONS = [
  { optionId: "allow-once", kind: "allow_once" as const },
  { optionId: "allow-always", kind: "allow_always" as const },
  { optionId: "reject", kind: "reject_once" as const },
];

function bindingInput(overrides: Partial<ApprovalBindingInput> = {}): ApprovalBindingInput {
  return {
    approvalId: "approval-1",
    toolId: "vault_write",
    schemaHash: "schema-1",
    arguments: { path: "Notes/a.md", text: "new" },
    targets: ["/vault/Notes/a.md"],
    beforeHash: "before-1",
    scopeVersion: 3,
    policyVersion: 5,
    ...overrides,
  };
}

function snapshot(overrides: Partial<BindingSnapshot> = {}): BindingSnapshot {
  const input = bindingInput();
  return {
    schemaHash: input.schemaHash,
    arguments: input.arguments,
    targets: input.targets,
    beforeHash: input.beforeHash,
    scopeVersion: input.scopeVersion,
    policyVersion: input.policyVersion,
    ...overrides,
  };
}

class MemoryPersistence implements ApprovalPersistence {
  state: ApprovalState | null = null;
  readonly saves: ApprovalState[] = [];

  async load(): Promise<ApprovalState | null> {
    return this.state;
  }

  async save(state: ApprovalState): Promise<void> {
    const copy = JSON.parse(JSON.stringify(state)) as ApprovalState;
    this.state = copy;
    this.saves.push(copy);
  }
}

async function allowedRequest(
  store: ApprovalStore,
  overrides: Partial<ApprovalBindingInput> = {}
): Promise<ApprovalRequest> {
  const request = await store.createRequest(bindingInput(overrides), OPTIONS);
  await store.decide(request, "allow-once");
  return request;
}

describe("ApprovalStore", () => {
  describe("createRequest()", () => {
    it("persists the original pending request so opening history can show it without granting permission https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const persistence = new MemoryPersistence();
      const store = new ApprovalStore({ now: () => 1000, persistence });
      const request = await store.createRequest(bindingInput(), OPTIONS);
      expect(persistence.state).toMatchObject({ requests: { "approval-1": request } });
      const reopened = new ApprovalStore({ now: () => 2000, persistence });
      await reopened.load();
      expect(reopened.status("approval-1", snapshot())).toBe("pending");
      expect(reopened.peek("approval-1")).toBeUndefined();
    });
    it("binds the exact arguments, schema, targets, baseline, policy and scope with a ten minute TTL", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });

      const request = await store.createRequest(bindingInput(), OPTIONS);

      expect(request.binding).toMatchObject({
        approvalId: "approval-1",
        toolId: "vault_write",
        schemaHash: "schema-1",
        targets: ["/vault/Notes/a.md"],
        scopeVersion: 3,
        policyVersion: 5,
        expiresAtMs: 1_000 + 10 * 60 * 1_000,
      });
      expect(request.binding.argumentsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(request.binding.bindingHash).toMatch(/^[0-9a-f]{64}$/);
      expect(request.options).toEqual(OPTIONS);
    });
  });

  describe("decide()", () => {
    it("rejects an option id that was not part of the real prompt", async () => {
      const persistence = new MemoryPersistence();
      const store = new ApprovalStore({ now: () => 1_000, persistence });
      const request = await store.createRequest(bindingInput(), OPTIONS);

      await expect(store.decide(request, "fabricated")).rejects.toMatchObject({
        code: "UNKNOWN_OPTION",
      });
      expect(persistence.saves).toHaveLength(1);
      expect(store.peek("approval-1")).toBeUndefined();
    });

    it("does not grant permission in memory when saving the decision fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const persistence = new MemoryPersistence();
      const store = new ApprovalStore({ now: () => 1000, persistence });
      const request = await store.createRequest(bindingInput(), OPTIONS);
      jest.spyOn(persistence, "save").mockRejectedValue(new Error("disk full"));
      await expect(store.decide(request, "allow-once")).rejects.toThrow("disk full");
      expect(store.status("approval-1", snapshot())).toBe("pending");
      expect(store.peek("approval-1")).toBeUndefined();
    });

    it("stores a rejection and never lets it be consumed", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      const request = await store.createRequest(bindingInput(), OPTIONS);

      await store.decide(request, "reject");

      expect(store.status("approval-1", snapshot())).toBe("rejected");
      await expect(store.consumeOnce("approval-1", snapshot(), "intent-1")).rejects.toMatchObject({
        code: "APPROVAL_REJECTED",
      });
    });
  });

  describe("status()", () => {
    it("invalidates the approval when any bound fact changes", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      await allowedRequest(store);

      expect(store.status("approval-1", snapshot())).toBe("allowed");
      expect(store.status("approval-1", snapshot({ arguments: { path: "Notes/b.md" } }))).toBe(
        "stale"
      );
      expect(store.status("approval-1", snapshot({ schemaHash: "schema-2" }))).toBe("stale");
      expect(store.status("approval-1", snapshot({ targets: ["/vault/Notes/b.md"] }))).toBe(
        "stale"
      );
      expect(store.status("approval-1", snapshot({ beforeHash: "before-2" }))).toBe("stale");
      expect(store.status("approval-1", snapshot({ scopeVersion: 4 }))).toBe("stale");
      expect(store.status("approval-1", snapshot({ policyVersion: 6 }))).toBe("stale");
    });

    it("requires a new request after the ten minute window", async () => {
      let now = 1_000;
      const store = new ApprovalStore({ now: () => now });
      await allowedRequest(store);

      now = 1_000 + 10 * 60 * 1_000 + 1;
      expect(store.status("approval-1", snapshot())).toBe("expired");
      await expect(store.consumeOnce("approval-1", snapshot(), "intent-1")).rejects.toMatchObject({
        code: "APPROVAL_EXPIRED",
      });
    });

    it("reports missing approvals instead of assuming permission", () => {
      const store = new ApprovalStore({ now: () => 1_000 });

      expect(store.status("approval-1", snapshot())).toBe("missing");
    });
  });

  describe("consumeOnce()", () => {
    it("writes the intent together with the consumption and refuses a second use", async () => {
      const persistence = new MemoryPersistence();
      const store = new ApprovalStore({ now: () => 1_000, persistence });
      await allowedRequest(store);

      const first = await store.consumeOnce("approval-1", snapshot(), "intent-1");

      expect(first).toMatchObject({ consumed: true, intentId: "intent-1" });
      expect(persistence.saves).toHaveLength(3);
      expect(persistence.state?.decisions["approval-1"]).toMatchObject({
        consumed: true,
        intentId: "intent-1",
      });

      await expect(store.consumeOnce("approval-1", snapshot(), "intent-2")).rejects.toMatchObject({
        code: "APPROVAL_CONSUMED",
      });
      expect(persistence.saves).toHaveLength(3);
    });

    it("consumes an approved intent once across concurrent callers and keeps a failed consumption unconsumed https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const persistence = new MemoryPersistence();
      const store = new ApprovalStore({ now: () => 1000, persistence });
      await allowedRequest(store);
      const save = jest.spyOn(persistence, "save").mockRejectedValueOnce(new Error("disk full"));
      await expect(store.consumeOnce("approval-1", snapshot(), "failed")).rejects.toThrow(
        "disk full"
      );
      expect(store.status("approval-1", snapshot())).toBe("allowed");
      save.mockRestore();
      const results = await Promise.allSettled([
        store.consumeOnce("approval-1", snapshot(), "intent-a"),
        store.consumeOnce("approval-1", snapshot(), "intent-b"),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({ code: "APPROVAL_CONSUMED" }) }),
      ]);
    });

    it("rejects a changed call even when the approval id is known", async () => {
      const store = new ApprovalStore({ now: () => 1_000 });
      await allowedRequest(store);

      await expect(
        store.consumeOnce("approval-1", snapshot({ arguments: { path: "Notes/evil.md" } }), "i-1")
      ).rejects.toMatchObject({ code: "APPROVAL_STALE" });
    });
  });

  describe("load()", () => {
    it("revalidates persisted bindings after a restart", async () => {
      const persistence = new MemoryPersistence();
      const first = new ApprovalStore({ now: () => 1_000, persistence });
      await allowedRequest(first);

      const restarted = new ApprovalStore({ now: () => 2_000, persistence });
      await restarted.load();

      expect(restarted.status("approval-1", snapshot())).toBe("allowed");
      expect(restarted.status("approval-1", snapshot({ arguments: { path: "x" } }))).toBe("stale");
      await restarted.consumeOnce("approval-1", snapshot(), "intent-1");
      expect(restarted.status("approval-1", snapshot())).toBe("consumed");
    });
  });
});

function rule(overrides: Partial<PermissionRuleInput> = {}): PermissionRuleInput {
  return {
    id: "rule-1",
    decision: "allow",
    scopeId: "project-1",
    family: "vault",
    effect: "write",
    toolId: "vault_write",
    root: "/vault/Notes",
    createdBy: "user",
    ...overrides,
  };
}

function ruleErrorCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof PermissionRuleError ? error.code : undefined;
  }
}

describe("PermissionRules", () => {
  describe("addRule()", () => {
    it("accepts only the supported long-term allow combinations", () => {
      const rules = new PermissionRules({ now: () => 1_000 });

      expect(() => rules.addRule(rule())).not.toThrow();
      expect(() =>
        rules.addRule(rule({ id: "external-read", family: "native_file", effect: "read" }))
      ).not.toThrow();

      for (const unsupported of [
        rule({ id: "delete", effect: "delete" }),
        rule({ id: "rename", effect: "rename" }),
        rule({ id: "mcp", family: "mcp", effect: "network" }),
        rule({ id: "host", family: "host_process", effect: "execute" }),
      ]) {
        expect(ruleErrorCode(() => rules.addRule(unsupported))).toBe("INVALID_RULE");
      }
    });

    it("requires a user creator and a precise root or path", () => {
      const rules = new PermissionRules({ now: () => 1_000 });

      expect(ruleErrorCode(() => rules.addRule(rule({ createdBy: "skill" as never })))).toBe(
        "INVALID_RULE"
      );
      expect(
        ruleErrorCode(() => rules.addRule(rule({ root: undefined, exactPath: undefined })))
      ).toBe("INVALID_RULE");
      expect(() =>
        rules.addRule(rule({ id: "exact", root: undefined, exactPath: "/vault/Notes/a.md" }))
      ).not.toThrow();
    });
  });

  describe("findRule()", () => {
    it("lets a deny rule win and ignores expired rules", () => {
      const rules = new PermissionRules({ now: () => 1_000 });
      rules.addRule(rule({ id: "allow", decision: "allow" }));
      rules.addRule(rule({ id: "deny", decision: "deny" }));
      rules.addRule(rule({ id: "expired", decision: "deny", expiresAtMs: 500 }));

      expect(
        rules.findRule({
          scopeId: "project-1",
          toolId: "vault_write",
          family: "vault",
          effect: "write",
          target: "/vault/Notes/a.md",
        })
      ).toMatchObject({ id: "deny", decision: "deny" });
    });

    it("does not match another scope, tool, family, effect or root", () => {
      const rules = new PermissionRules({ now: () => 1_000 });
      rules.addRule(rule());

      const base = {
        scopeId: "project-1",
        toolId: "vault_write",
        family: "vault" as const,
        effect: "write" as const,
        target: "/vault/Notes/a.md",
      };
      expect(rules.findRule(base)).toMatchObject({ id: "rule-1" });
      expect(rules.findRule({ ...base, scopeId: "project-2" })).toBeUndefined();
      expect(rules.findRule({ ...base, target: "/vault/Other/a.md" })).toBeUndefined();
      expect(rules.findRule({ ...base, toolId: "vault_edit" })).toBeUndefined();
    });
  });

  describe("revokeScope()", () => {
    it("removes rules when the project authorization or MCP config is revoked", () => {
      const rules = new PermissionRules({ now: () => 1_000 });
      rules.addRule(rule({ id: "a" }));
      rules.addRule(rule({ id: "b", scopeId: "project-2" }));

      expect(rules.revokeScope("project-1")).toBe(1);
      expect(
        rules.findRule({
          scopeId: "project-1",
          toolId: "vault_write",
          family: "vault",
          effect: "write",
          target: "/vault/Notes/a.md",
        })
      ).toBeUndefined();
      expect(rules.listRules()).toHaveLength(1);
    });
  });
});
