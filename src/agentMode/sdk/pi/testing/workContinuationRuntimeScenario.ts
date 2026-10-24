import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionUpdate } from "@/agentMode/session/types";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { withDiagnosticSummaries } from "./diagnosticSummaryProvider";
import { readStoredWorkItem } from "./readStoredWorkItem";

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

export async function runWorkContinuationRuntimeScenario(directory: string) {
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
        getVaultId: () => "work-continuation",
        getSecretById: (id: string) => (id === "fixture-key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
    },
  };
  const sessionId = "root-work-continuation";
  let backend = new PiBackendProcess(options);
  let updates: SessionUpdate[] = [];
  const observe = () =>
    backend.registerSessionHandler(sessionId, (event) => updates.push(event.update));
  const setTodo = (revision: number, status: "in_progress" | "completed") =>
    fauxAssistantMessage(
      [
        fauxToolCall("todo_set", {
          expectedRevision: revision,
          items: [{ text: "核对剩余资料", status, priority: "high" }],
        }),
      ],
      { stopReason: "toolUse" }
    );
  try {
    await backend.start();
    await backend.newSession({ sessionId, cwd: vaultRoot });
    observe();
    faux.setResponses([
      setTodo(0, "in_progress"),
      fauxAssistantMessage("本轮先结束，尚有资料未核对"),
    ]);
    await backend.prompt({
      sessionId,
      requestId: "original",
      prompt: [{ type: "text", text: "完整核对资料，保留原文" }],
    });
    assert.equal(faux.state.callCount, 2);
    assert.ok(
      updates.some(
        (update) =>
          update.sessionUpdate === "recovery_state" &&
          update.recovery.status === "available" &&
          update.recovery.message?.includes("剩余")
      )
    );
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    updates = [];
    observe();
    await backend.start();
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    assert.equal(
      faux.state.callCount,
      2,
      "opening a completed SDK segment must not create a request"
    );
    assert.ok(
      updates.some(
        (update) =>
          update.sessionUpdate === "recovery_state" &&
          update.recovery.status === "available" &&
          !update.recovery.crashLoopTripped
      )
    );
    faux.setResponses([
      (context) => {
        const text = JSON.stringify(context.messages);
        assert.ok(text.includes("完整核对资料，保留原文"));
        assert.ok(text.includes("host.work-checkpoint"));
        return setTodo(1, "completed");
      },
      fauxAssistantMessage("剩余资料已完成核对"),
    ]);
    await backend.recoverSession({ sessionId, action: "continue" });
    assert.equal(
      faux.state.callCount,
      4,
      "Continue must submit a new segment instead of resuming an empty scheduler"
    );
    const exported = await backend.exportSession({ sessionId, format: "json" });
    const entries = (
      JSON.parse(exported.content) as {
        session: { extras: { entries: { kind: string; data: Record<string, unknown> }[] } };
      }
    ).session.extras.entries;
    const runs = entries.filter((entry) => entry.kind === "va.run");
    assert.equal(
      new Set(runs.map((entry) => entry.data.runId)).size,
      1,
      "both segments share the original work identifier"
    );
    assert.equal(
      runs.at(-1)?.data.modelAttempts,
      4,
      "both segments preserve cumulative request usage"
    );
    assert.ok(
      updates.some(
        (update) => update.sessionUpdate === "recovery_state" && update.recovery.status === "none"
      )
    );
    faux.setResponses([setTodo(2, "in_progress"), fauxAssistantMessage("再次停在未完清单")]);
    await backend.prompt({
      sessionId,
      requestId: "stopped",
      prompt: [{ type: "text", text: "另一项任务" }],
    });
    const beforeAdjustment = JSON.parse(
      (await backend.exportSession({ sessionId, format: "json" })).content
    ) as { session: { extras: { entries: { kind: string; data: { runId?: string } }[] } } };
    const adjustedWorkId = beforeAdjustment.session.extras.entries
      .filter((entry) => entry.kind === "va.run")
      .at(-1)?.data.runId;
    assert.ok(adjustedWorkId);
    const adjustment = "补充要求：只核对来源，不修改原文";
    faux.setResponses([
      (context) => {
        const text = JSON.stringify(context.messages);
        assert.ok(text.includes("另一项任务"));
        assert.ok(text.includes(adjustment));
        return fauxAssistantMessage("已记录补充要求，仍有资料待核对");
      },
    ]);
    await backend.prompt({
      sessionId,
      requestId: "adjustment",
      prompt: [{ type: "text", text: adjustment }],
    });
    const adjustedEntries = (
      JSON.parse((await backend.exportSession({ sessionId, format: "json" })).content) as {
        session: {
          extras: { entries: { kind: string; data: { runId?: string; modelAttempts?: number } }[] };
        };
      }
    ).session.extras.entries;
    const adjustedRun = adjustedEntries.filter((entry) => entry.kind === "va.run").at(-1)?.data;
    assert.equal(
      adjustedRun?.runId,
      adjustedWorkId,
      "ordinary user adjustments must preserve the unfinished work identifier"
    );
    assert.equal(
      adjustedRun?.modelAttempts,
      7,
      "ordinary user adjustments share cumulative model usage"
    );
    await backend.recoverSession({ sessionId, action: "abort" });
    const calls = faux.state.callCount;
    await backend.shutdown();
    const adjustedWork = await readStoredWorkItem({
      privateRoot: options.host.privateRoot,
      vaultRoot,
      vaultId: "work-continuation",
      sessionId,
      workId: adjustedWorkId,
    });
    assert.ok(adjustedWork);
    assert.equal(adjustedWork.checkpoint.goal, "完整核对资料，保留原文");
    assert.ok(adjustedWork.checkpoint.userRequests?.some((request) => request.text === adjustment));
    assert.equal(
      adjustedWork.grants.length,
      4,
      "an explicit adjustment grants exactly one new execution segment"
    );
    backend = new PiBackendProcess(options);
    updates = [];
    observe();
    await backend.start();
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    assert.equal(faux.state.callCount, calls);
    assert.ok(
      !updates.some(
        (update) =>
          update.sessionUpdate === "recovery_state" &&
          update.recovery.status === "available" &&
          update.recovery.message?.includes("剩余")
      ),
      "explicit Stop must persist and not offer the stopped work again"
    );
    const noTodoSession = "root-work-no-todo";
    await backend.newSession({ sessionId: noTodoSession, cwd: vaultRoot });
    faux.setResponses([fauxAssistantMessage("尚需补充授权，两个项目没有完成")]);
    await backend.prompt({
      sessionId: noTodoSession,
      requestId: "no-todo-original",
      prompt: [{ type: "text", text: "核对两个项目并保留原文" }],
    });
    faux.setResponses([
      (context) => {
        assert.ok(JSON.stringify(context.messages).includes("核对两个项目并保留原文"));
        return fauxAssistantMessage("已收到补充要求");
      },
    ]);
    await backend.prompt({
      sessionId: noTodoSession,
      requestId: "no-todo-followup",
      prompt: [{ type: "text", text: "继续核对，仍然不要改原文" }],
    });
    const noTodoEntries = (
      JSON.parse(
        (await backend.exportSession({ sessionId: noTodoSession, format: "json" })).content
      ) as {
        session: {
          extras: { entries: { kind: string; data: { runId?: string; modelAttempts?: number } }[] };
        };
      }
    ).session.extras.entries;
    const noTodoRuns = noTodoEntries.filter((entry) => entry.kind === "va.run");
    assert.equal(new Set(noTodoRuns.map((entry) => entry.data.runId)).size, 1);
    assert.equal(noTodoRuns.at(-1)?.data.modelAttempts, 2);
    const noTodoWorkId = noTodoRuns.at(-1)?.data.runId;
    assert.ok(noTodoWorkId);
    await backend.shutdown();
    const noTodoWork = await readStoredWorkItem({
      privateRoot: options.host.privateRoot,
      vaultRoot,
      vaultId: "work-continuation",
      sessionId: noTodoSession,
      workId: noTodoWorkId,
    });
    assert.equal(noTodoWork?.checkpoint.goal, "核对两个项目并保留原文");
    assert.equal(noTodoWork?.checkpoint.userRequests?.length, 2);
    assert.equal(noTodoWork?.grants.length, 2);
    assert.deepEqual(noTodoWork?.checkpoint.remainingItems, []);
    backend = new PiBackendProcess(options);
    await backend.start();
    const failedSession = "root-work-terminal-failure";
    await backend.newSession({ sessionId: failedSession, cwd: vaultRoot });
    faux.setResponses([
      fauxAssistantMessage("已核对部分事实", {
        stopReason: "error",
        errorMessage: "diagnostic invalid request: do not retry",
      }),
    ]);
    await assert.rejects(
      backend.prompt({
        sessionId: failedSession,
        requestId: "failed-original",
        prompt: [{ type: "text", text: "核对所有资料并保留原文" }],
      }),
      /diagnostic invalid request/
    );
    const failedBefore = (
      JSON.parse(
        (await backend.exportSession({ sessionId: failedSession, format: "json" })).content
      ) as DiagnosticExport
    ).session.extras.entries.filter((entry) => entry.kind === "va.run");
    const failedWorkId = failedBefore.at(-1)!.data.runId as string;
    assert.equal(failedBefore.at(-1)!.data.status, "failed");
    const failedCalls = faux.state.callCount;
    await backend.shutdown();
    const beforeFailureCarry = await readStoredWorkItem({
      privateRoot: options.host.privateRoot,
      vaultRoot,
      vaultId: "work-continuation",
      sessionId: failedSession,
      workId: failedWorkId,
    });
    assert.equal(beforeFailureCarry?.status, "waiting_user");
    assert.deepEqual(beforeFailureCarry?.checkpoint.remainingItems, []);
    backend = new PiBackendProcess(options);
    await backend.start();
    await backend.loadSession({ sessionId: failedSession, cwd: vaultRoot });
    assert.equal(
      faux.state.callCount,
      failedCalls,
      "terminal failure cold open must remain read only"
    );
    faux.setResponses([fauxAssistantMessage("按原要求继续核对完毕")]);
    await backend.prompt({
      sessionId: failedSession,
      requestId: "failed-followup",
      prompt: [{ type: "text", text: "继续核对，保留原要求" }],
    });
    const failedAfter = (
      JSON.parse(
        (await backend.exportSession({ sessionId: failedSession, format: "json" })).content
      ) as DiagnosticExport
    ).session.extras.entries.filter((entry) => entry.kind === "va.run");
    assert.equal(
      failedAfter.at(-1)!.data.runId,
      failedWorkId,
      "explicit followup after terminal failure must preserve the original WorkItem"
    );
    assert.equal(failedAfter.at(-1)!.data.modelAttempts, 2);
    await backend.shutdown();
    const afterFailureCarry = await readStoredWorkItem({
      privateRoot: options.host.privateRoot,
      vaultRoot,
      vaultId: "work-continuation",
      sessionId: failedSession,
      workId: failedWorkId,
    });
    assert.equal(afterFailureCarry?.checkpoint.goal, "核对所有资料并保留原文");
    assert.equal(afterFailureCarry?.checkpoint.userRequests?.length, 2);
    assert.equal(afterFailureCarry?.grants.length, 2);
    return {
      status: "passed",
      checks: [
        "finished_sdk_segment_reopens_without_dispatch",
        "explicit_continue_creates_new_segment_with_original_goal_and_budget",
        "completed_remaining_list_clears_continue_offer",
        "explicit_stop_does_not_reoffer_finished_work",
        "new_user_adjustment_preserves_goal_raw_request_and_shared_budget",
        "followup_without_model_todo_preserves_goal_and_cumulative_budget",
        "terminal_failed_sdk_cold_followup_preserves_original_work_goal_and_grants",
      ],
      providerCalls: faux.state.callCount,
    };
  } finally {
    await backend.shutdown();
  }
}
