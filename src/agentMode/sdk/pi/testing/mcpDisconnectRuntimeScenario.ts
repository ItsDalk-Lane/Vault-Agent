import type { App } from "obsidian";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionUpdate } from "@/agentMode/session/types";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { mcpToolName } from "@/agentMode/sdk/pi/mcp/McpToolNames";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");
const http = requireNodeModule<typeof import("node:http")>("node:http");
const childProcess = requireNodeModule<typeof import("node:child_process")>("node:child_process");

interface PhaseReport {
  readonly status: "passed";
  readonly modelCalls: number;
  readonly approvals: number;
  readonly interruptedResult?: boolean;
  readonly checks?: readonly string[];
  readonly externalCalls?: number;
}

interface HttpRequest {
  readonly id?: number;
  readonly method?: string;
  readonly params?: {
    readonly name?: string;
    readonly arguments?: { readonly operation?: string };
  };
}

export async function runMcpDisconnectRuntimeScenario(directory: string): Promise<PhaseReport> {
  const phase = process.env.PI_MCP_DISCONNECT_PHASE ?? "all";
  const sessionId = "root-mcp-interrupted-effect";
  if (phase === "all") {
    const calls: HttpRequest[] = [];
    let announceRequest!: (response: import("node:http").ServerResponse) => void;
    const requestReceived = new Promise<import("node:http").ServerResponse>((resolve) => {
      announceRequest = resolve;
    });
    const server = http.createServer((request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const chunks: Uint8Array[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(Uint8Array.from(chunk)));
      request.on("end", () => {
        const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HttpRequest;
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        if (message.method === "tools/call") {
          calls.push(message);
          announceRequest(response);
          return;
        }
        const result =
          message.method === "initialize"
            ? {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "disconnect-fixture", version: "1" },
              }
            : message.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "apply",
                      description: "Perform one unknown external effect",
                      inputSchema: {
                        type: "object",
                        properties: { operation: { type: "string" } },
                        required: ["operation"],
                      },
                    },
                  ],
                }
              : {};
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      });
    });
    const sockets = new Set<import("node:net").Socket>();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => {
        sockets.delete(socket);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/mcp`;
    const children = new Set<import("node:child_process").ChildProcess>();
    const launch = (childPhase: string) => {
      const child = childProcess.spawn(process.execPath, [process.argv[1], directory], {
        env: { ...process.env, PI_MCP_DISCONNECT_PHASE: childPhase, PI_MCP_DISCONNECT_URL: url },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.add(child);
      let output = "";
      let errors = "";
      child.stdout.on("data", (data: Buffer) => {
        output += data.toString("utf8");
      });
      child.stderr.on("data", (data: Buffer) => {
        errors += data.toString("utf8");
      });
      const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code, signal) => {
            children.delete(child);
            resolve({ code, signal });
          });
        }
      );
      return {
        child,
        done,
        report: async (): Promise<PhaseReport> => {
          const end = await done;
          assert.equal(end.code, 0, errors);
          return JSON.parse(output.trim().split("\n").at(-1)!) as PhaseReport;
        },
      };
    };
    try {
      const crash = launch("crash");
      const pendingResponse = await Promise.race([
        requestReceived,
        crash.done.then((end) => {
          throw new Error(
            `Backend exited before HTTP request reached server: ${JSON.stringify(end)}`
          );
        }),
      ]);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].params?.name, "apply");
      assert.deepEqual(calls[0].params?.arguments, {
        operation: "one accepted effect before lost reply",
      });
      assert.equal(
        pendingResponse.headersSent,
        false,
        "the service has received the request but has not returned any response"
      );
      assert.equal(pendingResponse.writableEnded, false);
      // 真进程在服务端确认收包后退出，既不替换传输客户端，也不把请求尚未发出当作未知结果。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      assert.equal(crash.child.kill("SIGKILL"), true);
      assert.equal((await crash.done).signal, "SIGKILL");
      pendingResponse.destroy();
      const read = await launch("read").report();
      assert.equal(read.modelCalls, 0);
      assert.equal(read.approvals, 0);
      assert.equal(
        calls.length,
        1,
        "opening the actual crashed store must not resend the external request"
      );
      const continued = await launch("continue").report();
      assert.equal(continued.modelCalls, 0);
      assert.equal(continued.approvals, 0);
      assert.equal(continued.interruptedResult, true);
      assert.equal(
        calls.length,
        1,
        "the durable unknown-effect gate must block Continue without replaying the original operation"
      );
      const after = await launch("read").report();
      assert.equal(after.modelCalls, 0);
      assert.equal(after.approvals, 0);
      assert.equal(calls.length, 1);
      return {
        status: "passed",
        modelCalls: continued.modelCalls,
        approvals: continued.approvals,
        externalCalls: calls.length,
        checks: [
          "actual_http_request_received_before_reply_and_process_killed",
          "cold_open_and_export_do_not_resend_external_request_or_start_model",
          "explicit_continue_is_blocked_until_the_remote_effect_can_be_proven",
          "unknown_effect_recovery_is_visible_without_another_model_request",
          "second_cold_open_preserves_unknown_effect_with_zero_external_or_model_replay",
        ],
      };
    } finally {
      for (const child of children) child.kill("SIGKILL");
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
  const url = process.env.PI_MCP_DISCONNECT_URL;
  assert.ok(url);
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const config = normalizeMcpServerConfig({
    serverId: "disconnect",
    enabled: true,
    trusted: true,
    scope: "this-vault",
    toolExposure: "direct",
    transport: { kind: "http", url, headerSecretRefs: {} },
  });
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        baseUrl: "https://fixture.invalid/v1",
        origin: { kind: "byok" },
        apiKeyKeychainId: "key",
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "saved",
        providerId: "fixture",
        info: { id: "model", toolCall: true, limits: { context: 200_000, output: 4096 } },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      backends: { pi: { mcpServers: [config] } },
      skills: { folder: "skills" },
    },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [],
      getMarkdownFiles: () => [],
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const faux = fauxProvider();
  const backend = new PiBackendProcess({
    host: {
      app,
      fetch: window.fetch,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "mcp-disconnect",
        getSecretById: (id) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  });
  let approvals = 0;
  const updates: SessionUpdate[] = [];
  backend.setPermissionPrompter(async () => {
    approvals += 1;
    return {
      outcome: { outcome: "selected", optionId: phase === "crash" ? "allow_once" : "reject_once" },
    };
  });
  try {
    await backend.start();
    if (phase === "crash") {
      await backend.newSession({ sessionId, cwd: vaultRoot });
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall(mcpToolName("disconnect", "apply"), {
              operation: "one accepted effect before lost reply",
            }),
          ],
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage("no reply may finish before process crash"),
      ]);
      await backend.prompt({
        sessionId,
        requestId: "mcp-request-before-crash",
        prompt: [{ type: "text", text: "执行一次已确认但回复尚未返回的外部操作" }],
      });
      throw new Error("the parent must kill this process before any external reply");
    }
    backend.registerSessionHandler(sessionId, (event) => updates.push(event.update));
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    const before = await backend.exportSession({ sessionId, format: "json" });
    assert.ok(before.content.includes("mcp-request-before-crash"));
    assert.equal(faux.state.callCount, 0);
    if (phase === "read") return { status: "passed", modelCalls: faux.state.callCount, approvals };
    await backend.recoverSession({ sessionId, action: "reconcile" });
    await assert.rejects(
      backend.recoverSession({ sessionId, action: "continue" }),
      /needs_reconciliation/
    );
    assert.equal(faux.state.callCount, 0);
    const interruptedResult = updates.some(
      (update) =>
        update.sessionUpdate === "recovery_state" &&
        update.recovery.status === "read_only" &&
        update.recovery.pendingMutationIds.some((id) => id.startsWith("mcp:disconnect:"))
    );
    assert.equal(
      interruptedResult,
      true,
      "the persisted unknown result must be visible without waking the model or replaying the operation"
    );
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state?.readOnly, true);
    return { status: "passed", modelCalls: faux.state.callCount, approvals, interruptedResult };
  } finally {
    await backend.shutdown();
  }
}
