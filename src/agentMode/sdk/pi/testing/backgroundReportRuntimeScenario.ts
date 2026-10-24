import type { App } from "obsidian";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionEvent } from "@/agentMode/session/types";
import type { SessionExportDocument } from "@/agentMode/sdk/pi/storage/SessionExport";
import type { ProviderStreamsFactory } from "@/agentMode/sdk/pi/models/ProviderFactory";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { isSummaryRequest } from "@/agentMode/sdk/pi/testing/summaryRequest";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");
const childProcess = requireNodeModule<typeof import("node:child_process")>("node:child_process");

interface PhaseReport {
  readonly status: "passed";
  readonly phase: string;
  readonly calls: readonly string[];
  readonly reportEntries: number;
  readonly summaries: number;
  readonly compactionRequests?: number;
  readonly checks?: readonly string[];
  readonly foreground?: {
    readonly childId: string;
    readonly childCount: number;
    readonly requestIds: readonly string[];
    readonly providerCalls: number;
  };
  readonly scope?: string;
  readonly recovery?: {
    readonly afterReportContinueCalls: number;
    readonly afterSynthesisContinueCalls: number;
    readonly readCalls: number;
  };
}

async function findDiagnosticStore(folder: string): Promise<string | null> {
  for (const file of await fs.readdir(folder, { withFileTypes: true })) {
    const pathname = path.join(folder, file.name);
    if (file.name === "main.jsonl") return folder;
    if (file.isDirectory()) {
      const found = await findDiagnosticStore(pathname);
      if (found) return found;
    }
  }
  return null;
}

const sessionId = "root-background-report-fixture";
const childAnswer = "后台唯一答案-background-report-cut";
const synthesis = "父模型已综合唯一后台答案";

// 只在真实 JSONL 写入边界退出独立进程，保留生产 Backend、调度器和报告投递：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function runBackgroundReportRuntimeScenario(directory: string): Promise<PhaseReport> {
  const phase = process.env.PI_BACKGROUND_REPORT_PHASE ?? "all";
  if (phase === "all") {
    const run = (name: string, root: string): PhaseReport => {
      const output = childProcess.execFileSync(process.execPath, [process.argv[1], root], {
        env: { ...process.env, PI_BACKGROUND_REPORT_PHASE: name },
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.ok(output.trim(), `${name} must finish its actual SDK checkpoint before process exit`);
      return JSON.parse(output.trim().split("\n").at(-1)!) as PhaseReport;
    };
    const live = run("live", path.join(directory, "live"));
    assert.equal(live.summaries, 0);
    assert.ok(
      (live.compactionRequests ?? 0) > 0,
      "the live report path must also survive actual SDK context compaction"
    );
    const followup = run("followup", path.join(directory, "live"));
    assert.equal(
      followup.calls.length,
      1,
      "an explicit new user input can read the previously pending report"
    );
    assert.equal(followup.summaries, 1);
    const waited = run("live-wait", path.join(directory, "waited"));
    assert.equal(waited.summaries, 1);
    assert.equal(waited.calls.length, 4, "explicit wait must not queue a second synthesis input");
    const busy = run("live-busy", path.join(directory, "busy"));
    assert.equal(busy.summaries, 1);
    const crashed = run("crash", path.join(directory, "crash"));
    assert.equal(crashed.reportEntries, 1);
    const read = run("read", path.join(directory, "crash"));
    assert.equal(read.calls.length, 0);
    assert.equal(read.reportEntries, 1);
    const continued = run("continue", path.join(directory, "crash"));
    assert.equal(continued.calls.length, 0);
    assert.equal(continued.summaries, 0);
    const final = run("read", path.join(directory, "crash"));
    assert.equal(final.calls.length, 0);
    assert.equal(final.reportEntries, 1);
    assert.equal(final.summaries, 0);
    const synthesized = run("crash-synthesized", path.join(directory, "synthesized"));
    assert.equal(synthesized.summaries, 1);
    assert.equal(run("read", path.join(directory, "synthesized")).summaries, 1);
    const noDuplicate = run("continue", path.join(directory, "synthesized"));
    assert.equal(
      noDuplicate.calls.length,
      0,
      "an already completed synthesis must not wake the model twice"
    );
    assert.equal(noDuplicate.summaries, 1);
    assert.equal(noDuplicate.reportEntries, 1);
    const failedStore = run("storage-failure", path.join(directory, "failure"));
    assert.equal(failedStore.reportEntries, 0);
    assert.equal(failedStore.summaries, 0);
    assert.equal(failedStore.calls.length, 3);
    const unsupportedCalls: string[] = [];
    for (const unsupported of ["unknown-kind", "future-version"]) {
      const target = path.join(directory, unsupported);
      unsupportedCalls.push(...run("crash", target).calls);
      const store = await findDiagnosticStore(path.join(target, "private"));
      assert.ok(store);
      let alteredRecords = 0;
      for (const file of await fs.readdir(store)) {
        if (!file.startsWith("task-") || !file.endsWith(".jsonl")) continue;
        const taskFile = path.join(store, file);
        const altered = (await fs.readFile(taskFile, "utf8"))
          .split("\n")
          .map((line) => {
            if (!line) return line;
            const record = JSON.parse(line) as {
              payload?: { type: string; value?: { kind?: string; version?: number } };
            };
            const write = record.payload;
            if (write?.type === "task" && write.value?.kind === "va.subagent_reporter") {
              if (unsupported === "unknown-kind") write.value.kind = "va.future_reporter";
              else write.value.version = 99;
              alteredRecords += 1;
            }
            return JSON.stringify(record);
          })
          .join("\n");
        await fs.writeFile(taskFile, altered);
      }
      assert.ok(
        alteredRecords > 0,
        "the actual persisted nonterminal Reporter records must be changed"
      );
      const blocked = run("blocked", target);
      assert.equal(blocked.calls.length, 0);
      assert.equal(blocked.reportEntries, 1);
    }
    const foregroundTarget = path.join(directory, "foreground");
    const createdForeground = run("crash-foreground", foregroundTarget);
    assert.equal(
      createdForeground.calls.length,
      1,
      "the create-before-submit cut must precede any child model request"
    );
    assert.equal(run("read-foreground", foregroundTarget).calls.length, 0);
    const resumedForeground = run("continue-foreground", foregroundTarget);
    assert.equal(resumedForeground.foreground?.childCount, 1);
    assert.equal(
      resumedForeground.calls.filter((id) => id === "fixture-child").length,
      1,
      "the same foreground child must make only one actual model request after explicit recovery"
    );
    assert.equal(resumedForeground.calls.length, 2);
    const finalForeground = run("read-foreground", foregroundTarget);
    assert.equal(finalForeground.calls.length, 0);
    return {
      status: "passed",
      phase,
      scope:
        "actual_backend_sdk_jsonl_and_process_crash_with_controlled_provider_not_desktop_or_actual_model",
      foreground: resumedForeground.foreground,
      recovery: {
        afterReportContinueCalls: continued.calls.length,
        afterSynthesisContinueCalls: noDuplicate.calls.length,
        readCalls: read.calls.length + final.calls.length,
      },
      calls: [
        ...live.calls,
        ...followup.calls,
        ...busy.calls,
        ...waited.calls,
        ...crashed.calls,
        ...continued.calls,
        ...synthesized.calls,
        ...unsupportedCalls,
        ...failedStore.calls,
        ...createdForeground.calls,
        ...resumedForeground.calls,
      ],
      reportEntries: final.reportEntries,
      summaries: final.summaries,
      compactionRequests: live.compactionRequests,
      checks: [
        "finished_original_run_stores_report_without_new_model_request",
        "explicit_wait_consumes_actual_report_without_an_additional_followup",
        "new_explicit_input_after_cold_open_receives_original_pending_report",
        "background_report_and_actual_context_compaction_share_the_same_task_tree",
        "report_entry_is_tool_sourced_and_does_not_create_another_user_message",
        "busy_original_run_receives_report_without_creating_a_second_input",
        "real_process_exits_after_report_append_before_report_checkpoint",
        "read_only_reopen_preserves_report_and_does_not_start_model",
        "explicit_continue_restores_report_without_creating_another_model_input",
        "second_reopen_keeps_one_report_and_zero_automatic_requests",
        "completed_synthesis_before_report_checkpoint_is_not_dispatched_again",
        "unknown_reporter_kind_and_future_version_remain_readable_and_block_continue",
        "real_report_checkpoint_storage_failure_stops_before_report_or_followup",
        "foreground_create_before_submit_crash_restores_same_child_and_fixed_request_once",
        "foreground_read_only_reopen_and_normal_shutdown_never_start_child",
      ],
    };
  }
  const foreground = phase.includes("foreground");
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
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
    configuredModels: ["fixture-root", "fixture-child"].map((id) => ({
      configuredModelId: id,
      providerId: "fixture",
      info: { id, displayName: id, toolCall: true, limits: { context: 8192, output: 1024 } },
      configuredAt: 1,
    })),
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: {},
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["fixture-root", "fixture-child"] } },
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
  const calls: string[] = [];
  let compactionRequests = 0;
  let rootCompleted!: () => void;
  const parentReady = new Promise<void>((resolve) => {
    rootCompleted = resolve;
  });
  let releaseBusyParent!: () => void;
  const busyParent = new Promise<void>((resolve) => {
    releaseBusyParent = resolve;
  });
  const faux = fauxProvider({ models: [{ id: "fixture-root" }, { id: "fixture-child" }] });
  const response = async (
    context: unknown,
    _options: unknown,
    _state: unknown,
    model: { id: string }
  ) => {
    calls.push(model.id);
    await fs.appendFile(
      path.join(directory, "provider-calls.jsonl"),
      `${JSON.stringify(model.id)}\n`
    );
    if (model.id === "fixture-child") {
      if (!["live-busy", "live-wait", "crash-synthesized"].includes(phase) && !foreground)
        await parentReady;
      return fauxAssistantMessage(childAnswer);
    }
    if (phase === "live-wait" && calls.filter((id) => id === "fixture-root").length === 2) {
      const messages = (
        context as {
          messages: {
            role: string;
            toolName?: string;
            details?: { outcome?: { data?: { taskId?: string } } };
          }[];
        }
      ).messages;
      const taskId = messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "start_background_task"
      )?.details?.outcome?.data?.taskId;
      assert.ok(taskId, "wait selects the task identifier actually returned by start");
      return fauxAssistantMessage(
        [fauxToolCall("wait_subagent", { taskIds: [taskId], timeoutMs: 30_000 })],
        { stopReason: "toolUse" }
      );
    }
    if (
      phase === "followup" ||
      phase.startsWith("continue") ||
      calls.filter((id) => id === "fixture-root").length > 2
    ) {
      assert.ok(
        JSON.stringify(context).includes(childAnswer),
        "synthesis must read the actual child answer"
      );
      if (!foreground && phase !== "live-wait")
        assert.ok(JSON.stringify(context).includes("tool-sourced"));
      return fauxAssistantMessage(synthesis);
    }
    if (calls.filter((id) => id === "fixture-root").length === 1)
      return fauxAssistantMessage(
        [
          fauxToolCall(foreground ? "delegate_task" : "start_background_task", {
            profileId: "researcher",
            task: "读取并回报诊断答案",
            description: "后台诊断",
            modelKey: "fixture-child",
            commandId: "stable-background-command",
          }),
        ],
        { stopReason: "toolUse" }
      );
    if (["live-busy", "crash-synthesized"].includes(phase)) {
      await busyParent;
      return fauxAssistantMessage([fauxToolCall("todo_get", {})], { stopReason: "toolUse" });
    }
    return fauxAssistantMessage("后台任务已启动，等待实际报告");
  };
  faux.setResponses(Array.from({ length: 8 }, () => response));
  // 摘要走真实 SDK 压缩而不消费报告步骤；保留小上下文验证两条生产路径相互兼容。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const summaryStream = (context: unknown) => {
    compactionRequests += 1;
    const message = fauxAssistantMessage(
      "Keep the original user goal, committed tool results and pending child reports. Continue from the latest recorded boundary." +
        (JSON.stringify(context).includes(childAnswer)
          ? `\nSaved tool-sourced child report: ${childAnswer}`
          : "")
    );
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  const streamsFactory: ProviderStreamsFactory = () => ({
    stream: (model, context, options) =>
      isSummaryRequest(context)
        ? summaryStream(context)
        : faux.provider.stream(model, context, options),
    streamSimple: (model, context, options) =>
      isSummaryRequest(context)
        ? summaryStream(context)
        : faux.provider.streamSimple(model, context, options),
  });
  const backend = new PiBackendProcess({
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "background-report-fixture",
        getSecretById: (id) => (id === "fixture-key" ? "fixture-only-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory,
    },
  });
  let failedStoreObserved!: () => void;
  const failedStoreReady = new Promise<void>((resolve) => {
    failedStoreObserved = resolve;
  });
  const events: SessionEvent[] = [];
  backend.registerSessionHandler(sessionId, (event) => {
    events.push(event);
    if (
      event.update.sessionUpdate === "recovery_state" &&
      event.update.recovery.status === "storage_failed"
    )
      failedStoreObserved();
    if (event.update.sessionUpdate === "run_state" && event.update.run.status === "completed")
      rootCompleted();
  });
  let checkpointSaved!: () => void;
  const checkpoint = new Promise<void>((resolve) => {
    checkpointSaved = resolve;
  });
  let reportObserved!: () => void;
  const reportReady = new Promise<void>((resolve) => {
    reportObserved = resolve;
  });
  let reportWrites = 0;
  const append = fs.appendFile;
  fs.appendFile = async (file, data, options) => {
    const content = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (
      phase === "storage-failure" &&
      typeof file === "string" &&
      path.basename(file).startsWith("task-") &&
      content.includes('"kind":"va.subagent_reporter"') &&
      content.includes('"phase":"report"')
    ) {
      throw Object.assign(new Error("Injected actual Reporter checkpoint I/O failure"), {
        code: "EIO",
      });
    }
    await append(file, data, options);
    if (typeof file !== "string" || !file.endsWith("main.jsonl")) return;
    if (content.includes('"kind":"va.subagent.report"')) {
      reportWrites += 1;
      reportObserved();
    }
    if (phase === "crash-foreground" && content.includes('"docKind":"va.subagents"')) {
      const writes = (
        JSON.parse(content) as {
          writes: { type: string; value?: { id: number; owner?: { taskId: number } } }[];
        }
      ).writes;
      const created = writes.find(
        (write) => write.type === "conversation" && write.value?.owner?.taskId
      );
      if (created?.value) {
        const marker = {
          childId: String(created.value.id),
          ownerTaskId: String(created.value.owner!.taskId),
        };
        await fs.writeFile(path.join(directory, "foreground-cut.json"), JSON.stringify(marker));
        await new Promise<void>((resolve) =>
          process.stdout.write(
            `${JSON.stringify({ status: "passed", phase, calls, reportEntries: 0, summaries: 0 })}\n`,
            () => resolve()
          )
        );
        process.exit(0);
      }
    }

    if (
      ["live-busy", "crash-synthesized"].includes(phase) &&
      content.includes('"requestId":"subagent-context:') &&
      content.includes('"status":"queued"')
    )
      releaseBusyParent();
    const cutAfterReport = phase === "crash" && content.includes('"kind":"va.subagent.report"');
    const cutAfterSynthesis =
      phase === "crash-synthesized" &&
      content.includes(synthesis) &&
      content.includes('"kind":"pi.assistant"');
    if (cutAfterReport || cutAfterSynthesis) {
      await fs.writeFile(
        path.join(directory, "crash-cut.json"),
        JSON.stringify({
          afterReportAppend: true,
          afterSynthesis: cutAfterSynthesis,
          beforeCheckpoint: true,
        })
      );
      await new Promise<void>((resolve) =>
        process.stdout.write(
          `${JSON.stringify({ status: "passed", phase, calls, reportEntries: 1, summaries: cutAfterSynthesis ? 1 : 0 })}\n`,
          () => resolve()
        )
      );
      process.exit(0);
    }
    if (
      content.includes('"kind":"va.subagent_reporter"') &&
      content.includes('"status":"terminal"')
    )
      checkpointSaved();
  };
  try {
    await backend.start();
    if (phase.startsWith("live") || phase.startsWith("crash") || phase === "storage-failure") {
      await backend.newSession({ sessionId, cwd: vaultRoot });
      await backend.setSessionModel({ sessionId, modelId: "fixture-root" });
      await backend.prompt({
        sessionId,
        requestId: "background-user",
        prompt: [{ type: "text", text: "运行后台任务并综合报告" }],
      });
      if (phase === "storage-failure") await failedStoreReady;
      else await checkpoint;
    } else {
      const loaded = await backend.loadSession({ sessionId, cwd: vaultRoot });
      if (phase === "blocked") {
        assert.equal(
          loaded.state?.readOnly,
          true,
          "an unavailable persisted task definition must be shown as blocked read-only, not recoverable execution"
        );
        await assert.rejects(
          backend.recoverSession({ sessionId, action: "continue" }),
          /兼容|任务定义|task definition/
        );
        await assert.rejects(
          backend.prompt({ sessionId, prompt: [{ type: "text", text: "不得运行未知任务" }] })
        );
      }
      if (phase === "continue-foreground") {
        const recovering = backend.recoverSession({ sessionId, action: "continue" }).then(
          () => ({ kind: "completed" as const }),
          (error) => ({ kind: "failed" as const, error })
        );
        const outcome = await Promise.race([
          recovering,
          reportReady.then(() => ({ kind: "unexpected_background_report" as const })),
        ]);
        assert.notEqual(
          outcome.kind,
          "unexpected_background_report",
          "foreground recovery must not create a Reporter and queue a second model run"
        );
        if (outcome.kind === "failed") throw outcome.error;
      } else if (phase === "followup")
        await backend.prompt({
          sessionId,
          requestId: "explicit-report-followup",
          prompt: [{ type: "text", text: "综合已经保存的后台报告" }],
        });
      else if (phase.startsWith("continue"))
        await backend.recoverSession({ sessionId, action: "continue" });
    }
    const exported = JSON.parse(
      (await backend.exportSession({ sessionId, format: "json" })).content
    ) as SessionExportDocument;
    const entries = (exported.session.extras?.entries ?? []) as { kind: string; data?: unknown }[];
    const reports = entries.filter((entry) => entry.kind === "va.subagent.report");
    if (foreground) {
      assert.equal(
        reports.length,
        0,
        "a foreground delegation must not acquire a background Reporter"
      );
      const cut = JSON.parse(
        await fs.readFile(path.join(directory, "foreground-cut.json"), "utf8")
      ) as { childId: string; ownerTaskId: string };
      const store = await findDiagnosticStore(path.join(directory, "private"));
      assert.ok(store);
      const writes = (await fs.readFile(path.join(store, "main.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .flatMap(
          (line) =>
            (
              JSON.parse(line) as {
                writes: {
                  type: string;
                  value?: {
                    id: number;
                    conversationId?: number;
                    type?: string;
                    requestId?: string;
                    owner?: { taskId: number };
                  };
                }[];
              }
            ).writes
        );
      const childIds = new Set(
        writes
          .filter(
            (write) =>
              write.type === "conversation" &&
              write.value?.owner?.taskId === Number(cut.ownerTaskId)
          )
          .map((write) => String(write.value!.id))
      );
      assert.deepEqual([...childIds], [cut.childId]);
      const submissions = new Map(
        writes
          .filter(
            (write) =>
              write.type === "submission" &&
              String(write.value?.conversationId) === cut.childId &&
              write.value?.type === "input"
          )
          .map((write) => [write.value!.id, write.value!])
      );
      const requestIds = [...submissions.values()].map((value) => value.requestId ?? "");
      if (phase === "continue-foreground" || requestIds.length)
        assert.deepEqual(
          requestIds,
          [`delegate:${cut.ownerTaskId}`],
          "foreground recovery must reuse its fixed request ID"
        );
      if (phase === "continue-foreground") {
        assert.equal(
          calls.filter((id) => id === "fixture-child").length,
          1,
          "foreground recovery must dispatch the actual child once"
        );
        const childHistory = await backend.readSubagentHistory({
          sessionId,
          conversationId: cut.childId,
        });
        assert.equal(childHistory.filter((message) => message.message === childAnswer).length, 1);
        assert.ok(
          exported.session.messages.some((message) => message.text.includes(synthesis))
          // 一个 run 合并为一条消息后，综合答案只作为该消息文本的一部分。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
        );
      }
      return {
        status: "passed",
        phase,
        calls,
        reportEntries: reports.length,
        summaries: 0,
        foreground: {
          childId: cut.childId,
          childCount: childIds.size,
          requestIds,
          providerCalls: calls.length,
        },
      };
    }
    assert.equal(reports.length, phase === "storage-failure" ? 0 : 1);
    if (phase !== "storage-failure") {
      assert.ok(JSON.stringify(reports[0]).includes(childAnswer));
      assert.ok(JSON.stringify(reports[0]).includes('"source":"tool"'));
    } else {
      assert.equal(
        (await backend.loadSession({ sessionId, cwd: vaultRoot })).state?.readOnly,
        true
      );
      assert.equal(reportWrites, 0, "a failed checkpoint cannot publish a report to actual JSONL");
      assert.equal(calls.length, 3, "no provider can follow a failed durable Reporter checkpoint");
    }
    const summaries = exported.session.messages.filter(
      // 一个 run 合并为一条消息后，综合答案只作为该消息文本的一部分。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
      (message) => message.role === "assistant" && message.text.includes(synthesis)
    ).length;
    assert.equal(
      entries.filter((entry) => entry.kind === "va.subagent.followup").length,
      0,
      "a background report must never create a standalone model input"
    );
    if (phase.startsWith("live"))
      assert.equal(
        summaries,
        phase === "live" ? 0 : 1,
        "only an authorized running parent can synthesize a report; idle completion must remain idle"
      );
    assert.equal(
      exported.session.messages.filter((message) => message.role === "user").length,
      phase === "followup" ? 2 : 1,
      "tool-sourced report cannot appear as another user intent"
    );
    return {
      status: "passed",
      phase,
      calls,
      reportEntries: reports.length,
      summaries,
      compactionRequests,
    };
  } finally {
    fs.appendFile = append;
    await backend.shutdown();
  }
}
