import { requireNodeModule } from "@/utils/desktopRuntime";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { App } from "obsidian";
import type { JsonObject } from "@earendil-works/pi-durable";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type { SessionEvent } from "@/agentMode/session/types";
import { sha256 } from "@/utils/hash";
import type { ProviderStreamsFactory } from "@/agentMode/sdk/pi/models/ProviderFactory";
import { isSummaryRequest } from "@/agentMode/sdk/pi/testing/summaryRequest";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runProductionRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const secrets = new Map<string, string>([["fixture-key", "test-key"]]);
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "runtime-fixture",
    getSecretById: (id: string) => secrets.get(id) ?? null,
    setSecretById: (id: string, value: string) => {
      secrets.set(id, value);
    },
    deleteSecretById: (id: string) => {
      secrets.delete(id);
    },
  };
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
          limits: { context: 8192, output: 1024 },
          modalities: { input: ["text", "image"], output: ["text"] },
        },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: {},
      offerFeedbackCards: true,
    },
    backends: { pi: { enabledModels: ["fixture-model"] } },
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
  const faux = fauxProvider();
  let summaryCalls = 0;
  const summaryStream = () => {
    summaryCalls += 1;
    const message = fauxAssistantMessage(
      "## Goal\nContinue the existing diagnostic request.\n## Progress\nRetain recorded tool results and outstanding user decisions.\n## Next Steps\nComplete the pending conversation without repeating finished operations."
    );
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  let wholeMessageResponse = false;
  let wholeMessageCalls = 0;
  const wholeMessageStream = () => {
    wholeMessageCalls += 1;
    const message = fauxAssistantMessage([
      { type: "thinking", thinking: "公开思考", thinkingSignature: "opaque-signature" },
      { type: "text", text: "非增量的真实回答" },
      { type: "thinking", thinking: "redacted-private", redacted: true },
    ]);
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({
      type: "thinking_start",
      contentIndex: 0,
      partial: { ...message, content: [{ type: "thinking", thinking: "" }] },
    });
    stream.push({
      type: "thinking_end",
      contentIndex: 0,
      content: "公开思考",
      partial: { ...message, content: [{ type: "thinking", thinking: "公开思考" }] },
    });
    stream.push({
      type: "text_start",
      contentIndex: 1,
      partial: {
        ...message,
        content: [
          { type: "thinking", thinking: "公开思考" },
          { type: "text", text: "" },
        ],
      },
    });
    stream.push({
      type: "text_end",
      contentIndex: 1,
      content: "非增量的真实回答",
      partial: { ...message, content: message.content.slice(0, 2) },
    });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  const streamsFactory: ProviderStreamsFactory = () => ({
    stream: (model, context, request) =>
      isSummaryRequest(context)
        ? summaryStream()
        : wholeMessageResponse
          ? wholeMessageStream()
          : faux.provider.stream(model, context, request),
    streamSimple: (model, context, request) =>
      isSummaryRequest(context)
        ? summaryStream()
        : wholeMessageResponse
          ? wholeMessageStream()
          : faux.provider.streamSimple(model, context, request),
  });
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("todo_set", {
          expectedRevision: 0,
          items: [{ text: "核对笔记", status: "in_progress", priority: "high" }],
        }),
      ],
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage(
      [
        fauxToolCall(
          "propose_plan",
          {
            title: "核对计划",
            body: "先核对用户指定的笔记，再报告结果。",
            steps: ["核对笔记", "报告结果"],
          },
          { id: "call_0" }
        ),
      ],
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage(
      [
        fauxToolCall("ask_user", {
          questions: [
            {
              question: "先检查哪一项？",
              options: [{ label: "内容" }, { label: "格式" }],
              answerKey: "check",
            },
          ],
        }),
      ],
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage("真实入口回答"),
  ]);
  const options = {
    host: {
      app,
      keychain,
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory,
      skillsSource: {
        listSkills: async () => [
          {
            name: "review",
            description: "Review supplied material",
            filePath: "skills/review/SKILL.md",
            dirPath: "skills/review",
            enabledAgents: ["pi"],
            location: { kind: "canonical" as const },
          },
        ],
        readBody: (target: string) => fs.readFile(path.join(vaultRoot, target), "utf8"),
      },
    },
  };
  const backend = new PiBackendProcess(options);
  let approvals = 0;
  const planApprovalIds: string[] = [];
  let questionCount = 0;
  backend.setPermissionPrompter(async (request) => {
    assert.equal(request.toolCall.isPlanProposal, true);
    assert.ok(JSON.stringify(request.toolCall).includes("先核对用户指定的笔记"));
    approvals += 1;
    planApprovalIds.push(request.toolCall.toolCallId);
    const approval = request.options.find((option) => option.kind === "allow_once");
    assert.ok(approval);
    return { outcome: { outcome: "selected", optionId: approval.optionId } };
  });
  backend.setAskUserQuestionPrompter(async (request) => {
    questionCount += 1;
    assert.equal(request.questions[0]?.question, "先检查哪一项？");
    return { check: "内容" };
  });
  await backend.start();
  const opened = await backend.newSession({ cwd: vaultRoot });
  const events: SessionEvent[] = [];
  backend.registerSessionHandler(opened.sessionId, (event) => events.push(event));
  await backend.setSessionModel({ sessionId: opened.sessionId, modelId: "fixture-model" });
  await backend.setSessionMode({ sessionId: opened.sessionId, modeId: "plan" });
  const answer = await backend.prompt({
    sessionId: opened.sessionId,
    prompt: [{ type: "text", text: "请回答" }],
    requestId: "fixture-request",
  });
  assert.equal(answer.stopReason, "end_turn");
  assert.ok(JSON.stringify(events).includes("真实入口回答"));
  assert.equal(approvals, 1, "the real plan tool must wait for the host approval callback");
  assert.equal(questionCount, 1, "the real question tool must call the host question callback");
  assert.ok(
    summaryCalls > 0,
    "the actual 8k runtime must compact without consuming the tool response queue"
  );
  assert.ok(
    events.some(
      (event) =>
        event.update.sessionUpdate === "todo_update" &&
        event.update.todo.revision === 1 &&
        event.update.todo.items[0]?.text === "核对笔记"
    )
  );
  assert.ok(
    events.some(
      (event) =>
        event.update.sessionUpdate === "plan_proposal_update" &&
        event.update.plan.decision === "approved"
    )
  );
  assert.ok(
    events.some(
      (event) =>
        event.update.sessionUpdate === "state_changed" &&
        event.update.state.mode?.current === "default"
    ),
    "approved plans must leave plan mode during the live run"
  );
  const calls = faux.state.callCount;
  await backend.shutdown();
  const reopened = new PiBackendProcess(options);
  await reopened.start();
  const replay: SessionEvent[] = [];
  reopened.registerSessionHandler(opened.sessionId, (event) => replay.push(event));
  await reopened.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
  assert.ok(JSON.stringify(replay).includes("真实入口回答"));
  assert.ok(
    replay.some(
      (event) =>
        event.update.sessionUpdate === "todo_update" &&
        event.update.todo.items[0]?.text === "核对笔记"
    )
  );
  assert.ok(
    replay.some(
      (event) =>
        event.update.sessionUpdate === "plan_proposal_update" &&
        event.update.plan.decision === "approved"
    )
  );
  assert.equal(faux.state.callCount, calls);
  await reopened.prompt({
    sessionId: opened.sessionId,
    prompt: [{ type: "text", text: "请回答" }],
    requestId: "fixture-request",
  });
  assert.equal(faux.state.callCount, calls);
  const continued: SessionEvent[] = [];
  reopened.registerSessionHandler(opened.sessionId, (event) => continued.push(event));
  const runTool = async (
    requestId: string,
    name: string,
    args: JsonObject,
    expectedOffered = true
  ) => {
    faux.appendResponses([
      (context) => {
        const offered = new Set<string>();
        for (const message of context.messages) {
          if (message.role !== "system") continue;
          for (const removed of message.toolsRemoved ?? []) offered.delete(removed.name);
          for (const added of message.toolsAdded ?? []) offered.add(added.name);
        }
        assert.equal(
          offered.has(name),
          expectedOffered,
          `${requestId}: the actual provider schema must match current capability availability`
        );
        return fauxAssistantMessage(
          [fauxToolCall(name, args, { id: name === "propose_plan" ? "call_0" : requestId })],
          { stopReason: "toolUse" }
        );
      },
      fauxAssistantMessage("已处理工具结果"),
    ]);
    return reopened.prompt({
      sessionId: opened.sessionId,
      requestId,
      prompt: [{ type: "text", text: name }],
    });
  };
  let rejections = 0;
  reopened.setPermissionPrompter(async (request) => {
    rejections += 1;
    if (request.toolCall.isPlanProposal) planApprovalIds.push(request.toolCall.toolCallId);
    const denial = request.options.find((option) => option.kind === "reject_once");
    assert.ok(denial);
    return { outcome: { outcome: "selected", optionId: denial.optionId } };
  });
  await reopened.setSessionMode({ sessionId: opened.sessionId, modeId: "plan" });
  await runTool("reject-plan", "propose_plan", {
    title: "未批准计划",
    body: "这个计划需由用户拒绝。",
    steps: ["等待决定"],
  });
  assert.equal(
    planApprovalIds.length,
    2,
    "reused provider call_0 must ask for each different plan"
  );
  assert.equal(new Set(planApprovalIds).size, 2, "each actual SDK task must own its approval");
  for (const toolCallId of planApprovalIds)
    assert.ok(
      [...events, ...continued].some(
        (event) =>
          event.update.sessionUpdate === "tool_call" && event.update.toolCallId === toolCallId
      ),
      "each approval must refer to its own actual tool card"
    );
  assert.ok(
    continued.some(
      (event) =>
        event.update.sessionUpdate === "plan_proposal_update" &&
        event.update.plan.decision === "rejected"
    )
  );
  // 计划态按真实 network 效果收回工具；伪造旧工具调用也不应弹出会被误解为可执行的审批：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  await runTool("deny-web-in-plan", "web_fetch", { url: "http://127.0.0.1/private" }, false);
  assert.equal(rejections, 1);
  await reopened.setSessionMode({ sessionId: opened.sessionId, modeId: "default" });
  await runTool("deny-web", "web_fetch", { url: "http://127.0.0.1/private" });
  assert.equal(rejections, 2);
  await runTool("todo-stale-1", "todo_set", { expectedRevision: 0, items: [] });
  await runTool("todo-stale-2", "todo_set", { expectedRevision: 0, items: [] });
  assert.ok(JSON.stringify(continued).includes("TODO_REVISION_CONFLICT"));
  const feedback = continued.find(
    (event) => event.update.sessionUpdate === "feedback_offer" && event.update.offer !== null
  )?.update;
  assert.ok(
    feedback && feedback.sessionUpdate === "feedback_offer" && feedback.offer?.id,
    "actual repeated tool failures must produce a persisted feedback offer"
  );
  const feedbackId = feedback.offer.id;
  await reopened.setFeedbackStatus({
    sessionId: opened.sessionId,
    offerId: feedbackId,
    status: "dismissed",
  });
  let reachedQuestion!: () => void;
  const questionReached = new Promise<void>((resolve) => {
    reachedQuestion = resolve;
  });
  reopened.setAskUserQuestionPrompter(
    (request) =>
      new Promise((resolve) => {
        request.signal?.addEventListener("abort", () => resolve({}), { once: true });
        reachedQuestion();
      })
  );
  faux.appendResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("ask_user", {
          questions: [{ question: "等待用户决定", options: [{ label: "确认" }] }],
        }),
      ],
      { stopReason: "toolUse" }
    ),
  ]);
  const waiting = reopened.prompt({
    sessionId: opened.sessionId,
    requestId: "cancel-question",
    prompt: [{ type: "text", text: "等待提问后停止" }],
  });
  await questionReached;
  await reopened.prompt({
    sessionId: opened.sessionId,
    requestId: "stop-command",
    prompt: [{ type: "text", text: "/stop" }],
  });
  assert.equal((await waiting).stopReason, "cancelled");
  await reopened.shutdown();
  const afterDismissal = new PiBackendProcess(options);
  await afterDismissal.start();
  const dismissedReplay: SessionEvent[] = [];
  afterDismissal.registerSessionHandler(opened.sessionId, (event) => dismissedReplay.push(event));
  const beforeFinalReopen = faux.state.callCount;
  await afterDismissal.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
  assert.equal(faux.state.callCount, beforeFinalReopen);
  assert.ok(
    !dismissedReplay.some(
      (event) =>
        event.update.sessionUpdate === "feedback_offer" && event.update.offer?.id === feedbackId
    )
  );
  const projectedEvents: SessionEvent[] = [];
  afterDismissal.registerSessionHandler(opened.sessionId, (event) => projectedEvents.push(event));
  wholeMessageResponse = true;
  await afterDismissal.prompt({
    sessionId: opened.sessionId,
    requestId: "whole-message",
    prompt: [{ type: "text", text: "测试非增量与公开思考" }],
  });
  wholeMessageResponse = false;
  assert.ok(
    projectedEvents.some(
      (event) =>
        event.update.sessionUpdate === "session_projection" &&
        event.update.projection.messages.some(
          (message) => message.id.includes(":live:") && message.message === "非增量的真实回答"
        )
    ),
    "a replacement-only stream must show text before it commits"
  );
  assert.ok(!JSON.stringify(projectedEvents).includes("redacted-private"));
  assert.ok(!JSON.stringify(projectedEvents).includes("opaque-signature"));
  const thoughtReplay: SessionEvent[] = [];
  afterDismissal.registerSessionHandler(opened.sessionId, (event) => thoughtReplay.push(event));
  await afterDismissal.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
  assert.ok(
    thoughtReplay.some(
      (event) =>
        event.update.sessionUpdate === "session_projection" &&
        event.update.projection.messages.some((message) =>
          message.parts?.some(
            (part) =>
              part.kind === "thought" &&
              part.text === "公开思考" &&
              part.startedAtMs !== undefined &&
              part.durationMs !== undefined
          )
        )
    ),
    "the real watch must persist public reasoning timing for replay"
  );
  await fs.mkdir(path.join(vaultRoot, "skills", "review"), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, "skills", "review", "SKILL.md"),
    "Review the supplied material and report factual differences."
  );
  const beforeCommands = faux.state.callCount;
  await afterDismissal.prompt({
    sessionId: opened.sessionId,
    requestId: "skill-command",
    prompt: [{ type: "text", text: "/skill canonical:review" }],
  });
  await afterDismissal.prompt({
    sessionId: opened.sessionId,
    requestId: "model-command",
    prompt: [{ type: "text", text: "/model fixture-model" }],
  });
  await assert.rejects(
    afterDismissal.prompt({
      sessionId: opened.sessionId,
      requestId: "unknown-command",
      prompt: [{ type: "text", text: "/unknown" }],
    }),
    /Unknown command/
  );
  assert.equal(
    faux.state.callCount,
    beforeCommands,
    "local commands must never become model or shell requests"
  );
  const image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXkAAAAASUVORK5CYII=";
  faux.appendResponses([
    (context) => {
      const last = context.messages.filter((message) => message.role === "user").at(-1);
      assert.ok(last && Array.isArray(last.content));
      assert.ok(
        last.content.some(
          (part) => part.type === "image" && part.mimeType === "image/png" && part.data === image
        )
      );
      const text = JSON.stringify(last.content);
      assert.ok(text.includes("用户给出的短资料"));
      assert.ok(!text.includes("oversized-context-".repeat(20)));
      return fauxAssistantMessage("已检查图片与有来源的资料");
    },
  ]);
  await afterDismissal.prompt({
    sessionId: opened.sessionId,
    requestId: "context-and-image",
    prompt: [
      { type: "text", text: "请看这张图片" },
      { type: "image", mimeType: "image/png", data: image },
    ],
    context: {
      materials: [
        { origin: "note", sourcePath: "chosen.md", text: "用户给出的短资料" },
        { origin: "web", url: "https://example.test", text: "oversized-context-".repeat(12_000) },
      ],
    },
  });
  const withAttachment = await afterDismissal.exportSession({
    sessionId: opened.sessionId,
    format: "json",
  });
  const attachmentDocument = JSON.parse(withAttachment.content) as {
    session: { attachments?: { mime: string; bytes: number }[] };
  };
  assert.ok(
    attachmentDocument.session.attachments?.some(
      (attachment) => attachment.mime === "image/png" && attachment.bytes > 0
    ),
    "full export must include attachment metadata from the actual input receipt"
  );
  const sourceText = "**user**: 旧问题\n\n**ai**: 旧回答\n";
  const sourcePath = path.join(vaultRoot, "old-chat.md");
  await fs.writeFile(sourcePath, sourceText);
  const legacyEntry = {
    backendId: "claude",
    sessionId: "old-fixture",
    title: "原有聊天",
    createdAtMs: 1,
    lastAccessedAtMs: 2,
    sourcePath: "old-chat.md",
    sourceHash: sha256(sourceText),
    messages: [
      { role: "user" as const, text: "旧问题" },
      { role: "assistant" as const, text: "旧回答" },
    ],
    unknownFields: {},
    importMode: "text_only" as const,
  };
  const beforeImport = faux.state.callCount;
  const imported = await afterDismissal.importLegacySession({ cwd: vaultRoot, entry: legacyEntry });
  const repeated = await afterDismissal.importLegacySession({ cwd: vaultRoot, entry: legacyEntry });
  assert.equal(imported.sessionId, repeated.sessionId);
  assert.equal(await fs.readFile(sourcePath, "utf8"), sourceText);
  const importedBackup = await afterDismissal.exportSession({
    sessionId: imported.sessionId,
    format: "json",
  });
  const importedDocument = JSON.parse(importedBackup.content) as {
    session: { extras: { entries: { kind: string }[] } };
  };
  assert.equal(
    importedDocument.session.extras.entries.filter((entry) => entry.kind === "va.material").length,
    1
  );
  const fullBackup = await afterDismissal.exportSession({
    sessionId: opened.sessionId,
    format: "json",
  });
  const markdown = await afterDismissal.exportSession({
    sessionId: opened.sessionId,
    format: "markdown",
  });
  assert.ok(markdown.content.includes("真实入口回答"));
  const restored = await afterDismissal.importSessionBackup({
    cwd: vaultRoot,
    content: fullBackup.content,
  });
  assert.equal(restored.state.readOnly, true);
  const restoredEvents: SessionEvent[] = [];
  const stopWatchingBackup = afterDismissal.registerSessionHandler(restored.sessionId, (event) =>
    restoredEvents.push(event)
  );
  await afterDismissal.loadSession({ sessionId: restored.sessionId, cwd: vaultRoot });
  const restoredMessages = restoredEvents.flatMap((event) =>
    event.update.sessionUpdate === "session_projection" ? event.update.projection.messages : []
  );
  assert.ok(
    restoredMessages.some((message) => message.sender === "user" && message.message === "请回答"),
    "a full backup must retain the original user role"
  );
  assert.ok(
    restoredMessages.some(
      (message) => message.sender === "ai" && message.message === "真实入口回答"
    ),
    "a full backup must retain the original assistant role"
  );
  assert.ok(
    restoredMessages.some(
      (message) =>
        message.sender === "user" &&
        Array.isArray(message.content) &&
        JSON.stringify(message.content).includes(`data:image/png;base64,${image}`)
    ),
    "restoring the full backup must restore the actual image bytes rather than only its receipt"
  );
  const exportedAgain = await afterDismissal.exportSession({
    sessionId: restored.sessionId,
    format: "json",
  });
  assert.ok(exportedAgain.content.includes("真实入口回答"));
  assert.ok(
    exportedAgain.content.includes("va.state"),
    "full export must retain durable feature entries"
  );
  assert.equal(
    faux.state.callCount,
    beforeImport,
    "import, read-only restore, and export must never contact a provider"
  );
  stopWatchingBackup();
  faux.appendResponses([fauxAssistantMessage("导入后的新聊天确实可以继续")]);
  await afterDismissal.prompt({
    sessionId: imported.sessionId,
    requestId: "continue-import",
    prompt: [{ type: "text", text: "继续分析刚导入的资料" }],
  });
  assert.equal(faux.state.callCount, beforeImport + 1);
  assert.equal(await fs.readFile(sourcePath, "utf8"), sourceText);
  await afterDismissal.shutdown();
  await assert.rejects(
    afterDismissal.prompt({
      sessionId: opened.sessionId,
      prompt: [{ type: "text", text: "关闭后拒绝" }],
    })
  );
  const finalReopen = new PiBackendProcess(options);
  await finalReopen.start();
  const durableThinking: SessionEvent[] = [];
  finalReopen.registerSessionHandler(opened.sessionId, (event) => durableThinking.push(event));
  const beforeThinkingReopen = faux.state.callCount;
  await finalReopen.loadSession({ sessionId: opened.sessionId, cwd: vaultRoot });
  assert.equal(faux.state.callCount, beforeThinkingReopen);
  assert.ok(
    durableThinking.some(
      (event) =>
        event.update.sessionUpdate === "session_projection" &&
        event.update.projection.messages.some((message) =>
          message.parts?.some(
            (part) =>
              part.kind === "thought" && part.text === "公开思考" && part.durationMs !== undefined
          )
        )
    ),
    "actual reasoning timings must survive a complete runtime shutdown and reopen"
  );
  await finalReopen.shutdown();
  return {
    status: "passed",
    checks: [
      "production_backend_prompt",
      "durable_reopen_history",
      "read_only_reopen",
      "stable_request_deduplication",
      "durable_todo_tool",
      "plan_approval_callback",
      "actual_user_question",
      "feature_state_reopen",
      "plan_approval_leaves_read_only_mode",
      "rejected_plan_stays_rejected",
      "reused_provider_call_id_independent_plan_approvals_and_cards",
      "web_denial_without_network",
      "todo_revision_conflict",
      "error_feedback_persisted_and_dismissed",
      "stop_pending_question",
      "legacy_import_idempotent_source_unchanged",
      "full_backup_round_trip_read_only",
      "markdown_export_real_history",
      "nonincremental_stream_live_projection",
      "public_thinking_only_with_durable_timing",
      "local_skill_model_unknown_and_stop_commands",
      "material_budget_and_source_on_real_request",
      "image_private_blob_and_full_export_receipt",
      "imported_chat_continues_without_changing_source",
      "shutdown_rejects_new_calls_and_reopen_preserves_thinking",
    ],
    providerCalls: faux.state.callCount + wholeMessageCalls,
    approvals,
    questionCount,
    environment: {
      pathEntries: (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).length,
    },
  };
}
