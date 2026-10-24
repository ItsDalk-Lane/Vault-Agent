import type { App } from "obsidian";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type { SessionEvent } from "@/agentMode/session/types";
import type { VaultAgentSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runNativeMutationFailureRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  const externalRoot = path.join(directory, "external");
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.mkdir(externalRoot, { recursive: true });
  const target = path.join(await fs.realpath(externalRoot), "effect.md");
  await fs.writeFile(target, "before");
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
    agentMode: {
      activeBackend: "pi",
      backends: {
        pi: {
          hostExecutionMode: "strict",
          externalScopes: [{ root: externalRoot, permissions: ["read", "write"] }],
        },
      },
      skills: { folder: "skills" },
    },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: () => null,
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
        getVaultId: () => "native-mutation-failure",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  };
  let failReceipt = true;
  let loseWriteAcknowledgement = false;
  let writes = 0;
  const append = fs.appendFile;
  const writeFile: NodeExecutionEnv["writeFile"] = Reflect.get(
    NodeExecutionEnv.prototype,
    "writeFile"
  );
  fs.appendFile = async (file, data, ...rest) => {
    const content = typeof data === "string" ? data : String(data);
    if (
      failReceipt &&
      writes > 0 &&
      typeof file === "string" &&
      /doc-\d+\.jsonl$/.test(file) &&
      content.includes('"nativeJournal"') &&
      content.includes('"committed"')
    )
      throw Object.assign(new Error("injected native durable receipt failure"), { code: "EIO" });
    return append(file, data, ...rest);
  };
  NodeExecutionEnv.prototype.writeFile = async function (this: NodeExecutionEnv, file, ...args) {
    const result: Awaited<ReturnType<NodeExecutionEnv["writeFile"]>> = await writeFile.call(
      this,
      file,
      ...args
    );
    if (String(file) === target && result.ok) writes += 1;
    if (String(file) === target && result.ok && loseWriteAcknowledgement)
      return {
        ok: false,
        error: {
          name: "FileError",
          code: "unknown",
          message: "injected failure after real external write",
        },
      };
    return result;
  };
  let backend = new PiBackendProcess(options);
  const sessionId = "root-native-receipt-failure";
  const events: SessionEvent[] = [];
  try {
    await backend.start();
    await backend.newSession({ sessionId, cwd: vaultRoot });
    backend.registerSessionHandler(sessionId, (event) => events.push(event));
    backend.setPermissionPrompter(async () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("write", { path: target, content: "only once" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("this provider must never open after an uncertain native effect"),
    ]);
    await backend
      .prompt({
        sessionId,
        requestId: "native-receipt-write",
        prompt: [{ type: "text", text: "写入已授权的外部文件" }],
      })
      .catch(() => undefined);
    assert.equal(await fs.readFile(target, "utf8"), "only once");
    assert.equal(writes, 1, "the actual native effect must happen before receipt failure");
    assert.equal(
      faux.state.callCount,
      1,
      "an uncertain native receipt must close the real provider gate"
    );
    assert.ok(
      events.some(
        (event) =>
          event.update.sessionUpdate === "recovery_state" &&
          event.update.recovery.status === "storage_failed"
      )
    );
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, true);
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
        requestId: "native-blind-retry",
        prompt: [{ type: "text", text: "重试" }],
      })
    );
    assert.ok(
      (await backend.exportSession({ sessionId, format: "json" })).content.includes(
        "写入已授权的外部文件"
      )
    );
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, true);
    await assert.rejects(backend.recoverSession({ sessionId, action: "continue" }));
    assert.equal(writes, 1);
    assert.equal(faux.state.callCount, 1);
    assert.ok(
      (await backend.exportSession({ sessionId, format: "json" })).content.includes(
        "写入已授权的外部文件"
      )
    );
    await backend.shutdown();
    failReceipt = false;
    await fs.writeFile(target, "user changed while acknowledgement was unavailable");
    backend = new PiBackendProcess(options);
    await backend.start();
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, true);
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    assert.equal(
      (await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly,
      true,
      "a saved effect_unknown record must still block on the next open"
    );
    assert.equal(
      await fs.readFile(target, "utf8"),
      "user changed while acknowledgement was unavailable"
    );
    assert.equal(writes, 1);
    assert.equal(faux.state.callCount, 1);
    await backend.shutdown();
    await fs.writeFile(target, "only once");
    backend = new PiBackendProcess(options);
    await backend.start();
    backend.registerSessionHandler(sessionId, (event) => events.push(event));
    const reconciled = await backend.loadSession({ sessionId, cwd: vaultRoot });
    assert.equal(
      reconciled.state.readOnly,
      true,
      "three real interrupted opens must retain the crash-loop guard even after file reconciliation"
    );
    await backend.recoverSession({ sessionId, action: "abort" });
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, false);
    assert.equal(writes, 1);
    assert.equal(faux.state.callCount, 1);
    const lostAckSession = "root-native-ack-failure";
    await backend.newSession({ sessionId: lostAckSession, cwd: vaultRoot });
    backend.setPermissionPrompter(async () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    loseWriteAcknowledgement = true;
    const callsBeforeLostAck = faux.state.callCount;
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("write", { path: target, content: "landed before host failure" })],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("an acknowledged failure cannot permit another model call"),
    ]);
    await backend
      .prompt({
        sessionId: lostAckSession,
        requestId: "native-lost-ack",
        prompt: [{ type: "text", text: "核对丢失确认" }],
      })
      .catch(() => undefined);
    assert.equal(await fs.readFile(target, "utf8"), "landed before host failure");
    assert.equal(writes, 2);
    assert.equal(
      faux.state.callCount,
      callsBeforeLostAck + 1,
      "a host error after an actual native write must also stop the provider gate"
    );
    assert.equal(
      (await backend.loadSession({ sessionId: lostAckSession, cwd: vaultRoot })).state.readOnly,
      true
    );
    return {
      status: "passed",
      checks: [
        "actual_native_effect_once_receipt_failed",
        "live_native_unknown_closes_provider_and_new_turn",
        "native_unknown_reopen_readonly_and_exportable",
        "saved_native_effect_unknown_stays_blocking_without_overwrite",
        "native_receipt_reconciled_without_rewrite_or_model",
        "native_host_ack_failure_blocks_after_one_actual_write",
      ],
    };
  } finally {
    fs.appendFile = append;
    NodeExecutionEnv.prototype.writeFile = writeFile;
    await backend.shutdown();
  }
}
