import {
  DELEGATE_TOOL_NAME,
  SubagentProfileError,
  subagentProfile,
  type SubagentProfile,
} from "@/agentMode/sdk/pi/features/subagents/Profiles";
import { computeSubagentScope } from "@/agentMode/sdk/pi/features/subagents/SubagentScope";

// The child scope is a strict intersection of parent callable tools, the profile allowlist and the
// scope policy; effects follow the same rule, so a subagent can never gain a write its parent lacks.
// Depth 2 has no delegation tool, hidden parent tools are never added, and the child inherits the
// parent model:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function profile(profileId: "researcher" | "reviewer" | "writer"): SubagentProfile {
  const found = subagentProfile(profileId);
  if (found === undefined) throw new Error(`missing profile ${profileId}`);
  return found;
}

describe("SubagentScope", () => {
  describe("computeSubagentScope()", () => {
    it("never grants a write effect the parent does not have", () => {
      const scope = computeSubagentScope({
        parent: {
          callableTools: ["vault_read", "vault_write"],
          effects: ["read"],
          modelKey: "model-a",
          depth: 0,
          maxDepth: 2,
        },
        profile: profile("writer"),
        toolAllowlist: ["vault_read", "vault_write"],
        policy: { effects: ["read", "write", "create"] },
      });

      expect(scope.effects).toEqual(["read"]);
      expect(scope.effects).not.toContain("write");
      expect(scope.tools).toEqual(["vault_read", "vault_write"]);
    });

    it("intersects parent callable, profile allowlist and scope policy without hidden tools", () => {
      const scope = computeSubagentScope({
        parent: {
          callableTools: ["vault_read", "vault_search", "vault_write", DELEGATE_TOOL_NAME],
          effects: ["read", "state"],
          modelKey: "model-a",
          depth: 0,
          maxDepth: 2,
        },
        profile: profile("researcher"),
        toolAllowlist: ["vault_read", "vault_search", "vault_write", DELEGATE_TOOL_NAME],
        policy: { allowedTools: ["vault_read", "vault_search", DELEGATE_TOOL_NAME] },
      });

      expect(scope.tools).toEqual(["vault_read", "vault_search", DELEGATE_TOOL_NAME]);
      expect(scope.tools).not.toContain("vault_write");
      expect(scope.effects).toEqual(["read", "state"]);
      expect(scope.delegationAllowed).toBe(true);
      expect(scope.modelKey).toBe("model-a");
      expect(scope.depth).toBe(1);
    });

    it("removes the delegation tool at depth 2", () => {
      const scope = computeSubagentScope({
        parent: {
          callableTools: [DELEGATE_TOOL_NAME, "vault_read"],
          effects: ["read"],
          modelKey: "model-a",
          depth: 1,
          maxDepth: 2,
        },
        profile: profile("researcher"),
        toolAllowlist: [DELEGATE_TOOL_NAME, "vault_read"],
      });

      expect(scope.depth).toBe(2);
      expect(scope.tools).toEqual(["vault_read"]);
      expect(scope.delegationAllowed).toBe(false);
    });

    it("refuses a depth beyond the effective maximum", () => {
      expect(() =>
        computeSubagentScope({
          parent: {
            callableTools: ["vault_read"],
            effects: ["read"],
            modelKey: "model-a",
            depth: 2,
            maxDepth: 2,
          },
          profile: profile("researcher"),
          toolAllowlist: ["vault_read"],
        })
      ).toThrow(SubagentProfileError);
    });

    it("uses the policy scope id when provided", () => {
      const scope = computeSubagentScope({
        parent: {
          callableTools: ["vault_read"],
          effects: ["read"],
          modelKey: "model-a",
          depth: 0,
          maxDepth: 1,
        },
        profile: profile("reviewer"),
        toolAllowlist: ["vault_read"],
        policy: { scopeId: "project-1" },
      });

      expect(scope.scopeId).toBe("project-1");
      expect(scope.maxDepth).toBe(1);
      expect(scope.delegationAllowed).toBe(false);
    });
  });
});
