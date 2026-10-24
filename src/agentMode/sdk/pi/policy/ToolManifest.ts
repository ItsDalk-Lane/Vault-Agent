import { sha256 } from "@/utils/hash";

// The manifest is host-written security metadata: tools are denied unless registered, model
// arguments can never set effects/family/permissions, and MCP/skill registrations cannot shadow
// the reserved host tool names:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type ToolFamily =
  | "vault"
  | "native_file"
  | "obsidian_action"
  | "mcp"
  | "control"
  | "host_process";

export type ToolEffect =
  | "read"
  | "write"
  | "create"
  | "delete"
  | "rename"
  | "network"
  | "execute"
  | "ui"
  | "state";

export type ToolCaller = "root" | "subagent" | "fanout" | "system";

export type ToolReplayPolicy = "read_only" | "idempotent" | "unsafe";

/** A resource a call would touch, used by the policy engine before approval.
 * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
 */
export interface ToolTarget {
  readonly kind: "vault_path" | "external_path" | "operation";
  readonly value: string;
}

export type ToolTargetExtractor = (args: unknown) => readonly ToolTarget[];

export interface ToolManifestDefinition {
  readonly description?: string;
  readonly toolId: string;
  readonly family: ToolFamily;
  readonly effects: readonly ToolEffect[];
  readonly parameters: Record<string, unknown>;
  readonly extractTargets: ToolTargetExtractor;
  readonly implementationVersion: number;
  readonly schemaVersion: number;
  readonly replayPolicy: ToolReplayPolicy;
  readonly allowedCallers: readonly ToolCaller[];
  readonly maxOutputBytes: number;
}

export interface ToolManifest extends ToolManifestDefinition {
  readonly description: string;
  readonly schemaHash: string;
}

export interface ToolManifestDescription {
  readonly toolId: string;
  readonly family: ToolFamily;
  readonly effects: readonly ToolEffect[];
  readonly schemaHash: string;
  readonly schemaVersion: number;
  readonly implementationVersion: number;
  readonly replayPolicy: ToolReplayPolicy;
  readonly allowedCallers: readonly ToolCaller[];
  readonly maxOutputBytes: number;
}

export type ToolManifestErrorCode = "INVALID_MANIFEST" | "INVALID_ARGUMENT";

export class ToolManifestError extends Error {
  readonly code: ToolManifestErrorCode;

  constructor(code: ToolManifestErrorCode, message: string) {
    super(message);
    this.name = "ToolManifestError";
    this.code = code;
  }
}

const FAMILIES: ReadonlySet<ToolFamily> = new Set<ToolFamily>([
  "vault",
  "native_file",
  "obsidian_action",
  "mcp",
  "control",
  "host_process",
]);

const EFFECTS: ReadonlySet<ToolEffect> = new Set<ToolEffect>([
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

const CALLERS: ReadonlySet<ToolCaller> = new Set<ToolCaller>([
  "root",
  "subagent",
  "fanout",
  "system",
]);

const REPLAY_POLICIES: ReadonlySet<ToolReplayPolicy> = new Set<ToolReplayPolicy>([
  "read_only",
  "idempotent",
  "unsafe",
]);

const TOOL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

const RESERVED_TOOL_IDS: ReadonlySet<string> = new Set([
  "read",
  "write",
  "edit",
  "delete",
  "move",
  "bash",
  "powershell",
  "fetch",
  "search",
  "grep",
  "Agent",
  "Task",
  "Skill",
  "AskUserQuestion",
  "TodoWrite",
]);

const RESERVED_TOOL_PREFIXES: readonly string[] = Object.freeze(["vault_", "va."]);

/** Model-supplied names that would otherwise look like manifest/permission fields.
 * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
 */
export const RESERVED_ARGUMENT_KEYS: readonly string[] = Object.freeze([
  "safe",
  "family",
  "permission",
  "effects",
  "rootId",
  "scope",
  "caller",
  "approved",
  "replayPolicy",
]);

export function isReservedToolName(toolId: string): boolean {
  return (
    RESERVED_TOOL_IDS.has(toolId) ||
    RESERVED_TOOL_PREFIXES.some((prefix) => toolId.startsWith(prefix))
  );
}

export function defineToolManifest(definition: ToolManifestDefinition): ToolManifest {
  if (typeof definition !== "object" || definition === null) {
    throw new ToolManifestError("INVALID_MANIFEST", "A tool manifest must be an object.");
  }
  const toolId = definition.toolId;
  if (typeof toolId !== "string" || toolId.length === 0 || toolId.length > 128) {
    throw new ToolManifestError("INVALID_MANIFEST", "A tool manifest needs a non-empty toolId.");
  }
  if (!TOOL_ID_PATTERN.test(toolId)) {
    throw new ToolManifestError(
      "INVALID_MANIFEST",
      `The tool id "${toolId}" contains unsupported characters.`
    );
  }
  if (!FAMILIES.has(definition.family)) {
    throw new ToolManifestError("INVALID_MANIFEST", `Unknown tool family for ${toolId}.`);
  }
  const declaredEffects: readonly unknown[] = definition.effects;
  if (!Array.isArray(declaredEffects) || declaredEffects.length === 0) {
    throw new ToolManifestError("INVALID_MANIFEST", `The tool ${toolId} declares no effects.`);
  }
  for (const effect of declaredEffects) {
    if (typeof effect !== "string" || !EFFECTS.has(effect as ToolEffect)) {
      throw new ToolManifestError("INVALID_MANIFEST", `Unknown effect "${effect}" for ${toolId}.`);
    }
  }
  if (new Set(declaredEffects).size !== declaredEffects.length) {
    throw new ToolManifestError("INVALID_MANIFEST", `The tool ${toolId} repeats an effect.`);
  }
  if (typeof definition.parameters !== "object" || definition.parameters === null) {
    throw new ToolManifestError(
      "INVALID_MANIFEST",
      `The tool ${toolId} needs a parameter schema object.`
    );
  }
  if (Array.isArray(definition.parameters)) {
    throw new ToolManifestError(
      "INVALID_MANIFEST",
      `The tool ${toolId} needs a parameter schema object.`
    );
  }
  if (typeof definition.extractTargets !== "function") {
    throw new ToolManifestError("INVALID_MANIFEST", `The tool ${toolId} needs a target extractor.`);
  }
  if (!isPositiveInteger(definition.implementationVersion)) {
    throw new ToolManifestError(
      "INVALID_MANIFEST",
      `The tool ${toolId} needs a positive implementationVersion.`
    );
  }
  if (!isPositiveInteger(definition.schemaVersion)) {
    throw new ToolManifestError(
      "INVALID_MANIFEST",
      `The tool ${toolId} needs a positive schemaVersion.`
    );
  }
  if (!REPLAY_POLICIES.has(definition.replayPolicy)) {
    throw new ToolManifestError("INVALID_MANIFEST", `Unknown replay policy for ${toolId}.`);
  }
  const declaredCallers: readonly unknown[] = definition.allowedCallers;
  if (!Array.isArray(declaredCallers) || declaredCallers.length === 0) {
    throw new ToolManifestError("INVALID_MANIFEST", `The tool ${toolId} allows no callers.`);
  }
  for (const caller of declaredCallers) {
    if (typeof caller !== "string" || !CALLERS.has(caller as ToolCaller)) {
      throw new ToolManifestError("INVALID_MANIFEST", `Unknown caller "${caller}" for ${toolId}.`);
    }
  }
  if (!isPositiveInteger(definition.maxOutputBytes)) {
    throw new ToolManifestError(
      "INVALID_MANIFEST",
      `The tool ${toolId} needs a positive maxOutputBytes.`
    );
  }

  const parameters = deepFreeze(definition.parameters);
  return Object.freeze({
    toolId,
    family: definition.family,
    effects: Object.freeze([...definition.effects]),
    parameters,
    extractTargets: definition.extractTargets,
    implementationVersion: definition.implementationVersion,
    schemaVersion: definition.schemaVersion,
    replayPolicy: definition.replayPolicy,
    allowedCallers: Object.freeze([...definition.allowedCallers]),
    maxOutputBytes: definition.maxOutputBytes,
    description:
      definition.description ??
      `Execute ${definition.toolId} within the currently authorized scope. Check the returned result before claiming success.`,
    schemaHash: sha256(canonicalJson(parameters)),
  });
}

export function describeToolManifest(manifest: ToolManifest): ToolManifestDescription {
  return Object.freeze({
    toolId: manifest.toolId,
    family: manifest.family,
    effects: Object.freeze([...manifest.effects]),
    schemaHash: manifest.schemaHash,
    schemaVersion: manifest.schemaVersion,
    implementationVersion: manifest.implementationVersion,
    replayPolicy: manifest.replayPolicy,
    allowedCallers: Object.freeze([...manifest.allowedCallers]),
    maxOutputBytes: manifest.maxOutputBytes,
  });
}

export function isolateModelArguments(
  manifest: ToolManifest,
  args: unknown
): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new ToolManifestError(
      "INVALID_ARGUMENT",
      `The tool ${manifest.toolId} received arguments that are not an object.`
    );
  }
  const reserved = Object.keys(args).filter((key) => RESERVED_ARGUMENT_KEYS.includes(key));
  if (reserved.length > 0) {
    throw new ToolManifestError(
      "INVALID_ARGUMENT",
      `The model cannot set reserved security arguments for ${manifest.toolId}: ${reserved.join(", ")}.`
    );
  }
  // 批准绑定独立的完整参数快照，等待期间原输入或展示层不能改变嵌套操作内容。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  try {
    return deepFreeze(JSON.parse(JSON.stringify(args)) as Record<string, unknown>);
  } catch {
    throw new ToolManifestError("INVALID_ARGUMENT", "Tool arguments must be serializable JSON.");
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  return Object.freeze(value);
}
