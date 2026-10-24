import { requireNodeModule } from "@/utils/desktopRuntime";
import type { AskUserQuestionPrompt } from "@/agentMode/session/types";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { StoreLocator } from "@/agentMode/sdk/pi/storage/StoreLocator";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const fsSync = requireNodeModule<typeof import("node:fs")>("node:fs");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runPoolRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "pool-vault");
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
        configuredModelId: "saved-model",
        providerId: "fixture",
        info: {
          id: "fixture-model",
          displayName: "Fixture",
          toolCall: true,
          limits: { context: 8192 },
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
  const secrets = new Map<string, string>([["fixture-key", "test-key"]]);
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "pool-fixture",
    getSecretById: (id: string) => secrets.get(id) ?? null,
    setSecretById: (id: string, value: string) => {
      secrets.set(id, value);
    },
    deleteSecretById: (id: string) => {
      secrets.delete(id);
    },
  };
  const faux = fauxProvider();
  const privateRoot = path.join(directory, "pool-private");
  const locator = new StoreLocator({
    platform: process.platform,
    homeDir: privateRoot,
    env: {},
    vaultRoot,
    vaultId: keychain.getVaultId(),
  });
  const backend = new PiBackendProcess({
    host: {
      app,
      keychain,
      getSettings: () => settings,
      privateRoot,
      streamsFactory: () => faux.provider,
    },
  });
  const lease = (id: string) => path.join(locator.sessionStorePaths(id).leaseDir, "owner.json");
  const detachFirst = backend.registerSessionHandler("root-pool-first", () => undefined);
  backend.setSessionObserved({ sessionId: "root-pool-first", observed: true });
  const detachIdle = backend.registerSessionHandler("root-pool-idle", () => undefined);
  try {
    await backend.start();
    await backend.newSession({ sessionId: "root-pool-first", cwd: vaultRoot });
    await backend.newSession({ sessionId: "root-pool-idle", cwd: vaultRoot });
    await backend.newSession({ sessionId: "root-pool-third", cwd: vaultRoot });
    await fs.access(lease("root-pool-first"));
    await assert.rejects(
      () => fs.access(lease("root-pool-idle")),
      { code: "ENOENT" },
      "explicit visibility set before startup keeps its writer while a background handler does not"
    );
    const detachThird = backend.registerSessionHandler("root-pool-third", () => undefined);
    backend.setSessionObserved({ sessionId: "root-pool-third", observed: true });
    const fourth = backend.newSession({ sessionId: "root-pool-fourth", cwd: vaultRoot });
    await fourth;
    await assert.rejects(
      () => fs.access(lease("root-pool-first")),
      { code: "ENOENT" },
      "an observed idle chat releases capacity without hiding its history or cancelling work"
    );
    await fs.access(lease("root-pool-third"));
    detachFirst();
    const detachRestored = backend.registerSessionHandler("root-pool-first", () => undefined);
    backend.setSessionObserved({ sessionId: "root-pool-first", observed: true });
    const restored = await backend.setSessionMode({ sessionId: "root-pool-first", modeId: "plan" });
    assert.equal(
      restored.mode?.current,
      "plan",
      "an API call must reopen an idle-evicted session from metadata"
    );
    assert.equal(restored.model?.current.baseModelId, "saved-model");
    await fs.access(lease("root-pool-first"));
    await fs.access(lease("root-pool-third"));
    await assert.rejects(() => fs.access(lease("root-pool-fourth")), { code: "ENOENT" });
    assert.equal(
      faux.state.callCount,
      0,
      "pool opening, eviction and restoration never invoke a model"
    );
    const appendFile = fs.appendFile;
    let signalWrite!: () => void;
    let releaseWrite!: () => void;
    const writing = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let armed = true;
    fs.appendFile = async (...args: Parameters<typeof fs.appendFile>) => {
      if (
        armed &&
        typeof args[0] === "string" &&
        args[0].startsWith(locator.sessionStorePaths("root-pool-first").storeDir)
      ) {
        armed = false;
        signalWrite();
        await released;
      }
      return appendFile(...args);
    };
    let activeSession: AgentSession | undefined;
    try {
      const changingModel = backend.setSessionModel({
        sessionId: "root-pool-first",
        modelId: "saved-model",
      });
      await writing;
      activeSession = AgentSession.start({
        backend,
        cwd: vaultRoot,
        internalId: "observed-idle-real-session",
        backendId: "pi",
        projectId: "__global__",

        defaultModelSelection: { baseModelId: "saved-model", effort: null },
      });
      await activeSession.ready;
      await fs.access(lease("root-pool-first"));
      releaseWrite();
      const changed = await changingModel;
      assert.equal(
        changed.model?.current.baseModelId,
        "saved-model",
        "a configuration commit must retain its writer through all awaits"
      );
      faux.setResponses([fauxAssistantMessage("可见闲聊不会占满名额")]);
      assert.equal(
        await activeSession.sendPrompt("observed-idle-capacity-request").turn,
        "end_turn"
      );
      const openedId = activeSession.getBackendSessionId();
      assert.ok(openedId);
      const archive = await backend.exportSession({ sessionId: openedId, format: "json" });
      assert.ok(archive.content.includes("可见闲聊不会占满名额"));
      assert.equal(activeSession.getStatus(), "idle");
      const beforeRestore = faux.state.callCount;
      await backend.setSessionMode({ sessionId: "root-pool-third", modeId: "plan" });
      assert.equal(
        faux.state.callCount,
        beforeRestore,
        "restoring another visible idle chat must not resume or invoke models"
      );
      assert.ok(
        activeSession.store
          .getDisplayMessages()
          .some((message) => JSON.stringify(message).includes("可见闲聊不会占满名额")),
        "eviction preserves the visible session's cached history"
      );
    } finally {
      releaseWrite();
      fs.appendFile = appendFile;
      await activeSession?.dispose();
    }

    const pendingId = "root-pool-pending-question";
    let question!: AskUserQuestionPrompt;
    let sawQuestion!: () => void;
    const questionShown = new Promise<void>((resolve) => {
      sawQuestion = resolve;
    });
    let pendingQuestions: readonly AskUserQuestionPrompt[] = [];
    const detachPending = backend.registerSessionHandler(pendingId, (event) => {
      if (event.update.sessionUpdate === "session_projection")
        pendingQuestions = event.update.projection.pending.questions;
    });
    backend.setSessionObserved({ sessionId: pendingId, observed: true });
    backend.setAskUserQuestionPrompter((request) => {
      question = request;
      sawQuestion();
      return new Promise((resolve) => {
        if (request.signal?.aborted) resolve({});
        else request.signal?.addEventListener("abort", () => resolve({}), { once: true });
      });
    });
    await backend.newSession({ sessionId: pendingId, cwd: vaultRoot });
    await backend.setSessionModel({ sessionId: pendingId, modelId: "saved-model" });
    const beforeQuestion = faux.state.callCount;
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
    ]);
    const waitingQuestion = backend.prompt({
      sessionId: pendingId,
      requestId: "pool-pending-question",
      prompt: [{ type: "text", text: "先询问用户再继续" }],
    });
    await questionShown;
    await backend.pauseSession({ sessionId: pendingId });
    assert.equal((await waitingQuestion).stopReason, "max_turn_requests");
    await backend.loadSession({ sessionId: pendingId, cwd: vaultRoot });
    assert.deepEqual(
      pendingQuestions.map((item) => item.requestId),
      [question.requestId]
    );
    backend.setAskUserQuestionPrompter(async () => {
      throw new Error("eviction and cold opening cannot ask again");
    });
    for (const sessionId of ["root-pool-visible-idle-a", "root-pool-visible-idle-b"]) {
      backend.setSessionObserved({ sessionId, observed: true });
      await backend.newSession({ sessionId, cwd: vaultRoot });
    }
    await assert.rejects(
      () => fs.access(lease(pendingId)),
      { code: "ENOENT" },
      "cold pending records are not an active execution slot"
    );
    await backend.loadSession({ sessionId: pendingId, cwd: vaultRoot });
    assert.deepEqual(
      pendingQuestions.map((item) => item.requestId),
      [question.requestId],
      "capacity release retains the original question and recovery checkpoint"
    );
    assert.equal(
      faux.state.callCount,
      beforeQuestion + 1,
      "eviction and reopening never resume the saved question"
    );
    detachPending();
    detachRestored();
    detachThird();
    detachIdle();
    backend.setSessionObserved({ sessionId: "root-pool-first", observed: false });
    backend.setSessionObserved({ sessionId: "root-pool-third", observed: false });
    await backend.shutdown();
    for (const id of ["root-pool-first", "root-pool-idle", "root-pool-third", "root-pool-fourth"])
      await assert.rejects(() => fs.access(lease(id)), { code: "ENOENT" });
    const blockedMetadata = path.join(
      path.dirname(locator.sessionStorePaths("root-startup-retry").metaPath),
      "session.json"
    );
    const subscriptions = new Set<() => void>();
    const notices: string[] = [];
    let blockOnce = true;
    const retryBackend = new PiBackendProcess({
      host: {
        app,
        keychain,
        getSettings: () => settings,
        privateRoot,
        streamsFactory: () => faux.provider,
        notify: (message: string) => notices.push(message),
        subscribeSettings: (listener) => {
          subscriptions.add(listener);
          if (blockOnce) {
            blockOnce = false;
            fsSync.mkdirSync(blockedMetadata);
          }
          return () => {
            subscriptions.delete(listener);
          };
        },
      },
    });
    try {
      await retryBackend.start();
      await assert.rejects(() =>
        retryBackend.newSession({ sessionId: "root-startup-retry", cwd: vaultRoot })
      );
      assert.equal(
        subscriptions.size,
        0,
        "a startup failure must dispose the MCP subscription and its other partially-created resources"
      );
      await fs.rmdir(blockedMetadata);
      await retryBackend.newSession({ sessionId: "root-startup-retry", cwd: vaultRoot });
      await retryBackend.setSessionModel({
        sessionId: "root-startup-retry",
        modelId: "saved-model",
      });
      await fs.access(lease("root-startup-retry"));
      const retainedBytes = path.join(
        locator.sessionStorePaths("root-startup-retry").storeDir,
        "limit-fixture.bin"
      );
      await fs.writeFile(retainedBytes, new Uint8Array(16 * 1024 * 1024));
      faux.setResponses([fauxAssistantMessage("容量提醒后仍可回答")]);
      await retryBackend.prompt({
        sessionId: "root-startup-retry",
        requestId: "warning",
        prompt: [{ type: "text", text: "继续" }],
      });
      assert.equal(notices.length, 1, "16MiB must visibly suggest a new chat before continuing");
      const beforeBlock = faux.state.callCount;
      await fs.writeFile(retainedBytes, new Uint8Array(32 * 1024 * 1024));
      await assert.rejects(
        () =>
          retryBackend.prompt({
            sessionId: "root-startup-retry",
            requestId: "blocked",
            prompt: [{ type: "text", text: "继续" }],
          }),
        /存储上限.*总结并新建会话/
      );
      const archive = await retryBackend.exportSession({
        sessionId: "root-startup-retry",
        format: "json",
      });
      assert.ok(archive.content.includes("容量提醒后仍可回答"));
      assert.equal(
        faux.state.callCount,
        beforeBlock,
        "32MiB must block new billing while export and reading remain available"
      );
    } finally {
      await retryBackend.shutdown();
    }
    assert.equal(subscriptions.size, 0);
    return {
      status: "passed",
      checks: [
        "pre_registered_observer_keeps_writer",
        "background_handlers_do_not_pin_writers",
        "only_two_real_writers",
        "observed_idle_releases_capacity",
        "configuration_commit_retains_writer",
        "actual_session_observed_idle_dispatch",
        "eviction_preserves_visible_history",
        "cold_pending_question_releases_capacity",
        "cold_pending_question_reopens_without_model",
        "evicted_session_api_reopens_metadata",
        "shutdown_releases_all_leases",
        "startup_failure_disposes_partial_resources",
        "startup_retry_opens_fresh_harness",
        "16mib_visible_warning",
        "32mib_blocks_dispatch_but_allows_export",
      ],
      providerCalls: faux.state.callCount,
    };
  } finally {
    await backend.shutdown();
  }
}
