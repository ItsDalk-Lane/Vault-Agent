import { withDiagnosticSummaries } from "@/agentMode/sdk/pi/testing/diagnosticSummaryProvider";
import type { App } from "obsidian";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionEvent } from "@/agentMode/session/types";
import type { SessionExportMessage } from "@/agentMode/sdk/pi/storage/SessionExport";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { ProviderStreamsFactory } from "@/agentMode/sdk/pi/models/ProviderFactory";

interface SavedDiagnosticEntry {
  kind: string;
  model: { role: string; content: unknown; errorMessage?: string; stopReason?: string }[];
  data?: {
    requestId?: string;
    status?: string;
    modelAttempts?: number;
    runId?: string;
    purpose?: string;
  };
}

interface SavedDiagnosticDocument {
  session: {
    messages: SessionExportMessage[];
    extras: { entries: SavedDiagnosticEntry[] };
  };
}

export async function runStreamFailureRuntimeScenario(directory: string) {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
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
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        baseUrl: "https://fixture.invalid/v1",
        displayName: "Diagnostic provider",
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
          displayName: "Diagnostic model",
          toolCall: true,
          limits: { context: 8192, output: 1024 },
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
    backends: { pi: { enabledModels: ["fixture-model"] } },
  } as unknown as VaultAgentSettings;
  const faux = fauxProvider();
  const secrets = new Map<string, string>([["fixture-key", "fixture-only-key"]]);
  let streamUntilStopped = false;
  let activeStreamCalls = 0;
  let actualAborts = 0;
  const openActiveStream = (signal: AbortSignal | undefined) => {
    assert.ok(signal, "the actual SDK must supply its cancellation signal to the provider");
    activeStreamCalls += 1;
    const text = `诊断流式回答-${activeStreamCalls}：停止前的部分文字`;
    const message = fauxAssistantMessage(text);
    const output = createAssistantMessageEventStream();
    const abort = () => {
      actualAborts += 1;
      const interrupted = {
        ...message,
        stopReason: "aborted" as const,
        errorMessage: "Diagnostic provider received the actual abort signal.",
      };
      output.push({ type: "error", reason: "aborted", error: interrupted });
      output.end(interrupted);
    };
    signal.addEventListener("abort", abort, { once: true });
    output.push({ type: "start", partial: { ...message, content: [] } });
    output.push({
      type: "text_start",
      contentIndex: 0,
      partial: { ...message, content: [{ type: "text", text: "" }] },
    });
    output.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
    if (signal.aborted) {
      signal.removeEventListener("abort", abort);
      abort();
    }
    return output;
  };
  let summaryCalls = 0;
  const streamsFactory: ProviderStreamsFactory = () =>
    withDiagnosticSummaries(
      {
        stream: (model, context, input) =>
          streamUntilStopped
            ? openActiveStream(input?.signal)
            : faux.provider.stream(model, context, input),
        streamSimple: (model, context, input) =>
          streamUntilStopped
            ? openActiveStream(input?.signal)
            : faux.provider.streamSimple(model, context, input),
      },
      () => {
        summaryCalls += 1;
      }
    );
  const options = {
    host: {
      app,
      privateRoot: path.join(directory, "private"),
      getSettings: () => settings,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "stream-failure-fixture",
        getSecretById: (id: string) => secrets.get(id) ?? null,
        setSecretById: (id: string, value: string) => {
          secrets.set(id, value);
        },
        deleteSecretById: (id: string) => {
          secrets.delete(id);
        },
      },
      streamsFactory,
    },
  };
  const backend = new PiBackendProcess(options);
  const events: SessionEvent[] = [];
  let reopened: PiBackendProcess | undefined;
  try {
    await backend.start();
    const { sessionId } = await backend.newSession({ cwd: vaultRoot });
    const unsubscribe = backend.registerSessionHandler(sessionId, (event) => events.push(event));
    await backend.setSessionModel({ sessionId, modelId: "fixture-model" });
    faux.setResponses([
      fauxAssistantMessage("失败前已经输出的文字", {
        stopReason: "error",
        errorMessage: "diagnostic invalid request: do not retry",
      }),
    ]);
    const failedRequest = {
      sessionId,
      requestId: "diagnostic-failed-request",
      prompt: [{ type: "text" as const, text: "诊断不可重试的部分回答" }],
    };
    await assert.rejects(backend.prompt(failedRequest), /diagnostic invalid request/);
    assert.equal(faux.state.callCount, 1);
    const failureStates = events.flatMap((event) =>
      event.update.sessionUpdate === "run_state" &&
      event.update.run.requestId === failedRequest.requestId
        ? [event.update.run.status]
        : []
    );
    assert.equal(failureStates.at(-1), "failed");
    assert.equal(failureStates.includes("completed"), false);
    const failed = JSON.parse(
      (await backend.exportSession({ sessionId, format: "json" })).content
    ) as SavedDiagnosticDocument;
    assert.ok(
      failed.session.messages.some((message) => message.text.includes("失败前已经输出的文字"))
    );
    assert.ok(
      failed.session.extras.entries.some((entry) =>
        entry.model?.some(
          (message) =>
            message.role === "assistant" &&
            message.stopReason === "error" &&
            message.errorMessage === "diagnostic invalid request: do not retry"
        )
      )
    );
    const failedWorkRun = failed.session.extras.entries
      .filter((entry) => entry.kind === "va.run")
      .at(-1)?.data;
    assert.ok(failedWorkRun?.runId);
    const savedReservations = failed.session.extras.entries.filter(
      (entry) => entry.kind === "va.budget" && entry.data?.runId === failedWorkRun.runId
    );
    const beforeRetry = events.length;
    const summariesBeforeRetry = summaryCalls;
    faux.appendResponses([
      fauxAssistantMessage("第一次中断前的文字", {
        stopReason: "error",
        errorMessage: "diagnostic connection lost on attempt one",
      }),
      fauxAssistantMessage("第二次中断前的文字", {
        stopReason: "error",
        errorMessage: "diagnostic connection lost on attempt two",
      }),
      fauxAssistantMessage("第三次请求完成的最终回答"),
    ]);
    const retryRequest = {
      sessionId,
      requestId: "diagnostic-retried-request",
      prompt: [{ type: "text" as const, text: "诊断同一请求的重试" }],
    };
    assert.equal((await backend.prompt(retryRequest)).stopReason, "end_turn");
    assert.equal(faux.state.callCount, 4);
    const retryStates = events
      .slice(beforeRetry)
      .flatMap((event) =>
        event.update.sessionUpdate === "run_state" &&
        event.update.run.requestId === retryRequest.requestId
          ? [event.update.run.status]
          : []
      );
    assert.deepEqual(retryStates, ["running", "completed"]);
    const latestProjection = events
      .filter((event) => event.update.sessionUpdate === "session_projection")
      .at(-1)?.update;
    assert.ok(
      latestProjection?.sessionUpdate === "session_projection" &&
        latestProjection.projection.messages.some((message) =>
          message.message.includes("第三次请求完成的最终回答")
        ),
      "prompt must resolve only after the actual final answer is projected"
    );
    const saved = JSON.parse(
      (await backend.exportSession({ sessionId, format: "json" })).content
    ) as SavedDiagnosticDocument;
    const retryUsers = saved.session.extras.entries.flatMap((entry) =>
      (entry.model ?? []).filter(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("诊断同一请求的重试")
      )
    );
    assert.equal(retryUsers.length, 1);
    for (const text of ["第一次中断前的文字", "第二次中断前的文字", "第三次请求完成的最终回答"])
      assert.ok(saved.session.messages.some((message) => message.text.includes(text)));
    const completed = saved.session.extras.entries.filter(
      (entry) => entry.kind === "va.run" && entry.data?.requestId === retryRequest.requestId
    );
    assert.equal(completed.at(-1)?.data?.status, "completed");
    const completedRun = completed.at(-1)?.data;
    assert.ok(completedRun?.runId);
    const reservations = saved.session.extras.entries.filter(
      (entry) => entry.kind === "va.budget" && entry.data?.runId === completedRun.runId
    );
    assert.equal(
      completedRun.runId,
      failedWorkRun.runId,
      "retrying a terminal failed segment must preserve its work identity and prior costs"
    );
    assert.deepEqual(reservations.slice(0, savedReservations.length), savedReservations);
    const newReservations = reservations.slice(savedReservations.length);
    assert.equal(
      newReservations.filter((entry) => entry.data?.purpose !== "compaction").length,
      3,
      "the actual SDK retries must make exactly three ordinary model requests"
    );
    assert.equal(
      newReservations.filter((entry) => entry.data?.purpose === "compaction").length,
      summaryCalls - summariesBeforeRetry,
      "automatic summaries consume the same work budget and are counted separately from the three retries"
    );
    assert.equal(completedRun.modelAttempts, reservations.length);
    unsubscribe();
    await backend.shutdown();
    const callsBeforeReopen = faux.state.callCount;
    reopened = new PiBackendProcess(options);
    await reopened.start();
    await reopened.loadSession({ sessionId, cwd: vaultRoot });
    const restored = JSON.parse(
      (await reopened.exportSession({ sessionId, format: "json" })).content
    ) as SavedDiagnosticDocument;
    for (const text of [
      "失败前已经输出的文字",
      "第一次中断前的文字",
      "第二次中断前的文字",
      "第三次请求完成的最终回答",
    ])
      assert.ok(restored.session.messages.some((message) => message.text.includes(text)));
    assert.equal(faux.state.callCount, callsBeforeReopen);
    assert.equal((await reopened.prompt(retryRequest)).stopReason, "end_turn");
    assert.equal(faux.state.callCount, callsBeforeReopen);
    const duplicate = JSON.parse(
      (await reopened.exportSession({ sessionId, format: "json" })).content
    ) as SavedDiagnosticDocument;
    assert.equal(
      duplicate.session.messages.filter(
        (message) => message.role === "user" && message.text === "诊断同一请求的重试"
      ).length,
      1
    );
    streamUntilStopped = true;
    const observePartial = (marker: string) => {
      let delivered!: () => void;
      const ready = new Promise<void>((resolve) => {
        delivered = resolve;
      });
      const stop = reopened!.registerSessionHandler(sessionId, (event) => {
        if (
          event.update.sessionUpdate === "session_projection" &&
          event.update.projection.messages.some(
            (message) => message.sender === "ai" && message.message.includes(marker)
          )
        )
          delivered();
      });
      return { ready, stop };
    };
    const firstPartial = observePartial("诊断流式回答-1");
    const stopped = reopened.prompt({
      sessionId,
      requestId: "diagnostic-live-stop",
      prompt: [{ type: "text", text: "诊断流式停止" }],
    });
    await firstPartial.ready;
    await assert.rejects(
      reopened.setSessionModel({ sessionId, modelId: "fixture-model" }),
      /while the session is answering/
    );
    await assert.rejects(
      reopened.setSessionConfigOption({ sessionId, configId: "pi-effort", value: "high" }),
      /while answering/
    );
    await reopened.cancel({ sessionId });
    assert.equal((await stopped).stopReason, "cancelled");
    await reopened.cancel({ sessionId });
    assert.equal(Number(activeStreamCalls), 1);
    assert.equal(Number(actualAborts), 1);
    firstPartial.stop();
    const secondPartial = observePartial("诊断流式回答-2");
    const closed = reopened.prompt({
      sessionId,
      requestId: "diagnostic-live-close",
      prompt: [{ type: "text", text: "诊断活跃聊天关闭" }],
    });
    await secondPartial.ready;
    await reopened.closeSession({ sessionId });
    assert.equal((await closed).stopReason, "max_turn_requests");
    secondPartial.stop();
    assert.equal(Number(activeStreamCalls), 2);
    assert.equal(Number(actualAborts), 2);
    const callsAfterClose =
      Number(faux.state.callCount) + Number(activeStreamCalls) + Number(summaryCalls);
    await reopened.shutdown();
    reopened = new PiBackendProcess(options);
    const coldReopenEvents: SessionEvent[] = [];
    reopened.registerSessionHandler(sessionId, (event) => coldReopenEvents.push(event));
    await reopened.start();
    await reopened.loadSession({ sessionId, cwd: vaultRoot });
    const interruptedHistory = JSON.parse(
      (await reopened.exportSession({ sessionId, format: "json" })).content
    ) as SavedDiagnosticDocument;
    for (const marker of ["诊断流式回答-1", "诊断流式回答-2"])
      assert.equal(
        interruptedHistory.session.messages.filter((message) => message.text.includes(marker))
          .length,
        1
      );
    const closeRunStates = interruptedHistory.session.extras.entries.filter(
      (entry) => entry.kind === "va.run" && entry.data?.requestId === "diagnostic-live-close"
    );
    assert.equal(closeRunStates.at(-1)?.data?.status, "paused_user");
    assert.ok(
      !closeRunStates.some(
        (entry) => entry.data?.status === "cancelled" || entry.data?.status === "completed"
      ),
      "closing preserves resumable work rather than recording Stop or completion"
    );
    assert.equal(
      interruptedHistory.session.extras.entries.filter((entry) =>
        (entry.model ?? []).some(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("诊断活跃聊天关闭")
        )
      ).length,
      1,
      "cold opening a paused stream must preserve the single original SDK input"
    );
    assert.equal(
      interruptedHistory.session.extras.entries
        .filter(
          (entry) => entry.kind === "va.run" && entry.data?.requestId === "diagnostic-live-stop"
        )
        .at(-1)?.data?.status,
      "cancelled",
      "explicit Stop remains cancellation after the later pause and cold open"
    );
    assert.ok(
      coldReopenEvents.some(
        (event) =>
          event.update.sessionUpdate === "recovery_state" &&
          event.update.recovery.status === "available" &&
          event.update.recovery.interruptedRun?.requestId === "diagnostic-live-close" &&
          event.update.recovery.interruptedRun.status === "paused_user"
      ),
      "cold opening must offer the saved paused work for explicit continuation"
    );
    assert.equal(
      Number(faux.state.callCount) + Number(activeStreamCalls) + Number(summaryCalls),
      callsAfterClose,
      "cold open and export must make zero ordinary, active-stream or compaction provider calls"
    );
    return {
      status: "passed",
      scope: "production_backend_and_sdk_with_diagnostic_faux_provider_not_desktop_or_actual_model",
      checks: [
        "partial_text_is_preserved_with_original_final_error",
        "failed_request_never_reports_completed",
        "two_actual_sdk_retries_preserve_partial_attempts",
        "single_request_has_one_durable_user_entry",
        "retry_finishes_once_with_three_attempts",
        "prompt_resolves_after_final_projection",
        "reopen_and_export_preserve_all_partial_text_without_model_call",
        "same_request_id_after_reopen_does_not_dispatch_or_duplicate_user",
        "active_stream_rejects_model_and_effort_changes_without_partial_update",
        "stop_aborts_actual_stream_and_preserves_visible_partial_text",
        "repeated_stop_does_not_restart_or_abort_twice",
        "closing_active_session_pauses_original_input_and_cold_reopen_preserves_partials_without_dispatch",
      ],
      providerCalls:
        Number(faux.state.callCount) + Number(activeStreamCalls) + Number(summaryCalls),
      mainCalls: Number(faux.state.callCount) + Number(activeStreamCalls),
      summaryCalls,
      actualAborts,
      failedRequestStates: failureStates,
      retriedRequestStates: retryStates,
    };
  } finally {
    await reopened?.shutdown();
    await backend.shutdown();
  }
}
