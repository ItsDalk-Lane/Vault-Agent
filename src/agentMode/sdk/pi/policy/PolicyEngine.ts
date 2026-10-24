import type { VaultAgentMode } from "@/agentMode/session/types";
import type { ToolEffect, ToolFamily, ToolManifest } from "@/agentMode/sdk/pi/policy/ToolManifest";

// The engine is pure and always evaluates in the same order: protected path → scope → tool/resource
// family → read-only/plan → risk and mode. Auto never auto-approves delete/rename/unknown MCP, a
// read-only child cannot widen its rights, native tools cannot write Vault targets, and deny rules
// always beat allow rules:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type PolicyCaller = "root" | "subagent" | "fanout";

export interface PolicyTargetFact {
  readonly kind: "vault_path" | "external_path" | "operation";
  readonly value: string;
  readonly protected?: boolean;
  readonly insideScope?: boolean;
}

export interface PolicyScope {
  readonly vaultRoot: string;
  readonly externalRoots: readonly string[];
  readonly readOnly: boolean;
}

export interface PolicyRule {
  readonly id: string;
  readonly decision: "allow" | "deny";
  readonly toolId?: string;
  readonly family?: ToolFamily;
  readonly effect?: ToolEffect;
  readonly pathPrefix?: string;
  readonly expiresAtMs?: number;
}

export interface PolicyRequest {
  readonly manifest: Pick<ToolManifest, "toolId" | "family" | "effects" | "allowedCallers">;
  readonly targets: readonly PolicyTargetFact[];
  readonly mode: VaultAgentMode;
  readonly caller: PolicyCaller;
  readonly scope: PolicyScope;
  readonly rules?: readonly PolicyRule[];
  readonly nowMs?: number;
  readonly toolEnabled?: boolean;
  readonly trustedHost?: boolean;
}

export type PolicyDenyCode =
  | "CALLER_NOT_ALLOWED"
  | "TOOL_DISABLED"
  | "PROTECTED_PATH"
  | "PATH_OUT_OF_SCOPE"
  | "EXTERNAL_SCOPE_REQUIRED"
  | "USE_VAULT_TOOL"
  | "USE_EXTERNAL_TOOL"
  | "READ_ONLY_MODE"
  | "PERMISSION_DENIED"
  | "OPAQUE_EXECUTION_DISABLED";

export interface PolicyAllowDecision {
  readonly decision: "allow";
  readonly code: "ALLOWED";
  readonly requiresApproval: boolean;
  readonly matchedRuleId?: string;
}

export interface PolicyDenyDecision {
  readonly decision: "deny";
  readonly code: PolicyDenyCode;
  readonly message: string;
  readonly suggestedTool?: string;
}

export type PolicyDecision = PolicyAllowDecision | PolicyDenyDecision;

const READ_ONLY_SAFE_EFFECTS: ReadonlySet<ToolEffect> = new Set<ToolEffect>([
  "read",
  "state",
  "ui",
]);

const MUTATING_EFFECTS: ReadonlySet<ToolEffect> = new Set<ToolEffect>([
  "write",
  "create",
  "delete",
  "rename",
  "execute",
  "network",
]);

export class PolicyEngine {
  decide(request: PolicyRequest): PolicyDecision {
    const manifest = request.manifest;
    if (request.toolEnabled === false) {
      return deny("TOOL_DISABLED", `The tool "${manifest.toolId}" is not enabled.`);
    }
    if (!manifest.allowedCallers.includes(request.caller)) {
      return deny(
        "CALLER_NOT_ALLOWED",
        `The caller "${request.caller}" may not use the tool "${manifest.toolId}".`
      );
    }
    if (request.targets.some((target) => target.protected === true)) {
      return deny("PROTECTED_PATH", "The target belongs to a protected host directory.");
    }
    for (const target of request.targets) {
      if (target.kind === "vault_path" && target.insideScope === false) {
        return deny(
          "PATH_OUT_OF_SCOPE",
          `The Vault target "${target.value}" is outside the approved scope.`,
          "vault_search"
        );
      }
      if (target.kind === "external_path") {
        if (request.scope.externalRoots.length === 0) {
          return deny(
            "EXTERNAL_SCOPE_REQUIRED",
            `No external root has been authorized for "${target.value}".`
          );
        }
        if (target.insideScope === false) {
          return deny(
            "PATH_OUT_OF_SCOPE",
            `The external target "${target.value}" is outside its authorized root.`
          );
        }
      }
    }
    if (manifest.family === "native_file" && request.targets.some(isVaultTarget)) {
      return deny(
        "USE_VAULT_TOOL",
        "This target belongs to the Vault; use a Vault tool instead of a native file tool.",
        suggestedVaultTool(manifest.effects)
      );
    }
    if (manifest.family === "vault" && request.targets.some(isExternalTarget)) {
      return deny(
        "USE_EXTERNAL_TOOL",
        "This target is outside the Vault; use an external file tool instead."
      );
    }

    const matchedRules = matchingRules(request);
    const deniedByRule = matchedRules.find((rule) => rule.decision === "deny");
    if (deniedByRule !== undefined) {
      return deny("PERMISSION_DENIED", `The rule "${deniedByRule.id}" denies this call.`);
    }
    const allowedByRule = matchedRules.find((rule) => rule.decision === "allow");

    const mutating = manifest.effects.some((effect) => MUTATING_EFFECTS.has(effect));
    if (request.scope.readOnly && mutating) {
      return deny(
        "READ_ONLY_MODE",
        "This session is read-only, so mutating effects are not allowed."
      );
    }
    if (request.mode === "plan") {
      if (manifest.effects.some((effect) => !READ_ONLY_SAFE_EFFECTS.has(effect))) {
        return deny(
          "READ_ONLY_MODE",
          "Plan mode allows only read-only effects; this tool would mutate state or have unknown effects."
        );
      }
      // A known read-only tool stays approval-free while planning, including MCP reads.
      // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      return allow(false, allowedByRule?.id);
    }

    if (manifest.family === "host_process") {
      if (request.trustedHost === true) {
        return allow(true, allowedByRule?.id);
      }
      return deny(
        "OPAQUE_EXECUTION_DISABLED",
        "Opaque local processes are disabled in strict mode."
      );
    }
    if (manifest.family === "mcp") {
      return allow(true, allowedByRule?.id);
    }
    if (manifest.effects.some((effect) => effect === "delete" || effect === "rename")) {
      return allow(true, allowedByRule?.id);
    }
    if (
      manifest.effects.some((effect) => effect === "write" || effect === "create") &&
      request.targets.some(isExternalTarget)
    ) {
      return allow(true, allowedByRule?.id);
    }
    if (manifest.effects.every((effect) => READ_ONLY_SAFE_EFFECTS.has(effect))) {
      return allow(false, allowedByRule?.id);
    }
    if (manifest.family === "vault" && request.mode === "auto") {
      return allow(false, allowedByRule?.id);
    }
    const requiresApproval = true;
    if (allowedByRule !== undefined && isWaivableRule(manifest, allowedByRule)) {
      return allow(false, allowedByRule.id);
    }
    return allow(requiresApproval, allowedByRule?.id);
  }
}

function matchingRules(request: PolicyRequest): readonly PolicyRule[] {
  const now = request.nowMs ?? Date.now();
  const targetValues = request.targets.map((target) => target.value);
  return (request.rules ?? []).filter((rule) => {
    if (rule.expiresAtMs !== undefined && rule.expiresAtMs <= now) return false;
    if (rule.toolId !== undefined && rule.toolId !== request.manifest.toolId) return false;
    if (rule.family !== undefined && rule.family !== request.manifest.family) return false;
    if (rule.effect !== undefined && !request.manifest.effects.includes(rule.effect)) return false;
    if (
      rule.pathPrefix !== undefined &&
      !targetValues.some((value) => value.startsWith(rule.pathPrefix ?? ""))
    ) {
      return false;
    }
    return true;
  });
}

function isWaivableRule(manifest: PolicyRequest["manifest"], rule: PolicyRule): boolean {
  return (
    (rule.effect === "write" && manifest.family === "vault") ||
    (rule.effect === "read" && manifest.family === "native_file")
  );
}

function isVaultTarget(target: PolicyTargetFact): boolean {
  return target.kind === "vault_path";
}

function isExternalTarget(target: PolicyTargetFact): boolean {
  return target.kind === "external_path";
}

function suggestedVaultTool(effects: readonly ToolEffect[]): string {
  if (effects.includes("delete")) return "vault_delete";
  if (effects.includes("rename")) return "vault_rename";
  if (effects.includes("write") || effects.includes("create")) return "vault_write";
  return "vault_read";
}

function allow(requiresApproval: boolean, matchedRuleId?: string): PolicyAllowDecision {
  return {
    decision: "allow",
    code: "ALLOWED",
    requiresApproval,
    ...(matchedRuleId !== undefined ? { matchedRuleId } : {}),
  };
}

function deny(code: PolicyDenyCode, message: string, suggestedTool?: string): PolicyDenyDecision {
  return {
    decision: "deny",
    code,
    message,
    ...(suggestedTool !== undefined ? { suggestedTool } : {}),
  };
}
