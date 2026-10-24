import type { ToolEffect } from "@/agentMode/sdk/pi/policy/ToolManifest";
import {
  DELEGATE_TOOL_NAME,
  SubagentProfileError,
  type SubagentProfile,
} from "@/agentMode/sdk/pi/features/subagents/Profiles";

// The child scope is a strict intersection: parent callable tools ∩ profile allowlist ∩ current scope
// policy, and the same for effects, so a subagent can never gain a write capability its parent lacks.
// Hidden parent tools are never added, depth 2 has no delegation tool, and the child inherits the
// parent model because an unknown model was already rejected:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface SubagentScopeParent {
  readonly callableTools: readonly string[];
  readonly effects: readonly ToolEffect[];
  readonly modelKey: string;
  readonly depth: number;
  readonly maxDepth: number;
}

export interface SubagentScopePolicy {
  readonly allowedTools?: readonly string[];
  readonly effects?: readonly ToolEffect[];
  readonly scopeId?: string;
}

export interface SubagentScopeInput {
  readonly parent: SubagentScopeParent;
  readonly profile: SubagentProfile;
  readonly toolAllowlist: readonly string[];
  readonly policy?: SubagentScopePolicy;
}

export interface SubagentScope {
  readonly scopeId: string;
  readonly profileId: string;
  readonly tools: readonly string[];
  readonly effects: readonly ToolEffect[];
  readonly modelKey: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly delegationAllowed: boolean;
}

export function computeSubagentScope(input: SubagentScopeInput): SubagentScope {
  const parent = input.parent;
  const effectiveMaxDepth = Math.min(parent.maxDepth, input.profile.maxDepth);
  const depth = parent.depth + 1;
  if (depth > effectiveMaxDepth) {
    throw new SubagentProfileError(
      "SUBAGENT_DEPTH_EXCEEDED",
      `A subagent at depth ${depth} exceeds the maximum depth ${effectiveMaxDepth}.`
    );
  }
  const policyTools = input.policy?.allowedTools;
  const tools = parent.callableTools.filter(
    (tool) =>
      input.toolAllowlist.includes(tool) &&
      (policyTools === undefined || policyTools.includes(tool)) &&
      (tool !== DELEGATE_TOOL_NAME || depth < effectiveMaxDepth)
  );
  const policyEffects = input.policy?.effects;
  const effects = parent.effects.filter(
    (effect) =>
      input.profile.effects.includes(effect) &&
      (policyEffects === undefined || policyEffects.includes(effect))
  );
  return Object.freeze({
    scopeId: input.policy?.scopeId ?? `subagent:${input.profile.profileId}`,
    profileId: input.profile.profileId,
    tools: Object.freeze([...new Set(tools)]),
    effects: Object.freeze([...new Set(effects)]),
    modelKey: parent.modelKey,
    depth,
    maxDepth: effectiveMaxDepth,
    delegationAllowed: depth < effectiveMaxDepth && tools.includes(DELEGATE_TOOL_NAME),
  });
}
