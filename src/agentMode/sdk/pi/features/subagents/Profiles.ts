import type { ToolEffect } from "@/agentMode/sdk/pi/policy/ToolManifest";

// Subagent profiles are data, never code: researcher/reviewer are read-only and enabled by default,
// writer can only suggest changes and needs an explicit user opt-in, a profile never grants an effect
// the parent lacks, an unknown model is an error instead of a silent swap, and a tool name that is
// not part of the profile (or looks like executable code) is rejected:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type SubagentProfileId = "researcher" | "reviewer" | "writer";

export interface SubagentProfile {
  readonly profileId: SubagentProfileId;
  readonly displayName: string;
  readonly description: string;
  readonly effects: readonly ToolEffect[];
  readonly toolAllowlist: readonly string[];
  readonly maxDepth: number;
  readonly defaultEnabled: boolean;
  readonly writeCapable: boolean;
  readonly instructions: string;
}

export const SUBAGENT_MAX_DEPTH = 2;
export const DELEGATE_TOOL_NAME = "delegate_task";

export const SUBAGENT_PROFILES: readonly SubagentProfile[] = Object.freeze([
  Object.freeze({
    profileId: "researcher" as const,
    displayName: "Researcher",
    description:
      "Read-only search, read and link gathering, including authorized read-only remote sources.",
    effects: Object.freeze(["read", "state", "network"] as const),
    toolAllowlist: Object.freeze([
      "vault_read",
      "vault_search",
      "read",
      "search",
      "web_fetch",
      "delegate_task",
      "send_subagent_message",
      "wait_subagent",
    ]),
    maxDepth: SUBAGENT_MAX_DEPTH,
    defaultEnabled: true,
    writeCapable: false,
    instructions: "Research the question and report findings with sources. Never modify the vault.",
  }),
  Object.freeze({
    profileId: "reviewer" as const,
    displayName: "Reviewer",
    description: "Read-only review of an existing change or answer.",
    effects: Object.freeze(["read", "state"] as const),
    toolAllowlist: Object.freeze([
      "vault_read",
      "vault_search",
      "read",
      "search",
      "delegate_task",
      "send_subagent_message",
      "wait_subagent",
    ]),
    maxDepth: SUBAGENT_MAX_DEPTH,
    defaultEnabled: true,
    writeCapable: false,
    instructions: "Review the given material and report concrete problems. Never modify the vault.",
  }),
  Object.freeze({
    profileId: "writer" as const,
    displayName: "Writer",
    description: "Drafts suggested changes; every actual write still goes through host approval.",
    effects: Object.freeze(["read", "state", "write", "create"] as const),
    // 写作子任务只能看见当前实际注册的写入工具，授权仍由父会话交集与宿主审批决定：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    toolAllowlist: Object.freeze([
      "vault_read",
      "vault_search",
      "vault_create",
      "vault_edit",
      "vault_frontmatter",
      "read",
      "search",
      "delegate_task",
      "send_subagent_message",
      "wait_subagent",
    ]),
    maxDepth: SUBAGENT_MAX_DEPTH,
    defaultEnabled: false,
    writeCapable: true,
    instructions: "Draft the requested content. Writes still require the host approval path.",
  }),
]);

export type SubagentProfileErrorCode =
  | "SUBAGENT_PROFILE_UNKNOWN"
  | "SUBAGENT_PROFILE_DISABLED"
  | "SUBAGENT_PROFILE_CODE_REJECTED"
  | "SUBAGENT_PROFILE_UNKNOWN_TOOL"
  | "SUBAGENT_MODEL_UNKNOWN"
  | "SUBAGENT_DEPTH_EXCEEDED";

export class SubagentProfileError extends Error {
  readonly code: SubagentProfileErrorCode;

  constructor(code: SubagentProfileErrorCode, message: string) {
    super(message);
    this.name = "SubagentProfileError";
    this.code = code;
  }
}

export function subagentProfile(profileId: string): SubagentProfile | undefined {
  return SUBAGENT_PROFILES.find((profile) => profile.profileId === profileId);
}

export function defaultEnabledProfiles(): readonly SubagentProfileId[] {
  return Object.freeze(
    SUBAGENT_PROFILES.filter((profile) => profile.defaultEnabled).map(
      (profile) => profile.profileId
    )
  );
}

export interface SubagentProfileSchema {
  readonly type: "string";
  readonly enum: readonly SubagentProfileId[];
  readonly description: string;
}

// 角色选项和说明直接来自实际启用的配置，模型无需猜名称，也不会把未启用的写作角色当成授权。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export function subagentProfileSchema(
  enabledProfiles: readonly string[] = defaultEnabledProfiles()
): SubagentProfileSchema {
  const profiles = SUBAGENT_PROFILES.filter((profile) =>
    enabledProfiles.includes(profile.profileId)
  );
  return Object.freeze({
    type: "string" as const,
    enum: Object.freeze(profiles.map((profile) => profile.profileId)),
    description: `Allowed enabled profiles: ${profiles.map((profile) => `${profile.profileId}: ${profile.description}`).join("; ") || "none"}. Only enabled roles may run; write-capable roles require explicit user enablement. inputFiles supply read-only materials; outputPaths separately authorize exact writable targets and never grant access outside the parent scope.`,
  });
}

export interface SubagentModelChoice {
  readonly modelKey: string;
  readonly displayName?: string;
  readonly providerDisplayName?: string;
}

export interface SubagentModelSchema {
  readonly type: "string";
  readonly enum?: readonly string[];
  readonly description: string;
}

// 用户选择的是供应商与模型名称，工具必须同时给出对应配置键，不能迫使模型猜 UUID。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export function subagentModelSchema(
  knownModels?: readonly (string | SubagentModelChoice)[]
): SubagentModelSchema {
  const choices = knownModels?.map((model) =>
    typeof model === "string"
      ? { modelKey: model }
      : {
          modelKey: model.modelKey,
          displayName: model.displayName,
          providerDisplayName: model.providerDisplayName,
        }
  );
  return Object.freeze({
    type: "string" as const,
    ...(choices ? { enum: Object.freeze(choices.map((model) => model.modelKey)) } : {}),
    description: `Omit modelKey to inherit the parent model. To select another model use its exact configured modelKey from these available choices: ${choices ? JSON.stringify(choices) : "not supplied"}. Names identify choices; they are not modelKey aliases. No fallback model is used.`,
  });
}

export interface SubagentRequestInput {
  readonly profileId: string;
  readonly modelKey?: string;
  readonly toolAllowlist?: readonly string[];
  readonly instructions?: string;
  readonly maxDepth?: number;
  readonly enabledProfiles?: readonly string[];
  readonly knownModels?: readonly string[];
}

export interface ValidatedSubagentRequest {
  readonly profile: SubagentProfile;
  readonly modelKey: string | null;
  readonly toolAllowlist: readonly string[];
  readonly instructions: string;
  readonly maxDepth: number;
}

export function validateSubagentRequest(input: SubagentRequestInput): ValidatedSubagentRequest {
  const enabled = input.enabledProfiles ?? defaultEnabledProfiles();
  const allowed = subagentProfileSchema(enabled).enum.join(", ") || "none";
  const profile = subagentProfile(input.profileId);
  if (profile === undefined) {
    throw new SubagentProfileError(
      "SUBAGENT_PROFILE_UNKNOWN",
      `Unknown subagent profile "${input.profileId}". Allowed enabled profiles: ${allowed}.`
    );
  }
  if (!enabled.includes(profile.profileId)) {
    throw new SubagentProfileError(
      "SUBAGENT_PROFILE_DISABLED",
      `The subagent profile "${profile.profileId}" is not enabled; enable it explicitly first. Allowed enabled profiles: ${allowed}.`
    );
  }
  const modelKey = input.modelKey;
  if (modelKey !== undefined) {
    if (typeof modelKey !== "string" || modelKey.trim().length === 0) {
      throw new SubagentProfileError("SUBAGENT_MODEL_UNKNOWN", "modelKey must be a non-empty id.");
    }
    const known = input.knownModels;
    if (known !== undefined && !known.includes(modelKey)) {
      throw new SubagentProfileError(
        "SUBAGENT_MODEL_UNKNOWN",
        `The model "${modelKey}" is not configured; allowed modelKey values: ${known.join(", ") || "none"}. No fallback model is used.`
      );
    }
  }
  const requestedTools = input.toolAllowlist ?? profile.toolAllowlist;
  if (!Array.isArray(requestedTools) || requestedTools.length === 0) {
    throw new SubagentProfileError(
      "SUBAGENT_PROFILE_UNKNOWN_TOOL",
      `The profile "${profile.profileId}" needs at least one allowed tool.`
    );
  }
  const toolAllowlist: string[] = [];
  for (const tool of requestedTools) {
    if (typeof tool !== "string" || tool.trim().length === 0) {
      throw new SubagentProfileError(
        "SUBAGENT_PROFILE_UNKNOWN_TOOL",
        "Tool allowlist entries must be non-empty names."
      );
    }
    if (looksLikeCode(tool) || !profile.toolAllowlist.includes(tool)) {
      throw new SubagentProfileError(
        looksLikeCode(tool) ? "SUBAGENT_PROFILE_CODE_REJECTED" : "SUBAGENT_PROFILE_UNKNOWN_TOOL",
        `The profile "${profile.profileId}" does not allow the tool "${tool}".`
      );
    }
    toolAllowlist.push(tool);
  }
  const instructions = input.instructions ?? profile.instructions;
  if (looksLikeCode(instructions)) {
    throw new SubagentProfileError(
      "SUBAGENT_PROFILE_CODE_REJECTED",
      "Subagent instructions must be plain text, not executable code."
    );
  }
  const maxDepth = input.maxDepth ?? profile.maxDepth;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > SUBAGENT_MAX_DEPTH) {
    throw new SubagentProfileError(
      "SUBAGENT_DEPTH_EXCEEDED",
      `maxDepth must be between 1 and ${SUBAGENT_MAX_DEPTH}.`
    );
  }
  return Object.freeze({
    profile,
    modelKey: modelKey ?? null,
    toolAllowlist: Object.freeze(toolAllowlist),
    instructions,
    maxDepth,
  });
}

function looksLikeCode(value: string): boolean {
  return (
    /(^|\s)(import|require|eval|Function|new\s+Function)\s*[(`]/.test(value) ||
    /=>/.test(value) ||
    /```/.test(value) ||
    /<script/i.test(value) ||
    /process\.|globalThis\.|node:/.test(value)
  );
}
