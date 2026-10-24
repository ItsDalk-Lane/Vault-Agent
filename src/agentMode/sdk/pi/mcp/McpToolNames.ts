import { sha256 } from "@/utils/hash";

// MCP tool names are model-facing ASCII identifiers: `mcp_<serverSlug>_<toolSlug>_<hash12>` is at
// most 64 ASCII characters, and the hash is taken from the full serverId plus the original toolName,
// so long, punctuated or non-Latin names stay distinct and a truncated name can never be resolved
// back to the wrong tool. The registry keeps the exact bidirectional mapping:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const MCP_TOOL_NAME_MAX_LENGTH = 64;
export const MCP_TOOL_NAME_PREFIX = "mcp_";
export const MCP_TOOL_HASH_LENGTH = 12;

export type McpToolNameErrorCode = "MCP_TOOL_NAME_COLLISION";

export class McpToolNameError extends Error {
  readonly code: McpToolNameErrorCode;

  constructor(code: McpToolNameErrorCode, message: string) {
    super(message);
    this.name = "McpToolNameError";
    this.code = code;
  }
}

export interface McpToolIdentity {
  readonly serverId: string;
  readonly toolName: string;
}

export function mcpToolHash(
  serverId: string,
  toolName: string,
  length = MCP_TOOL_HASH_LENGTH
): string {
  return sha256(`${serverId}\u0000${toolName}`).slice(0, length);
}

export function mcpToolSlug(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

export function mcpToolName(serverId: string, toolName: string): string {
  const suffix = `_${mcpToolHash(serverId, toolName)}`;
  const maxBody = MCP_TOOL_NAME_MAX_LENGTH - MCP_TOOL_NAME_PREFIX.length - suffix.length;
  let server = mcpToolSlug(serverId, "server");
  let tool = mcpToolSlug(toolName, "tool");
  if (server.length + 1 + tool.length > maxBody) {
    const serverBudget = Math.max(1, Math.min(server.length, 8));
    tool = tool.slice(0, Math.max(1, maxBody - 1 - serverBudget));
    server = server.slice(0, Math.max(1, maxBody - 1 - tool.length));
  }
  return `${MCP_TOOL_NAME_PREFIX}${server}_${tool}${suffix}`;
}

export class McpToolNameRegistry {
  readonly #byInternal = new Map<string, McpToolIdentity>();
  readonly #byIdentity = new Map<string, string>();

  register(serverId: string, toolName: string): string {
    const identityKey = `${serverId}\u0000${toolName}`;
    const known = this.#byIdentity.get(identityKey);
    if (known !== undefined) return known;
    let internal = mcpToolName(serverId, toolName);
    const existing = this.#byInternal.get(internal);
    if (
      existing !== undefined &&
      (existing.serverId !== serverId || existing.toolName !== toolName)
    ) {
      internal = mcpToolName(serverId, toolName).replace(
        /_[0-9a-f]{12}$/,
        `_${mcpToolHash(serverId, toolName, 16)}`
      );
      if (this.#byInternal.has(internal)) {
        throw new McpToolNameError("MCP_TOOL_NAME_COLLISION", `Two MCP tools map to ${internal}.`);
      }
    }
    this.#byInternal.set(internal, { serverId, toolName });
    this.#byIdentity.set(identityKey, internal);
    return internal;
  }

  resolve(internalName: string): McpToolIdentity | undefined {
    return this.#byInternal.get(internalName);
  }

  get size(): number {
    return this.#byInternal.size;
  }
}
