import { isSummaryRequest } from "@/agentMode/sdk/pi/testing/summaryRequest";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionEvent } from "@/agentMode/session/types";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { Harness, createRegistry, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runRolloverRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
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
        info: { id: "model", toolCall: true, limits: { context: 8192, output: 1024 } },
        configuredAt: 1,
      },
      {
        configuredModelId: "child",
        providerId: "fixture",
        info: { id: "child", toolCall: true, limits: { context: 8192, output: 1024 } },
        configuredAt: 1,
      },
    ],
    agentMode: { activeBackend: "pi", backends: {}, skills: { folder: "skills" } },
    backends: { pi: { enabledModels: ["saved", "child"] } },
  } as unknown as VaultAgentSettings;
  const app = {
    vault: {
      configDir: ".fixture-config",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [],
      getMarkdownFiles: () => [],
      getAbstractFileByPath: () => null,
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const faux = fauxProvider();
  let explicitSummary = false;
  const automaticSummary = (context: Parameters<typeof faux.provider.streamSimple>[1]) => {
    const visible = context.messages
      .filter((message) => message.role !== "system")
      .flatMap((message) =>
        typeof message.content === "string"
          ? [message.content]
          : message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
      )
      .join("\n");
    const message = fauxAssistantMessage(visible.slice(-3500));
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  const options = {
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "rollover",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: (): ReturnType<
        import("@/agentMode/sdk/pi/models/ProviderFactory").ProviderStreamsFactory
      > => ({
        stream: (model, context, request) =>
          isSummaryRequest(context) && !explicitSummary
            ? automaticSummary(context)
            : faux.provider.stream(model, context, request),
        streamSimple: (model, context, request) =>
          isSummaryRequest(context) && !explicitSummary
            ? automaticSummary(context)
            : faux.provider.streamSimple(model, context, request),
      }),
    },
  };
  let backend = new PiBackendProcess(options);
  const rollover: PiBackendProcess["rolloverSession"] = async (input) => {
    explicitSummary = true;
    try {
      return await backend.rolloverSession(input);
    } finally {
      explicitSummary = false;
    }
  };
  const storeFiles = async (directory: string): Promise<string[]> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map(async (entry) =>
          entry.isDirectory()
            ? storeFiles(path.join(directory, entry.name))
            : [path.join(directory, entry.name)]
        )
      )
    ).flat();
  };
  const events: SessionEvent[] = [];
  let reopened: PiBackendProcess | undefined;
  try {
    await backend.start();
    const opened = await backend.newSession({ sessionId: "root-compact", cwd: vaultRoot });
    backend.registerSessionHandler(opened.sessionId, (event) => events.push(event));
    const prompt = async (text: string, requestId: string) => {
      try {
        return await backend.prompt({
          sessionId: opened.sessionId,
          requestId,
          prompt: [{ type: "text", text }],
        });
      } catch (error) {
        throw new Error(`${requestId}, calls=${faux.state.callCount}: ${String(error)}`);
      }
    };
    assert.equal(
      typeof backend.rolloverSession,
      "function",
      "the real backend must expose the explicit rollover action"
    );
    await assert.rejects(rollover({ sessionId: opened.sessionId }));
    assert.equal(
      faux.state.callCount,
      0,
      "empty history must not invent a summary or bill a request"
    );
    faux.setResponses([fauxAssistantMessage(`原始回答:${"old material ".repeat(800)}`)]);
    const older = "保留的原始问题";
    await prompt(older, "older");
    let summaryStarted!: () => void;
    let releaseSummary!: (message: AssistantMessage) => void;
    const generatingSummary = new Promise<void>((resolve) => {
      summaryStarted = resolve;
    });
    faux.setResponses([
      () => {
        summaryStarted();
        return new Promise<AssistantMessage>((resolve) => {
          releaseSummary = resolve;
        });
      },
    ]);
    const interrupted = rollover({ sessionId: opened.sessionId });
    const stopped = assert.rejects(interrupted, /停止/);
    await generatingSummary;
    const cancelling = backend.cancel({ sessionId: opened.sessionId });
    releaseSummary(fauxAssistantMessage("停止后的迟到摘要"));
    await Promise.all([cancelling, stopped]);
    assert.equal(
      (await backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot })).state.readOnly,
      false
    );
    faux.setResponses([fauxAssistantMessage(`停止后继续保留:${"old material ".repeat(800)}`)]);
    await prompt("停止总结后继续原聊天", "after-stop");

    const gate = await backend.newSession({ sessionId: "root-boundary", cwd: vaultRoot });
    let childStarted!: () => void;
    const childRunning = new Promise<void>((resolve) => {
      childStarted = resolve;
    });
    let launched = false;
    const backgroundResponse = (
      _input: unknown,
      streamOptions: { signal?: AbortSignal } | undefined,
      _state: unknown,
      model: { id: string }
    ) => {
      if (model.id === "child") {
        childStarted();
        return new Promise<AssistantMessage>((resolve) => {
          const abort = () => resolve(fauxAssistantMessage("停止后的迟到后台回答"));
          if (streamOptions?.signal?.aborted) abort();
          else streamOptions?.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      if (!launched) {
        launched = true;
        return fauxAssistantMessage(
          [
            fauxToolCall("start_background_task", {
              profileId: "researcher",
              task: "保持后台核对",
              description: "后台",
              modelKey: "child",
              commandId: "boundary-bg",
            }),
          ],
          { stopReason: "toolUse" }
        );
      }
      return fauxAssistantMessage("父任务已结束，后台仍在执行");
    };
    faux.setResponses(Array.from({ length: 6 }, () => backgroundResponse));
    await backend.prompt({
      sessionId: gate.sessionId,
      requestId: "background-boundary",
      prompt: [{ type: "text", text: "开始后台核对" }],
    });
    await childRunning;
    const beforeBlocked = faux.state.callCount;
    await assert.rejects(rollover({ sessionId: gate.sessionId }), /后台|工作/);
    assert.equal(faux.state.callCount, beforeBlocked);
    await backend.cancel({ sessionId: gate.sessionId });
    let questionShown!: () => void;
    const questionPending = new Promise<void>((resolve) => {
      questionShown = resolve;
    });
    backend.setAskUserQuestionPrompter(
      (request) =>
        new Promise((resolve) => {
          questionShown();
          request.signal?.addEventListener("abort", () => resolve({}), { once: true });
        })
    );
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("ask_user", {
            questions: [
              { question: "等待用户选择", options: [{ label: "继续" }], answerKey: "choice" },
            ],
          }),
        ],
        { stopReason: "toolUse" }
      ),
    ]);
    const waitingQuestion = backend.prompt({
      sessionId: gate.sessionId,
      requestId: "question-boundary",
      prompt: [{ type: "text", text: "先提问" }],
    });
    await questionPending;
    await assert.rejects(rollover({ sessionId: gate.sessionId }), /工作|批准|问题/);
    await backend.cancel({ sessionId: gate.sessionId });
    await waitingQuestion;
    await backend.closeSession({ sessionId: gate.sessionId });
    const knownSessions = new Set(
      (await backend.listSessions({ cwd: vaultRoot })).sessions.map((session) => session.sessionId)
    );
    const original = await backend.exportSession({ sessionId: opened.sessionId, format: "json" });
    faux.setResponses([fauxAssistantMessage("准备失败前的真实摘要")]);
    const rename = fs.rename;
    Reflect.set(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
      if (
        String(args[1]).endsWith("recovery-view.json") &&
        !String(args[1]).includes(`${path.sep}root-compact${path.sep}`)
      )
        throw new Error("new root snapshot unavailable");
      return rename(...args);
    });
    try {
      await assert.rejects(
        rollover({ sessionId: opened.sessionId }),
        /new root snapshot unavailable/
      );
    } finally {
      Reflect.set(fs, "rename", rename);
    }
    assert.equal(
      (await backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot })).state.readOnly,
      false
    );
    const failedRoots = (await backend.listSessions({ cwd: vaultRoot })).sessions.filter(
      (session) => !knownSessions.has(session.sessionId)
    );
    assert.equal(
      failedRoots.length,
      0,
      "failed replacement startup must not publish an executable session"
    );
    faux.setResponses([fauxAssistantMessage(`保留补充回答:${"recent material ".repeat(800)}`)]);
    await prompt("准备继续原始内容", "after-failed-rollover");
    const sourceMode = (await backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot }))
      .state.mode?.current;
    await backend.shutdown();
    const main = (await storeFiles(path.join(directory, "private"))).find((file) =>
      file.endsWith("root-compact/main.jsonl")
    );
    assert.ok(main);
    const metadata = JSON.parse(
      await fs.readFile(path.join(path.dirname(main), "session.json"), "utf8")
    ) as { conversationId: string };
    const storage = await openNodeJsonlStorage(path.dirname(main), BACKGROUND_CONTEXT, {
      fsync: true,
    });
    const harness = await Harness.open(
      storage,
      { models: createModels(), registry: createRegistry() },
      BACKGROUND_CONTEXT
    );
    try {
      const source = await harness.conversation(
        Number(metadata.conversationId) as ConversationId,
        BACKGROUND_CONTEXT
      );
      assert.ok(source);
      await source.commit(async (tx) => {
        await tx.appendEntry(source.id, {
          kind: "va.recent_context_fixture",
          data: { origin: "test-fixture" },
          model: [
            {
              role: "user",
              content: [{ type: "text", text: "RECENT_USER_PURPLE：最新颜色是紫色" }],
              timestamp: Date.now(),
            },
            fauxAssistantMessage("RECENT_ASSISTANT_PURPLE：已确认最新颜色为紫色"),
          ],
        });
        await tx.appendEntry(source.id, {
          kind: "va.resource_fixture",
          data: { content: "x".repeat(33 * 1024 * 1024) },
        });
      }, BACKGROUND_CONTEXT);
    } finally {
      await harness.close(BACKGROUND_CONTEXT);
      await storage.close(BACKGROUND_CONTEXT);
    }
    assert.ok((await fs.stat(main)).size > 32 * 1024 * 1024);
    backend = new PiBackendProcess(options);
    await backend.start();
    await backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
    faux.setResponses([fauxAssistantMessage("真实滚动摘要：较早状态为黄色")]);
    const before = faux.state.callCount;
    const rolled = await rollover({ sessionId: opened.sessionId });
    assert.notEqual(rolled.sessionId, opened.sessionId);
    assert.equal(rolled.state.readOnly, false);
    assert.equal(
      faux.state.callCount,
      before + 1,
      "rollover must use one actual SDK compaction response"
    );
    const archived = await backend.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
    assert.equal(archived.state.readOnly, true);
    await assert.rejects(prompt("old session cannot write", "archived-refuses-new-work"));
    const exported = await backend.exportSession({ sessionId: opened.sessionId, format: "json" });
    assert.ok(exported.content.includes(older));
    assert.ok(exported.content.includes("原始回答"));
    assert.ok(original.content.includes(older));
    const carried = await backend.exportSession({ sessionId: rolled.sessionId, format: "json" });
    assert.ok(carried.content.includes("真实滚动摘要"));
    assert.ok(carried.content.includes(opened.sessionId));
    assert.ok(carried.content.includes('"origin"'));
    const oldStore = (await storeFiles(path.join(directory, "private"))).find((file) =>
      file.endsWith("root-compact/main.jsonl")
    );
    assert.ok(oldStore);
    const bytesBeforeReopen = await fs.readFile(oldStore, "utf8");
    await backend.shutdown();
    reopened = new PiBackendProcess(options);
    const replay: SessionEvent[] = [];
    reopened.registerSessionHandler(opened.sessionId, (event) => replay.push(event));
    await reopened.start();
    const archivedReopen = await reopened.loadSession({
      sessionId: opened.sessionId,
      cwd: vaultRoot,
    });
    assert.equal(archivedReopen.state.readOnly, true);
    assert.equal(faux.state.callCount, before + 1);
    assert.equal(
      await fs.readFile(oldStore, "utf8"),
      bytesBeforeReopen,
      "reading archived history must not append or shrink the original JSONL"
    );
    await reopened.loadSession({ sessionId: rolled.sessionId, cwd: vaultRoot });
    let firstContext = "";
    faux.setResponses([
      (context) => {
        firstContext = JSON.stringify(context.messages);
        return fauxAssistantMessage("根据已保存摘要继续回答");
      },
    ]);
    await reopened.prompt({
      sessionId: rolled.sessionId,
      requestId: "fresh-after-rollover",
      prompt: [{ type: "text", text: "继续" }],
    });
    const saved = await reopened.exportSession({ sessionId: rolled.sessionId, format: "json" });
    assert.ok(saved.content.includes("根据已保存摘要继续回答"));
    assert.deepEqual(
      {
        mode: rolled.state.mode?.current,
        carriedUser: carried.content.includes("RECENT_USER_PURPLE"),
        recentUser: firstContext.includes("RECENT_USER_PURPLE"),
        recentAssistant: firstContext.includes("RECENT_ASSISTANT_PURPLE"),
      },
      { mode: sourceMode, carriedUser: true, recentUser: true, recentAssistant: true },
      "the first new-root request must preserve the source mode and the official compaction's unabridged recent tail"
    );
    return {
      status: "passed",
      checks: [
        "explicit_action_only",
        "stop_during_summary_keeps_source_writable",
        "active_background_or_pending_question_blocks_rollover",
        "failed_new_root_does_not_archive_or_publish_ghost",
        "explicit_rollover_remains_available_for_large_sessions",
        "official_sdk_summary_carried_to_new_root_with_source",
        "old_store_readonly_and_bytes_preserved",
        "archived_reopen_has_no_provider_call",
        "new_root_accepts_new_work",
        "first_request_keeps_recent_user_and_assistant_tail",
        "new_root_preserves_source_execution_mode",
      ],
      providerCalls: faux.state.callCount,
    };
  } finally {
    await reopened?.shutdown();
    await backend.shutdown();
  }
}
