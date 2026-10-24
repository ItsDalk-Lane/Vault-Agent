import { isSummaryRequest } from "@/agentMode/sdk/pi/testing/summaryRequest";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import type { SessionEvent } from "@/agentMode/session/types";
import {
  fauxAssistantMessage,
  fauxProvider,
  type AssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");
const childProcess = requireNodeModule<typeof import("node:child_process")>("node:child_process");

interface SavedEntry {
  readonly id: number;
  readonly kind: string;
  readonly data: { readonly status?: string; readonly taskId?: string };
  readonly model: readonly {
    readonly role: string;
    readonly usage?: { readonly totalTokens: number };
  }[];
}

async function savedEntries(
  backend: PiBackendProcess,
  sessionId: string
): Promise<readonly SavedEntry[]> {
  const exported = await backend.exportSession({ sessionId, format: "json" });
  return (JSON.parse(exported.content) as { session: { extras: { entries: SavedEntry[] } } })
    .session.extras.entries;
}

async function fixture(directory: string, resume = false) {
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
        info: { id: "model", toolCall: true, limits: { context: 32768, output: 12288 } },
        configuredAt: 1,
      },
    ],
    agentMode: { activeBackend: "pi", backends: {}, skills: { folder: "skills" } },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const app = {
    vault: {
      configDir: ".test-config",
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
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "compaction-boundary",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  };
  const backend = new PiBackendProcess(options);
  await backend.start();
  const events: SessionEvent[] = [];
  const sessionId = "root-compaction-boundary";
  backend.registerSessionHandler(sessionId, (event) => events.push(event));
  const opened = resume
    ? await backend.loadSession({ sessionId, cwd: vaultRoot })
    : await backend.newSession({ sessionId, cwd: vaultRoot });
  const prompt = (text: string, requestId: string) =>
    backend.prompt({ sessionId: opened.sessionId, requestId, prompt: [{ type: "text", text }] });
  return { backend, options, opened, events, faux, prompt, vaultRoot };
}

async function overflow(directory: string) {
  const subject = await fixture(directory);
  try {
    subject.faux.setResponses([fauxAssistantMessage(`原始回答:${"source ".repeat(5000)}`)]);
    await subject.prompt("必须保留的原始问题", "overflow-seed");
    const before = subject.faux.state.callCount;
    const failures = () =>
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "context_length_exceeded: controlled provider overflow",
      });
    const inputs: string[] = [];
    let generations = 0;
    let summaries = 0;
    const response = (context: TranscriptContext) => {
      inputs.push(JSON.stringify(context.messages));
      if (isSummaryRequest(context)) {
        summaries += 1;
        return fauxAssistantMessage("OVERFLOW_RECOVERY_SUMMARY");
      }
      generations += 1;
      return failures();
    };
    subject.faux.setResponses([
      response,
      response,
      response,
      fauxAssistantMessage("不得进行第三次自动重试"),
    ]);
    await assert.rejects(
      subject.prompt("触发真实上下文超限分支", "overflow"),
      /context_length_exceeded/
    );
    assert.equal(generations, 2, "the real SDK may make only one generation retry after overflow");
    assert.equal(summaries, 1);
    assert.equal(subject.faux.state.callCount - before, 3);
    assert.equal(subject.faux.getPendingResponseCount(), 1);
    assert.ok(inputs.at(-1)?.includes("OVERFLOW_RECOVERY_SUMMARY"));
    const entries = await savedEntries(subject.backend, subject.opened.sessionId);
    assert.equal(entries.filter((entry) => entry.kind === "pi.compaction").length, 1);
    assert.ok(JSON.stringify(entries).includes("必须保留的原始问题"));
    const users = entries.filter(
      (entry) =>
        entry.kind === "pi.user" && JSON.stringify(entry).includes("触发真实上下文超限分支")
    );
    assert.equal(users.length, 1, "retry must reuse the original user submission");
    return { generations, summaries, providerCalls: subject.faux.state.callCount - before };
  } finally {
    await subject.backend.shutdown();
  }
}

async function stale(directory: string) {
  const subject = await fixture(directory);
  const append = Reflect.get(NodeExecutionEnv.prototype, "appendFile");
  let releaseOld = (_message: AssistantMessage): void => undefined;
  let reopened: PiBackendProcess | undefined;
  try {
    subject.faux.setResponses([fauxAssistantMessage(`旧回答:${"source ".repeat(5000)}`)]);
    await subject.prompt("旧问题", "stale-seed");
    const seedUsage = subject.events
      .filter((event) => event.update.sessionUpdate === "usage_update")
      .at(-1);
    assert.ok(seedUsage?.update.sessionUpdate === "usage_update");
    const usage = seedUsage.update.usage.usedTokens;
    assert.equal(typeof usage, "number");
    const target = 26_400;
    assert.ok(usage < target, `the seed must leave a real background threshold range (${usage})`);
    let oldStarted!: () => void;
    const summarizing = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    const oldSummary = new Promise<AssistantMessage>((resolve) => {
      releaseOld = resolve;
    });
    let summaries = 0;
    const response = (context: TranscriptContext) => {
      if (isSummaryRequest(context)) {
        summaries += 1;
        if (summaries === 1) {
          oldStarted();
          return oldSummary;
        }
        return fauxAssistantMessage("NEW_EFFECTIVE_SUMMARY");
      }
      return summarizing.then(() => fauxAssistantMessage(`新上下文:${"fresh ".repeat(6000)}`));
    };
    subject.faux.setResponses([response, response, response]);
    const foreground = subject.prompt(
      `触发后台压缩${"x".repeat(Math.floor((target - usage) * 3.5))}`,
      "stale-background"
    );
    await summarizing;
    await foreground;
    const start = subject.events.find(
      (event) =>
        event.update.sessionUpdate === "compaction" &&
        event.update.trigger === "auto" &&
        event.update.status === "in_progress"
    );
    assert.ok(start?.update.sessionUpdate === "compaction");
    const oldTaskId = start.update.id;
    await subject.prompt("/compact", "new-manual-head");
    const beforeLate = await savedEntries(subject.backend, subject.opened.sessionId);
    const newest = beforeLate.filter((entry) => entry.kind === "pi.compaction").at(-1);
    assert.ok(newest && JSON.stringify(newest).includes("NEW_EFFECTIVE_SUMMARY"));
    if (process.env.PI_COMPACTION_PHASE === "crash") {
      // 在真实任务结局之后、显示记录追加之前退出，验证重开只补事实而不再次请求摘要。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      NodeExecutionEnv.prototype.appendFile = async function (
        this: NodeExecutionEnv,
        ...args: Parameters<NodeExecutionEnv["appendFile"]>
      ): ReturnType<NodeExecutionEnv["appendFile"]> {
        const text = typeof args[1] === "string" ? args[1] : new TextDecoder().decode(args[1]);
        if (
          text.includes('"kind":"va.compaction"') &&
          text.includes(`"taskId":"${oldTaskId}"`) &&
          text.includes('"status":"skipped"')
        ) {
          await new Promise<void>((resolve) =>
            process.stdout.write(
              `${JSON.stringify({ status: "passed", phase: "crash", oldTaskId })}\n`,
              () => resolve()
            )
          );
          process.exit(0);
        }
        return Reflect.apply(append, this, args);
      };
    }
    let staleEnded!: () => void;
    const ended = new Promise<void>((resolve) => {
      staleEnded = resolve;
    });
    subject.backend.registerSessionHandler(subject.opened.sessionId, (event) => {
      subject.events.push(event);
      if (
        event.update.sessionUpdate === "compaction" &&
        event.update.id === oldTaskId &&
        event.update.status !== "in_progress"
      )
        staleEnded();
    });
    releaseOld(fauxAssistantMessage("STALE_OLD_SUMMARY"));
    await ended;
    const live = subject.events
      .filter(
        (event) => event.update.sessionUpdate === "compaction" && event.update.id === oldTaskId
      )
      .at(-1);
    assert.ok(live?.update.sessionUpdate === "compaction");
    assert.equal(live.update.status, "skipped");
    const afterLate = await savedEntries(subject.backend, subject.opened.sessionId);
    assert.equal(afterLate.filter((entry) => entry.kind === "pi.compaction").at(-1)?.id, newest.id);
    assert.ok(
      !JSON.stringify(afterLate.filter((entry) => entry.kind === "pi.compaction")).includes(
        "STALE_OLD_SUMMARY"
      )
    );
    let receivedContext = "";
    subject.faux.setResponses([
      (context) => {
        receivedContext = JSON.stringify(context.messages);
        return fauxAssistantMessage("使用最新摘要继续");
      },
    ]);
    await subject.prompt("使用最新上下文回答", "after-stale");
    assert.ok(receivedContext.includes("NEW_EFFECTIVE_SUMMARY"));
    assert.ok(!receivedContext.includes("STALE_OLD_SUMMARY"));
    assert.ok(receivedContext.includes("新上下文:"));
    const saved = await savedEntries(subject.backend, subject.opened.sessionId);
    assert.ok(
      saved.some(
        (entry) =>
          entry.kind === "va.compaction" &&
          entry.data?.taskId === oldTaskId &&
          entry.data.status === "skipped"
      ),
      "the real stale task/submission outcome must persist as skipped for cold reopen"
    );
    await subject.backend.shutdown();
    const calls = subject.faux.state.callCount;
    reopened = new PiBackendProcess(subject.options);
    await reopened.start();
    const replay: SessionEvent[] = [];
    reopened.registerSessionHandler(subject.opened.sessionId, (event) => replay.push(event));
    await reopened.loadSession({ sessionId: subject.opened.sessionId, cwd: subject.vaultRoot });
    assert.ok(
      replay.some(
        (event) =>
          event.update.sessionUpdate === "session_projection" &&
          event.update.projection.messages.some((message) =>
            message.parts?.some(
              (part) =>
                part.kind === "compaction" && part.id === oldTaskId && part.status === "skipped"
            )
          )
      )
    );
    assert.equal(subject.faux.state.callCount, calls);
    return { oldTaskId, summaries };
  } finally {
    NodeExecutionEnv.prototype.appendFile = append;
    releaseOld(fauxAssistantMessage("停止后的迟到摘要"));
    await reopened?.shutdown();
    await subject.backend.shutdown();
  }
}

export async function runCompactionBoundaryRuntimeScenario(directory: string) {
  if (process.env.PI_COMPACTION_PHASE === "crash") return stale(directory);
  const overflowResult = await overflow(path.join(directory, "overflow"));
  const staleResult = await stale(path.join(directory, "stale"));
  const crashDirectory = path.join(directory, "after-task-before-display");
  const output = childProcess.execFileSync(process.execPath, [process.argv[1], crashDirectory], {
    env: { ...process.env, PI_COMPACTION_PHASE: "crash" },
    encoding: "utf8",
    timeout: 30_000,
  });
  const crashed = JSON.parse(output.trim().split("\n").at(-1)!) as {
    status: string;
    phase: string;
    oldTaskId: string;
  };
  assert.equal(crashed.status, "passed");
  assert.equal(crashed.phase, "crash");
  const recovered = await fixture(crashDirectory, true);
  try {
    assert.equal(recovered.faux.state.callCount, 0);
    const entries = await savedEntries(recovered.backend, recovered.opened.sessionId);
    assert.ok(
      entries.some(
        (entry) =>
          entry.kind === "va.compaction" &&
          entry.data?.taskId === crashed.oldTaskId &&
          entry.data.status === "skipped"
      ),
      "opening a crashed real store must complete the missing display receipt from task/submission facts without a model call"
    );
  } finally {
    await recovered.backend.shutdown();
  }
  return {
    status: "passed",
    checks: [
      "SC-P08-T05-01-stale-summary-rejected-and-skipped-persists",
      "SC-P08-T05-02-context-overflow-one-compaction-one-retry",
      "latest-summary-and-new-context-used-after-late-result",
      "cold-reopen-stale-row-without-provider",
      "crash-after-task-before-display-receipt-reconciles-without-provider",
    ],
    overflow: overflowResult,
    stale: staleResult,
  };
}
