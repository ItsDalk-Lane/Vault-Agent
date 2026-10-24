import { requireNodeModule } from "@/utils/desktopRuntime";
import { TFile, type App } from "obsidian";
import { sha256 } from "@/utils/hash";
import type { VaultAgentSettings } from "@/settings/model";
import {
  fauxProvider,
  fauxAssistantMessage,
  createAssistantMessageEventStream,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type {
  SessionUpdate,
  AskUserQuestionPrompt,
  PermissionPrompt,
  PermissionDecision,
} from "@/agentMode/session/types";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runUserPauseRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "user-pause-vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        displayName: "Fixture",
        baseUrl: "http://127.0.0.1:9999/v1",
        apiKeyKeychainId: "fixture-key",
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "saved-model",
        providerId: "fixture",
        info: {
          id: "fixture-model",
          displayName: "Fixture",
          toolCall: true,
          limits: { context: 262144 },
        },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: {},
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["saved-model"] } },
  } as unknown as VaultAgentSettings;
  const files = new Map<string, TFile>();
  let writes = 0;
  const app = {
    vault: {
      configDir: ".fixture-config",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (name: string) => files.get(name) ?? null,
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      process: async (file: TFile, update: (current: string) => string) => {
        const absolute = path.join(vaultRoot, file.path);
        const next = update(await fs.readFile(absolute, "utf8"));
        await fs.writeFile(absolute, next);
        writes += 1;
      },
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: { iterateAllLeaves: () => undefined },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
  } as unknown as App;
  const faux = fauxProvider();
  let calls = 0;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const streamsFactory: import("@/agentMode/sdk/pi/models/ProviderFactory").ProviderStreamsFactory =
    () => {
      const open: ReturnType<
        import("@/agentMode/sdk/pi/models/ProviderFactory").ProviderStreamsFactory
      >["streamSimple"] = (model, context, request) => {
        calls += 1;
        if (calls > 1) return faux.provider.streamSimple(model, context, request);
        const stream = createAssistantMessageEventStream();
        const message = fauxAssistantMessage("暂停前已经记录的进度");
        stream.push({ type: "start", partial: { ...message, content: [] } });
        stream.push({
          type: "text_start",
          contentIndex: 0,
          partial: { ...message, content: [{ type: "text", text: "" }] },
        });
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "暂停前已经记录的进度",
          partial: message,
        });
        const abort = () => {
          const stopped = { ...message, stopReason: "aborted" as const };
          stream.push({ type: "error", reason: "aborted", error: stopped });
          stream.end(stopped);
        };
        request?.signal?.addEventListener("abort", abort, { once: true });
        if (request?.signal?.aborted) abort();
        started();
        return stream;
      };
      return { stream: open, streamSimple: open };
    };
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "user-pause-fixture",
    getSecretById: (id: string) => (id === "fixture-key" ? "fixture-key" : null),
    setSecretById: () => undefined,
    deleteSecretById: () => undefined,
  };
  const options = {
    host: {
      app,
      keychain,
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory,
    },
  };
  let backend = new PiBackendProcess(options);
  const sessionId = "root-user-pause";
  try {
    await backend.start();
    await backend.newSession({ sessionId, cwd: vaultRoot });
    await backend.setSessionModel({ sessionId, modelId: "saved-model" });
    await backend.setSessionMode({ sessionId, modeId: "auto" });
    const updates: SessionUpdate[] = [];
    let ready!: () => void;
    const paused = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let sawProgress!: () => void;
    const visibleProgress = new Promise<void>((resolve) => {
      sawProgress = resolve;
    });
    backend.registerSessionHandler(sessionId, (event) => {
      updates.push(event.update);
      if (
        event.update.sessionUpdate === "session_projection" &&
        event.update.projection.messages.some((message) =>
          message.message.includes("暂停前已经记录的进度")
        )
      )
        sawProgress();
      if (
        event.update.sessionUpdate === "recovery_state" &&
        event.update.recovery.status === "available" &&
        event.update.recovery.message?.includes("按要求暂停")
      )
        ready();
    });
    faux.setResponses([fauxAssistantMessage("继续后完成原有任务，保留前一段结果")]);
    const turn = backend.prompt({
      sessionId,
      requestId: "long-task",
      prompt: [{ type: "text", text: "完整核对资料，保存进度且不要重复完成的操作" }],
    });
    await entered;
    await visibleProgress;
    await backend.pauseSession({ sessionId });
    const result = await turn;
    assert.equal(result.stopReason, "max_turn_requests");
    await paused;
    assert.equal(calls, 1);
    assert.ok(
      updates.some(
        (update) => update.sessionUpdate === "run_state" && update.run.status === "paused_user"
      )
    );
    assert.ok(
      !updates.some(
        (update) => update.sessionUpdate === "run_state" && update.run.status === "completed"
      )
    );
    const pausedExport = await backend.exportSession({ sessionId, format: "json" });
    assert.ok(
      pausedExport.content.includes("暂停前已经记录的进度"),
      "a saved pause must preserve the visible partial response"
    );
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    assert.equal(calls, 1, "opening a paused task must not dispatch");
    const reopened = await backend.exportSession({ sessionId, format: "json" });
    assert.ok(reopened.content.includes("暂停前已经记录的进度"));
    await backend.recoverSession({ sessionId, action: "continue" });
    assert.equal(
      calls,
      2,
      "Continue must resume the saved generation, not submit the original input again"
    );
    const exported = await backend.exportSession({ sessionId, format: "json" });
    assert.ok(exported.content.includes("继续后完成原有任务"));
    const document = JSON.parse(exported.content) as {
      session: {
        messages: { text: string }[];
        extras: { entries: { kind: string; model?: { content?: { text?: string }[] }[] }[] };
      };
    };
    const entries = document.session.extras.entries;
    assert.equal(entries.filter((entry) => entry.kind === "va.paused-output").length, 1);
    assert.equal(
      document.session.messages.some((message) => message.text.includes("暂停前已经记录的进度")),
      false,
      "the original aborted generation cannot duplicate the resumed final answer"
    );
    assert.equal(
      entries.filter(
        (entry) =>
          entry.kind === "pi.user" &&
          entry.model?.[0]?.content?.some(
            (part) => part.text === "完整核对资料，保存进度且不要重复完成的操作"
          )
      ).length,
      1
    );
    for (const lifecycle of ["pause", "shutdown", "release", "pause_release"] as const) {
      const questionSessionId = `root-question-${lifecycle}`;
      const opened = await backend.newSession({ sessionId: questionSessionId, cwd: vaultRoot });
      const hostSession = new AgentSession({
        backend,
        backendSessionId: questionSessionId,
        internalId: `host-${questionSessionId}`,
        backendId: "pi",
        cwd: vaultRoot,
      });
      hostSession.completeResume(opened.state);
      await hostSession.ready;
      await backend.setSessionModel({ sessionId: questionSessionId, modelId: "saved-model" });
      let sawQuestion!: () => void;
      const questionReached = new Promise<void>((resolve) => {
        sawQuestion = resolve;
      });
      let sawPending!: () => void;
      const pendingShown = new Promise<void>((resolve) => {
        sawPending = resolve;
      });
      let originalQuestion: AskUserQuestionPrompt | undefined;
      let questionWindows = 0;
      backend.setAskUserQuestionPrompter((request) => {
        originalQuestion = request;
        questionWindows += 1;
        sawQuestion();
        return new Promise((resolve) =>
          request.signal?.addEventListener("abort", () => resolve({}), { once: true })
        );
      });
      backend.registerSessionHandler(questionSessionId, (event) => {
        if (
          event.update.sessionUpdate === "session_projection" &&
          event.update.projection.pending.questions.length
        )
          sawPending();
      });
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("ask_user", {
              questions: [
                {
                  question: "保留哪项？",
                  answerKey: "choice",
                  options: [{ label: "A" }, { label: "B" }],
                },
              ],
            }),
          ],
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage("已沿原问题收到A并完成"),
      ]);
      const beforeQuestionCalls: number = calls;
      const waiting = backend
        .prompt({
          sessionId: questionSessionId,
          requestId: `question-${lifecycle}`,
          prompt: [{ type: "text", text: "先询问用户再继续" }],
        })
        .then(
          (output) => ({ kind: "output" as const, output }),
          (error: unknown) => ({ kind: "error" as const, error })
        );
      await Promise.all([questionReached, pendingShown]);
      assert.ok(originalQuestion);
      assert.equal(calls, beforeQuestionCalls + 1);
      if (lifecycle === "pause" || lifecycle === "pause_release") await hostSession.pause();
      if (lifecycle === "release" || lifecycle === "pause_release")
        await hostSession.releaseBackendSession();
      await hostSession.dispose();
      await backend.shutdown();
      const interrupted = await waiting;
      if (lifecycle !== "shutdown") {
        assert.equal(interrupted.kind, "output");
        if (interrupted.kind === "output")
          assert.equal(interrupted.output.stopReason, "max_turn_requests");
      } else if (interrupted.kind === "error") {
        assert.match(
          String(interrupted.error),
          /closed/i,
          "shutdown may only interrupt this active call because its SDK owner closed"
        );
      }
      assert.equal(
        originalQuestion.signal?.aborted,
        true,
        "closing must withdraw the live question window"
      );
      backend = new PiBackendProcess(options);
      await backend.start();
      backend.setAskUserQuestionPrompter(async () => {
        questionWindows += 1;
        throw new Error("a saved answer must not open another question window");
      });
      const resumedUi = new AgentSession({
        backend,
        backendSessionId: questionSessionId,
        internalId: `resumed-${questionSessionId}`,
        backendId: "pi",
        cwd: vaultRoot,
      });
      const loaded = await backend.loadSession({ sessionId: questionSessionId, cwd: vaultRoot });
      resumedUi.completeResume(loaded.state);
      await resumedUi.ready;
      const pendingOnReopen = resumedUi.getPendingAskUserQuestions();
      assert.equal(
        resumedUi.getRecoveryState()?.status,
        "available",
        "pending saved work must still require explicit recovery"
      );
      assert.equal(
        calls,
        beforeQuestionCalls + 1,
        "reopening a pending question must not call a model"
      );
      assert.equal(
        pendingOnReopen.length,
        1,
        `${lifecycle} must retain the original durable pending question`
      );
      assert.equal(pendingOnReopen[0].requestId, originalQuestion.requestId);
      assert.equal(questionWindows, 1, "opening history must not call the question prompter");
      await backend.answerPendingQuestion({
        sessionId: questionSessionId,
        requestId: originalQuestion.requestId,
        answers: { choice: "A" },
      });
      assert.equal(
        calls,
        beforeQuestionCalls + 1,
        "saving an answer must not resume the paused SDK task"
      );
      await resumedUi.recoverSession("continue");
      const finalRecovery = resumedUi.getRecoveryState();
      assert.ok(
        !finalRecovery || finalRecovery.status === "none",
        `${lifecycle}: completed recovered work must clear the real Session recovery state`
      );
      await resumedUi.recoverSession("continue");
      assert.equal(
        calls,
        beforeQuestionCalls + 2,
        "Continue must use the original tool checkpoint before exactly one final model request"
      );
      assert.equal(
        questionWindows,
        1,
        "Continue must consume the saved answer without asking again"
      );
      const resumed = JSON.parse(
        (await backend.exportSession({ sessionId: questionSessionId, format: "json" })).content
      ) as typeof document;
      assert.ok(JSON.stringify(resumed).includes("已沿原问题收到A并完成"));
      assert.equal(
        resumed.session.extras.entries.filter((entry) => entry.kind === "pi.user").length,
        1
      );
      await resumedUi.dispose();
      await backend.shutdown();
      backend = new PiBackendProcess(options);
      await backend.start();
      const coldUi = new AgentSession({
        backend,
        backendSessionId: questionSessionId,
        internalId: `completed-${questionSessionId}`,
        backendId: "pi",
        cwd: vaultRoot,
      });
      const completed = await backend.loadSession({ sessionId: questionSessionId, cwd: vaultRoot });
      coldUi.completeResume(completed.state);
      await coldUi.ready;
      const coldRecovery = coldUi.getRecoveryState();
      assert.ok(
        !coldRecovery || coldRecovery.status === "none",
        "cold reopening completed recovered work must not offer recovery"
      );
      await coldUi.recoverSession("continue");
      assert.equal(
        calls,
        beforeQuestionCalls + 2,
        "completed or cold repeated Continue cannot call the model again"
      );
      await coldUi.dispose();
    }
    for (const interaction of ["edit", "plan"] as const) {
      for (const lifecycle of ["pause", "shutdown"] as const) {
        const approvalSessionId = `root-approval-${interaction}-${lifecycle}`;
        const target = `${interaction}-${lifecycle}.md`;
        const before = "原始内容，必须保留。";
        await fs.writeFile(path.join(vaultRoot, target), before);
        files.set(
          target,
          Object.assign(new TFile(), {
            path: target,
            extension: "md",
            stat: { size: before.length },
          })
        );
        await backend.newSession({ sessionId: approvalSessionId, cwd: vaultRoot });
        await backend.setSessionModel({ sessionId: approvalSessionId, modelId: "saved-model" });
        let sawPermission!: () => void;
        const permissionReached = new Promise<void>((resolve) => {
          sawPermission = resolve;
        });
        let sawPending!: () => void;
        const pendingShown = new Promise<void>((resolve) => {
          sawPending = resolve;
        });
        let originalPermission: PermissionPrompt | undefined;
        let windows = 0;
        backend.setPermissionPrompter((request) => {
          originalPermission = request;
          windows += 1;
          sawPermission();
          return new Promise<PermissionDecision>((resolve) =>
            request.signal?.addEventListener(
              "abort",
              () => resolve({ outcome: { outcome: "cancelled" } }),
              { once: true }
            )
          );
        });
        backend.registerSessionHandler(approvalSessionId, (event) => {
          if (
            event.update.sessionUpdate === "session_projection" &&
            (interaction === "plan"
              ? event.update.projection.pending.plan
              : event.update.projection.pending.permissions.length)
          )
            sawPending();
        });
        faux.setResponses([
          fauxAssistantMessage(
            [
              interaction === "edit"
                ? fauxToolCall("vault_edit", {
                    path: target,
                    fileVersion: sha256(before),
                    edits: [{ oldText: "原始内容", newText: "已批准内容" }],
                  })
                : fauxToolCall("propose_plan", {
                    title: "待批准计划",
                    body: "先核对再执行",
                    steps: ["核对"],
                  }),
            ],
            { stopReason: "toolUse" }
          ),
          fauxAssistantMessage(`原${interaction}任务已明确批准后完成`),
        ]);
        const beforeCalls: number = calls;
        const beforeWrites = writes;
        const waiting = backend
          .prompt({
            sessionId: approvalSessionId,
            requestId: `approval-${interaction}-${lifecycle}`,
            prompt: [{ type: "text", text: "先等待明确批准，保留原任务" }],
          })
          .then(
            (output) => ({ kind: "output" as const, output }),
            (error) => ({ kind: "error" as const, error })
          );
        await Promise.all([permissionReached, pendingShown]);
        assert.ok(originalPermission);
        assert.equal(writes, beforeWrites);
        if (lifecycle === "pause") await backend.pauseSession({ sessionId: approvalSessionId });
        await backend.shutdown();
        const interrupted = await waiting;
        if (lifecycle === "pause") {
          assert.equal(interrupted.kind, "output");
          if (interrupted.kind === "output")
            assert.equal(interrupted.output.stopReason, "max_turn_requests");
        } else if (interrupted.kind === "error") assert.match(String(interrupted.error), /closed/i);
        assert.equal(originalPermission.signal?.aborted, true);
        assert.equal(writes, beforeWrites);
        backend = new PiBackendProcess(options);
        await backend.start();
        const pendingOnReopen: string[] = [];
        backend.setPermissionPrompter(async (request) => {
          windows += 1;
          assert.equal(
            request.toolCall.toolCallId,
            originalPermission!.toolCall.toolCallId,
            "Continue must approve the original SDK task"
          );
          if (interaction === "edit")
            assert.ok(
              request.toolCall.content?.some(
                (part) => part.type === "diff" && part.oldText === before
              )
            );
          const option = request.options.find((option) => option.kind === "allow_once");
          assert.ok(option);
          return { outcome: { outcome: "selected", optionId: option.optionId } };
        });
        backend.registerSessionHandler(approvalSessionId, (event) => {
          if (event.update.sessionUpdate === "session_projection")
            pendingOnReopen.splice(
              0,
              pendingOnReopen.length,
              ...(interaction === "plan"
                ? event.update.projection.pending.plan?.pendingToolCallId
                  ? [event.update.projection.pending.plan.pendingToolCallId]
                  : []
                : event.update.projection.pending.permissions.map(
                    (request) => request.toolCall.toolCallId
                  ))
            );
        });
        await backend.loadSession({ sessionId: approvalSessionId, cwd: vaultRoot });
        assert.equal(
          calls,
          beforeCalls + 1,
          "reopening a pending permission must not call a model"
        );
        assert.equal(writes, beforeWrites, "reopening must not execute the waiting operation");
        assert.equal(
          pendingOnReopen.length,
          1,
          `${lifecycle} must retain the original durable pending ${interaction} approval`
        );
        assert.equal(pendingOnReopen[0], originalPermission.toolCall.toolCallId);
        assert.equal(windows, 1, "read-only reopen must not display a live approval window");
        await backend.recoverSession({ sessionId: approvalSessionId, action: "continue" });
        assert.equal(windows, 2, "explicit Continue must obtain a fresh live approval");
        assert.equal(calls, beforeCalls + 2);
        assert.equal(writes, beforeWrites + (interaction === "edit" ? 1 : 0));
        assert.equal(
          await fs.readFile(path.join(vaultRoot, target), "utf8"),
          interaction === "edit" ? before.replace("原始内容", "已批准内容") : before
        );
        const resumed = JSON.parse(
          (await backend.exportSession({ sessionId: approvalSessionId, format: "json" })).content
        ) as typeof document;
        assert.ok(JSON.stringify(resumed).includes(`原${interaction}任务已明确批准后完成`));
        assert.equal(
          resumed.session.extras.entries.filter((entry) => entry.kind === "pi.user").length,
          1
        );
      }
    }
    const backgroundSettings = {
      ...settings,
      configuredModels: [
        ...settings.configuredModels,
        {
          configuredModelId: "fixture-child",
          providerId: "fixture",
          info: {
            id: "fixture-child",
            displayName: "Child",
            toolCall: true,
            limits: { context: 262144 },
          },
          configuredAt: 1,
        },
      ],
      agentMode: {
        ...settings.agentMode,
        backends: {
          ...settings.agentMode.backends,
          pi: { ...settings.agentMode.backends.pi, enabledSubagentProfiles: ["researcher"] },
        },
      },
      backends: {
        ...settings.backends,
        pi: { ...settings.backends.pi, enabledModels: ["saved-model", "fixture-child"] },
      },
    } as VaultAgentSettings;
    const background = fauxProvider({ models: [{ id: "fixture-model" }, { id: "fixture-child" }] });
    let childStarted!: () => void;
    const childRunning = new Promise<void>((resolve) => {
      childStarted = resolve;
    });
    let childInterrupted = false;
    let parentCalls = 0;
    let childCalls = 0;
    let childConversationId: string | undefined;
    background.setResponses(
      Array.from({ length: 8 }, () => async (context, request, _state, model) => {
        if (model.id === "fixture-child") {
          childCalls += 1;
          if (childCalls === 1)
            return new Promise<never>((_resolve, reject) => {
              const signal = request?.signal;
              assert.ok(signal);
              signal.addEventListener(
                "abort",
                () => {
                  childInterrupted = true;
                  reject(new Error("The child owner was paused and released"));
                },
                { once: true }
              );
              childStarted();
            });
          return fauxAssistantMessage("原后台任务已从原检查点恢复完成");
        }
        parentCalls += 1;
        if (parentCalls === 1)
          return fauxAssistantMessage(
            [
              fauxToolCall("start_background_task", {
                profileId: "researcher",
                task: "保存并继续同一后台任务",
                description: "Idle parent close",
                modelKey: "fixture-child",
                commandId: "idle-parent-close",
              }),
            ],
            { stopReason: "toolUse" }
          );
        const result = context.messages.findLast(
          (message) => message.role === "toolResult" && message.toolName === "start_background_task"
        );
        assert.ok(result && result.role === "toolResult");
        const body = result.content.find(
          (part) => part.type === "text" && part.text.startsWith("{")
        );
        assert.ok(body && body.type === "text");
        childConversationId = (JSON.parse(body.text) as { childConversationId: string })
          .childConversationId;
        assert.ok(childConversationId);
        return fauxAssistantMessage("父任务已完成，后台任务独立等待");
      })
    );
    const backgroundOptions = {
      host: {
        ...options.host,
        getSettings: () => backgroundSettings,
        streamsFactory: () => background.provider,
      },
    };
    let backgroundBackend = new PiBackendProcess(backgroundOptions);
    await backgroundBackend.start();
    const backgroundSession = AgentSession.start({
      backend: backgroundBackend,
      cwd: vaultRoot,
      internalId: "host-idle-parent-close",
      backendId: "pi",

      defaultModelSelection: { baseModelId: "saved-model", effort: null },
    });
    try {
      await backgroundSession.ready;
      assert.equal(
        await backgroundSession.sendPrompt("启动独立后台任务，先结束父回答").turn,
        "end_turn"
      );
      await childRunning;
      assert.equal(backgroundSession.getStatus(), "idle");
      assert.equal(backgroundSession.getActiveBackgroundTaskCount(), 1);
      assert.equal(parentCalls, 2);
      assert.equal(childCalls, 1);
      const ownerId = backgroundSession.getBackendSessionId();
      assert.ok(ownerId);
      const beforeClose = await backgroundBackend.exportSession({
        sessionId: ownerId,
        format: "json",
      });
      await backgroundSession.releaseBackendSession();
      assert.equal(
        childInterrupted,
        true,
        "release must stop the actual in-flight provider request instead of leaving it running"
      );
      await backgroundSession.dispose();
      await backgroundBackend.shutdown();
      backgroundBackend = new PiBackendProcess(backgroundOptions);
      await backgroundBackend.start();
      await backgroundBackend.loadSession({ sessionId: ownerId, cwd: vaultRoot });
      assert.equal(parentCalls, 2, "read-only reopen cannot call the completed parent again");
      assert.equal(childCalls, 1, "read-only reopen cannot resume a saved child");
      const coldHistory = await backgroundBackend.readSubagentHistory({
        sessionId: ownerId,
        conversationId: childConversationId!,
      });
      assert.equal(
        coldHistory.filter(
          (message) =>
            message.sender === "user" && message.message.includes("保存并继续同一后台任务")
        ).length,
        1
      );
      const coldExport = await backgroundBackend.exportSession({
        sessionId: ownerId,
        format: "json",
      });
      assert.ok(beforeClose.content.includes("启动独立后台任务，先结束父回答"));
      assert.ok(coldExport.content.includes("启动独立后台任务，先结束父回答"));
      await backgroundBackend.recoverSession({ sessionId: ownerId, action: "continue" });
      assert.equal(
        parentCalls,
        2,
        "Continue must not resubmit or synthesize the completed parent input"
      );
      assert.equal(
        childCalls,
        2,
        "Continue must resume exactly the original child generation once"
      );
      const history = await backgroundBackend.readSubagentHistory({
        sessionId: ownerId,
        conversationId: childConversationId!,
      });
      assert.equal(
        history.filter(
          (message) =>
            message.sender === "user" && message.message.includes("保存并继续同一后台任务")
        ).length,
        1
      );
      assert.ok(
        history.some((message) => message.message.includes("原后台任务已从原检查点恢复完成"))
      );
    } finally {
      await backgroundSession.dispose();
      await backgroundBackend.shutdown();
    }
    return {
      status: "passed",
      checks: [
        "explicit_pause_preserves_sdk_and_current_progress",
        "reopen_does_not_resume_work",
        "explicit_continue_adds_one_grant_and_resumes_original_generation",
        "goal_and_user_input_not_duplicated",
        "pause_and_shutdown_keep_original_pending_question_without_live_window",
        "answer_on_reopen_does_not_resume_until_explicit_continue",
        "continue_consumes_saved_answer_at_original_sdk_tool_checkpoint",
        "pause_and_shutdown_keep_pending_edit_and_plan_approvals",
        "approval_reopen_is_read_only_and_continue_revalidates_original_task",
        "host_release_preserves_active_and_already_paused_question_tasks",
        "idle_parent_close_preserves_background_tree_without_cold_auto_resume",
        "completed_recovery_clears_live_and_cold_session_state_and_repeat_continue_is_noop",
      ],
      providerCalls: calls,
      backgroundClose: { parentCalls, childCalls, originalChildInputPreserved: true },
    };
  } finally {
    await backend.shutdown();
  }
}
