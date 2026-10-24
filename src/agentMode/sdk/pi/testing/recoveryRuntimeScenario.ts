import { TFile, type App } from "obsidian";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionEvent, BackendState } from "@/agentMode/session/types";
import type { ProviderStreamsFactory } from "@/agentMode/sdk/pi/models/ProviderFactory";
import { PiRuntime } from "@/agentMode/sdk/pi/runtime/PiRuntime";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const fsSync = requireNodeModule<typeof import("node:fs")>("node:fs");
const path = requireNodeModule<typeof import("node:path")>("node:path");
const childProcess = requireNodeModule<typeof import("node:child_process")>("node:child_process");

interface PhaseReport {
  readonly status: "passed";
  readonly phase: string;
  readonly readOnly?: boolean;
  readonly modelCalls?: number;
  readonly recovery?: string;
  readonly crashLoopTripped?: boolean;
  readonly rejected?: boolean;
  readonly file?: string | null;
  readonly history?: boolean;
  readonly exported?: boolean;
  readonly runStatus?: string;
}

async function filesBelow(directory: string): Promise<readonly string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(target) : [target];
    })
  );
  return nested.flat();
}

// 故障仅在独立夹具进程的供应商或文件 I/O 边界退出，真实恢复链不被替换：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function runRecoveryRuntimeScenario(directory: string): Promise<PhaseReport> {
  const phase = process.env.PI_RECOVERY_PHASE ?? "all";
  if (phase === "all") {
    await fs.mkdir(directory, { recursive: true });
    const run = (name: string, root: string): PhaseReport => {
      const output = childProcess.execFileSync(process.execPath, [process.argv[1], root], {
        env: { ...process.env, PI_RECOVERY_PHASE: name },
        encoding: "utf8",
        timeout: 30_000,
      });
      return JSON.parse(output.trim().split("\n").at(-1)!) as PhaseReport;
    };
    const generation = path.join(directory, "generation");
    run("crash-generation", generation);
    const opens = [run("open", generation), run("open", generation), run("open", generation)];
    assert.deepEqual(
      opens.map((report) => report.readOnly),
      [false, false, true]
    );
    assert.ok(opens.every((report) => report.modelCalls === 0));
    assert.equal(opens[2].crashLoopTripped, true);
    const blocked = run("probe", generation);
    assert.equal(blocked.rejected, true);
    assert.equal(blocked.modelCalls, 0);
    assert.equal(run("abort", generation).history, true);
    const tool = path.join(directory, "tool");
    run("crash-tool", tool);
    const toolProbe = run("probe", tool);
    assert.equal(toolProbe.rejected, true);
    assert.equal(toolProbe.file, null);
    const continued = run("continue", tool);
    assert.equal(continued.file, "恢复后才允许的内容");
    assert.equal(continued.history, true);
    assert.equal(continued.runStatus, "completed");
    for (const kind of ["approval", "question", "plan"] as const) {
      const target = path.join(directory, kind);
      run(`crash-${kind}`, target);
      run(`${kind}-open`, target);
      run(`${kind}-decide`, target);
      assert.equal(run(`continue-${kind}`, target).runStatus, "completed");
    }
    const failedContinuation = path.join(directory, "failed-continuation");
    run("crash-generation", failedContinuation);
    const rejectedContinuation = run("continue-failed", failedContinuation);
    assert.equal(rejectedContinuation.rejected, true);
    assert.equal(rejectedContinuation.runStatus, "failed");
    const storeFiles = await filesBelow(path.join(generation, "private"));
    const relativeMeta = storeFiles.find((name) =>
      name.endsWith("root-recovery-fixture/meta.json")
    );
    assert.ok(relativeMeta);
    const metaPath = relativeMeta;
    const mainPath = path.join(path.dirname(metaPath), "main.jsonl");
    const beforeTail = await fs.readFile(mainPath, "utf8");
    await fs.appendFile(mainPath, '{"partial":');
    assert.equal(run("tail", generation).history, true);
    const afterTail = await fs.readFile(mainPath, "utf8");
    assert.ok(afterTail.startsWith(beforeTail));
    assert.ok(!afterTail.includes('{"partial":'));
    const header = await fs.readFile(metaPath, "utf8");
    await fs.writeFile(metaPath, JSON.stringify({ ...JSON.parse(header), schemaVersion: 99 }));
    const futureHeader = await fs.readFile(metaPath, "utf8");
    const future = run("future", generation);
    assert.equal(future.readOnly, true);
    assert.equal(future.history, true);
    assert.equal(future.exported, true);
    assert.equal(future.modelCalls, 0);
    assert.ok((await fs.readFile(metaPath, "utf8")) === futureHeader);
    assert.ok((await fs.readFile(mainPath, "utf8")) === afterTail);
    await fs.writeFile(metaPath, header);
    await fs.appendFile(mainPath, "{broken}\n");
    const damaged = await fs.readFile(mainPath, "utf8");
    const corrupt = run("corrupt", generation);
    assert.equal(corrupt.readOnly, true);
    assert.equal(corrupt.history, true);
    assert.equal(corrupt.exported, true);
    assert.ok((await fs.readFile(mainPath, "utf8")) === damaged);
    const failed = run("storage-failure", path.join(directory, "failure"));
    assert.equal(failed.recovery, "storage_failed");
    assert.equal(failed.exported, true);
    return { status: "passed", phase, history: true, exported: true };
  }

  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const keychainValues = new Map<string, string>([["fixture-key", "test-key"]]);
  const faux = fauxProvider();
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
          limits: { context: 200_000, output: 4096 },
        },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: {
        pi: {
          defaultMode: phase.includes("approval")
            ? "default"
            : phase.includes("plan")
              ? "plan"
              : "auto",
        },
      },
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["fixture-model"] } },
  } as unknown as VaultAgentSettings;
  const flushAndExit = async (report: PhaseReport): Promise<never> => {
    await new Promise<void>((resolve) =>
      process.stdout.write(`${JSON.stringify(report)}\n`, () => resolve())
    );
    process.exit(0);
  };
  const fileOf = (target: string): TFile | null =>
    fsSync.existsSync(path.join(vaultRoot, target))
      ? Object.assign(new TFile(), { path: target, extension: path.extname(target).slice(1) })
      : null;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: fileOf,
      getFiles: () => [],
      getMarkdownFiles: () => [],
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      create: async (target: string, content: string) => {
        if (phase === "crash-tool") await flushAndExit({ status: "passed", phase });
        await fs.writeFile(path.join(vaultRoot, target), content);
        return fileOf(target);
      },
      createFolder: (target: string) => fs.mkdir(path.join(vaultRoot, target), { recursive: true }),
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const modelInputs: string[] = [];
  const streamsFactory: ProviderStreamsFactory = () => ({
    stream: (model, context, options) => {
      modelInputs.push(JSON.stringify(context.messages));
      return faux.provider.stream(model, context, options);
    },
    streamSimple: (model, context, options) => {
      modelInputs.push(JSON.stringify(context.messages));
      return faux.provider.streamSimple(model, context, options);
    },
  });
  const events: SessionEvent[] = [];
  let permissionCalls = 0;
  let questionCalls = 0;
  let storageFailed!: () => void;
  const failureObserved = new Promise<void>((resolve) => {
    storageFailed = resolve;
  });
  const runtime = new PiRuntime(
    {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "recovery-fixture",
        getSecretById: (id) => keychainValues.get(id) ?? null,
        setSecretById: (id, value) => {
          keychainValues.set(id, value);
        },
        deleteSecretById: (id) => {
          keychainValues.delete(id);
        },
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory,
    },
    {
      emit: (event) => {
        events.push(event);
        if (
          event.update.sessionUpdate === "recovery_state" &&
          event.update.recovery.status === "storage_failed"
        )
          storageFailed();
      },
      permission: async () => {
        permissionCalls += 1;
        if (phase === "crash-approval" || phase === "crash-plan")
          return flushAndExit({ status: "passed", phase });
        return { outcome: { outcome: "cancelled" } };
      },
      ask: async () => {
        questionCalls += 1;
        if (phase === "crash-question") return flushAndExit({ status: "passed", phase });
        return {};
      },
      readOnly: () => false,
    }
  );
  await runtime.initialize();
  const sessionId = "root-recovery-fixture";
  const prompt = (requestId: string) =>
    runtime.prompt({ sessionId, requestId, prompt: [{ type: "text", text: requestId }] });
  let state: BackendState;
  let rejected = false;
  let exported = false;
  if (phase.startsWith("crash-") || phase === "storage-failure") {
    state = (await runtime.open({ sessionId, cwd: vaultRoot })).state;
    faux.setResponses([fauxAssistantMessage("已保存的真实回答")]);
    await prompt("saved-history");
    if (phase === "storage-failure") {
      const files = await filesBelow(path.join(directory, "private"));
      const relative = files.find((name) => name.endsWith("root-recovery-fixture/main.jsonl"));
      assert.ok(relative);
      const main = relative;
      await fs.rename(main, `${main}.saved`);
      await fs.mkdir(main);
      await assert.rejects(prompt("storage-must-fail"));
      await failureObserved;
      exported = (await runtime.exportSession({ sessionId, format: "markdown" })).content.includes(
        "已保存的真实回答"
      );
    } else {
      faux.setResponses([
        phase === "crash-tool" || phase === "crash-approval"
          ? fauxAssistantMessage(
              [fauxToolCall("vault_create", { path: "late.md", content: "恢复后才允许的内容" })],
              { stopReason: "toolUse" }
            )
          : phase === "crash-question"
            ? fauxAssistantMessage(
                [
                  fauxToolCall("ask_user", {
                    questions: [
                      {
                        question: "保留哪项内容？",
                        answerKey: "choice",
                        options: [{ label: "标题" }, { label: "正文" }],
                      },
                    ],
                  }),
                ],
                { stopReason: "toolUse" }
              )
            : phase === "crash-plan"
              ? fauxAssistantMessage(
                  [
                    fauxToolCall("propose_plan", {
                      title: "原始模型标题",
                      body: "# 正文标题不同\n\n保存原始计划正文",
                      steps: ["核对原文"],
                    }),
                  ],
                  { stopReason: "toolUse" }
                )
              : () => flushAndExit({ status: "passed", phase }),
      ]);
      await prompt("unfinished-request");
    }
  } else {
    state = (await runtime.load(sessionId, vaultRoot)).state;
    if (/^(approval|question|plan)-(open|decide)$/.test(phase)) {
      const projection = events
        .filter((event) => event.update.sessionUpdate === "session_projection")
        .at(-1)?.update;
      assert.ok(projection?.sessionUpdate === "session_projection");
      const pending = projection.projection.pending;
      assert.equal(faux.state.callCount, 0);
      assert.equal(permissionCalls, 0);
      assert.equal(questionCalls, 0);
      if (phase.startsWith("approval-")) {
        assert.equal(pending.permissions.length, 1);
        assert.equal(pending.permissions[0].toolCall.title, "vault_create");
        assert.deepEqual(
          pending.permissions[0].options.map((option) => option.optionId),
          ["allow_once", "reject_once"]
        );
        assert.ok(
          pending.recovery?.pendingPermissionIds.includes(
            pending.permissions[0].toolCall.toolCallId
          )
        );
        if (phase.endsWith("decide"))
          await runtime.decidePermission({
            sessionId,
            requestId: pending.permissions[0].toolCall.toolCallId,
            decision: { outcome: { outcome: "selected", optionId: "allow_once" } },
          });
        assert.equal(fsSync.existsSync(path.join(vaultRoot, "late.md")), false);
      } else if (phase.startsWith("question-")) {
        assert.equal(pending.questions.length, 1);
        assert.equal(pending.questions[0].questions[0].question, "保留哪项内容？");
        assert.ok(pending.recovery?.pendingQuestionIds.includes(pending.questions[0].requestId));
        if (phase.endsWith("decide"))
          await runtime.answerPendingQuestion({
            sessionId,
            requestId: pending.questions[0].requestId,
            answers: { choice: "标题" },
          });
      } else {
        assert.equal(pending.plan?.title, "原始模型标题");
        assert.equal(pending.plan.body, "# 正文标题不同\n\n保存原始计划正文");
        if (phase.endsWith("decide"))
          await runtime.decidePendingPlan({
            sessionId,
            planId: pending.plan.id,
            revision: pending.plan.revision,
            action: "feedback",
            feedback: "请先核对原文",
          });
        assert.equal(state.mode?.current, "plan");
      }
      assert.equal(faux.state.callCount, 0);
      return flushAndExit({ status: "passed", phase, modelCalls: 0, history: true });
    } else if (["continue-approval", "continue-question", "continue-plan"].includes(phase)) {
      faux.setResponses([fauxAssistantMessage("继续后的保存回答")]);
      await runtime.recoverSession({ sessionId, action: "continue" });
      assert.equal(permissionCalls, 0);
      assert.equal(questionCalls, 0);
      if (phase === "continue-approval")
        assert.equal(
          await fs.readFile(path.join(vaultRoot, "late.md"), "utf8"),
          "恢复后才允许的内容"
        );
      if (phase === "continue-question")
        assert.ok(modelInputs.some((input) => input.includes("标题")));
      if (phase === "continue-plan")
        assert.ok(modelInputs.some((input) => input.includes("请先核对原文")));
    } else if (phase === "probe") {
      await assert.rejects(prompt("must-not-start-old-work"));
      rejected = true;
    } else if (phase === "abort") {
      await runtime.recoverSession({ sessionId, action: "abort" });
      faux.setResponses([fauxAssistantMessage("停止后新回答")]);
      await prompt("fresh-after-abort");
    } else if (phase === "continue") {
      faux.setResponses([fauxAssistantMessage("恢复后的真实回答")]);
      await runtime.recoverSession({ sessionId, action: "continue" });
    } else if (phase === "continue-failed") {
      faux.setResponses([
        fauxAssistantMessage("", { stopReason: "error", errorMessage: "offline" }),
      ]);
      await assert.rejects(runtime.recoverSession({ sessionId, action: "continue" }));
      rejected = true;
    } else if (phase === "future" || phase === "corrupt") {
      await assert.rejects(prompt("read-only-rejects-input"));
      await assert.rejects(runtime.recoverSession({ sessionId, action: "continue" }));
      exported = (await runtime.exportSession({ sessionId, format: "markdown" })).content.includes(
        "已保存的真实回答"
      );
    }
  }
  const projection = events
    .filter((event) => event.update.sessionUpdate === "session_projection")
    .at(-1)?.update;
  const recoveryEvent = events
    .filter((event) => event.update.sessionUpdate === "recovery_state")
    .at(-1)?.update;
  const recovery =
    recoveryEvent?.sessionUpdate === "recovery_state" ? recoveryEvent.recovery : null;
  const runEvent = events
    .filter((event) => event.update.sessionUpdate === "run_state")
    .at(-1)?.update;
  const report: PhaseReport = {
    status: "passed",
    phase,
    readOnly: state.readOnly,
    modelCalls: faux.state.callCount,
    recovery: recovery?.status,
    crashLoopTripped: recovery?.crashLoopTripped,
    rejected,
    file: await fs.readFile(path.join(vaultRoot, "late.md"), "utf8").catch(() => null),
    history:
      projection?.sessionUpdate === "session_projection" &&
      projection.projection.messages.some((message) =>
        message.message.includes("已保存的真实回答")
      ),
    exported,
    runStatus: runEvent?.sessionUpdate === "run_state" ? runEvent.run.status : undefined,
  };
  if (phase === "open" || phase === "probe") return flushAndExit(report);
  await runtime.shutdown();
  return report;
}
