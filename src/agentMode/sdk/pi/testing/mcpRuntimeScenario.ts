import type { ProviderStreamsFactory } from "@/agentMode/sdk/pi/models/ProviderFactory";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { isSummaryRequest } from "@/agentMode/sdk/pi/testing/summaryRequest";
import { requireNodeModule } from "@/utils/desktopRuntime";
const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");
const http = requireNodeModule<typeof import("node:http")>("node:http");
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { App } from "obsidian";
import type { PermissionDecision, SessionUpdate } from "@/agentMode/session/types";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { mcpToolName } from "@/agentMode/sdk/pi/mcp/McpToolNames";
import { createPiMcpTools } from "@/agentMode/sdk/pi/mcp/createPiMcpTools";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function runMcpRuntimeScenario(directory: string) {
  const echoedSecret = "fixture-mcp-private-token";
  let calls = 0;
  let remoteEffects = 0;
  let initializations = 0;
  const server = http.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
    request.on("end", () => {
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method?: string;
        params?: {
          name?: string;
          arguments?: { text?: string };
          _meta?: { progressToken?: string | number };
        };
      };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      let result: unknown = {};
      if (message.method === "initialize") {
        initializations += 1;
        result = {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        };
      }
      if (message.method === "tools/list") {
        assert.equal(request.headers.authorization, `Bearer ${echoedSecret}`);
        result = {
          tools: [
            {
              name: "status",
              description: "Read the service's current receipt count without performing an action",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "echo",
              description: `Echo the approved text; server echoed ${request.headers.authorization ?? ""}`,
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
        };
      }
      if (message.method === "tools/call") {
        calls += 1;
        if (message.params?.arguments?.text === "effect-then-disconnect") {
          remoteEffects += 1;
          response.destroy();
          return;
        }
        result = {
          content:
            message.params?.name === "status"
              ? [{ type: "text", text: JSON.stringify({ remoteEffects }) }]
              : message.params?.arguments?.text === "return-image"
                ? [
                    {
                      type: "image",
                      mimeType: "image/png",
                      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA9sAAAAASUVORK5CYII=",
                    },
                  ]
                : [{ type: "text", text: `MCP result: ${message.params?.arguments?.text}` }],
        };
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: message.params?._meta?.progressToken, progress: 1, total: 2, message: "halfway" } })}\n\n`
        );
        response.end(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`);
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const config = normalizeMcpServerConfig({
    serverId: "fixture",
    enabled: true,
    trusted: true,
    scope: "this-vault",
    toolExposure: "direct",
    transport: {
      kind: "http",
      url: `http://127.0.0.1:${address.port}/mcp`,
      headerSecretRefs: { Authorization: "mcp:fixture:authorization" },
    },
  });
  const vaultRoot = path.join(directory, "mcp-vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        baseUrl: "https://fixture.invalid/v1",
        displayName: "Fixture",
        apiKeyKeychainId: "fixture-key",
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "fixture-model",
        providerId: "fixture",
        info: {
          id: "fixture-model",
          displayName: "Fixture",
          toolCall: true,
          // 单层权限模型下命令与外部文件工具常驻注册，夹具窗口需容纳其 schema。https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
          limits: { context: 12_288 },
        },
        configuredAt: 1,
      },
      {
        configuredModelId: "fixture-vision-model",
        providerId: "fixture",
        info: {
          id: "fixture-vision-model",
          displayName: "Fixture vision",
          toolCall: true,
          modalities: { input: ["text", "image"] },
          // 单层权限模型下命令与外部文件工具常驻注册，夹具窗口需容纳其 schema。https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
          limits: { context: 12_288 },
        },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: { pi: { mcpServers: [config] } },
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["fixture-model", "fixture-vision-model"] } },
  } as unknown as VaultAgentSettings;
  const app = {
    vault: {
      configDir: ".fixture-config",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [],
      getMarkdownFiles: () => [],
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const secrets = new Map<string, string>([
    ["fixture-key", "test-key"],
    ["mcp:fixture:authorization", `Bearer ${echoedSecret}`],
  ]);
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "mcp-fixture",
    getSecretById: (id: string) => secrets.get(id) ?? null,
    setSecretById: (id: string, value: string) => {
      secrets.set(id, value);
    },
    deleteSecretById: (id: string) => {
      secrets.delete(id);
    },
  };
  const faux = fauxProvider();
  // SDK 压缩请求有独立的摘要流，不能消费外部工具调用/审批的既定对话步骤。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const summaryStream = () => {
    const message = fauxAssistantMessage(
      "Retain the user's request, actual external tool results and pending permissions. Continue from the current recorded state."
    );
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  const listeners = new Set<() => void>();
  let networkRequests = 0;
  const streamsFactory: ProviderStreamsFactory = () => ({
    stream: (model, context, options) =>
      isSummaryRequest(context) ? summaryStream() : faux.provider.stream(model, context, options),
    streamSimple: (model, context, options) =>
      isSummaryRequest(context)
        ? summaryStream()
        : faux.provider.streamSimple(model, context, options),
  });
  const host = {
    app,
    fetch: ((...args) => {
      networkRequests += 1;
      return window.fetch(...args);
    }) as typeof window.fetch,
    keychain,
    getSettings: () => settings,
    privateRoot: path.join(directory, "mcp-private"),
    streamsFactory,
    subscribeSettings: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  let backend = new PiBackendProcess({ host });
  let approvals = 0;
  const updates: SessionUpdate[] = [];
  const allow = async (): Promise<PermissionDecision> => {
    approvals += 1;
    return { outcome: { outcome: "selected", optionId: "allow_once" } };
  };
  backend.setPermissionPrompter(async (request) => {
    assert.ok(JSON.stringify(request.toolCall.rawInput).includes("approved input"));
    return allow();
  });
  const responses = (text = "approved input") =>
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall(mcpToolName("fixture", "echo"), { text })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Tool completed"),
    ]);
  try {
    await backend.start();
    const opened = await backend.newSession({ cwd: vaultRoot });
    backend.registerSessionHandler(opened.sessionId, (notification) => {
      updates.push(notification.update);
    });
    await backend.setSessionMode({ sessionId: opened.sessionId, modeId: "default" });
    responses();
    const result = await backend.prompt({
      sessionId: opened.sessionId,
      prompt: [{ type: "text", text: "Use the configured MCP tool" }],
    });
    assert.equal(result.stopReason, "end_turn");
    assert.ok(networkRequests > 0, "MCP requests must use the injected host network");
    assert.equal(calls, 1, "the configured MCP tool must reach its actual HTTP server");
    assert.equal(approvals, 1, "unknown external effects must wait for the user's approval");
    assert.ok(
      updates.some(
        (update) =>
          update.sessionUpdate === "tool_call_update" &&
          update.progress?.description?.includes("halfway")
      ),
      "actual server progress reaches the chat event stream"
    );
    await backend.setSessionMode({ sessionId: opened.sessionId, modeId: "plan" });
    responses("blocked plan call");
    await backend.prompt({
      sessionId: opened.sessionId,
      prompt: [{ type: "text", text: "Plan only" }],
    });
    assert.equal(calls, 1);
    assert.equal(approvals, 1);
    await backend.setSessionMode({ sessionId: opened.sessionId, modeId: "default" });
    const child = await backend.newSession({
      sessionId: "root-mcp-child",
      parentSessionId: opened.sessionId,
      parentRunId: "mcp-child-check",
      readOnly: true,
      cwd: vaultRoot,
    });
    responses("blocked read-only child");
    await backend.prompt({
      sessionId: child.sessionId,
      prompt: [{ type: "text", text: "Read-only candidate" }],
    });
    assert.equal(
      calls,
      1,
      "a read-only child cannot borrow its default-mode parent's external tools"
    );
    assert.equal(approvals, 1);
    const permissionStarted = deferred<void>();
    const latePermission = deferred<PermissionDecision>();
    backend.setPermissionPrompter(() => {
      permissionStarted.resolve();
      return latePermission.promise;
    });
    responses("cancel pending permission");
    const cancelled = backend.prompt({
      sessionId: opened.sessionId,
      prompt: [{ type: "text", text: "Cancel this request" }],
    });
    await permissionStarted.promise;
    await backend.cancel({ sessionId: opened.sessionId });
    await cancelled;
    latePermission.resolve({ outcome: { outcome: "selected", optionId: "allow_once" } });
    assert.equal(
      calls,
      1,
      "stopping while permission is pending must not start a late external call"
    );
    const disabledStarted = deferred<void>();
    const disabledPermission = deferred<PermissionDecision>();
    backend.setPermissionPrompter(() => {
      disabledStarted.resolve();
      return disabledPermission.promise;
    });
    responses("disabled while reviewing");
    const disabled = backend.prompt({
      sessionId: opened.sessionId,
      prompt: [{ type: "text", text: "Disable the server before approval" }],
    });
    await disabledStarted.promise;
    settings.agentMode.backends.pi!.mcpServers = [
      normalizeMcpServerConfig({ ...config, enabled: false }),
    ];
    for (const listener of listeners) listener();
    disabledPermission.resolve({ outcome: { outcome: "selected", optionId: "allow_once" } });
    await disabled;
    assert.equal(calls, 1, "disabling the server revokes an approval still being reviewed");
    const originalArchive = await backend.exportSession({
      sessionId: opened.sessionId,
      format: "json",
    });
    const saved = JSON.parse(originalArchive.content) as {
      session: {
        extras: {
          entries: {
            kind: string;
            data?: { toolId: string; decision: string; status: string; argumentsHash: string };
          }[];
        };
      };
    };
    const audits = saved.session.extras.entries
      .filter((entry) => entry.kind === "va.audit")
      .map((entry) => entry.data!);
    assert.ok(audits.some((record) => record.status === "executed"));
    assert.ok(audits.some((record) => record.status === "rejected"));
    assert.ok(audits.some((record) => record.status === "cancelled"));
    assert.equal(
      audits.some((record) => record.decision !== "allow" && record.status === "executed"),
      false
    );
    assert.ok(audits.every((record) => /^[a-f0-9]{64}$/.test(record.argumentsHash)));
    assert.equal(JSON.stringify(audits).includes(echoedSecret), false);
    await backend.shutdown();
    settings.agentMode.backends.pi!.mcpServers = [
      normalizeMcpServerConfig({ ...config, toolExposure: "deferred" }),
    ];
    backend = new PiBackendProcess({ host });
    backend.setPermissionPrompter(allow);
    await backend.start();
    const beforeLazyOpen = initializations;
    const lazy = await backend.newSession({ sessionId: "root-mcp-deferred", cwd: vaultRoot });
    assert.equal(
      initializations,
      beforeLazyOpen,
      "the default deferred server must not connect merely because a chat opened"
    );
    await backend.setSessionMode({ sessionId: lazy.sessionId, modeId: "default" });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("mcp_search_tools", { query: "echo" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        [fauxToolCall(mcpToolName("fixture", "echo"), { text: "deferred approved input" })],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("Deferred tool completed"),
    ]);
    await backend.prompt({
      sessionId: lazy.sessionId,
      prompt: [{ type: "text", text: "Find and use the echo tool" }],
    });
    assert.equal(
      calls,
      2,
      "a deferred tool loads and calls through the same real registry and approval path"
    );
    assert.equal(approvals, 2);
    const archive = await backend.exportSession({ sessionId: lazy.sessionId, format: "json" });
    assert.ok(archive.content.includes("mcp_search_tools"));
    assert.ok(archive.content.includes("Echo the approved text"));
    assert.equal(
      archive.content.includes(echoedSecret),
      false,
      "a real server's Bearer echo in listTools descriptions must not enter search-result history"
    );
    await backend.setSessionModel({ sessionId: lazy.sessionId, modelId: "fixture-vision-model" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall(mcpToolName("fixture", "echo"), { text: "return-image" })],
        { stopReason: "toolUse" }
      ),
      (context) => {
        const result = context.messages.findLast((message) => message.role === "toolResult");
        assert.ok(result && result.role === "toolResult");
        assert.ok(
          result.content.some((block) => block.type === "image"),
          "a vision model must receive a bounded image from the actual MCP HTTP result"
        );
        return fauxAssistantMessage("Vision tool output arrived");
      },
    ]);
    await backend.prompt({
      sessionId: lazy.sessionId,
      prompt: [{ type: "text", text: "Read the tool image" }],
    });
    await backend.setSessionModel({ sessionId: lazy.sessionId, modelId: "fixture-model" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall(mcpToolName("fixture", "echo"), { text: "return-image" })],
        { stopReason: "toolUse" }
      ),
      (context) => {
        const result = context.messages.findLast((message) => message.role === "toolResult");
        assert.ok(result && result.role === "toolResult");
        assert.equal(
          result.content.some((block) => block.type === "image"),
          false
        );
        assert.ok(
          result.content.some(
            (block) =>
              block.type === "text" && block.text.includes("selected model does not support images")
          )
        );
        return fauxAssistantMessage("Text-only omission explained");
      },
    ]);
    await backend.prompt({
      sessionId: lazy.sessionId,
      prompt: [{ type: "text", text: "Use the same tool after switching models" }],
    });
    await backend.shutdown();
    backend = new PiBackendProcess({ host });
    backend.setPermissionPrompter(allow);
    await backend.start();
    const beforeRestore = initializations;
    await backend.loadSession({ sessionId: lazy.sessionId, cwd: vaultRoot });
    assert.equal(
      initializations,
      beforeRestore,
      "opening history does not reconnect a saved deferred server"
    );
    faux.setResponses([
      (context) => {
        const offered = new Set<string>();
        for (const message of context.messages)
          if (message.role === "system") {
            for (const tool of message.toolsAdded ?? []) offered.add(tool.name);
            for (const tool of message.toolsRemoved ?? []) offered.delete(tool.name);
          }
        assert.ok(
          offered.has(mcpToolName("fixture", "echo")),
          "a previously loaded deferred tool must remain available after reopening without a second search"
        );
        return fauxAssistantMessage("Restored deferred tool is offered");
      },
    ]);
    await backend.prompt({
      sessionId: lazy.sessionId,
      prompt: [{ type: "text", text: "Continue with the loaded tools" }],
    });
    assert.equal(
      initializations,
      beforeRestore + 1,
      "the next explicit prompt restores the configured deferred server exactly once"
    );
    assert.equal(calls, 4, "restoring schemas must not replay external tool calls");
    const [
      { Harness, createRegistry },
      { createModels },
      { openNodeJsonlStorage },
      { BACKGROUND_CONTEXT },
    ] = await Promise.all([
      import("@earendil-works/pi-durable"),
      import("@earendil-works/pi-ai/models"),
      import("@earendil-works/pi-durable/storage/jsonl/node"),
      import("@earendil-works/chord/context"),
    ]);
    const faultDirectory = path.join(directory, "mcp-failed-durable-write");
    const faultStorage = await openNodeJsonlStorage(faultDirectory, BACKGROUND_CONTEXT);
    const faultHarness = await Harness.open(
      faultStorage,
      { models: createModels(), registry: createRegistry() },
      BACKGROUND_CONTEXT
    );
    const faultConversation = await faultHarness.root(BACKGROUND_CONTEXT);
    const installedAfterFailedWrite: ToolRegistration[] = [];
    const faultMcp = await createPiMcpTools({
      conversationId: String(faultConversation.id),
      harness: faultHarness,
      fetch: window.fetch,
      sessionId: "root-mcp-write-fault",
      vaultId: "mcp-fixture-write-fault",
      keychain,
      getSettings: () => settings,
      getMode: () => "default",
      emit: () => undefined,
      installTools: (tools) => installedAfterFailedWrite.push(...tools),
    });
    try {
      // 只在真实 SDK 的存储边界注入写盘故障，核心文档事务和错误传播仍由 SDK 执行。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      faultStorage.commit = async () => {
        throw new Error("fixture MCP durable commit failed");
      };
      const search = faultMcp.registrations.find((tool) => tool.name === "mcp_search_tools")!;
      await assert.rejects(
        search.execute(
          { query: "echo" },
          { conversationId: faultConversation.id } as ToolExecutionApi,
          BACKGROUND_CONTEXT
        ),
        /fixture MCP durable commit failed/
      );
      assert.equal(
        installedAfterFailedWrite.length,
        0,
        "a failed real SDK commit must not publish a new deferred registration"
      );
      await assert.rejects(
        faultMcp.prepare(String(faultConversation.id)),
        /Session failed after a storage error/
      );
      assert.equal(
        installedAfterFailedWrite.length,
        0,
        "the failed session snapshot cannot reopen external tools"
      );
    } finally {
      await faultMcp.dispose();
      await faultHarness.close(BACKGROUND_CONTEXT).catch(() => undefined);
    }
    const checkedStorage = await openNodeJsonlStorage(
      path.join(directory, "mcp-readonly-check"),
      BACKGROUND_CONTEXT
    );
    const checkedHarness = await Harness.open(
      checkedStorage,
      { models: createModels(), registry: createRegistry() },
      BACKGROUND_CONTEXT
    );
    const checkedConversation = await checkedHarness.root(BACKGROUND_CONTEXT);
    const checkedSettings = {
      ...settings,
      agentMode: {
        ...settings.agentMode,
        backends: {
          ...settings.agentMode.backends,
          pi: {
            ...settings.agentMode.backends.pi!,
            mcpServers: [normalizeMcpServerConfig({ ...config, toolExposure: "direct" })],
          },
        },
      },
    };
    let readOnlyCheck = false;
    const checkedMcp = await createPiMcpTools({
      harness: checkedHarness,
      conversationId: String(checkedConversation.id),
      fetch: window.fetch,
      sessionId: "root-mcp-readonly-check",
      vaultId: "mcp-fixture-readonly-check",
      keychain,
      getSettings: () => checkedSettings,
      getMode: () => (readOnlyCheck ? "plan" : "default"),
      isReadOnly: () => readOnlyCheck,
      requestPermission: allow,
      emit: () => undefined,
      riskFor: (tool) =>
        tool.toolName === "status"
          ? { effects: ["read"], unknownEffects: false }
          : { effects: ["network"], unknownEffects: true },
    });
    try {
      const remoteAction = checkedMcp.registrations.find(
        (tool) => tool.name === mcpToolName("fixture", "echo")
      )!;
      const remoteStatus = checkedMcp.registrations.find(
        (tool) => tool.name === mcpToolName("fixture", "status")
      )!;
      await remoteAction.execute(
        { text: "effect-then-disconnect" },
        { conversationId: checkedConversation.id, callId: "unknown-for-read" } as ToolExecutionApi,
        BACKGROUND_CONTEXT
      );
      readOnlyCheck = true;
      const statusResult = await remoteStatus.execute(
        {},
        { conversationId: checkedConversation.id, callId: "readonly-status" } as ToolExecutionApi,
        BACKGROUND_CONTEXT
      );
      assert.equal(
        statusResult.isError,
        false,
        "host-verified read-only status queries must remain available for reconciliation"
      );
      assert.ok(JSON.stringify(statusResult.output).includes("remoteEffects"));
      assert.equal(
        (await checkedMcp.reconcile()).decisions[0].canContinue,
        false,
        "a current receipt count cannot prove this ambiguous operation's result"
      );
      const requestsBeforeBlocked = calls;
      await remoteAction.execute(
        { text: "must-not-repeat" },
        {
          conversationId: checkedConversation.id,
          callId: "blocked-after-read",
        } as ToolExecutionApi,
        BACKGROUND_CONTEXT
      );
      assert.equal(calls, requestsBeforeBlocked);
    } finally {
      await checkedMcp.dispose();
      await checkedHarness.close(BACKGROUND_CONTEXT);
    }
    remoteEffects = 0;
    await backend.shutdown();
    settings.agentMode.backends.pi!.mcpServers = [
      normalizeMcpServerConfig({ ...config, toolExposure: "direct" }),
    ];
    backend = new PiBackendProcess({ host });
    await backend.start();
    const unknownSession = await backend.newSession({
      sessionId: "root-mcp-unknown-effect",
      cwd: vaultRoot,
    });
    await backend.setSessionModel({
      sessionId: unknownSession.sessionId,
      modelId: "fixture-model",
    });
    backend.setPermissionPrompter(allow);
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall(mcpToolName("fixture", "echo"), { text: "effect-then-disconnect" })],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("External result needs reconciliation"),
    ]);
    await backend
      .prompt({
        sessionId: unknownSession.sessionId,
        requestId: "unknown-effect",
        prompt: [{ type: "text", text: "Run one approved external action" }],
      })
      .catch(() => undefined);
    assert.equal(
      remoteEffects,
      1,
      "the real remote service must apply exactly one effect before disconnecting"
    );
    const callsAfterUnknown = calls;
    const unknownLoaded = await backend.loadSession({
      sessionId: unknownSession.sessionId,
      cwd: vaultRoot,
    });
    assert.equal(
      unknownLoaded.state?.readOnly,
      true,
      "unknown external effects must activate the real recovery gate"
    );
    await assert.rejects(
      backend.prompt({
        sessionId: unknownSession.sessionId,
        prompt: [
          { type: "text", text: "Do not send another action while the prior result is unknown" },
        ],
      })
    );
    assert.equal(calls, callsAfterUnknown);
    await backend.shutdown();
    backend = new PiBackendProcess({ host });
    await backend.start();
    const coldUnknown = await backend.loadSession({
      sessionId: unknownSession.sessionId,
      cwd: vaultRoot,
    });
    assert.equal(
      coldUnknown.state?.readOnly,
      true,
      "cold reopening must preserve the same unknown effect"
    );
    await backend.recoverSession({ sessionId: unknownSession.sessionId, action: "reconcile" });
    assert.equal(
      (await backend.loadSession({ sessionId: unknownSession.sessionId, cwd: vaultRoot })).state
        ?.readOnly,
      true
    );
    await assert.rejects(
      backend.recoverSession({ sessionId: unknownSession.sessionId, action: "continue" }),
      /reconciliation|核对|只读|恢复/
    );
    assert.equal(
      calls,
      callsAfterUnknown,
      "reconnect, reconciliation and continue cannot resend the original external operation"
    );
    const unknownExport = await backend.exportSession({
      sessionId: unknownSession.sessionId,
      format: "json",
    });
    assert.ok(unknownExport.content.includes("MCP_CALL_FAILED"));
    assert.ok(
      unknownExport.content.includes('"effect":"unknown"') ||
        unknownExport.content.includes('"effect": "unknown"')
    );
    const identitySession = await backend.newSession({
      sessionId: "root-mcp-reused-call",
      cwd: vaultRoot,
    });
    await backend.setSessionMode({ sessionId: identitySession.sessionId, modeId: "default" });
    const identityUpdates: SessionUpdate[] = [];
    backend.registerSessionHandler(identitySession.sessionId, (notification) =>
      identityUpdates.push(notification.update)
    );
    const approvalIds: string[] = [];
    backend.setPermissionPrompter(async (request) => {
      approvalIds.push(request.toolCall.toolCallId);
      return allow();
    });
    const beforeIdentityCalls = Number(calls);
    for (const number of [1, 2]) {
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall(
              mcpToolName("fixture", "echo"),
              { text: `independent approved input ${number}` },
              { id: "call_0" }
            ),
          ],
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage(`Completed independent operation ${number}`),
      ]);
      await backend.prompt({
        sessionId: identitySession.sessionId,
        requestId: `reused-call-${number}`,
        prompt: [{ type: "text", text: `Execute independently approved operation ${number}` }],
      });
    }
    assert.equal(
      calls,
      beforeIdentityCalls + 2,
      "both separately approved requests must reach the real HTTP service"
    );
    assert.equal(approvalIds.length, 2);
    assert.equal(
      new Set(approvalIds).size,
      2,
      "reused provider call_0 cannot overwrite the first approval"
    );
    for (const toolCallId of approvalIds) {
      assert.ok(
        identityUpdates.some(
          (update) => update.sessionUpdate === "tool_call" && update.toolCallId === toolCallId
        ),
        "each approval must link to a different actual SDK tool card"
      );
      assert.ok(
        identityUpdates.some(
          (update) =>
            update.sessionUpdate === "tool_call_update" &&
            update.toolCallId === toolCallId &&
            update.progress?.description?.includes("halfway")
        ),
        "server progress must update the matching task card"
      );
    }
    return {
      status: "passed",
      checks: [
        "configured_mcp_reaches_production_registry",
        "real_http_tool_call",
        "reused_provider_call_id_keeps_independent_mcp_approvals_and_progress_cards",
        "concrete_arguments_approval",
        "actual_server_progress",
        "plan_denies_external_effects",
        "read_only_child_cannot_borrow_parent_permissions",
        "stop_pending_permission",
        "disable_revokes_pending_approval",
        "lazy_deferred_connect",
        "native_deferred_tool_search",
        "catalog_bearer_echo_redacted_in_durable_history",
        "single_authorization_header_for_real_http_auth",
        "private_durable_audit_preserves_actual_mcp_decision_without_raw_arguments",
        "deferred_tools_restored_on_next_prompt_without_search_or_external_call_replay",
        "real_http_image_result_reaches_selected_vision_model",
        "switch_to_text_only_model_explains_omitted_mcp_image",
        "real_sdk_failed_loaded_tools_commit_and_snapshot_publish_no_external_registration",
        "remote_effect_then_disconnect_blocks_same_tree_operations_across_cold_reopen",
        "reconciliation_reads_facts_without_reconnect_or_retry_clearing_unknown",
        "host_verified_readonly_http_status_query_does_not_clear_unknown_effects",
      ],
      calls,
      approvals,
    };
  } finally {
    await backend.shutdown();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
