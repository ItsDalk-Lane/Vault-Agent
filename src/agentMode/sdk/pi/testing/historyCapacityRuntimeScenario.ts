import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionUpdate } from "@/agentMode/session/types";
import {
  createAssistantMessageEventStream,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { withDiagnosticSummaries } from "./diagnosticSummaryProvider";
import { StoreLocator } from "@/agentMode/sdk/pi/storage/StoreLocator";

export async function runHistoryCapacityRuntimeScenario(directory: string) {
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
        apiKeyKeychainId: "key",
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
  let holding = false;
  let heldCalls = 0;
  let aborts = 0;
  let firstOpened!: () => void;
  let secondOpened!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstOpened = resolve;
  });
  const secondStarted = new Promise<void>((resolve) => {
    secondOpened = resolve;
  });
  const heldStream = (signal?: AbortSignal) => {
    assert.ok(signal);
    heldCalls += 1;
    const stream = createAssistantMessageEventStream();
    const message = fauxAssistantMessage(`执行中的聊天 ${heldCalls}`);
    const abort = () => {
      aborts += 1;
      const result = {
        ...message,
        stopReason: "aborted" as const,
        errorMessage: "User stopped busy fixture",
      };
      stream.push({ type: "error", reason: "aborted", error: result });
      stream.end(result);
    };
    signal.addEventListener("abort", abort, { once: true });
    stream.push({ type: "start", partial: message });
    if (heldCalls === 1) firstOpened();
    if (heldCalls === 2) secondOpened();
    return stream;
  };
  const options = {
    host: {
      app,
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "history-capacity",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      streamsFactory: () =>
        withDiagnosticSummaries({
          stream: (model, context, input) =>
            holding ? heldStream(input?.signal) : faux.provider.stream(model, context, input),
          streamSimple: (model, context, input) =>
            holding ? heldStream(input?.signal) : faux.provider.streamSimple(model, context, input),
        }),
    },
  };
  const historyId = "root-capacity-history";
  const noSnapshotId = "root-capacity-no-snapshot";
  const firstId = "root-capacity-first";
  const secondId = "root-capacity-second";
  let backend = new PiBackendProcess(options);
  let first: Promise<unknown> | undefined;
  let second: Promise<unknown> | undefined;
  try {
    await backend.start();
    await backend.newSession({ sessionId: historyId, cwd: vaultRoot });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("todo_set", {
            expectedRevision: 0,
            items: [{ text: "原目标尚待完成", status: "pending", priority: "high" }],
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("历史中的已保存回答"),
    ]);
    await backend.prompt({
      sessionId: historyId,
      requestId: "history-original",
      prompt: [{ type: "text", text: "保留原始目标和未完工作" }],
    });
    await backend.newSession({ sessionId: noSnapshotId, cwd: vaultRoot });
    await backend.shutdown();
    const locator = new StoreLocator({
      platform: process.platform,
      homeDir: options.host.privateRoot,
      env: {},
      vaultRoot,
      vaultId: "history-capacity",
    });
    const noSnapshotDirectory = path.dirname(locator.sessionStorePaths(noSnapshotId).metaPath);
    await fs.rm(path.join(noSnapshotDirectory, "recovery-view.json"), { force: true });
    const originalMetadata = await fs.readFile(
      path.join(noSnapshotDirectory, "session.json"),
      "utf8"
    );
    backend = new PiBackendProcess(options);
    await backend.start();
    holding = true;
    await backend.newSession({ sessionId: firstId, cwd: vaultRoot });
    first = backend.prompt({
      sessionId: firstId,
      prompt: [{ type: "text", text: "第一项持续工作" }],
    });
    await firstStarted;
    await backend.newSession({ sessionId: secondId, cwd: vaultRoot });
    second = backend.prompt({
      sessionId: secondId,
      prompt: [{ type: "text", text: "第二项持续工作" }],
    });
    await secondStarted;
    const updates: SessionUpdate[] = [];
    backend.registerSessionHandler(historyId, (event) => updates.push(event.update));
    const calls = Number(faux.state.callCount) + heldCalls;
    await assert.rejects(
      backend.loadSession({ sessionId: noSnapshotId, cwd: vaultRoot }),
      (error: unknown) =>
        (error as { code?: string }).code === "RUNTIME_BUSY" &&
        String(error).includes("没有可验证的历史快照")
    );
    assert.equal(
      await fs.readFile(path.join(noSnapshotDirectory, "session.json"), "utf8"),
      originalMetadata
    );
    const loaded = await backend.loadSession({ sessionId: historyId, cwd: vaultRoot });
    assert.equal(loaded.state?.readOnly, true);
    assert.ok(
      updates.some(
        (update) =>
          update.sessionUpdate === "recovery_state" && update.recovery.reloadAvailable === true
      )
    );
    assert.ok(
      updates.some(
        (update) =>
          update.sessionUpdate === "session_projection" &&
          update.projection.messages.some((message) =>
            message.message.includes("历史中的已保存回答")
          )
      )
    );
    await assert.rejects(
      backend.recoverSession({ sessionId: historyId, action: "continue" }),
      /只允许读取|只读/
    );
    await backend.recoverSession({ sessionId: historyId, action: "reconcile" });
    assert.equal(
      Number(faux.state.callCount) + heldCalls,
      calls,
      "opening and explicitly retrying busy history cannot start a request"
    );
    assert.equal(heldCalls, 2, "history reads cannot create a third live provider");
    await backend.cancel({ sessionId: firstId });
    await first;
    await backend.closeSession({ sessionId: firstId });
    updates.length = 0;
    await backend.recoverSession({ sessionId: historyId, action: "reconcile" });
    assert.equal(
      Number(faux.state.callCount) + heldCalls,
      calls,
      "an explicit history reload only opens and verifies records"
    );
    assert.ok(
      updates.some(
        (update) => update.sessionUpdate === "state_changed" && update.state.readOnly !== true
      )
    );
    assert.ok(
      updates.some(
        (update) =>
          update.sessionUpdate === "recovery_state" &&
          update.recovery.continuationAvailable === true
      )
    );
    assert.ok(
      !updates.some(
        (update) =>
          update.sessionUpdate === "recovery_state" && update.recovery.reloadAvailable === true
      )
    );
    holding = false;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("todo_set", {
            expectedRevision: 1,
            items: [{ text: "原目标尚待完成", status: "completed", priority: "high" }],
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("用户明确继续后完成"),
    ]);
    await backend.recoverSession({ sessionId: historyId, action: "continue" });
    assert.equal(Number(faux.state.callCount) + heldCalls, calls + 2);
    await backend.cancel({ sessionId: secondId });
    await second;
    assert.equal(aborts, 2);
    return {
      status: "passed",
      checks: [
        "two_busy_roots_do_not_block_readonly_history",
        "busy_reload_is_explicit_and_does_not_queue_or_dispatch",
        "released_slot_reload_replays_real_sdk_and_clears_temporary_readonly",
        "only_explicit_continue_resumes_original_work",
        "missing_snapshot_returns_retryable_busy_error_without_touching_original_records",
      ],
      providerCalls: Number(faux.state.callCount) + heldCalls,
    };
  } finally {
    await backend.shutdown();
    await Promise.allSettled([first, second]);
  }
}
