import type { ToolEffect, ToolFamily } from "@/agentMode/sdk/pi/policy/ToolManifest";

// Long-term rules can only be created by the user in the settings UI and are limited to the two
// supported precise kinds: ordinary Vault edits and external reads. Deny rules are precise and
// always win; revoking the project authorization or MCP config removes its rules:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface PermissionRuleInput {
  readonly id: string;
  readonly decision: "allow" | "deny";
  readonly scopeId: string;
  readonly family: ToolFamily;
  readonly effect: ToolEffect;
  readonly toolId: string;
  readonly root?: string;
  readonly exactPath?: string;
  readonly schemaHash?: string;
  readonly createdBy: "user";
  readonly expiresAtMs?: number;
}

export interface PermissionRule extends PermissionRuleInput {
  readonly createdAtMs: number;
}

export interface PermissionRuleQuery {
  readonly scopeId: string;
  readonly toolId: string;
  readonly family: ToolFamily;
  readonly effect: ToolEffect;
  readonly target: string;
}

export type PermissionRuleErrorCode = "INVALID_RULE";

export class PermissionRuleError extends Error {
  readonly code: PermissionRuleErrorCode;

  constructor(code: PermissionRuleErrorCode, message: string) {
    super(message);
    this.name = "PermissionRuleError";
    this.code = code;
  }
}

const FAMILIES: ReadonlySet<string> = new Set<ToolFamily>([
  "vault",
  "native_file",
  "obsidian_action",
  "mcp",
  "control",
  "host_process",
]);

const EFFECTS: ReadonlySet<string> = new Set<ToolEffect>([
  "read",
  "write",
  "create",
  "delete",
  "rename",
  "network",
  "execute",
  "ui",
  "state",
]);

export class PermissionRules {
  private readonly now: () => number;
  private readonly rules = new Map<string, PermissionRule>();

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  addRule(input: PermissionRuleInput): PermissionRule {
    if (input.createdBy !== "user") {
      throw new PermissionRuleError(
        "INVALID_RULE",
        "Long-term rules can only be created by the user."
      );
    }
    if (!FAMILIES.has(input.family) || !EFFECTS.has(input.effect)) {
      throw new PermissionRuleError("INVALID_RULE", "The rule names an unknown family or effect.");
    }
    if (input.root === undefined && input.exactPath === undefined) {
      throw new PermissionRuleError(
        "INVALID_RULE",
        "A long-term rule needs a precise root or exact path."
      );
    }
    if (input.decision === "allow" && !isSupportedLongTermAllow(input.family, input.effect)) {
      throw new PermissionRuleError(
        "INVALID_RULE",
        "Long-term allow rules are limited to ordinary Vault edits and external reads."
      );
    }
    const rule: PermissionRule = Object.freeze({ ...input, createdAtMs: this.now() });
    this.rules.set(rule.id, rule);
    return rule;
  }

  findRule(query: PermissionRuleQuery): PermissionRule | undefined {
    const now = this.now();
    const matching = [...this.rules.values()].filter(
      (rule) =>
        (rule.expiresAtMs === undefined || rule.expiresAtMs > now) &&
        rule.scopeId === query.scopeId &&
        rule.toolId === query.toolId &&
        rule.family === query.family &&
        rule.effect === query.effect &&
        pathMatches(rule, query.target)
    );
    return matching.find((rule) => rule.decision === "deny") ?? matching.find(isAllow);
  }

  revokeScope(scopeId: string): number {
    let removed = 0;
    for (const [id, rule] of this.rules) {
      if (rule.scopeId !== scopeId) continue;
      this.rules.delete(id);
      removed += 1;
    }
    return removed;
  }

  listRules(): readonly PermissionRule[] {
    return Object.freeze([...this.rules.values()]);
  }
}

function isSupportedLongTermAllow(family: ToolFamily, effect: ToolEffect): boolean {
  return (
    (family === "vault" && effect === "write") || (family === "native_file" && effect === "read")
  );
}

function isAllow(rule: PermissionRule): boolean {
  return rule.decision === "allow";
}

function pathMatches(rule: PermissionRule, target: string): boolean {
  if (rule.exactPath !== undefined) return target === rule.exactPath;
  if (rule.root !== undefined) {
    return target === rule.root || target.startsWith(`${rule.root}/`);
  }
  return false;
}
