import type { McpFetch, McpTransport } from "@earendil-works/pi-mcp";
import type { McpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import {
  createHttpMcpTransport,
  type McpCredentialResolver,
} from "@/agentMode/sdk/pi/mcp/HttpTransport";

// Connections are pooled per vault + root + scope + fingerprint: the same key shares one handshake
// even under concurrent acquires, a different vault never reuses another vault's connection, a
// failed connect is cleaned up so the next attempt can retry, and dispose closes everything. MCP is
// additive: a failed server never touches the local Vault tools. The locked Pi MCP package is ESM,
// so the SDK port is injected in tests and created with a dynamic import in production:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type McpConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "auth_required"
  | "error"
  | "closing"
  | "closed";

export interface McpClientLike {
  connect(transport: McpTransport): Promise<unknown>;
  close(): Promise<void> | void;
}

export interface McpConnection {
  readonly key: string;
  readonly vaultKey: string;
  readonly rootId: string;
  readonly scopeId: string;
  readonly config: McpServerConfig;
  readonly client: McpClientLike;
  transport: McpTransport | null;
  state: McpConnectionState;
  refCount: number;
  error?: string;
}

export interface McpSdkPort {
  createClient(config: McpServerConfig): McpClientLike;
  createTransport(
    config: McpServerConfig,
    context: { readonly resolveCredential: McpCredentialResolver; readonly fetch?: McpFetch }
  ): Promise<McpTransport>;
  isAuthRequiredError(thrown: unknown): boolean;
}

export type McpManagerErrorCode = "MCP_MANAGER_DISPOSED" | "MCP_TRANSPORT_UNSUPPORTED";

export class McpManagerError extends Error {
  readonly code: McpManagerErrorCode;

  constructor(code: McpManagerErrorCode, message: string) {
    super(message);
    this.name = "McpManagerError";
    this.code = code;
  }
}

export interface McpManagerOptions {
  readonly vaultKey: string;
  readonly rootId: string;
  readonly resolveCredential: McpCredentialResolver;
  readonly sdk?: McpSdkPort;
  readonly fetch?: McpFetch;
  readonly onStateChange?: (connection: McpConnection) => void;
}

export async function loadPiMcpSdk(): Promise<McpSdkPort> {
  const sdk = await import("@earendil-works/pi-mcp");
  return {
    createClient: (config) =>
      new sdk.McpClient({
        name: "vault-agent",
        version: "1.0.0",
        requestTimeoutMs: config.timeoutMs,
      }),
    createTransport: async (config, context) => {
      if (config.transport.kind !== "http") {
        throw new McpManagerError(
          "MCP_TRANSPORT_UNSUPPORTED",
          "The stdio MCP transport is not wired yet."
        );
      }
      const handle = await createHttpMcpTransport(config.transport, {
        resolveCredential: context.resolveCredential,
        ...(context.fetch !== undefined ? { fetch: context.fetch } : {}),
      });
      return handle.transport;
    },
    isAuthRequiredError: (thrown) => thrown instanceof sdk.McpAuthRequiredError,
  };
}

export function mcpConnectionKey(parts: {
  vaultKey: string;
  rootId: string;
  scopeId: string;
  fingerprint: string;
}): string {
  return [parts.vaultKey, parts.rootId, parts.scopeId, parts.fingerprint].join("|");
}

export class McpManager {
  readonly #vaultKey: string;
  readonly #rootId: string;
  readonly #resolveCredential: McpCredentialResolver;
  readonly #sdk: McpSdkPort | undefined;
  readonly #fetch: McpFetch | undefined;
  readonly #onStateChange: ((connection: McpConnection) => void) | undefined;
  readonly #pool = new Map<string, McpConnection>();
  readonly #connecting = new Map<string, Promise<McpConnection>>();
  readonly #states = new Map<string, { state: McpConnectionState; error?: string }>();
  readonly #serverIds = new Map<string, string>();
  #sdkPromise: Promise<McpSdkPort> | null = null;
  #disposed = false;

  constructor(options: McpManagerOptions) {
    this.#vaultKey = options.vaultKey;
    this.#rootId = options.rootId;
    this.#resolveCredential = options.resolveCredential;
    this.#sdk = options.sdk;
    this.#fetch = options.fetch;
    this.#onStateChange = options.onStateChange;
  }

  async acquire(config: McpServerConfig): Promise<McpConnection> {
    if (this.#disposed) {
      throw new McpManagerError("MCP_MANAGER_DISPOSED", "The MCP manager is disposed.");
    }
    const key = this.keyOf(config);
    const connecting = this.#connecting.get(key);
    if (connecting !== undefined) {
      const connection = await connecting;
      connection.refCount += 1;
      return connection;
    }
    const existing = this.#pool.get(key);
    if (existing !== undefined && existing.state === "connected") {
      existing.refCount += 1;
      return existing;
    }
    const promise = this.#open(config, key);
    this.#connecting.set(key, promise);
    try {
      const connection = await promise;
      connection.refCount += 1;
      return connection;
    } finally {
      if (this.#connecting.get(key) === promise) this.#connecting.delete(key);
    }
  }

  async release(configOrKey: McpServerConfig | string): Promise<boolean> {
    const key = typeof configOrKey === "string" ? configOrKey : this.keyOf(configOrKey);
    const connection = this.#pool.get(key);
    if (connection === undefined) return false;
    connection.refCount = Math.max(0, connection.refCount - 1);
    if (connection.refCount > 0) return true;
    this.#pool.delete(key);
    await this.#closeConnection(connection);
    return true;
  }

  async invalidateServer(serverId: string): Promise<void> {
    const matches = [...this.#pool.values()].filter(
      (connection) => connection.config.serverId === serverId
    );
    for (const connection of matches) {
      this.#pool.delete(connection.key);
      await this.#closeConnection(connection);
    }
    for (const [key, knownServerId] of this.#serverIds) {
      if (knownServerId !== serverId || this.#pool.has(key)) continue;
      this.#states.set(key, { state: "closed" });
    }
  }

  async handleConfigChange(previous: McpServerConfig, next: McpServerConfig): Promise<void> {
    if (previous.fingerprint === next.fingerprint) return;
    await this.invalidateServer(next.serverId);
  }

  getConnection(key: string): McpConnection | undefined {
    return this.#pool.get(key);
  }

  getState(key: string): McpConnectionState | undefined {
    return this.#pool.get(key)?.state ?? this.#states.get(key)?.state;
  }

  get error(): string | undefined {
    for (const entry of this.#states.values()) {
      if (entry.error !== undefined) return entry.error;
    }
    return undefined;
  }

  get size(): number {
    return this.#pool.size;
  }

  keyOf(config: McpServerConfig): string {
    return mcpConnectionKey({
      vaultKey: this.#vaultKey,
      rootId: this.#rootId,
      scopeId: this.#scopeIdOf(config),
      fingerprint: config.fingerprint,
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const connections = [...this.#pool.values()];
    this.#pool.clear();
    for (const connection of connections) {
      await this.#closeConnection(connection);
    }
  }

  async #open(config: McpServerConfig, key: string): Promise<McpConnection> {
    const frozen: McpServerConfig = Object.freeze({
      ...config,
      transport: Object.freeze(config.transport),
      credentialRefs: Object.freeze([...config.credentialRefs]),
    });
    const sdk = await this.#sdkPort();
    const client = sdk.createClient(frozen);
    const connection: McpConnection = {
      key,
      vaultKey: this.#vaultKey,
      rootId: this.#rootId,
      scopeId: this.#scopeIdOf(frozen),
      config: frozen,
      client,
      transport: null,
      state: "connecting",
      refCount: 0,
    };
    this.#pool.set(key, connection);
    this.#serverIds.set(key, frozen.serverId);
    this.#setState(connection, "connecting");
    try {
      const transport = await sdk.createTransport(frozen, {
        resolveCredential: this.#resolveCredential,
        ...(this.#fetch !== undefined ? { fetch: this.#fetch } : {}),
      });
      connection.transport = transport;
      await client.connect(transport);
      this.#setState(connection, "connected");
      return connection;
    } catch (thrown) {
      const authRequired = sdk.isAuthRequiredError(thrown);
      connection.error = thrown instanceof Error ? thrown.message : String(thrown);
      this.#setState(connection, authRequired ? "auth_required" : "error", connection.error);
      this.#pool.delete(key);
      await this.#closeConnection(connection);
      this.#states.set(key, {
        state: authRequired ? "auth_required" : "error",
        ...(connection.error !== undefined ? { error: connection.error } : {}),
      });
      throw thrown;
    }
  }

  async #closeConnection(connection: McpConnection): Promise<void> {
    if (connection.state === "closed") return;
    this.#setState(connection, "closing");
    try {
      await connection.transport?.close();
    } finally {
      try {
        await connection.client.close();
      } finally {
        this.#setState(connection, "closed");
      }
    }
  }

  #setState(connection: McpConnection, state: McpConnectionState, error?: string): void {
    connection.state = state;
    if (error !== undefined) connection.error = error;
    this.#states.set(connection.key, {
      state,
      ...(connection.error !== undefined ? { error: connection.error } : {}),
    });
    this.#onStateChange?.(connection);
  }

  #scopeIdOf(config: McpServerConfig): string {
    if (config.scope === "global") return "global";
    if (config.scope === "this-vault") return `vault:${this.#vaultKey}`;
    return `project:${this.#rootId}`;
  }

  async #sdkPort(): Promise<McpSdkPort> {
    if (this.#sdk !== undefined) return this.#sdk;
    this.#sdkPromise ??= loadPiMcpSdk();
    return this.#sdkPromise;
  }
}
