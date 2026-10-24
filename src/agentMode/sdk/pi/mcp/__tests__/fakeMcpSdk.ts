import type { JsonRpcMessage, McpTransport, McpTransportSendOptions } from "@earendil-works/pi-mcp";
import type { McpClientLike, McpSdkPort } from "@/agentMode/sdk/pi/mcp/McpManager";
import type { McpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";

// Test double for the ESM-only Pi MCP package: the jest runtime cannot load @earendil-works/pi-mcp,
// so tests inject this SDK-shaped port while the manager/transport logic under test stays real.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export class FakeAuthRequiredError extends Error {
  constructor() {
    super("MCP server requires authorization");
    this.name = "McpAuthRequiredError";
  }
}

type MessageListener = (message: JsonRpcMessage) => void;
type ErrorListener = (error: Error) => void;
type CloseListener = () => void;

export class FakeMcpTransport implements McpTransport {
  #peer: FakeMcpTransport | null = null;
  #messageListeners = new Set<MessageListener>();
  #errorListeners = new Set<ErrorListener>();
  #closeListeners = new Set<CloseListener>();
  #started = false;
  closed = false;

  connectPeer(peer: FakeMcpTransport): void {
    this.#peer = peer;
  }

  async start(): Promise<void> {
    this.#started = true;
  }

  async send(message: JsonRpcMessage, _options?: McpTransportSendOptions): Promise<void> {
    if (!this.#started || this.closed) throw new Error("transport is not open");
    const peer = this.#peer;
    if (peer === null || peer.closed) throw new Error("transport peer is not connected");
    const copy = JSON.parse(JSON.stringify(message)) as JsonRpcMessage;
    queueMicrotask(() => peer.#deliver(copy));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.#closeListeners) listener();
    await this.#peer?.close();
  }

  onMessage(listener: MessageListener): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  onClose(listener: CloseListener): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  #deliver(message: JsonRpcMessage): void {
    if (this.closed) return;
    for (const listener of this.#messageListeners) listener(message);
  }
}

export interface FakeMcpServer {
  readonly transport: FakeMcpTransport;
  readonly initializes: () => number;
}

export function createFakeMcpServer(toolCount = 1): FakeMcpServer {
  const client = new FakeMcpTransport();
  const server = new FakeMcpTransport();
  client.connectPeer(server);
  server.connectPeer(client);
  let initializes = 0;
  server.onMessage((message) => {
    const request = message as { id?: string | number | null; method?: string };
    if (request.method === undefined || request.id === undefined || request.id === null) return;
    if (request.method === "initialize") {
      initializes += 1;
      void server.send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake", version: "1.0.0" },
        },
      });
      return;
    }
    if (request.method === "tools/list") {
      void server.send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: Array.from({ length: toolCount }, (_, index) => ({
            name: `tool-${index + 1}`,
            inputSchema: { type: "object" },
          })),
        },
      });
      return;
    }
    void server.send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: "method not found" },
    });
  });
  void server.start();
  return { transport: client, initializes: () => initializes };
}

export class FakeMcpClient implements McpClientLike {
  readonly #authRequired: boolean;
  #nextId = 1;
  closed = false;

  constructor(authRequired = false) {
    this.#authRequired = authRequired;
  }

  async connect(transport: McpTransport): Promise<unknown> {
    if (this.#authRequired) throw new FakeAuthRequiredError();
    await transport.start();
    const response = await this.#request(transport, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vault-agent", version: "1.0.0" },
    });
    await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return response;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async #request(
    transport: McpTransport,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const unsubscribe = transport.onMessage((message) => {
        const response = message as { id?: unknown; result?: unknown; error?: unknown };
        if (response.id !== id) return;
        unsubscribe();
        if (response.error !== undefined) reject(new Error(`MCP error for ${method}`));
        else resolve(response.result);
      });
      void transport.send({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
        unsubscribe();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

export interface FakeSdkOptions {
  readonly failServerIds?: readonly string[];
  readonly authServerIds?: readonly string[];
  readonly toolCount?: number;
}

export interface FakeSdkPort extends McpSdkPort {
  readonly servers: FakeMcpServer[];
  readonly clients: FakeMcpClient[];
  readonly createdServerIds: string[];
}

export function createFakeSdkPort(options: FakeSdkOptions = {}): FakeSdkPort {
  const servers: FakeMcpServer[] = [];
  const clients: FakeMcpClient[] = [];
  const createdServerIds: string[] = [];
  const serverByServerId = new Map<string, FakeMcpServer>();
  return {
    servers,
    clients,
    createdServerIds,
    createClient: (config: McpServerConfig) => {
      const server = createFakeMcpServer(options.toolCount ?? 1);
      const client = new FakeMcpClient(options.authServerIds?.includes(config.serverId) === true);
      servers.push(server);
      clients.push(client);
      createdServerIds.push(config.serverId);
      serverByServerId.set(config.serverId, server);
      return client;
    },
    createTransport: async (config: McpServerConfig) => {
      if (options.failServerIds?.includes(config.serverId) === true) {
        throw new Error("handshake failed");
      }
      const server = serverByServerId.get(config.serverId);
      if (server === undefined) throw new Error("no fake server");
      return server.transport;
    },
    isAuthRequiredError: (thrown) => thrown instanceof FakeAuthRequiredError,
  };
}
