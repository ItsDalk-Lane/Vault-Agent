import type { McpClient, StdioTransport } from "@earendil-works/pi-mcp";
import type { VaultAgentSettings } from "@/settings/model";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { PiMcpService } from "@/agentMode/sdk/pi/mcp/PiMcpService";
import { StdioTransportFactory } from "@/agentMode/sdk/pi/mcp/StdioTransportFactory";
import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import { requireNodeModule } from "@/utils/desktopRuntime";

interface ProcessObservation {
  readonly nonce: string;
  readonly pid: number;
  readonly initialized: number;
  readonly listed: number;
  readonly serverSecretPresent: boolean;
  readonly visibleEnvironmentPresent: boolean;
  readonly modelApiKeyPresent: boolean;
}

interface StopReceipt {
  readonly nonce: string;
  readonly pid: number;
  readonly signal: string;
  readonly stdinClosed: boolean;
}

// 诊断服务在 stdin 关闭后继续存活，必须由真实 SDK 发出终止信号；仅写本次临时目录内的退出凭据。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const SERVER_SOURCE = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const nonce = process.argv[2];
const receiptPath = process.argv[3];
let initialized = 0;
let listed = 0;
let stdinClosed = false;
const keepAlive = setInterval(() => undefined, 60000);
fs.writeFileSync(receiptPath + ".started", JSON.stringify({ nonce, pid: process.pid }));
process.on("SIGTERM", () => {
  fs.writeFileSync(receiptPath, JSON.stringify({ nonce, pid: process.pid, signal: "SIGTERM", stdinClosed }));
  clearInterval(keepAlive);
  process.exit(0);
});
const input = readline.createInterface({ input: process.stdin, terminal: false });
input.on("close", () => { stdinClosed = true; });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === "initialize") {
    initialized += 1;
    result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "vault-agent-stdio-diagnostic", version: "1" } };
  } else if (message.method === "tools/list") {
    listed += 1;
    result = { tools: [{ name: "process_status", description: "Return this diagnostic process identity.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] };
  } else if (message.method === "tools/call" && message.params.name === "process_status") {
    const status = { nonce, pid: process.pid, initialized, listed, serverSecretPresent: process.env.MCP_STDIO_TEST_TOKEN === "diagnostic-server-secret", visibleEnvironmentPresent: process.env.MCP_DIAGNOSTIC_VISIBLE === "yes", modelApiKeyPresent: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"].some((key) => process.env[key] !== undefined) };
    result = { content: [{ type: "text", text: JSON.stringify(status) }] };
  } else if (message.method === "ping") result = {};
  else {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unsupported diagnostic method" } }) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
});
`;

export async function runMcpStdioRuntimeScenario(directory: string) {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const crypto = requireNodeModule<typeof import("node:crypto")>("node:crypto");
  const sdk = await import("@earendil-works/pi-mcp");
  await fs.mkdir(directory, { recursive: true });
  const commandPath = await fs.realpath(process.execPath);
  const cwd = await fs.realpath(directory);
  const script = path.join(cwd, "stdio-diagnostic.cjs");
  await fs.writeFile(script, SERVER_SOURCE);
  const nonce = crypto.randomUUID();
  const serviceReceipt = path.join(cwd, "service-stop.json");
  const factoryReceipt = path.join(cwd, "factory-stop.json");
  const config = (receiptPath: string) =>
    normalizeMcpServerConfig({
      serverId: "stdio-diagnostic",
      displayName: "Local stdio diagnostic",
      enabled: true,
      trusted: true,
      scope: "this-vault",
      transport: {
        kind: "stdio",
        commandPath,
        args: [script, nonce, receiptPath],
        cwd,
        env: { MCP_DIAGNOSTIC_VISIBLE: "yes" },
        envSecretRefs: { MCP_STDIO_TEST_TOKEN: "mcp:stdio-diagnostic:token" },
      },
      timeoutMs: 5000,
    });
  const serviceConfig = config(serviceReceipt);
  const localPolicy = {
    hostExecutionMode: "strict" as "strict" | "trusted_host",
    mcpServers: [serviceConfig],
  };
  const settings = {
    agentMode: { backends: { pi: localPolicy } },
  } as unknown as VaultAgentSettings;
  let approvals = 0;
  const service = new PiMcpService({
    sessionId: "root-stdio-diagnostic",
    vaultId: `stdio-diagnostic-${nonce}`,
    getSettings: () => settings,
    getMode: () => "default",
    keychain: {
      isAvailable: () => true,
      getVaultId: () => "stdio-diagnostic",
      getSecretById: (id) =>
        id === "mcp:stdio-diagnostic:token" ? "diagnostic-server-secret" : null,
      setSecretById: () => undefined,
      deleteSecretById: () => undefined,
    },
    requestPermission: async (prompt) => {
      assert.deepEqual(prompt.toolCall.rawInput, {
        commandPath,
        args: [script, nonce, serviceReceipt],
        cwd,
      });
      approvals += 1;
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    },
  });
  let directTransport: StdioTransport | undefined;
  let directClient: McpClient | undefined;
  const processes: {
    label: string;
    pid: number;
    exited: boolean;
    signal: string;
    stdinClosed: boolean;
  }[] = [];
  const absent = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
  };
  const readIdentity = async (client: McpClient): Promise<ProcessObservation> => {
    const response = await client.callTool("process_status", {});
    const text = response.content.find((item) => item.type === "text");
    assert.ok(text?.type === "text");
    const observed = JSON.parse(text.text) as ProcessObservation;
    assert.equal(observed.nonce, nonce);
    assert.ok(Number.isInteger(observed.pid) && observed.pid > 0 && observed.pid !== process.pid);
    assert.equal(absent(observed.pid), false);
    assert.equal(observed.initialized, 1);
    assert.ok(observed.listed >= 1);
    assert.equal(observed.serverSecretPresent, true);
    assert.equal(observed.visibleEnvironmentPresent, true);
    assert.equal(observed.modelApiKeyPresent, false);
    return observed;
  };
  const proveExit = async (label: string, receiptPath: string, pid: number) => {
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8")) as StopReceipt;
    assert.deepEqual(receipt, { nonce, pid, signal: "SIGTERM", stdinClosed: true });
    assert.equal(
      absent(pid),
      true,
      `${label}: the exact original OS process must be gone before close resolves`
    );
    processes.push({
      label,
      pid,
      exited: true,
      signal: receipt.signal,
      stdinClosed: receipt.stdinClosed,
    });
  };
  try {
    await assert.rejects(service.connect(serviceConfig.serverId), /Enable trusted host/);
    await assert.rejects(fs.access(`${serviceReceipt}.started`), { code: "ENOENT" });
    assert.equal(approvals, 0);
    localPolicy.hostExecutionMode = "trusted_host";
    const catalog = await service.connect(serviceConfig.serverId);
    assert.deepEqual(
      catalog.snapshot.tools.map((tool) => tool.toolName),
      ["process_status"]
    );
    const client = service.getClient(serviceConfig.serverId);
    assert.ok(client);
    assert.equal(client.serverInfo?.name, "vault-agent-stdio-diagnostic");
    const serviceProcess = await readIdentity(client);
    await service.dispose();
    await proveExit("production_service_manager", serviceReceipt, serviceProcess.pid);
    assert.equal(approvals, 1);
    const directConfig = config(factoryReceipt);
    assert.equal(directConfig.transport.kind, "stdio");
    if (directConfig.transport.kind !== "stdio") throw new Error("Expected a stdio configuration");
    const factory = new StdioTransportFactory({
      environment: new CommandEnvironment({
        platform:
          process.platform === "win32"
            ? "win32"
            : process.platform === "darwin"
              ? "darwin"
              : "linux",
        parentEnv: {
          ...process.env,
          OPENAI_API_KEY: "must-not-reach-child",
          ANTHROPIC_API_KEY: "must-not-reach-child",
        },
      }),
      exists: (target) =>
        fs.access(target).then(
          () => true,
          () => false
        ),
      createTransport: (plan) =>
        (directTransport = new sdk.StdioTransport({
          command: plan.command,
          args: plan.args,
          cwd: plan.cwd,
          env: { ...plan.env },
          inheritEnv: plan.inheritEnv,
        })),
      resolveSecret: async () => "diagnostic-server-secret",
      terminate: {
        terminate: async () =>
          directPid !== undefined && absent(directPid) ? "confirmed" : "incomplete",
      },
    });
    let directPid: number | undefined;
    const handle = await factory.create({
      serverId: directConfig.serverId,
      config: directConfig.transport,
      mode: "trusted_host",
      riskAuthorized: true,
    });
    directClient = new sdk.McpClient({
      name: "vault-agent-stdio-diagnostic",
      version: "1",
      requestTimeoutMs: 5000,
    });
    await directClient.connect(handle.transport);
    await directClient.listTools();
    const factoryProcess = await readIdentity(directClient);
    directPid = factoryProcess.pid;
    assert.equal(directTransport?.pid, directPid);
    assert.deepEqual(await handle.close(), { status: "closed", cleanup: "clean" });
    await proveExit("factory_handle", factoryReceipt, directPid);
    await directClient.close();
    const orphanedProcesses = processes.filter((entry) => !absent(entry.pid)).length;
    assert.equal(orphanedProcesses, 0);
    return {
      status: "passed",
      scenarioId: "SC-P09-T08-04",
      scope: "actual_local_stdio_mcp_os_processes_no_obsidian_no_ai_model",
      platform: process.platform,
      commandPath,
      approvals,
      processes,
      orphanedProcesses,
      checks: [
        "strict_gate_spawns_no_os_process",
        "actual_sdk_initialize_list_and_call_over_stdio",
        "production_service_manager_close_terminates_original_pid",
        "factory_handle_close_requires_verified_os_process_exit",
        "stdin_close_is_followed_by_real_sigterm_not_only_fake_cleanup",
        "actual_child_environment_does_not_inherit_model_keys",
      ],
    };
  } finally {
    await service.dispose();
    await directClient?.close();
    await directTransport?.close();
  }
}
