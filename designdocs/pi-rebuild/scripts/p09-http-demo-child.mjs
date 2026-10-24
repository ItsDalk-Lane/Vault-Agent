import * as http from "node:http";
import { McpManager } from "@/agentMode/sdk/pi/mcp/McpManager";
import { McpCatalog } from "@/agentMode/sdk/pi/mcp/McpCatalog";
import { planMcpExposure } from "@/agentMode/sdk/pi/mcp/McpExposure";
import { McpConnectionTester } from "@/agentMode/sdk/pi/mcp/McpConnectionTest";
import { createHttpMcpTransport } from "@/agentMode/sdk/pi/mcp/HttpTransport";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";

// P09-T10 real-endpoint demo: a local Streamable-HTTP MCP server answers initialize and tools/list
// only. The real McpClient + real StreamableHttpTransport run through McpManager, McpCatalog, the
// exposure planner and the bounded Test button; the server records any tools/call so the demo can
// prove the test path had no side effects:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const sdk = await import("@earendil-works/pi-mcp");

let toolListCalls = 0;
let toolCallCalls = 0;
const server = http.createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let message;
    try {
      message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (message.id === undefined || message.id === null) {
      response.writeHead(202).end();
      return;
    }
    const reply = (result) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    };
    if (message.method === "initialize") {
      reply({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "demo-server", version: "1.0.0" },
      });
      return;
    }
    if (message.method === "tools/list") {
      toolListCalls += 1;
      reply({
        tools: [
          {
            name: "demo_echo",
            description: "Echo text",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      });
      return;
    }
    if (message.method === "tools/call") {
      toolCallCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "this demo never executes tools" },
        })
      );
      return;
    }
    reply({});
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const sdkPort = {
  createClient: (config) =>
    new sdk.McpClient({
      name: "vault-agent",
      version: "1.0.0",
      requestTimeoutMs: config.timeoutMs,
    }),
  createTransport: async (config, context) => {
    const handle = await createHttpMcpTransport(config.transport, {
      resolveCredential: context.resolveCredential,
      fetch: globalThis.fetch,
    });
    return handle.transport;
  },
  isAuthRequiredError: (thrown) => thrown instanceof sdk.McpAuthRequiredError,
};
const manager = new McpManager({
  vaultKey: "vault-demo",
  rootId: "root-demo",
  resolveCredential: async () => undefined,
  sdk: sdkPort,
});
const config = normalizeMcpServerConfig({
  serverId: "demo-server",
  scope: "this-vault",
  enabled: true,
  trusted: true,
  transport: { kind: "http", url: `http://127.0.0.1:${port}/mcp`, headerSecretRefs: {} },
});
const connection = await manager.acquire(config);
const managerState = connection.state;
const client = connection.client;

const catalog = new McpCatalog({
  serverId: "demo-server",
  client: {
    listToolsPage: async () => ({ tools: await client.listTools(), nextCursor: null }),
  },
});
const snapshot = await catalog.refresh();
const exposure = planMcpExposure(
  snapshot.tools.map((tool) => ({
    internalName: tool.internalName,
    serverId: tool.serverId,
    toolName: tool.toolName,
    exposure: "direct",
  }))
);

const timer = {
  setTimeout: (callback, ms) => ({ id: setTimeout(callback, ms) }),
  clearTimeout: (handle) => clearTimeout(handle.id),
};
const tester = new McpConnectionTester({
  fingerprint: config.fingerprint,
  connect: async () => ({
    serverInfo: { name: "demo-server", version: "1.0.0" },
    capabilities: { tools: {} },
    listTools: async () => (await client.listTools()).map((tool) => ({ name: tool.name })),
    close: async () => undefined,
  }),
  timer,
  redactor: new Redactor(),
  now: () => Date.now(),
});
const testReport = await tester.run();

const connectionKey = connection.key;
await manager.dispose();
const closedAfterDispose = manager.getState(connectionKey) === "closed";
server.close();

process.stdout.write(
  JSON.stringify({
    result: "passed",
    managerState,
    toolCount: snapshot.tools.length,
    catalogComplete: snapshot.complete,
    internalName: snapshot.tools[0]?.internalName ?? "",
    exposureDirect: exposure.direct.length,
    testStatus: testReport.status,
    testToolCount: testReport.toolCount,
    toolListCalls,
    toolCallCalls,
    closedAfterDispose,
  })
);
