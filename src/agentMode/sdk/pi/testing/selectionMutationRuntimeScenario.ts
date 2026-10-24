import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
  Harness,
  ToolTask,
  defineExtension,
  hook,
  type Registry,
} from "@earendil-works/pi-durable";
import type { PermissionDecision, PermissionPrompt, SessionEvent } from "@/agentMode/session/types";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function runSelectionMutationRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const target = "selection.md";
  const before = "# note\n颜色：紫色\n手工保留\n";
  const after = before.replace("紫色", "蓝色");
  const absolute = path.join(vaultRoot, target);
  await fs.writeFile(absolute, before);
  const file = Object.assign(new TFile(), {
    path: target,
    extension: "md",
    stat: { size: before.length },
  });
  const state = { content: before, from: 3, to: 5, visible: true };
  const secondary = { content: before, visible: false };
  let writes = 0;
  let directEditorWrites = 0;
  let beforeCas: (() => void | Promise<void>) | undefined;
  let afterProcess: (() => void) | undefined;
  let failReceipt = false;
  const leaf = {
    view: {
      file,
      editor: {
        getValue: () => state.content,
        getCursor: (which: "from" | "to") => ({
          line: 1,
          ch: which === "from" ? state.from : state.to,
        }),
        replaceRange: (text: string) => {
          directEditorWrites += 1;
          state.content = state.content.replace("紫色", text);
        },
      },
    },
  } as unknown as WorkspaceLeaf;
  const otherLeaf = {
    view: {
      file,
      editor: {
        getValue: () => secondary.content,
        getCursor: () => ({ line: 1, ch: 3 }),
        replaceRange: () => {
          directEditorWrites += 1;
        },
      },
    },
  } as unknown as WorkspaceLeaf;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: (name: string) => (name === target ? file : null),
      getFiles: () => [file],
      getMarkdownFiles: () => [file],
      read: () => fs.readFile(absolute, "utf8"),
      process: async (_file: TFile, update: (current: string) => string) => {
        await beforeCas?.();
        const current = await fs.readFile(absolute, "utf8");
        const next = update(current);
        await fs.writeFile(absolute, next);
        writes += 1;
        state.content = next;
        afterProcess?.();
      },
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {
      iterateAllLeaves: (visit: (leaf: WorkspaceLeaf) => void) => {
        if (state.visible) visit(leaf);
        if (secondary.visible) visit(otherLeaf);
      },
    },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
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
        info: { id: "model", toolCall: true, limits: { context: 200_000, output: 4096 } },
        configuredAt: 1,
      },
    ],
    agentMode: { activeBackend: "pi", backends: {}, skills: { folder: "skills" } },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const faux = fauxProvider();
  const host = {
    app,
    keychain: {
      isAvailable: () => true,
      getVaultId: () => "selection-mutation",
      getSecretById: (id: string) => (id === "key" ? "test-key" : null),
      setSecretById: () => undefined,
      deleteSecretById: () => undefined,
    },
    getSettings: () => settings,
    privateRoot: path.join(directory, "private"),
    streamsFactory: () => faux.provider,
  };
  const sessionId = "root-selection-mutation";
  let backend = new PiBackendProcess({ host });
  const events: SessionEvent[] = [];
  const permissions: PermissionPrompt[] = [];
  const allow = async (prompt: PermissionPrompt): Promise<PermissionDecision> => {
    permissions.push(prompt);
    return { outcome: { outcome: "selected", optionId: "allow_once" } };
  };
  const append = fs.appendFile;
  const harnessOpenDescriptor = Object.getOwnPropertyDescriptor(Harness, "open")!;
  const openHarness: typeof Harness.open = Harness.open.bind(Harness);
  const selectionSignals: AbortSignal[] = [];
  Harness.open = async (storage, options, context) => {
    // 临时审批窗口的撤销不等于工具取消；用公开执行钩子观察真实 CAS 所属任务信号。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    (options.registry as unknown as Registry).install(
      defineExtension({
        name: "selection-cancellation-observer",
        hooks: [
          hook(ToolTask, {
            beforeTool: (call, _api, toolContext) => {
              if (call.name === "obsidian_replace_selection" && toolContext.abortSignal)
                selectionSignals.push(toolContext.abortSignal);
              return undefined;
            },
          }),
        ],
      })
    );
    return openHarness(storage, options, context);
  };
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
  const replace = async (requestId: string) => {
    let lastResult: {
      ok?: boolean;
      code?: string;
      receipt?: { operationId: string; committed: boolean };
    } = {};
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("obsidian_get_selection", {})], { stopReason: "toolUse" }),
      (context) => {
        const result = context.messages.findLast((message) => message.role === "toolResult");
        assert.ok(result && result.role === "toolResult");
        const text = result.content.find(
          (part) => part.type === "text" && part.text.startsWith("{")
        );
        assert.ok(text && text.type === "text");
        assert.ok(
          result.content.some(
            (part) => part.type === "text" && part.text.startsWith("<host-tool-outcome>")
          ),
          "the model must also receive trusted operation metadata separately from the JSON body"
        );
        const selected = JSON.parse(text.text) as { ok: boolean; selectionToken: string };
        assert.equal(selected.ok, true);
        return fauxAssistantMessage(
          [
            fauxToolCall("obsidian_replace_selection", {
              selectionToken: selected.selectionToken,
              text: "蓝色",
            }),
          ],
          { stopReason: "toolUse" }
        );
      },
      (context) => {
        const result = context.messages.findLast((message) => message.role === "toolResult");
        assert.ok(result && result.role === "toolResult");
        const body = result.content.find(
          (part) => part.type === "text" && part.text.startsWith("{")
        );
        assert.ok(body && body.type === "text");
        assert.ok(
          result.content.some(
            (part) => part.type === "text" && part.text.startsWith("<host-tool-outcome>")
          )
        );
        lastResult = JSON.parse(body.text) as typeof lastResult;
        return fauxAssistantMessage("选区工具已返回真实结果。");
      },
    ]);
    await backend
      .prompt({
        sessionId,
        requestId,
        prompt: [{ type: "text", text: "读取真实选区并替换，使用独立写入审批" }],
      })
      .catch(() => undefined);
    return lastResult;
  };
  const open = async (fresh = false) => {
    backend.setPermissionPrompter(allow);
    await backend.start();
    backend.registerSessionHandler(sessionId, (event) => events.push(event));
    return fresh
      ? backend.newSession({ sessionId, cwd: vaultRoot })
      : backend.loadSession({ sessionId, cwd: vaultRoot });
  };
  const receiptIds = async () => {
    const exported = JSON.parse(
      (await backend.exportSession({ sessionId, format: "json" })).content
    ) as {
      session: {
        extras: {
          entries: {
            kind: string;
            data?: { operationId?: string; fileChanges?: { mutationOperationIds?: string[] }[] };
          }[];
        };
      };
    };
    return exported.session.extras.entries
      .filter((entry) => entry.kind === "va.mutation")
      .flatMap(
        (entry) =>
          entry.data?.fileChanges?.flatMap((change) => change.mutationOperationIds ?? []) ?? []
      );
  };
  try {
    await open(true);
    const changed = await replace("selection-with-receipt");
    assert.equal(
      writes,
      1,
      "selection replacement must write through the actual Vault.process adapter"
    );
    assert.equal(directEditorWrites, 0);
    assert.equal(await fs.readFile(absolute, "utf8"), after);
    assert.equal(state.content, after);
    assert.equal(changed.ok, true);
    assert.equal(changed.receipt?.committed, true);
    const operationId = changed.receipt?.operationId;
    assert.ok(operationId);
    assert.deepEqual(await receiptIds(), [operationId]);
    assert.deepEqual(permissions[0].binding?.targets, [target]);
    assert.ok(
      permissions[0].toolCall.content?.some(
        (part) => part.type === "diff" && part.oldText === before && part.newText === after
      )
    );
    const calls = faux.state.callCount;
    await backend.shutdown();
    backend = new PiBackendProcess({ host });
    await open();
    assert.equal(faux.state.callCount, calls);
    assert.equal(writes, 1);
    assert.deepEqual(await receiptIds(), [operationId]);
    await backend.setSessionMode({ sessionId, modeId: "auto" });
    const approvalsBeforeRevert = permissions.length;
    assert.deepEqual(await backend.revertFileChange({ sessionId, operationIds: [operationId] }), {
      ok: true,
    });
    assert.equal(
      permissions.length,
      approvalsBeforeRevert + 1,
      "Auto still requires a fresh explicit rollback approval"
    );
    assert.equal(await fs.readFile(absolute, "utf8"), before);
    assert.equal(state.content, before);
    assert.equal(writes, 2);
    await backend.revertFileChange({ sessionId, operationIds: [operationId] });
    assert.equal(writes, 2);
    await backend.setSessionMode({ sessionId, modeId: "default" });
    secondary.visible = true;
    secondary.content = `${before}另一个编辑窗口尚未保存`;
    assert.equal(
      (await replace("selection-other-unsaved-editor")).ok,
      false,
      "a saved target editor cannot bypass another unsaved editor of the same note"
    );
    assert.equal(writes, 2);
    assert.equal(await fs.readFile(absolute, "utf8"), before);
    assert.equal(secondary.content, `${before}另一个编辑窗口尚未保存`);
    secondary.visible = false;
    for (const race of ["buffer", "range", "leaf", "disk"] as const) {
      state.content = before;
      state.from = 3;
      state.to = 5;
      state.visible = true;
      await fs.writeFile(absolute, before);
      beforeCas = async () => {
        beforeCas = undefined;
        if (race === "buffer") state.content = `${before}用户稍后输入`;
        if (race === "range") state.to = 4;
        if (race === "leaf") state.visible = false;
        if (race === "disk") await fs.writeFile(absolute, `${before}用户稍后保存`);
      };
      const failed = await replace(`selection-race-${race}`);
      assert.equal(
        failed.ok,
        false,
        `${race} changes at the actual CAS boundary must refuse the stale selection`
      );
      assert.equal(writes, 2);
      assert.equal(
        await fs.readFile(absolute, "utf8"),
        race === "disk" ? `${before}用户稍后保存` : before
      );
      if (race === "buffer") assert.equal(state.content, `${before}用户稍后输入`);
    }
    state.visible = true;
    state.from = 3;
    state.to = 5;
    state.content = `${before}尚未保存`;
    await fs.writeFile(absolute, before);
    assert.equal((await replace("selection-unsaved-buffer")).ok, false);
    assert.equal(await fs.readFile(absolute, "utf8"), before);
    assert.equal(state.content, `${before}尚未保存`);
    assert.equal(writes, 2);
    state.content = before;
    const atCas = deferred<void>();
    const releaseCas = deferred<void>();
    const aborted = deferred<void>();
    const signalsBeforeStop = selectionSignals.length;
    beforeCas = () => {
      atCas.resolve();
      return releaseCas.promise;
    };
    const stopping = replace("selection-stop-at-cas");
    await atCas.promise;
    assert.equal(selectionSignals.length, signalsBeforeStop + 1);
    const selectionSignal = selectionSignals.at(-1);
    assert.ok(selectionSignal, "the real selection ToolTask must reach the CAS boundary");
    assert.equal(
      selectionSignal.aborted,
      false,
      "normal approval withdrawal must not cancel the tool"
    );
    selectionSignal.addEventListener("abort", () => aborted.resolve(), { once: true });
    const cancelling = backend.cancel({ sessionId });
    await aborted.promise;
    releaseCas.resolve();
    await Promise.all([stopping, cancelling]);
    beforeCas = undefined;
    assert.equal(writes, 2);
    assert.equal(await fs.readFile(absolute, "utf8"), before);
    const stoppedId = permissions.at(-1)?.toolCall.toolCallId;
    assert.ok(stoppedId);
    assert.equal((await receiptIds()).includes(stoppedId), false);
    const beforeStopOpen = faux.state.callCount;
    await backend.shutdown();
    backend = new PiBackendProcess({ host });
    await open();
    assert.equal(writes, 2);
    assert.equal(faux.state.callCount, beforeStopOpen);
    assert.equal((await receiptIds()).includes(stoppedId), false);
    afterProcess = () => {
      afterProcess = undefined;
      throw new Error("selection host acknowledgement lost after actual write");
    };
    const beforeAck = faux.state.callCount;
    await replace("selection-lost-host-ack");
    assert.equal(writes, 3);
    assert.equal(await fs.readFile(absolute, "utf8"), after);
    assert.equal(
      faux.state.callCount,
      beforeAck + 2,
      "the actual write's unknown outcome must block the next provider request"
    );
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, true);
    const unknownOperationId = events
      .flatMap((event) =>
        event.update.sessionUpdate === "recovery_state"
          ? event.update.recovery.pendingMutationIds
          : []
      )
      .at(-1);
    assert.ok(unknownOperationId);
    await backend.shutdown();
    backend = new PiBackendProcess({ host });
    await open();
    assert.equal(faux.state.callCount, beforeAck + 2);
    assert.equal(writes, 3);
    assert.equal((await receiptIds()).filter((id) => id === unknownOperationId).length, 1);
    assert.deepEqual(
      await backend.revertFileChange({ sessionId, operationIds: [unknownOperationId] }),
      { ok: true }
    );
    assert.equal(writes, 4);
    assert.equal(await fs.readFile(absolute, "utf8"), before);
    afterProcess = () => {
      failReceipt = true;
    };
    const beforeReceipt = faux.state.callCount;
    await replace("selection-lost-receipt");
    afterProcess = undefined;
    assert.equal(writes, 5);
    assert.equal(await fs.readFile(absolute, "utf8"), after);
    assert.equal(faux.state.callCount, beforeReceipt + 2);
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, true);
    const receiptOperationId = events
      .flatMap((event) =>
        event.update.sessionUpdate === "recovery_state"
          ? event.update.recovery.pendingMutationIds
          : []
      )
      .at(-1);
    assert.ok(receiptOperationId);
    await backend.shutdown();
    failReceipt = false;
    backend = new PiBackendProcess({ host });
    await open();
    assert.equal(writes, 5);
    assert.equal(faux.state.callCount, beforeReceipt + 2);
    assert.equal((await receiptIds()).filter((id) => id === receiptOperationId).length, 1);
    assert.equal(directEditorWrites, 0);
    return {
      status: "passed",
      checks: [
        "actual_selection_write_uses_vault_cas_and_committed_receipt",
        "cold_reopen_keeps_same_receipt_without_model_or_rewrite",
        "auto_rollback_requires_new_approval_and_restores_original_content",
        "cas_rechecks_leaf_range_full_buffer_and_disk_baseline",
        "unsaved_buffer_is_not_overwritten",
        "another_unsaved_editor_blocks_selection_disk_write",
        "stop_at_actual_cas_and_reopen_never_apply_stale_operation",
        "lost_host_ack_blocks_dispatch_and_reconciles_same_receipt_without_write",
        "lost_receipt_blocks_dispatch_and_reopen_preserves_original_operation_id",
      ],
      fileWrites: writes,
      directEditorWrites,
    };
  } finally {
    Object.defineProperty(Harness, "open", harnessOpenDescriptor);
    fs.appendFile = append;
    await backend.shutdown();
  }
}
