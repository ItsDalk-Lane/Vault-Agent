import {
  defineToolManifest,
  type ToolEffect,
  type ToolFamily,
  type ToolManifestDefinition,
} from "@/agentMode/sdk/pi/policy/ToolManifest";
import { PolicyEngine } from "@/agentMode/sdk/pi/policy/PolicyEngine";
import {
  ToolGateway,
  type GatewayExecuteContext,
  type ToolGatewayOptions,
} from "@/agentMode/sdk/pi/tools/ToolGateway";
import { ToolHook } from "@/agentMode/sdk/pi/policy/ToolHook";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { AuditLog, type AuditRecord } from "@/agentMode/sdk/pi/policy/AuditLog";

// Every tool execution — including nested executeTool calls — passes the same gateway: beforeTool
// only does the manifest/caller pre-check, the execute wrapper re-verifies cancellation, scope and
// targets after approval, a review exception denies instead of allowing, and a hidden tool is not
// callable even if model-supplied annotations claim otherwise:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function definition(overrides: Partial<ToolManifestDefinition> = {}): ToolManifestDefinition {
  return {
    toolId: "vault_write",
    family: "vault",
    effects: ["write"],
    parameters: { type: "object" },
    extractTargets: () => [],
    implementationVersion: 1,
    schemaVersion: 1,
    replayPolicy: "idempotent",
    allowedCallers: ["root", "subagent"],
    maxOutputBytes: 64_000,
    ...overrides,
  };
}

function context(overrides: Partial<GatewayExecuteContext> = {}): GatewayExecuteContext {
  return {
    caller: "root",
    mode: "default",
    scope: { vaultRoot: "/vault", externalRoots: [], readOnly: false },
    scopeVersion: 1,
    policyVersion: 1,
    targets: [{ kind: "vault_path", value: "/vault/Notes/a.md", insideScope: true }],
    ...overrides,
  };
}

interface Harness {
  readonly gateway: ToolGateway;
  readonly registry: ToolRegistry;
  readonly executed: string[];
  readonly options: ToolGatewayOptions;
}

function harness(overrides: Partial<ToolGatewayOptions> = {}): Harness {
  const registry = new ToolRegistry();
  const executed: string[] = [];
  const options: ToolGatewayOptions = {
    registry,
    policy: new PolicyEngine(),
    requestApproval: async () => "approved",
    isScopeActive: () => true,
    revalidateTargets: async () => true,
    ...overrides,
  };
  const gateway = new ToolGateway(options);
  return { gateway, registry, executed, options };
}

function register(
  harnessed: Harness,
  overrides: Partial<ToolManifestDefinition> = {},
  effects: readonly ToolEffect[] = ["write"],
  family: ToolFamily = "vault"
): void {
  const manifest = defineToolManifest(
    definition({ toolId: `tool_${family}_${effects.join("_")}`, effects, family, ...overrides })
  );
  harnessed.registry.register(manifest, "host");
  harnessed.gateway.registerTool({
    toolId: manifest.toolId,
    manifest,
    execute: async () => {
      harnessed.executed.push(manifest.toolId);
      return { content: `${manifest.toolId} done` };
    },
  });
}

describe("ToolGateway", () => {
  describe("executeTool()", () => {
    it("keeps rejection and an uncertain started write distinct in durable outcome metadata https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const rejected = harness({ requestApproval: async () => "rejected" });
      register(rejected);
      const denial = await rejected.gateway.executeTool(
        "tool_vault_write",
        {},
        context({ operationId: "denied" })
      );
      expect(denial).toMatchObject({
        outcome: {
          operationId: "denied",
          status: "error",
          effect: "not_applied",
          error: { phase: "review", code: "APPROVAL_REJECTED" },
          nextActions: ["revise_request"],
        },
      });
      const uncertain = harness();
      const manifest = defineToolManifest(definition());
      uncertain.registry.register(manifest, "host");
      uncertain.gateway.registerTool({
        toolId: manifest.toolId,
        manifest,
        execute: async () => {
          throw new Error("private");
        },
      });
      const failure = await uncertain.gateway.executeTool(
        manifest.toolId,
        {},
        context({ operationId: "uncertain" })
      );
      expect(failure).toMatchObject({
        outcome: {
          operationId: "uncertain",
          effect: "unknown",
          error: { phase: "execution" },
          nextActions: ["read", "reconcile"],
        },
      });
      expect(JSON.stringify(failure)).not.toContain("private");
    });
    it.each(["STALE_BASELINE", "EFFECT_UNKNOWN", "CANCELLED"])(
      "preserves %s from the execution layer without exposing raw errors https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (code) => {
        const h = harness();
        const manifest = defineToolManifest(definition());
        h.registry.register(manifest, "host");
        h.gateway.registerTool({
          toolId: manifest.toolId,
          manifest,
          execute: async () => {
            throw Object.assign(new Error("private host error"), { code });
          },
        });
        const result = await h.gateway.executeTool(manifest.toolId, {}, context());
        expect(result).toMatchObject({ decision: "deny", code });
        expect(JSON.stringify(result)).not.toContain("private host error");
      }
    );
    it("persists approval before a tool effect and records rejection without claiming execution https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const records: AuditRecord[] = [];
      const audit = new AuditLog({
        sink: {
          write: (record) => {
            records.push(record);
          },
        },
      });
      const fixture = harness({ audit });
      const manifest = defineToolManifest(definition({ toolId: "audited_write" }));
      fixture.registry.register(manifest, "host");
      fixture.gateway.registerTool({
        toolId: manifest.toolId,
        manifest,
        execute: async () => {
          expect(records).toMatchObject([
            { status: "approved", decision: "allow", operationId: "original-call" },
          ]);
          return { content: "saved" };
        },
      });
      await expect(
        fixture.gateway.executeTool(
          "audited_write",
          { headers: { authorization: "private" } },
          context({ operationId: "original-call", requestId: "original-request" })
        )
      ).resolves.toMatchObject({ decision: "allow" });
      expect(records.map((record) => record.status)).toEqual(["approved", "executed"]);
      expect(JSON.stringify(records)).not.toContain("private");
      const denied = harness({ audit, requestApproval: async () => "rejected" });
      register(denied);
      await expect(
        denied.gateway.executeTool("tool_vault_write", {}, context())
      ).resolves.toMatchObject({
        decision: "deny",
        code: "APPROVAL_REJECTED",
        message: expect.stringContaining("拒绝"),
      });
      expect(records.at(-1)).toMatchObject({ decision: "deny", status: "rejected" });
      expect(denied.executed).toEqual([]);
    });

    it.each(["cancel", "disable", "revoke", "target"])(
      "does not execute when %s arrives while the approval audit is saved https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (change) => {
        const controller = new AbortController();
        let active = true;
        let targetUnchanged = true;
        const fixture = harness({
          isScopeActive: () => active,
          revalidateTargets: async () => targetUnchanged,
          audit: new AuditLog({
            sink: {
              write: (record) => {
                if (record.status !== "approved") return;
                if (change === "cancel") controller.abort();
                if (change === "disable") fixture.gateway.setToolEnabled("tool_vault_write", false);
                if (change === "revoke") active = false;
                if (change === "target") targetUnchanged = false;
              },
            },
          }),
        });
        register(fixture);
        const result = await fixture.gateway.executeTool(
          "tool_vault_write",
          {},
          context({ signal: controller.signal })
        );
        expect(result).toMatchObject({
          decision: "deny",
          outcome: { effect: "not_applied", error: { phase: "review" } },
        });
        expect(fixture.executed).toEqual([]);
      }
    );

    it("performs no effect when the initial audit write fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = harness({
        audit: new AuditLog({
          sink: {
            write: () => {
              throw new Error("secret sink details");
            },
          },
        }),
      });
      register(fixture);
      const result = await fixture.gateway.executeTool("tool_vault_write", {}, context());
      expect(result).toMatchObject({ decision: "deny", code: "AUDIT_FAILED" });
      expect(JSON.stringify(result)).not.toContain("secret sink details");
      expect(fixture.executed).toEqual([]);
    });

    it("does not repeat a completed effect when its final audit cannot be saved https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let writes = 0;
      const fixture = harness({
        audit: new AuditLog({
          sink: {
            write: () => {
              if (++writes === 2) throw new Error("sink failed after effect");
            },
          },
        }),
      });
      register(fixture);
      const result = await fixture.gateway.executeTool("tool_vault_write", {}, context());
      expect(result).toMatchObject({
        decision: "deny",
        code: "AUDIT_FAILED",
        message: expect.stringContaining("可能已经发生"),
      });
      expect(fixture.executed).toEqual(["tool_vault_write"]);
      expect(writes).toBe(2);
    });

    it("honors only the host-owned trusted command flag and still requires the gateway approval https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let approvals = 0;
      const fixture = harness({
        requestApproval: async () => {
          approvals++;
          return "approved";
        },
      });
      register(fixture, {}, ["execute"], "host_process");
      const denied = await fixture.gateway.executeTool(
        "tool_host_process_execute",
        {},
        context({ trustedHost: false, targets: [{ kind: "operation", value: "command" }] })
      );
      const approved = await fixture.gateway.executeTool(
        "tool_host_process_execute",
        {},
        context({ trustedHost: true, targets: [{ kind: "operation", value: "command" }] })
      );
      expect(denied).toMatchObject({ decision: "deny", code: "OPAQUE_EXECUTION_DISABLED" });
      expect(approved.decision).toBe("allow");
      expect(approvals).toBe(1);
      expect(fixture.executed).toEqual(["tool_host_process_execute"]);
    });

    it("executes an approved tool and returns its result", async () => {
      const harnessed = harness();
      register(harnessed);

      const result = await harnessed.gateway.executeTool("tool_vault_write", {}, context());

      expect(result).toMatchObject({ decision: "allow", toolId: "tool_vault_write" });
      expect(harnessed.executed).toEqual(["tool_vault_write"]);
    });

    it("denies a hidden tool even when model-supplied annotations claim it is available", async () => {
      const harnessed = harness();
      register(harnessed);
      harnessed.gateway.setToolEnabled("tool_vault_write", false);

      const result = await harnessed.gateway.executeTool(
        "tool_vault_write",
        { modelTools: [{ name: "tool_vault_write" }] },
        context({ modelTools: [{ name: "tool_vault_write" }] })
      );

      expect(result).toMatchObject({ decision: "deny", code: "TOOL_DISABLED" });
      expect(harnessed.executed).toEqual([]);
    });

    it("denies instead of allowing when the review throws", async () => {
      const harnessed = harness({
        policy: {
          decide: () => {
            throw new Error("review crashed");
          },
        } as unknown as PolicyEngine,
      });
      register(harnessed);

      const result = await harnessed.gateway.executeTool("tool_vault_write", {}, context());

      expect(result).toMatchObject({ decision: "deny", code: "TOOL_REVIEW_FAILED" });
      expect(harnessed.executed).toEqual([]);
    });

    it("blocks when the scope is revoked while the approval is pending", async () => {
      let resolveApproval: ((outcome: "approved") => void) | undefined;
      let scopeActive = true;
      const harnessed = harness({
        requestApproval: () =>
          new Promise((resolve) => {
            resolveApproval = resolve;
          }),
        isScopeActive: () => scopeActive,
      });
      register(harnessed);

      const pending = harnessed.gateway.executeTool("tool_vault_write", {}, context());
      scopeActive = false;
      resolveApproval?.("approved");
      const result = await pending;

      expect(result).toMatchObject({ decision: "deny", code: "SCOPE_REVOKED" });
      expect(harnessed.executed).toEqual([]);
    });

    it("rejects when the approval is cancelled or unavailable", async () => {
      const cancelled = harness({ requestApproval: async () => "cancelled" });
      register(cancelled);
      expect(await cancelled.gateway.executeTool("tool_vault_write", {}, context())).toMatchObject({
        decision: "deny",
        code: "CANCELLED",
      });

      const unavailable = harness({ requestApproval: undefined });
      register(unavailable);
      expect(
        await unavailable.gateway.executeTool("tool_vault_write", {}, context())
      ).toMatchObject({ decision: "deny", code: "APPROVAL_UNAVAILABLE" });
    });

    it("denies an unknown tool and a disallowed caller at the gate", async () => {
      const harnessed = harness();
      register(harnessed, { allowedCallers: ["root"] });

      expect(await harnessed.gateway.executeTool("missing", {}, context())).toMatchObject({
        decision: "deny",
        code: "UNKNOWN_TOOL",
      });
      expect(
        await harnessed.gateway.executeTool("tool_vault_write", {}, context({ caller: "subagent" }))
      ).toMatchObject({ decision: "deny", code: "CALLER_NOT_ALLOWED" });
    });
  });

  describe("registerTool()", () => {
    it("cannot be unwrapped or replaced after registration", async () => {
      const harnessed = harness();
      register(harnessed);
      const manifest = harnessed.registry.requireManifest("tool_vault_write");

      expect(() =>
        harnessed.gateway.registerTool({
          toolId: "tool_vault_write",
          manifest,
          execute: async () => ({ content: "replacement" }),
        })
      ).toThrow(/already wrapped/i);

      const result = await harnessed.gateway.executeTool("tool_vault_write", {}, context());
      expect(result).toMatchObject({ decision: "allow" });
      expect(harnessed.executed).toEqual(["tool_vault_write"]);
    });
  });

  describe("nested execution", () => {
    it("routes nested executeTool calls through the same gate", async () => {
      const harnessed = harness();
      const registry = harnessed.registry;
      const innerManifest = defineToolManifest(
        definition({ toolId: "inner_write", effects: ["write"] })
      );
      registry.register(innerManifest, "host");
      const innerExecuted: string[] = [];
      harnessed.gateway.registerTool({
        toolId: "inner_write",
        manifest: innerManifest,
        execute: async () => {
          innerExecuted.push("inner");
          return { content: "inner done" };
        },
      });
      const outerManifest = defineToolManifest(
        definition({ toolId: "outer_tool", effects: ["read"] })
      );
      registry.register(outerManifest, "host");
      harnessed.gateway.registerTool({
        toolId: "outer_tool",
        manifest: outerManifest,
        execute: async (_args, ctx) => {
          const nested = await ctx.invokeTool("inner_write", {}, {});
          return { content: JSON.stringify(nested) };
        },
      });
      harnessed.gateway.setToolEnabled("inner_write", false);

      const result = await harnessed.gateway.executeTool("outer_tool", {}, context());

      expect(result.decision).toBe("allow");
      expect(result.decision === "allow" ? result.content : "").toContain("TOOL_DISABLED");
      expect(innerExecuted).toEqual([]);
    });
  });
});

describe("ToolHook", () => {
  describe("beforeTool()", () => {
    it("allows a registered tool for an allowed caller", async () => {
      const registry = new ToolRegistry();
      registry.register(defineToolManifest(definition()), "host");
      const hook = new ToolHook({ registry });

      expect(await hook.beforeTool({ toolId: "vault_write", caller: "root" })).toEqual({
        allowed: true,
      });
    });

    it("denies an unknown tool or a disallowed caller", async () => {
      const registry = new ToolRegistry();
      registry.register(defineToolManifest(definition({ allowedCallers: ["root"] })), "host");
      const hook = new ToolHook({ registry });

      expect(await hook.beforeTool({ toolId: "missing", caller: "root" })).toMatchObject({
        allowed: false,
        code: "UNKNOWN_TOOL",
      });
      expect(await hook.beforeTool({ toolId: "vault_write", caller: "subagent" })).toMatchObject({
        allowed: false,
        code: "CALLER_NOT_ALLOWED",
      });
    });

    it("denies instead of allowing when the hook review throws", async () => {
      const hook = new ToolHook({
        registry: {
          requireManifest: () => {
            throw new Error("registry crashed");
          },
        } as unknown as ToolRegistry,
      });

      expect(await hook.beforeTool({ toolId: "vault_write", caller: "root" })).toMatchObject({
        allowed: false,
        code: "TOOL_REVIEW_FAILED",
      });
    });
  });
});
