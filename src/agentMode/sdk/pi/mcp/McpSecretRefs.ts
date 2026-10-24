// MCP credentials are addressed by reference: a config may only carry `mcp:<server>:<field>` refs
// whose value lives in the OS keychain, so exporting a config or writing it to data.json can never
// contain the raw token, and a plaintext value is rejected instead of silently stored:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface McpSecretStore {
  read(ref: string): Promise<string | undefined>;
  write(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

export type McpSecretSource = "keychain";

export interface McpSecretRef {
  readonly ref: string;
  readonly source: McpSecretSource;
}

export type McpSecretRefErrorCode = "MCP_SECRET_REF_INVALID" | "MCP_SECRET_PLAINTEXT_DENIED";

export class McpSecretRefError extends Error {
  readonly code: McpSecretRefErrorCode;

  constructor(code: McpSecretRefErrorCode, message: string) {
    super(message);
    this.name = "McpSecretRefError";
    this.code = code;
  }
}

export const MCP_SECRET_REF_PATTERN = /^mcp:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/;

export function isMcpSecretRef(value: unknown): value is string {
  return typeof value === "string" && MCP_SECRET_REF_PATTERN.test(value);
}

export function mcpSecretRef(serverId: string, field: string): string {
  const server = slug(serverId);
  const name = slug(field);
  if (server.length === 0 || name.length === 0) {
    throw new McpSecretRefError(
      "MCP_SECRET_REF_INVALID",
      "A secret ref needs a server and a field."
    );
  }
  return `mcp:${server}:${name}`;
}

export function assertMcpSecretRef(value: unknown, field: string): string {
  if (isMcpSecretRef(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    throw new McpSecretRefError(
      "MCP_SECRET_PLAINTEXT_DENIED",
      `${field} must be a secretRef, not a plaintext value.`
    );
  }
  throw new McpSecretRefError("MCP_SECRET_REF_INVALID", `${field} must be a secretRef.`);
}

export class McpSecretRefs {
  readonly #store: McpSecretStore;

  constructor(options: { store: McpSecretStore }) {
    this.#store = options.store;
  }

  async store(serverId: string, field: string, value: string): Promise<McpSecretRef> {
    if (typeof value !== "string" || value.length === 0) {
      throw new McpSecretRefError("MCP_SECRET_REF_INVALID", "A secret value is required.");
    }
    const ref = mcpSecretRef(serverId, field);
    await this.#store.write(ref, value);
    return Object.freeze({ ref, source: "keychain" });
  }

  async resolve(ref: string): Promise<string | undefined> {
    if (!isMcpSecretRef(ref)) {
      throw new McpSecretRefError("MCP_SECRET_REF_INVALID", "Not an MCP secret ref.");
    }
    return this.#store.read(ref);
  }

  async remove(ref: string): Promise<void> {
    if (!isMcpSecretRef(ref)) {
      throw new McpSecretRefError("MCP_SECRET_REF_INVALID", "Not an MCP secret ref.");
    }
    await this.#store.delete(ref);
  }
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
