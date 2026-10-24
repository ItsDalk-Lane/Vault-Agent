import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionUpdate } from "@/agentMode/session/types";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { withDiagnosticSummaries } from "./diagnosticSummaryProvider";
import { createWorkItemStore } from "@/agentMode/sdk/pi/storage/WorkItemStore";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Conversation, Harness } from "@earendil-works/pi-durable";

export async function runSteerRuntimeScenario(directory: string) {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
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
        apiKeyKeychainId: "fixture-key",
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "saved",
        providerId: "fixture",
        info: { id: "model", toolCall: true, limits: { context: 262144, output: 1024 } },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      backends: {},
      skills: { folder: "skills" },
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const app = {
    vault: {
      configDir: ".fixture",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [],
      getMarkdownFiles: () => [],
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const faux = fauxProvider();
  const options = {
    host: {
      app,
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => withDiagnosticSummaries(faux.provider),
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "steer-runtime",
        getSecretById: (id: string) => (id === "fixture-key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
    },
  };
  const sessionId = "root-steer";
  let backend = new PiBackendProcess(options);
  const updates: SessionUpdate[] = [];
  const actualRoot = (id = sessionId) =>
    (
      backend as unknown as {
        runtime: {
          roots: Map<
            string,
            { harness: Harness; conversation: Conversation; run: { id: string } | null }
          >;
        };
      }
    ).runtime.roots.get(id)!;
  let questionReady!: () => void;
  let releaseQuestion!: () => void;
  let questionStarted: Promise<void>;
  const prepareQuestion = () => {
    questionStarted = new Promise<void>((resolve) => {
      questionReady = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseQuestion = resolve;
    });
    backend.setAskUserQuestionPrompter(async (request) => {
      const abort = () => releaseQuestion();
      request.signal?.addEventListener("abort", abort, { once: true });
      questionReady();
      await release;
      request.signal?.removeEventListener("abort", abort);
      return { detail: "继续" };
    });
  };
  const question = () =>
    fauxAssistantMessage(
      [
        fauxToolCall("ask_user", {
          questions: [
            {
              answerKey: "detail",
              header: "确认",
              question: "准备好继续了吗？",
              options: [{ label: "继续", description: "继续原工作" }],
            },
          ],
        }),
      ],
      { stopReason: "toolUse" }
    );
  const queued = (requestId: string, id = sessionId) => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const stop = actualRoot(id).harness.subscribeCommits((publication) => {
      if (
        publication.changes.some(
          (change) =>
            change.type === "submission" &&
            change.value.requestId === requestId &&
            change.value.status === "queued"
        )
      ) {
        stop();
        resolve();
      }
    });
    return promise;
  };
  const raw = "补充：保留原文；所有结论都必须附核对依据。";
  try {
    await backend.start();
    await backend.newSession({ sessionId, cwd: vaultRoot });
    backend.registerSessionHandler(sessionId, (event) => updates.push(event.update));
    prepareQuestion();
    faux.setResponses([
      question(),
      (context) => {
        const material = JSON.stringify(context);
        assert.ok(
          material.includes(raw),
          "the very next actual request must contain the exact supplemental requirement"
        );
        assert.ok(material.includes("host.work-checkpoint"));
        return fauxAssistantMessage("已按照补充要求完成本轮核对");
      },
    ]);
    const original = backend.prompt({
      sessionId,
      requestId: "original",
      prompt: [{ type: "text", text: "完整核对资料，不修改原文" }],
    });
    await questionStarted!;
    const root = actualRoot();
    const workId = root.run!.id;
    const store = await createWorkItemStore({
      harness: root.harness,
      conversation: root.conversation,
    });
    const before = await store.read(workId);
    const committed = queued("supplement");
    const supplement = backend.steerSession({ sessionId, requestId: "supplement", text: raw });
    await committed;
    assert.equal(faux.state.callCount, 1);
    releaseQuestion();
    await supplement;
    await original;
    const after = await store.read(workId);
    assert.equal(after!.checkpoint.goal, "完整核对资料，不修改原文");
    assert.equal(after!.grants.length, before!.grants.length);
    assert.equal(after!.reservations.length, 2);
    assert.equal(
      after!.checkpoint.userRequests!.filter((request) => request.requestId === "supplement")
        .length,
      1
    );
    assert.equal(after!.checkpoint.userRequests!.at(-1)!.text, raw);
    const entries = (
      await root.conversation.entries({ order: "ascending" }, 1000, undefined, BACKGROUND_CONTEXT)
    ).items;
    assert.ok(
      entries.some(
        (entry) => entry.kind === "va.steer-input" && JSON.stringify(entry.data).includes(raw)
      )
    );
    assert.equal(
      entries.filter(
        (entry) =>
          entry.kind === "va.run" && (entry.data as { status?: string }).status === "running"
      ).length,
      1,
      "steering must not create a second host turn"
    );
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    assert.equal(
      faux.state.callCount,
      2,
      "cold open must not resume the accepted supplemental input"
    );
    const restored = await (await createWorkItemStore(actualRoot())).read(workId);
    assert.equal(
      restored!.checkpoint.userRequests!.filter((request) => request.requestId === "supplement")
        .length,
      1
    );

    prepareQuestion();
    faux.setResponses([question()]);
    const stoppedTurn = backend.prompt({
      sessionId,
      requestId: "stop-original",
      prompt: [{ type: "text", text: "继续核对" }],
    });
    await questionStarted!;
    const stoppedQueued = queued("stopped-supplement");
    const stoppedSupplement = backend
      .steerSession({ sessionId, requestId: "stopped-supplement", text: "停止后不得唤醒" })
      .then(
        () => false,
        () => true
      );
    await stoppedQueued;
    await backend.cancel({ sessionId });
    assert.equal(await stoppedSupplement, true);
    await stoppedTurn;
    const stoppedWork = await (await createWorkItemStore(actualRoot())).read(workId);
    assert.ok(
      !stoppedWork!.checkpoint.userRequests?.some(
        (request) => request.requestId === "stopped-supplement"
      )
    );
    assert.equal(faux.state.callCount, 3);
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    assert.equal(faux.state.callCount, 3);
    await assert.rejects(
      backend.steerSession({ sessionId, requestId: "idle", text: "空闲不得假补充" }),
      /未补充/
    );
    await assert.rejects(
      backend.steerSession({ sessionId, requestId: "command", text: "/compact" }),
      /文字/
    );

    const raceId = "root-steer-race";
    await backend.newSession({ sessionId: raceId, cwd: vaultRoot });
    let raceQuestionReady!: () => void;
    const raceStarted = new Promise<void>((resolve) => {
      raceQuestionReady = resolve;
    });
    let raceRelease!: () => void;
    const raceQuestion = new Promise<void>((resolve) => {
      raceRelease = resolve;
    });
    backend.setAskUserQuestionPrompter(async () => {
      raceQuestionReady();
      await raceQuestion;
      return { detail: "继续" };
    });
    faux.setResponses([question(), fauxAssistantMessage("原工作已经结束")]);
    const raceTurn = backend.prompt({
      sessionId: raceId,
      requestId: "race-original",
      prompt: [{ type: "text", text: "核对最后一项" }],
    });
    await raceStarted;
    const raceRoot = (
      backend as unknown as {
        runtime: {
          roots: Map<string, { harness: Harness; conversation: Conversation; run: { id: string } }>;
        };
      }
    ).runtime.roots.get(raceId)!;
    const raceWorkId = raceRoot.run.id;
    const submit: Conversation["submit"] = raceRoot.conversation.submit.bind(raceRoot.conversation);
    raceRoot.conversation.submit = async (draft, context) => {
      if (draft.type === "input" && draft.whenBusy === "steer") {
        raceRelease();
        await raceTurn;
      }
      return submit(draft, context);
    };
    await assert.rejects(
      backend.steerSession({ sessionId: raceId, requestId: "race-late", text: "这条补充已来不及" }),
      /未补充/
    );
    assert.equal(
      faux.state.callCount,
      5,
      "the last-boundary race must not call a provider for a second SDK turn"
    );
    const raceWork = await (await createWorkItemStore(raceRoot)).read(raceWorkId);
    assert.ok(
      !raceWork!.checkpoint.userRequests?.some((request) => request.requestId === "race-late")
    );
    assert.equal((await raceRoot.harness.inspect(BACKGROUND_CONTEXT)).tasks.length, 0);
    const rejectedText = "这条补充已来不及";
    faux.setResponses([
      (context) => {
        assert.ok(
          !JSON.stringify(context).includes(rejectedText),
          "the next real request must not inherit rejected supplemental instructions"
        );
        return fauxAssistantMessage("已正常处理后续要求");
      },
    ]);
    await backend.prompt({
      sessionId: raceId,
      requestId: "after-rejected",
      prompt: [{ type: "text", text: "正常核对下一项" }],
    });
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    await backend.loadSession({ sessionId: raceId, cwd: vaultRoot });
    assert.equal(faux.state.callCount, 6);
    const reopenedRace = (
      backend as unknown as {
        runtime: { roots: Map<string, { harness: Harness; conversation: Conversation }> };
      }
    ).runtime.roots.get(raceId)!;
    const reopenedContext = await reopenedRace.conversation.context(BACKGROUND_CONTEXT);
    assert.ok(!JSON.stringify(reopenedContext.messages).includes(rejectedText));
    faux.setResponses([
      (context) => {
        assert.ok(
          JSON.stringify(context).includes(rejectedText),
          "an explicit ordinary request with identical text remains valid"
        );
        return fauxAssistantMessage("已接受明确重新发送的要求");
      },
    ]);
    await backend.prompt({
      sessionId: raceId,
      requestId: "legitimate-same-text",
      prompt: [{ type: "text", text: rejectedText }],
    });
    const sameTextContext = await reopenedRace.conversation.context(BACKGROUND_CONTEXT);
    assert.equal(
      sameTextContext.messages.filter(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes(rejectedText)
      ).length,
      1,
      "omit targets the rejected entry identity, never all matching text"
    );
    const coldId = "root-steer-cold";
    await backend.newSession({ sessionId: coldId, cwd: vaultRoot });
    prepareQuestion();
    faux.setResponses([question()]);
    const coldTurn = backend
      .prompt({
        sessionId: coldId,
        requestId: "cold-original",
        prompt: [{ type: "text", text: "重开后仍按原目标核对资料" }],
      })
      .catch(() => undefined);
    await questionStarted!;
    const coldWorkId = actualRoot(coldId).run!.id;
    const coldQueued = queued("cold-supplement", coldId);
    const coldText = "持久补充：任何时候都保留原文，不得覆盖。";
    const coldSupplement = backend
      .steerSession({ sessionId: coldId, requestId: "cold-supplement", text: coldText })
      .catch(() => undefined);
    await coldQueued;
    assert.equal(faux.state.callCount, 8);
    await backend.shutdown();
    await Promise.all([coldTurn, coldSupplement]);
    backend = new PiBackendProcess(options);
    backend.setAskUserQuestionPrompter(async () => ({ detail: "继续" }));
    await backend.start();
    await backend.loadSession({ sessionId: coldId, cwd: vaultRoot });
    assert.equal(
      faux.state.callCount,
      8,
      "opening queued supplemental input must not start any request"
    );
    const coldStore = await createWorkItemStore(actualRoot(coldId));
    const coldBefore = await coldStore.read(coldWorkId);
    assert.ok(
      !coldBefore!.checkpoint.userRequests?.some(
        (request) => request.requestId === "cold-supplement"
      )
    );
    faux.setResponses([
      (context) => {
        assert.ok(JSON.stringify(context).includes(coldText));
        return fauxAssistantMessage("按冷重开的补充完成本轮核对");
      },
    ]);
    await backend.recoverSession({ sessionId: coldId, action: "continue" });
    const coldAfter = await coldStore.read(coldWorkId);
    assert.equal(coldAfter!.checkpoint.goal, "重开后仍按原目标核对资料");
    assert.equal(
      coldAfter!.checkpoint.userRequests!.filter(
        (request) => request.requestId === "cold-supplement"
      ).length,
      1
    );
    assert.equal(coldAfter!.checkpoint.userRequests!.at(-1)!.text, coldText);
    assert.equal(
      coldAfter!.grants.length,
      coldBefore!.grants.length + 1,
      "only explicit Continue authorizes a new segment, not replaying the supplement"
    );
    assert.equal(faux.state.callCount, 9);
    return {
      status: "passed",
      providerCalls: faux.state.callCount,
      checks: [
        "same_tool_round_steer_exact_input",
        "same_work_goal_budget_and_single_turn",
        "cold_open_zero_calls_and_idempotent_raw_source",
        "stop_does_not_wake_queued_steer",
        "idle_and_commands_rejected",
        "last_boundary_race_zero_extra_model_and_tools",
        "queued_steer_survives_cold_open_and_follows_original_work_only_after_continue",
        "rejected_entry_is_omitted_after_reopen_without_blocking_identical_new_user_text",
      ],
    };
  } finally {
    releaseQuestion?.();
    await backend.shutdown();
  }
}
