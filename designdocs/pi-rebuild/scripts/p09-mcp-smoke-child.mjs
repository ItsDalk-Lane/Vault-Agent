import { McpManager } from "@/agentMode/sdk/pi/mcp/McpManager";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import {
  createCredentialGuardedFetch,
  loadHttpTransportConstructor,
} from "@/agentMode/sdk/pi/mcp/HttpTransport";

// P09-T02 smoke child: runs the real McpManager against the real public McpClient over the public
// in-memory transport (the jest runtime cannot load the ESM package), and instantiates the real
// StreamableHttpTransport through the production loader to prove the dynamic-import port works:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const sdk = await import("@earendil-works/pi-mcp");
const testing = await import("@earendil-works/pi-mcp/testing");

const pair = testing.createInMemoryTransportPair();
let initializes = 0;
pair.server.onMessage((message) => {
  if (!sdk.isJsonRpcRequest(message)) return;
  const id = message.id ?? null;
  if (message.method === "initialize") {
    initializes += 1;
    void pair.server.send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: sdk.LATEST_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "smoke", version: "1.0.0" },
      },
    });
    return;
  }
  void pair.server.send({ jsonrpc: "2.0", id, result: { tools: [] } });
});
await pair.server.start();

const sdkPort = {
  createClient: (config) =>
    new sdk.McpClient({
      name: "vault-agent",
      version: "1.0.0",
      requestTimeoutMs: config.timeoutMs,
    }),
  createTransport: async () => pair.client,
  isAuthRequiredError: (thrown) => thrown instanceof sdk.McpAuthRequiredError,
};
const manager = new McpManager({
  vaultKey: "vault-smoke",
  rootId: "root-smoke",
  resolveCredential: async () => "Bearer smoke",
  sdk: sdkPort,
});
const config = normalizeMcpServerConfig({
  serverId: "smoke",
  scope: "this-vault",
  transport: { kind: "http", url: "https://mcp.example.com/mcp", headerSecretRefs: {} },
});
const [first, second] = await Promise.all([manager.acquire(config), manager.acquire(config)]);
const sameConnection = first === second;
const initializeCount = initializes;
const connectedState = first.state;
const refCount = first.refCount;
await manager.dispose();
const closedAfterDispose = pair.client.closed === true;

const createTransport = await loadHttpTransportConstructor();
const realTransport = createTransport({
  url: "https://mcp.example.com/mcp",
  headers: { Authorization: "Bearer smoke" },
  fetch: async () => ({ status: 200, headers: { get: () => null } }),
  openGetStream: false,
});
const realTransportName = realTransport.constructor.name;
await realTransport.close();

let crossOriginDenied = "";
try {
  const guarded = createCredentialGuardedFetch({
    allowedOrigin: "https://mcp.example.com",
    headers: async () => ({ Authorization: "Bearer smoke" }),
    fetch: async () => ({ status: 200, headers: { get: () => null } }),
  });
  await guarded("https://evil.example.com/mcp");
} catch (thrown) {
  crossOriginDenied = thrown?.code ?? "";
}

process.stdout.write(
  JSON.stringify({
    result: "passed",
    sameConnection,
    initializeCount,
    connectedState,
    refCount,
    closedAfterDispose,
    realTransportName,
    crossOriginDenied,
  })
);
