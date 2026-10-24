import { isSummaryRequest } from "@/agentMode/sdk/pi/testing/summaryRequest";
import { TFile, type App } from "obsidian";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { RunBudget } from "@/agentMode/sdk/pi/runtime/RunBudget";
import type { SessionEvent } from "@/agentMode/session/types";
import type { VaultAgentSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runMutationFailureRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const files = new Map<string, TFile>();
  let writes = 0;
  let failReceipt = false;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: (target: string) => files.get(target) ?? null,
      getFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()],
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      create: async (target: string, content: string) => {
        writes += 1;
        await fs.writeFile(path.join(vaultRoot, target), content, { flag: "wx" });
        const file = Object.assign(new TFile(), {
          path: target,
          extension: "md",
          stat: { size: content.length },
        });
        files.set(target, file);
        failReceipt = true;
        return file;
      },
      on: () => ({}),
      offref: () => undefined,
    },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
    workspace: { iterateAllLeaves: () => undefined },
  } as unknown as App;
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
        info: { id: "model", toolCall: true, limits: { context: 8192, output: 1024 } },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      backends: { pi: { defaultMode: "auto" } },
      skills: { folder: "skills" },
    },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const faux = fauxProvider();
  const summaryStream = () => {
    const message = fauxAssistantMessage(
      "Keep the original goal and confirmed tool results. Pending operations require reconciliation before further effects."
    );
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  const options = {
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "mutation-failure",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => ({
        stream: (
          model: Parameters<typeof faux.provider.stream>[0],
          context: Parameters<typeof faux.provider.stream>[1],
          options: Parameters<typeof faux.provider.stream>[2]
        ) =>
          isSummaryRequest(context)
            ? summaryStream()
            : faux.provider.stream(model, context, options),
        streamSimple: (
          model: Parameters<typeof faux.provider.streamSimple>[0],
          context: Parameters<typeof faux.provider.streamSimple>[1],
          options: Parameters<typeof faux.provider.streamSimple>[2]
        ) =>
          isSummaryRequest(context)
            ? summaryStream()
            : faux.provider.streamSimple(model, context, options),
      }),
    },
  };
  const append = fs.appendFile;
  fs.appendFile = async (file, data, options) => {
    const content = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (
      failReceipt &&
      typeof file === "string" &&
      /doc-\d+\.jsonl$/.test(file) &&
      (content.includes('"committed":true') || content.includes('"committed"],true'))
    ) {
      throw Object.assign(new Error("injected actual Durable mutation receipt failure"), {
        code: "EIO",
      });
    }
    return append(file, data, options);
  };
  let backend = new PiBackendProcess(options);
  const reserve = Reflect.get(RunBudget.prototype, "reserve");
  let releaseReserve = (): void => undefined;
  const events: SessionEvent[] = [];
  const sessionId = "root-receipt-failure";
  try {
    await backend.start();
    await backend.newSession({ sessionId, cwd: vaultRoot });
    backend.registerSessionHandler(sessionId, (event) => events.push(event));
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("vault_create", { path: "effect.md", content: "只允许写入一次" })],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("不应该在副作用待核对时继续请求此回答"),
    ]);
    const promptFailure = await backend
      .prompt({
        sessionId,
        requestId: "receipt-write",
        prompt: [{ type: "text", text: "创建笔记" }],
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    assert.equal(
      writes,
      1,
      `the real host must reach its effect before fault injection: ${String(promptFailure)}`
    );
    assert.equal(await fs.readFile(path.join(vaultRoot, "effect.md"), "utf8"), "只允许写入一次");
    assert.equal(
      faux.state.callCount,
      1,
      "an uncertain receipt must stop the next actual provider request"
    );
    assert.ok(
      events.some(
        (event) =>
          event.update.sessionUpdate === "recovery_state" &&
          event.update.recovery.status === "storage_failed"
      ),
      "a failed Durable receipt must expose the actual storage failure, not continue with a normal tool result"
    );
    const state = await backend.loadSession({ sessionId, cwd: vaultRoot });
    assert.equal(
      state.state.readOnly,
      true,
      "the live runtime must become read-only before another user turn"
    );
    assert.ok(
      events.some(
        (event) =>
          event.update.sessionUpdate === "recovery_state" &&
          event.update.recovery.pendingMutationIds.length === 1
      )
    );
    await assert.rejects(
      backend.prompt({
        sessionId,
        requestId: "blind-retry",
        prompt: [{ type: "text", text: "重试" }],
      })
    );
    assert.equal(faux.state.callCount, 1);
    assert.ok(
      (await backend.exportSession({ sessionId, format: "json" })).content.includes("创建笔记")
    );
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, true);
    assert.ok(
      (await backend.exportSession({ sessionId, format: "json" })).content.includes("创建笔记")
    );
    assert.equal(writes, 1);
    assert.equal(faux.state.callCount, 1);
    await backend.shutdown();
    failReceipt = false;
    backend = new PiBackendProcess(options);
    await backend.start();
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, false);
    assert.equal(writes, 1);
    assert.equal(faux.state.callCount, 1);
    let reserveReached!: () => void;
    const reserveWaiting = new Promise<void>((resolve) => {
      reserveReached = resolve;
    });
    const heldReserve = new Promise<void>((resolve) => {
      releaseReserve = resolve;
    });
    // 保留真实预算提交与结果，仅在返回调度器前暂停，以复现另一工具此时丢失确认的竞态。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    RunBudget.prototype.reserve = async function (
      this: RunBudget,
      input: Parameters<RunBudget["reserve"]>[0]
    ): ReturnType<RunBudget["reserve"]> {
      const result = await Reflect.apply(reserve, this, [input]);
      if (input.purpose === "subagent") {
        reserveReached();
        await heldReserve;
      }
      return result;
    };
    const race = await backend.newSession({ sessionId: "root-deferred-receipt", cwd: vaultRoot });
    let childStatus: string | null = null;
    backend.registerSessionHandler(race.sessionId, (event) => {
      const update = event.update;
      if (
        update.sessionUpdate === "tool_call_update" &&
        update.vendorToolName === "Agent" &&
        update.rawInput &&
        typeof update.rawInput === "object" &&
        "childConversationId" in update.rawInput &&
        (update.status === "failed" || update.status === "completed")
      ) {
        childStatus = update.status;
      }
    });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("start_background_task", {
            profileId: "researcher",
            task: "核对资料",
            description: "预算等待中的子任务",
            modelKey: "saved",
            commandId: "deferred-child",
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("子任务已交给后台"),
    ]);
    const launch = backend.prompt({
      sessionId: race.sessionId,
      requestId: "launch-deferred-child",
      prompt: [{ type: "text", text: "后台核对" }],
    });
    await reserveWaiting;
    await launch;
    const callsBeforeEffect = faux.state.callCount;
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("vault_create", { path: "race.md", content: "预算等待期间的唯一写入" })],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("预算等待后不应打开的请求"),
    ]);
    await backend
      .prompt({
        sessionId: race.sessionId,
        requestId: "unknown-during-reserve",
        prompt: [{ type: "text", text: "创建另一笔记" }],
      })
      .catch(() => undefined);
    assert.equal(faux.state.callCount, callsBeforeEffect + 1);
    assert.equal(
      (await backend.loadSession({ sessionId: race.sessionId, cwd: vaultRoot })).state.readOnly,
      true
    );
    assert.equal(
      childStatus,
      null,
      "the real child must still be waiting at its committed budget boundary"
    );
    releaseReserve();
    await backend.shutdown();
    assert.notEqual(
      childStatus,
      "completed",
      "a failed authoritative store must not fabricate a completed child receipt"
    );
    assert.equal(
      faux.state.callCount,
      callsBeforeEffect + 1,
      "a provider admitted before a durable budget wait must be rechecked after another actual tool effect becomes unknown"
    );
    assert.equal(writes, 2);
    return {
      status: "passed",
      checks: [
        "actual_effect_once_receipt_write_failed",
        "live_runtime_readonly_before_next_provider_or_tool",
        "blind_retry_rejected",
        "failed_receipt_reopen_readonly_and_exportable",
        "reopen_completes_receipt_without_rewriting_or_provider",
        "unknown_during_deferred_budget_blocks_final_provider_open",
      ],
    };
  } finally {
    fs.appendFile = append;
    releaseReserve();
    RunBudget.prototype.reserve = reserve;
    await backend.shutdown();
  }
}
