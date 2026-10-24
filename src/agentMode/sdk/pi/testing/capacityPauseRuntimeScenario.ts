import { requireNodeModule } from "@/utils/desktopRuntime";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runCapacityPauseRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "capacity-vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        displayName: "Fixture",
        baseUrl: "http://127.0.0.1:9999/v1",
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
          limits: { context: 262144 },
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
  const fsSync = requireNodeModule<typeof import("node:fs")>("node:fs");
  const faux = fauxProvider();
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "capacity-fixture",
    getSecretById: (id: string) => (id === "fixture-key" ? "fixture-key" : null),
    setSecretById: () => undefined,
    deleteSecretById: () => undefined,
  };
  let actualWrites = 0;
  Object.assign(app.vault, {
    getAbstractFileByPath: () => null,
    create: async () => {
      actualWrites++;
      throw new Error("the storage gate should prevent this write");
    },
  });
  const privateRoot = path.join(directory, "private");
  const backend = new PiBackendProcess({
    host: {
      app,
      keychain,
      getSettings: () => settings,
      privateRoot,
      streamsFactory: () => faux.provider,
    },
  });
  const findStore = async (root: string, sessionId: string): Promise<string> => {
    const children = await fs.readdir(root, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const target = path.join(root, child.name);
      if (child.name === sessionId) return path.join(target, "store");
      try {
        return await findStore(target, sessionId);
      } catch {
        continue;
      }
    }
    throw new Error("no fixture store");
  };
  try {
    await backend.start();
    const sessionId = "root-capacity-model";
    await backend.newSession({ sessionId, cwd: vaultRoot });
    await backend.setSessionModel({ sessionId, modelId: "saved-model" });
    const store = await findStore(privateRoot, sessionId);
    await fs.writeFile(
      path.join(store, "fixture-capacity-padding.bin"),
      new Uint8Array(31 * 1024 * 1024)
    );
    let ready!: () => void;
    const paused = new Promise<void>((resolve) => {
      ready = resolve;
    });
    backend.registerSessionHandler(sessionId, (event) => {
      if (
        event.update.sessionUpdate === "recovery_state" &&
        event.update.recovery.interruptedRun?.status === "paused_storage"
      )
        ready();
    });
    const result = await backend.prompt({
      sessionId,
      requestId: "capacity-goal",
      prompt: [{ type: "text", text: "保留已完成结果，迁移记录后继续核对" }],
    });
    assert.equal(result.stopReason, "max_turn_requests");
    await paused;
    assert.equal(
      faux.state.callCount,
      0,
      "the finalization reserve must pause before a new request"
    );
    const next = await backend.rolloverSession({ sessionId });
    assert.notEqual(next.sessionId, sessionId);
    faux.setResponses([fauxAssistantMessage("已在新记录继续原有目标")]);
    await backend.prompt({
      sessionId: next.sessionId,
      requestId: "continue-capacity",
      prompt: [{ type: "text", text: "继续原有目标" }],
    });
    assert.equal(faux.state.callCount, 1);
    assert.equal((await backend.loadSession({ sessionId, cwd: vaultRoot })).state.readOnly, true);
    const writeRoot = "root-capacity-write";
    await backend.newSession({ sessionId: writeRoot, cwd: vaultRoot });
    await backend.setSessionModel({ sessionId: writeRoot, modelId: "saved-model" });
    await backend.setSessionMode({ sessionId: writeRoot, modeId: "auto" });
    const writeStore = await findStore(privateRoot, writeRoot);
    faux.setResponses([
      () => {
        fsSync.writeFileSync(
          path.join(writeStore, "fixture-capacity-padding.bin"),
          new Uint8Array(31 * 1024 * 1024)
        );
        return fauxAssistantMessage(
          [fauxToolCall("vault_create", { path: "new.md", content: "must not be written" })],
          { stopReason: "toolUse" }
        );
      },
    ]);
    let writeReady!: () => void;
    const writePaused = new Promise<void>((resolve) => {
      writeReady = resolve;
    });
    backend.registerSessionHandler(writeRoot, (event) => {
      if (
        event.update.sessionUpdate === "recovery_state" &&
        event.update.recovery.interruptedRun?.status === "paused_storage"
      )
        writeReady();
    });
    assert.equal(
      (
        await backend.prompt({
          sessionId: writeRoot,
          requestId: "write-capacity",
          prompt: [{ type: "text", text: "创建文件" }],
        })
      ).stopReason,
      "max_turn_requests"
    );
    await writePaused;
    assert.equal(
      actualWrites,
      0,
      "growth from the preceding model response must pause before host mutation"
    );
    return {
      status: "passed",
      checks: [
        "capacity_reserves_space_and_pauses_before_model",
        "explicit_rollover_preserves_goal_without_autorun",
        "old_store_remains_read_only",
        "growth_after_model_pauses_before_host_write",
      ],
      providerCalls: faux.state.callCount,
    };
  } finally {
    await backend.shutdown();
  }
}
