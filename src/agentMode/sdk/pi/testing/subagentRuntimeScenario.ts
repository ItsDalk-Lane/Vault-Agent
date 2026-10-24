import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { TFile, type App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { Harness, createRegistry, defineDoc } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { StoreLocator } from "@/agentMode/sdk/pi/storage/StoreLocator";
import { readStoredWorkItem } from "./readStoredWorkItem";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type { SessionEvent, BackendProcess } from "@/agentMode/session/types";

interface DiagnosticExport {
  readonly session: {
    readonly extras: {
      readonly entries: readonly {
        readonly kind: string;
        readonly data: Record<string, unknown>;
      }[];
    };
  };
}

export async function runSubagentRuntimeScenario(directory: string) {
  const assert: typeof import("node:assert/strict") =
    requireNodeModule<typeof import("node:assert/strict")>("node:assert/strict");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const vaultRoot = path.join(directory, "vault");
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
    configuredModels: ["fixture-model", "fixture-child"].map((id) => ({
      configuredModelId: id,
      providerId: "fixture",
      info: { id, displayName: id, toolCall: true, limits: { context: 200_000, output: 4096 } },
      configuredAt: 1,
    })),
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: {
        pi: { defaultMode: "auto", enabledSubagentProfiles: ["researcher", "reviewer", "writer"] },
      },
    },
    backends: { pi: { enabledModels: ["fixture-model", "fixture-child"] } },
  } as unknown as VaultAgentSettings;
  const files = new Map<string, TFile>();
  let fileWrites = 0;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: (target: string) => files.get(target) ?? null,
      getFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()],
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      process: async (file: TFile, transform: (content: string) => string) => {
        const content = transform(await fs.readFile(path.join(vaultRoot, file.path), "utf8"));
        await fs.writeFile(path.join(vaultRoot, file.path), content);
        fileWrites += 1;
        file.stat.size = content.length;
        return content;
      },
      on: () => ({}),
      offref: () => undefined,
    },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
    workspace: { iterateAllLeaves: () => undefined },
  } as unknown as App;
  const faux = fauxProvider({ models: [{ id: "fixture-model" }, { id: "fixture-child" }] });
  const modelCalls: string[] = [];
  const childResponse = (
    _input: unknown,
    _options: unknown,
    _state: unknown,
    model: { id: string }
  ) => {
    modelCalls.push(model.id);
    return fauxAssistantMessage(model.id === "fixture-child" ? "实际子任务答案" : "父任务整理答案");
  };
  faux.setResponses([
    (context, _options, _state, model) => {
      const tools = getCurrentTools(context.messages);
      let chosenModelKey: string | undefined;
      for (const name of ["delegate_task", "start_background_task"]) {
        const tool = tools.find((item) => item.name === name);
        assert.ok(tool, `the actual model receives ${name}`);
        const schema = tool.parameters as {
          properties?: { modelKey?: { enum?: readonly string[]; description?: string } };
        };
        assert.deepEqual(
          schema.properties?.modelKey?.enum,
          ["fixture-model", "fixture-child"],
          "actual model schemas list selectable configured IDs"
        );
        assert.ok(
          schema.properties?.modelKey?.description?.includes("Fixture"),
          "human provider names reach the actual model schema"
        );
        assert.ok(schema.properties?.modelKey?.description?.includes("fixture-child"));
        if (name === "delegate_task") chosenModelKey = schema.properties?.modelKey?.enum?.at(-1);
      }
      assert.ok(chosenModelKey);
      modelCalls.push(model.id);
      return fauxAssistantMessage(
        [
          fauxToolCall("delegate_task", {
            profileId: "researcher",
            task: "核查",
            description: "子任务核查",
            modelKey: chosenModelKey,
          }),
        ],
        { stopReason: "toolUse" }
      );
    },
    childResponse,
    childResponse,
  ]);
  const options = {
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "subagent-fixture",
        getSecretById: (id: string) => (id === "fixture-key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  };
  const backend = new PiBackendProcess(options);
  await backend.start();
  const opened = await backend.newSession({ cwd: vaultRoot });
  await backend.setSessionModel({ sessionId: opened.sessionId, modelId: "fixture-model" });
  const events: SessionEvent[] = [];
  backend.registerSessionHandler(opened.sessionId, (event) => events.push(event));
  await backend.prompt({
    sessionId: opened.sessionId,
    requestId: "delegate",
    prompt: [{ type: "text", text: "交给子任务核查" }],
  });
  assert.deepEqual(modelCalls, ["fixture-model", "fixture-child", "fixture-model"]);
  assert.ok(
    events.some(
      (event) =>
        event.update.sessionUpdate === "tool_call" && event.update.vendorToolName === "Agent"
    )
  );
  assert.ok(JSON.stringify(events).includes("实际子任务答案"));
  const calls = faux.state.callCount;
  const childId = events
    .flatMap((event) => {
      const input =
        event.update.sessionUpdate === "tool_call_update" ? event.update.rawInput : null;
      return input &&
        typeof input === "object" &&
        "childConversationId" in input &&
        typeof input.childConversationId === "string"
        ? [input.childConversationId]
        : [];
    })
    .find((id) => typeof id === "string");
  assert.equal(typeof childId, "string");
  const history = await (backend as BackendProcess).readSubagentHistory?.({
    sessionId: opened.sessionId,
    conversationId: String(childId),
  });
  assert.ok(
    history?.some((message) => message.message.includes("实际子任务答案")),
    "the product history API must expose the actual saved child answer"
  );
  assert.equal(
    faux.state.callCount,
    calls,
    "reading child history must not start another model request"
  );
  await assert.rejects(
    () =>
      (backend as BackendProcess).readSubagentHistory!({
        sessionId: opened.sessionId,
        conversationId: "99999",
      }),
    /不属于/
  );
  const priorRuns = (
    JSON.parse(
      (await backend.exportSession({ sessionId: opened.sessionId, format: "json" })).content
    ) as DiagnosticExport
  ).session.extras.entries.filter((entry) => entry.kind === "va.run");
  const originalRunId = priorRuns.at(-1)!.data.runId as string;
  await backend.shutdown();
  const locator = new StoreLocator({
    platform: process.platform,
    homeDir: options.host.privateRoot,
    env: {},
    vaultRoot,
    vaultId: "subagent-fixture",
  });
  const persisted = await openNodeJsonlStorage(
    locator.sessionStorePaths(opened.sessionId).storeDir,
    BACKGROUND_CONTEXT
  );
  const diagnostic = await Harness.open(
    persisted,
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT
  );
  const diagnosticRoot = await diagnostic.root(BACKGROUND_CONTEXT);
  const mailboxToken = defineDoc({
    kind: "va.subagent.mailbox",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "initial",
    initial: () => ({
      messages: {},
      sequences: {},
      stoppedRuns: {},
      epoch: 0,
    }),
  });
  await diagnosticRoot.commit(async (tx) => {
    const mailbox = await tx.doc(mailboxToken, diagnosticRoot.id);
    Object.assign(mailbox.stoppedRuns, { [originalRunId]: 1 });
  }, BACKGROUND_CONTEXT);
  await diagnostic.close(BACKGROUND_CONTEXT);
  const reopened = new PiBackendProcess(options);
  await reopened.start();
  const replay: SessionEvent[] = [];
  reopened.registerSessionHandler(opened.sessionId, (event) => replay.push(event));
  await reopened.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
  assert.ok(JSON.stringify(replay).includes("实际子任务答案"));
  const reopenedHistory = await (reopened as BackendProcess).readSubagentHistory?.({
    sessionId: opened.sessionId,
    conversationId: String(childId),
  });
  assert.ok(reopenedHistory?.some((message) => message.message.includes("实际子任务答案")));
  assert.equal(faux.state.callCount, calls);
  const initialCalls = [...modelCalls];
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("start_background_task", {
          profileId: "researcher",
          task: "核对后台资料",
          description: "冷开后明确继续的后台核查",
          modelKey: "fixture-child",
          commandId: "cold-followup",
        }),
      ],
      { stopReason: "toolUse" }
    ),
    childResponse,
    childResponse,
    childResponse,
  ]);
  await reopened.prompt({
    sessionId: opened.sessionId,
    requestId: "cold-followup",
    prompt: [{ type: "text", text: "继续核对，启动后台助手" }],
  });
  const after = (
    JSON.parse(
      (await reopened.exportSession({ sessionId: opened.sessionId, format: "json" })).content
    ) as DiagnosticExport
  ).session.extras.entries;
  const latest = after.filter((entry) => entry.kind === "va.run").at(-1)!.data;
  assert.equal(
    latest.runId,
    originalRunId,
    "a new explicit segment retains the original WorkItem after cold open"
  );
  assert.ok(
    modelCalls.slice(initialCalls.length).includes("fixture-child"),
    "the production background creation must start a real child after the original root Stop marker"
  );
  assert.ok(!JSON.stringify(replay).includes("子任务需要一个仍有效的用户请求"));
  await reopened.shutdown();
  const item = await readStoredWorkItem({
    privateRoot: options.host.privateRoot,
    vaultRoot,
    vaultId: "subagent-fixture",
    sessionId: opened.sessionId,
    workId: originalRunId,
  });
  assert.equal(item?.checkpoint.goal, "交给子任务核查");
  assert.equal(item?.checkpoint.userRequests?.length, 2);
  assert.equal(item?.grants.length, 2);
  const writerFile = Object.assign(new TFile(), {
    path: "writer.md",
    extension: "md",
    stat: { size: 5 },
  });
  files.set(writerFile.path, writerFile);
  await fs.writeFile(path.join(vaultRoot, writerFile.path), "base\n");
  const writerSession = "root-cold-writer";
  let writerBackend = new PiBackendProcess(options);
  const writerEvents: SessionEvent[] = [];
  const observeWriter = () =>
    writerBackend.registerSessionHandler(writerSession, (event) => writerEvents.push(event));
  let childRequests = 0;
  let revokedWriteDenied = false;
  let revokedModelReadOnly = false;
  let rootRequests = 0;
  let writerReached!: () => void;
  const childWaiting = new Promise<void>((resolve) => {
    writerReached = resolve;
  });
  const response: Parameters<typeof faux.setResponses>[0][number] = async (
    context,
    request,
    _state,
    model
  ) => {
    if (model.id === "fixture-model") {
      rootRequests += 1;
      if (rootRequests === 1)
        return fauxAssistantMessage(
          [
            fauxToolCall("start_background_task", {
              profileId: "writer",
              task: "Add once and verify the saved write",
              description: "Writer checkpoint",
              outputPaths: ["writer.md"],
              inputFiles: ["writer.md"],
              modelKey: "fixture-child",
              commandId: "writer-checkpoint",
            }),
          ],
          { stopReason: "toolUse" }
        );
      if (rootRequests === 2)
        return new Promise((_resolve, reject) => {
          request?.signal?.addEventListener("abort", () => reject(new Error("root paused")), {
            once: true,
          });
        });
      return fauxAssistantMessage("父任务已从原检查点继续");
    }
    childRequests += 1;
    const read = () =>
      fauxAssistantMessage([fauxToolCall("vault_read", { path: "writer.md" })], {
        stopReason: "toolUse",
      });
    const edit = () => {
      const result = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "vault_read"
      );
      const details = (result && "details" in result ? result.details : undefined) as
        | { outcome?: { data?: { value?: { fileVersion?: string } } } }
        | undefined;
      const fileVersion = details?.outcome?.data?.value?.fileVersion;
      assert.ok(fileVersion, "writer uses the actual complete-file version returned by vault_read");
      return fauxAssistantMessage(
        [
          fauxToolCall("vault_edit", {
            path: "writer.md",
            fileVersion,
            edits: [{ oldText: "base", newText: "base\nonce" }],
          }),
        ],
        { stopReason: "toolUse" }
      );
    };
    if (childRequests === 1) return read();
    if (childRequests === 2) return edit();
    if (childRequests === 3) {
      writerReached();
      return new Promise((_resolve, reject) =>
        request?.signal?.addEventListener("abort", () => reject(new Error("child paused")), {
          once: true,
        })
      );
    }
    const repeated =
      context.messages.filter(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("Add once and verify the saved write")
      ).length > 1;
    if (childRequests === 4) {
      assert.equal(repeated, false, "recovery must keep the original child input");
      return read();
    }
    if (childRequests === 5) {
      settings.agentMode.backends.pi!.enabledSubagentProfiles = ["researcher", "reviewer"];
      return edit();
    }
    const result = context.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "vault_edit"
    );
    revokedWriteDenied =
      result?.role === "toolResult" &&
      result.isError === true &&
      /permission|read.?only|not.?allowed|not.?enabled|只读|权限/i.test(JSON.stringify(result));
    const offered = new Set<string>();
    for (const message of context.messages)
      if (message.role === "system") {
        for (const tool of message.toolsAdded ?? []) offered.add(tool.name);
        for (const tool of message.toolsRemoved ?? []) offered.delete(tool.name);
      }
    revokedModelReadOnly = !offered.has("vault_edit");
    settings.agentMode.backends.pi!.enabledSubagentProfiles = ["researcher", "reviewer", "writer"];
    return fauxAssistantMessage("verified already saved write");
  };
  try {
    await writerBackend.start();
    await writerBackend.newSession({ sessionId: writerSession, cwd: vaultRoot });
    await writerBackend.setSessionModel({ sessionId: writerSession, modelId: "fixture-model" });
    observeWriter();
    faux.setResponses(Array.from({ length: 12 }, () => response));
    const running = writerBackend
      .prompt({
        sessionId: writerSession,
        requestId: "writer-original",
        prompt: [{ type: "text", text: "只修改指定文件一次，然后核对结果" }],
      })
      .catch((error) => ({ error }));
    await childWaiting;
    assert.equal(fileWrites, 1, "the real host vault_edit must commit before pause");
    assert.equal(await fs.readFile(path.join(vaultRoot, "writer.md"), "utf8"), "base\nonce\n");
    await writerBackend.pauseSession({ sessionId: writerSession });
    await running;
    const writerBefore = (
      JSON.parse(
        (await writerBackend.exportSession({ sessionId: writerSession, format: "json" })).content
      ) as DiagnosticExport
    ).session.extras.entries;
    const writerRunId = writerBefore.filter((entry) => entry.kind === "va.run").at(-1)!.data.runId;
    const callsBeforeReopen = faux.state.callCount;
    await writerBackend.shutdown();
    writerBackend = new PiBackendProcess(options);
    await writerBackend.start();
    observeWriter();
    await writerBackend.loadSession({ sessionId: writerSession, cwd: vaultRoot });
    assert.equal(
      faux.state.callCount,
      callsBeforeReopen,
      "opening the writer checkpoint must not execute"
    );
    await writerBackend.recoverSession({ sessionId: writerSession, action: "continue" });
    assert.equal(
      revokedWriteDenied,
      true,
      "revoking the enabled writer must reject its already selected write at the final host gate"
    );
    assert.equal(
      revokedModelReadOnly,
      true,
      "the next actual model request must expose the revoked child as read only"
    );
    assert.equal(
      fileWrites,
      1,
      "continuing the actual production writer must never replay the committed edit"
    );
    assert.equal(await fs.readFile(path.join(vaultRoot, "writer.md"), "utf8"), "base\nonce\n");
    const writerAfter = (
      JSON.parse(
        (await writerBackend.exportSession({ sessionId: writerSession, format: "json" })).content
      ) as DiagnosticExport
    ).session.extras.entries;
    assert.equal(
      writerAfter.filter((entry) => entry.kind === "va.run").at(-1)!.data.runId,
      writerRunId
    );
    const reference = writerEvents
      .flatMap((event) =>
        event.update.sessionUpdate === "tool_call_update" &&
        event.update.rawInput &&
        typeof event.update.rawInput === "object" &&
        "childConversationId" in event.update.rawInput
          ? [String(event.update.rawInput.childConversationId)]
          : []
      )
      .at(-1);
    assert.ok(reference);
    const writerHistory = await writerBackend.readSubagentHistory({
      sessionId: writerSession,
      conversationId: reference,
    });
    assert.equal(
      writerHistory.filter(
        (message) =>
          message.sender === "user" &&
          message.message.includes("Add once and verify the saved write")
      ).length,
      1
    );
    assert.ok(
      writerHistory.some((message) => message.message.includes("verified already saved write"))
    );
  } finally {
    await writerBackend.shutdown();
  }
  let childStarted!: () => void;
  const childRunning = new Promise<void>((resolve) => {
    childStarted = resolve;
  });
  let stoppedChild = false;
  let stopParentRequests = 0;
  faux.setResponses(
    Array.from({ length: 8 }, () => async (_context, request, _state, model) => {
      if (model.id === "fixture-child")
        return new Promise<never>((_resolve, reject) => {
          const signal = request?.signal;
          assert.ok(signal);
          signal.addEventListener(
            "abort",
            () => {
              stoppedChild = true;
              reject(new Error("The actual background request was stopped"));
            },
            { once: true }
          );
          childStarted();
        });
      stopParentRequests += 1;
      return stopParentRequests === 1
        ? fauxAssistantMessage(
            [
              fauxToolCall("start_background_task", {
                profileId: "researcher",
                task: "Wait for explicit stop",
                description: "Background stop",
                modelKey: "fixture-child",
                commandId: "production-idle-stop",
              }),
            ],
            { stopReason: "toolUse" }
          )
        : fauxAssistantMessage("The parent has finished; independent background work may continue");
    })
  );
  const stopBackend = new PiBackendProcess(options);
  await stopBackend.start();
  const stopSession = AgentSession.start({
    backend: stopBackend,
    cwd: vaultRoot,
    internalId: "actual-idle-background-stop",
    backendId: "pi",
    projectId: "__global__",
    defaultModelSelection: { baseModelId: "fixture-model", effort: null },
  });
  let stopFinished = false;
  let promptDuringStop = false;
  let stopCalls = 0;
  try {
    await stopSession.ready;
    assert.equal(
      await stopSession.sendPrompt("Start independent background work and finish this parent input")
        .turn,
      "end_turn"
    );
    await childRunning;
    assert.equal(stopSession.getStatus(), "idle");
    assert.equal(stopSession.getActiveBackgroundTaskCount(), 1);
    assert.equal(
      await stopSession.sendPrompt("A normal followup while the child is running").turn,
      "end_turn"
    );
    assert.equal(stopSession.getActiveBackgroundTaskCount(), 1);
    let releaseStop!: () => void;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const actualCancel = stopBackend.cancel.bind(stopBackend);
    stopBackend.cancel = async (input) => {
      stopCalls += 1;
      await stopGate;
      await actualCancel(input);
      stopFinished = true;
    };
    const actualPrompt: BackendProcess["prompt"] = stopBackend.prompt.bind(stopBackend);
    stopBackend.prompt = async (input) => {
      promptDuringStop ||= !stopFinished;
      return actualPrompt(input);
    };
    const cancelled = stopSession.cancel();
    const duplicateCancelled = stopSession.cancel();
    const next = stopSession.sendPrompt(
      "A new explicit input after stopping the previous background work"
    );
    assert.equal(promptDuringStop, false);
    releaseStop();
    await cancelled;
    await duplicateCancelled;
    assert.equal(
      stoppedChild,
      true,
      "the public Session Stop must abort the real child provider request"
    );
    assert.equal(stopCalls, 1);
    assert.equal(await next.turn, "end_turn");
    assert.equal(
      promptDuringStop,
      false,
      "old tree Stop must settle before the next provider input"
    );
    assert.equal(stopSession.getActiveBackgroundTaskCount(), 0);
    assert.equal(
      stopParentRequests,
      4,
      "stopped child reports must not create another model input"
    );
  } finally {
    await stopSession.dispose();
    await stopBackend.shutdown();
  }
  return {
    status: "passed",
    scenario: "production-subagents",
    modelCalls: initialCalls,
    coldFollowup: { sameWorkItem: latest.runId === originalRunId, backgroundStarted: true },
    writerCheckpoint: {
      fileWrites,
      originalInputPreserved: true,
      sameWorkItem: true,
      revokedWriteDenied,
      revokedModelReadOnly,
    },
    idleBackgroundStop: {
      childAborted: stoppedChild,
      stopCalls,
      nextInputAfterStop: !promptDuringStop,
      passiveReports: stopParentRequests === 4,
    },
    modelChoicesVisible: true,
    answers: 1,
    reopenedWithoutRequests: true,
    readOnlyChildHistory: true,
  };
}
