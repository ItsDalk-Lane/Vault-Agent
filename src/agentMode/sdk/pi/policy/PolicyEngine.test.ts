import {
  defineToolManifest,
  type ToolEffect,
  type ToolFamily,
  type ToolManifestDefinition,
} from "@/agentMode/sdk/pi/policy/ToolManifest";
import {
  PolicyEngine,
  type PolicyRequest,
  type PolicyRule,
} from "@/agentMode/sdk/pi/policy/PolicyEngine";
import type { VaultAgentMode } from "@/agentMode/session/types";

// The policy engine is a pure, fixed-order decision: protected path → tool/resource family →
// read-only/plan → risk and mode. External targets need no pre-authorized root — the per-call
// approval is the only authorization layer. Auto mode never auto-approves delete/rename/unknown
// MCP, a read-only child cannot widen its rights, native tools cannot write Vault targets, and a
// deny rule always beats an allow rule:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
const ENGINE = new PolicyEngine();
const VAULT_TARGET = { kind: "vault_path" as const, value: "Notes/a.md", insideScope: true };
const EXTERNAL_TARGET = {
  kind: "external_path" as const,
  value: "/ext/a.md",
  insideScope: true,
};

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
    allowedCallers: ["root", "subagent", "fanout"],
    maxOutputBytes: 64_000,
    ...overrides,
  };
}

function request(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    manifest: defineToolManifest(definition()),
    targets: [VAULT_TARGET],
    mode: "default",
    caller: "root",
    scope: { vaultRoot: "/vault", readOnly: false },
    rules: [],
    nowMs: 1_000,
    ...overrides,
  };
}

function decide(overrides: Partial<PolicyRequest>) {
  return ENGINE.decide(request(overrides));
}

function withManifest(
  family: ToolFamily,
  effects: readonly ToolEffect[],
  overrides: Partial<PolicyRequest> = {}
) {
  return decide({
    manifest: defineToolManifest(
      definition({ toolId: `tool_${family}_${effects.join("_")}`, family, effects })
    ),
    ...overrides,
  });
}

interface Fixture {
  readonly name: string;
  readonly family: ToolFamily;
  readonly effects: readonly ToolEffect[];
  readonly mode: VaultAgentMode;
  readonly targets?: PolicyRequest["targets"];
  readonly expected: Record<string, unknown>;
}

const POLICY_FIXTURES: readonly Fixture[] = [
  {
    name: "vault read in plan",
    family: "vault",
    effects: ["read"],
    mode: "plan",
    expected: { decision: "allow", requiresApproval: false },
  },
  {
    name: "vault read in default",
    family: "vault",
    effects: ["read"],
    mode: "default",
    expected: { decision: "allow", requiresApproval: false },
  },
  {
    name: "vault write in plan",
    family: "vault",
    effects: ["write"],
    mode: "plan",
    expected: { decision: "deny", code: "READ_ONLY_MODE" },
  },
  {
    name: "vault write in default",
    family: "vault",
    effects: ["write"],
    mode: "default",
    expected: { decision: "allow", requiresApproval: true },
  },
  {
    name: "vault write in auto inside the approved scope",
    family: "vault",
    effects: ["write"],
    mode: "auto",
    expected: { decision: "allow", requiresApproval: false },
  },
  {
    name: "vault delete in default",
    family: "vault",
    effects: ["delete"],
    mode: "default",
    expected: { decision: "allow", requiresApproval: true },
  },
  {
    name: "vault delete in auto",
    family: "vault",
    effects: ["delete"],
    mode: "auto",
    expected: { decision: "allow", requiresApproval: true },
  },
  {
    name: "vault rename in auto",
    family: "vault",
    effects: ["rename"],
    mode: "auto",
    expected: { decision: "allow", requiresApproval: true },
  },
  {
    name: "external read in plan without any pre-authorized root",
    family: "native_file",
    effects: ["read"],
    mode: "plan",
    targets: [EXTERNAL_TARGET],
    expected: { decision: "allow", requiresApproval: false },
  },
  {
    name: "external write in plan",
    family: "native_file",
    effects: ["write"],
    mode: "plan",
    targets: [EXTERNAL_TARGET],
    expected: { decision: "deny", code: "READ_ONLY_MODE" },
  },
  {
    name: "host process in default needs its own approval",
    family: "host_process",
    effects: ["execute"],
    mode: "default",
    expected: { decision: "allow", requiresApproval: true },
  },
  {
    name: "host process in auto still needs its own approval",
    family: "host_process",
    effects: ["execute"],
    mode: "auto",
    expected: { decision: "allow", requiresApproval: true },
  },
  {
    name: "unknown MCP effect in default",
    family: "mcp",
    effects: ["network"],
    mode: "default",
    expected: { decision: "allow", requiresApproval: true },
  },
  {
    name: "unknown MCP effect in auto",
    family: "mcp",
    effects: ["network"],
    mode: "auto",
    expected: { decision: "allow", requiresApproval: true },
  },
  {
    name: "control state in plan",
    family: "control",
    effects: ["state"],
    mode: "plan",
    expected: { decision: "allow", requiresApproval: false },
  },
];

describe("PolicyEngine", () => {
  describe("decide()", () => {
    it.each(POLICY_FIXTURES)("matches the policy fixture for $name", (fixture) => {
      const outcome = withManifest(fixture.family, fixture.effects, {
        mode: fixture.mode,
        ...(fixture.targets !== undefined ? { targets: fixture.targets } : {}),
      });

      expect(outcome).toMatchObject(fixture.expected);
    });

    it("returns USE_VAULT_TOOL when a native tool targets the Vault", () => {
      const outcome = withManifest("native_file", ["read"], { targets: [VAULT_TARGET] });

      expect(outcome).toMatchObject({
        decision: "deny",
        code: "USE_VAULT_TOOL",
        suggestedTool: "vault_read",
      });
    });

    it("returns USE_EXTERNAL_TOOL when a Vault tool targets an external file", () => {
      const outcome = decide({ targets: [EXTERNAL_TARGET] });

      expect(outcome).toMatchObject({ decision: "deny", code: "USE_EXTERNAL_TOOL" });
    });

    it("allows a known read-only MCP tool in plan mode", () => {
      const outcome = withManifest("mcp", ["read"], { mode: "plan" });

      expect(outcome).toMatchObject({ decision: "allow", requiresApproval: false });
    });

    it("rejects an MCP tool with unknown effects in plan mode", () => {
      const outcome = withManifest("mcp", ["network"], { mode: "plan" });

      expect(outcome).toMatchObject({ decision: "deny", code: "READ_ONLY_MODE" });
    });

    it("lets a deny rule win over a matching allow rule", () => {
      const rules: PolicyRule[] = [
        { id: "allow-edit", decision: "allow", toolId: "vault_write", effect: "write" },
        { id: "deny-edit", decision: "deny", toolId: "vault_write", effect: "write" },
      ];

      expect(decide({ rules })).toMatchObject({ decision: "deny", code: "PERMISSION_DENIED" });
    });

    it("uses an allow rule to skip approval only for the supported long-term kinds", () => {
      const allowWrite: PolicyRule[] = [
        { id: "allow-edit", decision: "allow", toolId: "vault_write", effect: "write" },
      ];
      expect(decide({ rules: allowWrite })).toMatchObject({
        decision: "allow",
        requiresApproval: false,
        matchedRuleId: "allow-edit",
      });

      const allowDelete: PolicyRule[] = [
        { id: "allow-delete", decision: "allow", toolId: "vault_write", effect: "delete" },
      ];
      expect(
        decide({
          manifest: defineToolManifest(definition({ effects: ["delete"] })),
          rules: allowDelete,
        })
      ).toMatchObject({ decision: "allow", requiresApproval: true });
    });

    it("denies a read-only child that tries to widen its rights", () => {
      const outcome = decide({
        caller: "subagent",
        scope: { vaultRoot: "/vault", readOnly: true },
      });

      expect(outcome).toMatchObject({ decision: "deny", code: "READ_ONLY_MODE" });
    });

    it("rejects callers, disabled tools and protected or out-of-scope vault targets; external targets need no scope (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", () => {
      expect(
        decide({
          manifest: defineToolManifest(definition({ allowedCallers: ["root"] })),
          caller: "subagent",
        })
      ).toMatchObject({ decision: "deny", code: "CALLER_NOT_ALLOWED" });

      expect(decide({ toolEnabled: false })).toMatchObject({
        decision: "deny",
        code: "TOOL_DISABLED",
      });

      expect(
        decide({ targets: [{ kind: "vault_path", value: "Notes/a.md", protected: true }] })
      ).toMatchObject({ decision: "deny", code: "PROTECTED_PATH" });

      expect(
        decide({
          targets: [EXTERNAL_TARGET],
          manifest: defineToolManifest(
            definition({ family: "native_file", toolId: "native_edit", effects: ["write"] })
          ),
        })
      ).toMatchObject({ decision: "allow", requiresApproval: true });

      expect(
        decide({ targets: [{ kind: "vault_path", value: "Other/a.md", insideScope: false }] })
      ).toMatchObject({ decision: "deny", code: "PATH_OUT_OF_SCOPE" });
    });
  });
});
