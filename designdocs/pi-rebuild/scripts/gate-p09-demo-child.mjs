import { McpSecretRefs } from "@/agentMode/sdk/pi/mcp/McpSecretRefs";
import {
  exportMcpServerConfig,
  normalizeMcpServerConfig,
  type McpServerConfig,
} from "@/agentMode/sdk/pi/mcp/McpConfig";
import { McpManager } from "@/agentMode/sdk/pi/mcp/McpManager";
import { McpCatalog, type McpToolPage } from "@/agentMode/sdk/pi/mcp/McpCatalog";
import { McpToolAdapter } from "@/agentMode/sdk/pi/mcp/McpToolAdapter";
import { McpProgressTracker } from "@/agentMode/sdk/pi/mcp/McpProgress";
import { McpConnectionTester } from "@/agentMode/sdk/pi/mcp/McpConnectionTest";
import { McpCredentialStore } from "@/agentMode/sdk/pi/mcp/McpCredentialStore";
import { McpOAuth } from "@/agentMode/sdk/pi/mcp/McpOAuth";
import { StdioTransportFactory } from "@/agentMode/sdk/pi/mcp/StdioTransportFactory";
import { planMcpExposure, McpExposureController } from "@/agentMode/sdk/pi/mcp/McpExposure";
import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";
import { createFakeSdkPort, FakeMcpTransport } from "@/agentMode/sdk/pi/mcp/__tests__/fakeMcpSdk";

// GATE-P09 child: drives the real P09 modules (config/secret refs, pool, catalog, Durable bridge,
// progress, bounded test, OAuth credentials, stdio policy, exposure) over fake hosts. Real
// pi-mcp client/transport against a live local endpoint is proven by p09-http-demo.mjs:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const report = {};

const keychain = new Map();
const secrets = new McpSecretRefs({
  store: {
    read: async (ref) => keychain.get(ref),
    write: async (ref, value) => {
      keychain.set(ref, value);
    },
    delete: async (ref) => {
      keychain.delete(ref);
    },
  },
});
const authRef = await secrets.store("docs-server", "authorization", "Bearer sk-live-gate");
const config = normalizeMcpServerConfig({
  serverId: "docs-server",
  scope: "this-vault",
  transport: {
    kind: "http",
    url: "https://mcp.example.com/mcp",
    headerSecretRefs: { Authorization: authRef.ref },
  },
});
const exported = exportMcpServerConfig(config);
report.secretRefOnly = !exported.includes("sk-live-gate") && exported.includes("mcp:docs-server:authorization");
let npxRejected = "";
try {
  normalizeMcpServerConfig({
    serverId: "bad",
    transport: {
      kind: "stdio",
      commandPath: "/usr/bin/npx",
      args: ["-y", "server"],
      cwd: "/tmp",
      env: {},
      envSecretRefs: {},
    },
  });
} catch (thrown) {
  npxRejected = thrown?.code ?? "";
}
report.npxRejected = npxRejected === "MCP_COMMAND_EVALUATION_DENIED";

const sdk = createFakeSdkPort();
const manager = new McpManager({
  vaultKey: "vault-gate",
  rootId: "root-gate",
  resolveCredential: async () => "Bearer gate",
  sdk,
});
const [first, second] = await Promise.all([manager.acquire(config), manager.acquire(config)]);
report.poolMerged = first === second && sdk.servers.length === 1 && sdk.servers[0].initializes() === 1;
const connectionKey = first.key;
await manager.dispose();
report.poolClosed = manager.getState(connectionKey) === "closed" && sdk.servers[0].transport.closed === true;

const pages = new Map();
for (let index = 0; index < 600; index += 1) {
  const page = index < 200 ? "" : index < 400 ? "c-200" : "c-400";
  const entry = pages.get(page) ?? { tools: [], nextCursor: null };
  entry.tools.push({
    name: `tool-${index}`,
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
  });
  entry.nextCursor = index === 199 ? "c-200" : index === 399 ? "c-400" : null;
  pages.set(page, entry);
}
pages.set("", {
  tools: [
    ...(pages.get("").tools ?? []),
    { name: "evil", inputSchema: { type: "object", properties: {}, required: ["missing"] } },
  ],
  nextCursor: "c-200",
});
const catalog = new McpCatalog({
  serverId: "docs-server",
  client: { listToolsPage: async (cursor) => pages.get(cursor ?? "") ?? { tools: [], nextCursor: null } },
});
const snapshot = await catalog.refresh();
report.catalogBounded =
  snapshot.tools.length + snapshot.disabled.length === 500 && snapshot.complete === false;
report.schemaDisabled = snapshot.disabled.some((entry) => entry.toolName === "evil");

const adapterClient = {
  calls: 0,
  async callTool(name, args, options) {
    this.calls += 1;
    options?.onProgress?.({ progress: 1, total: 2, message: "half" });
    return { content: [{ type: "text", text: "boom" }], isError: true };
  },
};
const updates = [];
const adapter = new McpToolAdapter({
  serverId: "docs-server",
  catalog,
  client: adapterClient,
  supportsImages: false,
  onExecutionUpdate: (update) => updates.push(update),
});
const toolName = snapshot.tools[0].internalName;
const denied = await adapter.executeTool(toolName, { q: "x" }, { callId: "call-gate" }, {});
report.unknownEffectsDenied = denied.isError === true && adapterClient.calls === 0;
const adapterAllowed = new McpToolAdapter({
  serverId: "docs-server",
  catalog,
  client: adapterClient,
  riskFor: () => ({ effects: ["network"], unknownEffects: false }),
  gateway: { authorize: async () => ({ allowed: true }) },
  supportsImages: false,
  onExecutionUpdate: (update) => updates.push(update),
});
const result = await adapterAllowed.executeTool(toolName, { q: "x" }, { callId: "call-gate" }, {});
report.isErrorKept = result.isError === true && JSON.stringify(result.output).includes("boom");
report.progressMapped = updates.some((update) => update.toolCallId === "call-gate" && update.total === 2);

const tracker = new McpProgressTracker({ now: () => 0, secretValues: ["sk-live-gate"] });
tracker.bind({
  hostToolCallId: "call-gate",
  serverId: "docs-server",
  toolName,
  progressToken: "token-1",
});
tracker.update({
  serverId: "docs-server",
  toolName,
  notification: { progressToken: "token-1", progress: 1, total: 2 },
});
const terminal = tracker.finish("call-gate", "timed_out");
report.progressTerminal = terminal.lastPercent === 50 && terminal.note.includes("side effects are unknown");
const lateUpdate = tracker.update({
  serverId: "docs-server",
  toolName,
  notification: { progressToken: "token-1", progress: 2, total: 2 },
});
report.lateProgressDropped = lateUpdate === null;

const timer = {
  nowMs: 0,
  entries: new Map(),
  nextId: 1,
  setTimeout(callback, ms) {
    const id = this.nextId++;
    this.entries.set(id, { at: this.nowMs + ms, callback });
    return { id };
  },
  clearTimeout(handle) {
    this.entries.delete(handle.id);
  },
  advance(ms) {
    this.nowMs += ms;
    for (const [id, entry] of [...this.entries.entries()].sort((l, r) => l[1].at - r[1].at)) {
      if (entry.at > this.nowMs) continue;
      this.entries.delete(id);
      entry.callback();
    }
  },
};
const tester = new McpConnectionTester({
  fingerprint: "gate",
  connect: (input) =>
    new Promise((_resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  timer,
  redactor: new Redactor({ secretValues: ["sk-live-gate"] }),
  now: () => timer.nowMs,
});
const testRun = tester.run();
timer.advance(20_000);
const testReport = await testRun;
report.testTimeout = testReport.status === "timed_out";
const redactingTester = new McpConnectionTester({
  fingerprint: "redact",
  connect: async () => {
    throw new Error(`${"x".repeat(1_990)}sk-live-gate${"y".repeat(100)}`);
  },
  timer,
  redactor: new Redactor({ secretValues: ["sk-live-gate"] }),
  now: () => timer.nowMs,
});
const redactedReport = await redactingTester.run();
report.testRedacted =
  redactedReport.error !== undefined &&
  !redactedReport.error.includes("sk-live") &&
  redactedReport.error.length <= 2_000;

const credentialStore = new McpCredentialStore({
  keychain: {
    read: async (ref) => keychain.get(ref),
    write: async (ref, value) => {
      keychain.set(ref, value);
    },
    delete: async (ref) => {
      keychain.delete(ref);
    },
  },
  now: () => 0,
});
let authorizeStarted = false;
const oauthFlow = {
  begin: async () => ({
    redirectUrl: "http://127.0.0.1:1234/callback",
    start: async () => {
      authorizeStarted = true;
      return { status: "REDIRECT", state: "state-gate" };
    },
    waitForCallback: async (state) => ({ code: "code-gate", state }),
    exchange: async () => ({ accessToken: "access-gate", expiresAt: 5_000 }),
    tokens: async () => undefined,
    refresh: async () => undefined,
    close: async () => undefined,
  }),
};
const oauth = new McpOAuth({
  serverId: "docs-server",
  serverUrl: "https://mcp.example.com/mcp",
  scopes: ["read"],
  store: credentialStore,
  flow: oauthFlow,
  timer,
  now: () => 0,
});
const oauthResult = await oauth.authorize();
report.oauthAuthorized = authorizeStarted && oauthResult.status === "authorized";
const oauthAccess = await oauth.accessToken();
report.oauthCredentialRef = oauthAccess?.tokens.accessToken === "access-gate";
await oauth.signOut();
const afterSignOut = await oauth.accessToken();
report.oauthSignOut = afterSignOut === undefined;

const stdioFactory = new StdioTransportFactory({
  environment: new CommandEnvironment({
    platform: "darwin",
    parentEnv: { PATH: "/usr/bin:/bin", HOME: "/Users/example", ANTHROPIC_API_KEY: "sk-model" },
  }),
  exists: async () => true,
  createTransport: () => new FakeMcpTransport(),
  terminate: { terminate: async () => "confirmed" },
  resolveSecret: async () => "server-secret",
  defaultMode: "trusted_host",
  defaultRiskAuthorized: true,
});
const stdioHandle = await stdioFactory.create({
  serverId: "local-server",
  config: {
    kind: "stdio",
    commandPath: "/usr/local/bin/mcp-server",
    args: ["--stdio"],
    cwd: "/tmp",
    env: { LOG_LEVEL: "info" },
    envSecretRefs: { MCP_TOKEN: "mcp:local-server:token" },
  },
  mode: "trusted_host",
  riskAuthorized: true,
  interpreterAvailable: true,
});
report.stdioEnvIsolated =
  stdioHandle.plan.inheritEnv === false &&
  stdioHandle.plan.env.MCP_TOKEN === "server-secret" &&
  stdioHandle.plan.env.ANTHROPIC_API_KEY === undefined;
let strictDenied = "";
try {
  await stdioFactory.create({
    serverId: "local-server",
    config: {
      kind: "stdio",
      commandPath: "/usr/local/bin/mcp-server",
      args: [],
      cwd: "/tmp",
      env: {},
      envSecretRefs: {},
    },
    mode: "strict",
    riskAuthorized: true,
    interpreterAvailable: true,
  });
} catch (thrown) {
  strictDenied = thrown?.code ?? "";
}
report.stdioStrictDenied = strictDenied === "MCP_STDIO_STRICT_DENIED";
const closed = await stdioHandle.close();
report.stdioClosed = closed.cleanup === "clean";

const exposureTools = [
  { internalName: "mcp_docs_a", serverId: "docs-server", toolName: "a", exposure: "direct" },
  { internalName: "mcp_docs_b", serverId: "docs-server", toolName: "b", exposure: "deferred" },
  { internalName: "mcp_docs_c", serverId: "docs-server", toolName: "c", exposure: "hidden" },
];
const exposurePlan = planMcpExposure(exposureTools);
const exposureController = new McpExposureController({ tools: exposureTools });
let hiddenDenied = false;
try {
  await exposureController.load("mcp_docs_c");
} catch (thrown) {
  hiddenDenied = thrown?.code === "MCP_EXPOSURE_HIDDEN";
}
const loaded = await exposureController.load("mcp_docs_b");
report.exposureSelection =
  exposurePlan.hidden.length === 1 &&
  hiddenDenied &&
  loaded.includes("mcp_docs_b") &&
  !exposureController.canCall("mcp_docs_c");

report.result = "passed";
process.stdout.write(JSON.stringify(report));
