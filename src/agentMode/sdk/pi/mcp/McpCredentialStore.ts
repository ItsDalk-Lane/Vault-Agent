import { sha256 } from "@/utils/hash";

// MCP OAuth credentials live in the OS keychain under their own namespace, keyed by the exact server
// origin: a different origin can never read them, signOut bumps a generation so a refresh or login
// callback that started earlier cannot write a token back, and nothing is stored in data.json:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface McpKeychainPort {
  read(ref: string): Promise<string | undefined>;
  write(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

export interface McpOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly scope?: string;
}

export interface McpOAuthClientInformation {
  readonly clientId: string;
  readonly clientSecret?: string;
}

export interface McpOAuthCredentialRecord {
  readonly origin: string;
  readonly generation: number;
  readonly clientInformation?: McpOAuthClientInformation;
  readonly tokens?: McpOAuthTokens;
  readonly updatedAtMs: number;
}

export type McpCredentialErrorCode = "MCP_CREDENTIAL_STORE_FAILED" | "MCP_CREDENTIAL_INVALID";

export class McpCredentialError extends Error {
  readonly code: McpCredentialErrorCode;

  constructor(code: McpCredentialErrorCode, message: string) {
    super(message);
    this.name = "McpCredentialError";
    this.code = code;
  }
}

export interface McpCredentialStoreOptions {
  readonly keychain: McpKeychainPort;
  readonly now?: () => number;
  readonly namespace?: string;
}

export class McpCredentialStore {
  readonly #keychain: McpKeychainPort;
  readonly #now: () => number;
  readonly #namespace: string;
  readonly #generations = new Map<string, number>();
  readonly #origins = new Map<string, string>();

  constructor(options: McpCredentialStoreOptions) {
    this.#keychain = options.keychain;
    this.#now = options.now ?? Date.now;
    this.#namespace = options.namespace ?? "mcp-oauth";
  }

  refFor(serverId: string, origin: string): string {
    return `${this.#namespace}:${slug(serverId)}:${sha256(origin).slice(0, 16)}`;
  }

  generationOf(serverId: string): number {
    return this.#generations.get(serverId) ?? 0;
  }

  async setOrigin(serverId: string, origin: string): Promise<boolean> {
    const previous = this.#origins.get(serverId);
    if (previous === origin) return false;
    this.#origins.set(serverId, origin);
    if (previous !== undefined) {
      await this.#bumpGeneration(serverId);
    }
    return previous !== undefined;
  }

  async load(serverId: string, origin: string): Promise<McpOAuthCredentialRecord | undefined> {
    const raw = await this.#readRef(serverId, origin);
    if (raw === undefined) return undefined;
    const record = parseRecord(raw);
    if (record === null || record.origin !== origin) return undefined;
    if (this.#generations.has(serverId) && record.generation !== this.generationOf(serverId)) {
      return undefined;
    }
    return record;
  }

  async credentials(
    serverId: string,
    origin: string
  ): Promise<
    | { readonly tokens: McpOAuthTokens; readonly clientInformation?: McpOAuthClientInformation }
    | undefined
  > {
    const record = await this.load(serverId, origin);
    if (record?.tokens === undefined) return undefined;
    return {
      tokens: record.tokens,
      ...(record.clientInformation !== undefined
        ? { clientInformation: record.clientInformation }
        : {}),
    };
  }

  async saveClientInformation(
    serverId: string,
    origin: string,
    information: McpOAuthClientInformation,
    generation = this.generationOf(serverId)
  ): Promise<boolean> {
    return this.#write(serverId, origin, generation, (record) => ({
      ...record,
      clientInformation: information,
    }));
  }

  async saveTokens(
    serverId: string,
    origin: string,
    tokens: McpOAuthTokens,
    generation = this.generationOf(serverId)
  ): Promise<boolean> {
    return this.#write(serverId, origin, generation, (record) => ({ ...record, tokens }));
  }

  async signOut(serverId: string, origin?: string): Promise<number> {
    const generation = await this.#bumpGeneration(serverId);
    if (origin !== undefined) {
      await this.#deleteRef(serverId, origin);
      return generation;
    }
    const previousOrigin = this.#origins.get(serverId);
    if (previousOrigin !== undefined) await this.#deleteRef(serverId, previousOrigin);
    return generation;
  }

  async isCurrent(serverId: string, generation: number): Promise<boolean> {
    return this.generationOf(serverId) === generation;
  }

  async #write(
    serverId: string,
    origin: string,
    generation: number,
    update: (record: McpOAuthCredentialRecord) => McpOAuthCredentialRecord
  ): Promise<boolean> {
    const currentGeneration = this.generationOf(serverId);
    if (generation !== currentGeneration) return false;
    const knownOrigin = this.#origins.get(serverId);
    if (knownOrigin !== undefined && knownOrigin !== origin) return false;
    const existing = await this.load(serverId, origin);
    const record: McpOAuthCredentialRecord = {
      origin,
      generation: currentGeneration,
      ...(existing?.clientInformation !== undefined
        ? { clientInformation: existing.clientInformation }
        : {}),
      ...(existing?.tokens !== undefined ? { tokens: existing.tokens } : {}),
      updatedAtMs: this.#now(),
    };
    const next = update(record);
    await this.#writeRef(serverId, origin, JSON.stringify(next));
    this.#origins.set(serverId, origin);
    return true;
  }

  async #bumpGeneration(serverId: string): Promise<number> {
    const next = this.generationOf(serverId) + 1;
    this.#generations.set(serverId, next);
    return next;
  }

  async #readRef(serverId: string, origin: string): Promise<string | undefined> {
    try {
      return await this.#keychain.read(this.refFor(serverId, origin));
    } catch (thrown) {
      throw new McpCredentialError(
        "MCP_CREDENTIAL_STORE_FAILED",
        thrown instanceof Error ? thrown.message : String(thrown)
      );
    }
  }

  async #writeRef(serverId: string, origin: string, value: string): Promise<void> {
    try {
      await this.#keychain.write(this.refFor(serverId, origin), value);
    } catch (thrown) {
      throw new McpCredentialError(
        "MCP_CREDENTIAL_STORE_FAILED",
        thrown instanceof Error ? thrown.message : String(thrown)
      );
    }
  }

  async #deleteRef(serverId: string, origin: string): Promise<void> {
    try {
      await this.#keychain.delete(this.refFor(serverId, origin));
    } catch (thrown) {
      throw new McpCredentialError(
        "MCP_CREDENTIAL_STORE_FAILED",
        thrown instanceof Error ? thrown.message : String(thrown)
      );
    }
  }
}

function parseRecord(raw: string): McpOAuthCredentialRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.origin !== "string" || typeof record.generation !== "number") return null;
  const tokens = parseTokens(record.tokens);
  const clientInformation = parseClientInformation(record.clientInformation);
  return {
    origin: record.origin,
    generation: record.generation,
    ...(tokens !== undefined ? { tokens } : {}),
    ...(clientInformation !== undefined ? { clientInformation } : {}),
    updatedAtMs: typeof record.updatedAtMs === "number" ? record.updatedAtMs : 0,
  };
}

function parseTokens(value: unknown): McpOAuthTokens | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const tokens = value as Record<string, unknown>;
  if (typeof tokens.accessToken !== "string" || tokens.accessToken.length === 0) return undefined;
  return {
    accessToken: tokens.accessToken,
    ...(typeof tokens.refreshToken === "string" ? { refreshToken: tokens.refreshToken } : {}),
    ...(typeof tokens.expiresAt === "number" ? { expiresAt: tokens.expiresAt } : {}),
    ...(typeof tokens.scope === "string" ? { scope: tokens.scope } : {}),
  };
}

function parseClientInformation(value: unknown): McpOAuthClientInformation | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const info = value as Record<string, unknown>;
  if (typeof info.clientId !== "string" || info.clientId.length === 0) return undefined;
  return {
    clientId: info.clientId,
    ...(typeof info.clientSecret === "string" ? { clientSecret: info.clientSecret } : {}),
  };
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "server"
  );
}
