import { TFile, type App } from "obsidian";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { Conversation } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { PiRuntime } from "@/agentMode/sdk/pi/runtime/PiRuntime";
import { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import type { HostToolExecutionGate } from "@/agentMode/sdk/pi/tools/HostToolDefinition";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function runCheckpointToolBoundaryRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const files = new Map<string, TFile>();
  const checkpointStarted = deferred();
  const releaseCheckpoint = deferred();
  const ioAttempted = deferred();
  let checkpointHeld = false;
  let checkpointSaved = false;
  let checkpointIntercepted = false;
  let insideCreateGate = false;
  let boundaryWaits = 0;
  let writes = 0;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (target: string) => files.get(target) ?? null,
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      create: async (target: string, content: string) => {
        ioAttempted.resolve();
        assert.equal(checkpointSaved, true, "文件操作越过了尚未保存的工作检查点");
        await fs.writeFile(path.join(vaultRoot, target), content, { flag: "wx" });
        writes += 1;
        const file = Object.assign(new TFile(), {
          path: target,
          extension: "md",
          stat: { size: content.length },
        });
        files.set(target, file);
        return file;
      },
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: { iterateAllLeaves: () => undefined },
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
    agentMode: {
      activeBackend: "pi",
      backends: { pi: { defaultMode: "auto" } },
      skills: { folder: "skills" },
    },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const provider = fauxProvider();
  const backend = new PiBackendProcess({
    host: {
      app,
      privateRoot: path.join(directory, "private"),
      getSettings: () => settings,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "checkpoint-tool-boundary",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      streamsFactory: () => provider.provider,
    },
  });
  const originalCheckpoint = Reflect.get(PiRuntime.prototype, "checkpointWorkItem") as (
    ...args: unknown[]
  ) => Promise<void>;
  const originalGate = Object.getOwnPropertyDescriptor(
    CapabilityCatalog.prototype,
    "setExecutionGate"
  )!.value as CapabilityCatalog["setExecutionGate"];
  Reflect.set(
    PiRuntime.prototype,
    "checkpointWorkItem",
    async function (this: PiRuntime, ...args: unknown[]) {
      if (!checkpointIntercepted && args[2] === "committed_progress") {
        const owner = args[0] as { conversation: Conversation };
        const page = await owner.conversation.entries(
          { order: "descending" },
          100,
          undefined,
          BACKGROUND_CONTEXT
        );
        if (
          page.items.some(
            (entry) =>
              entry.kind === "va.state" &&
              entry.data &&
              typeof entry.data === "object" &&
              !Array.isArray(entry.data) &&
              entry.data.docKind === "va.todos"
          )
        ) {
          checkpointIntercepted = true;
          checkpointHeld = true;
          checkpointStarted.resolve();
          await releaseCheckpoint.promise;
          await Reflect.apply(originalCheckpoint, this, args);
          checkpointSaved = true;
          checkpointHeld = false;
          return;
        }
      }
      return Reflect.apply(originalCheckpoint, this, args);
    }
  );
  CapabilityCatalog.prototype.setExecutionGate = function (gate: HostToolExecutionGate) {
    originalGate.call(this, async (...args: Parameters<HostToolExecutionGate>) => {
      if (args[0] !== "vault_create") return gate(...args);
      await checkpointStarted.promise;
      insideCreateGate = true;
      try {
        return await gate(...args);
      } finally {
        insideCreateGate = false;
      }
    });
  };
  let execution: Promise<unknown> | undefined;
  let chains: Map<string, Promise<void>> | undefined;
  try {
    await backend.start();
    const sessionId = "root-checkpoint-tool-boundary";
    await backend.newSession({ sessionId, cwd: vaultRoot });
    const runtime = Reflect.get(backend, "runtime") as PiRuntime;
    chains = Reflect.get(runtime, "checkpointChains") as Map<string, Promise<void>>;
    const get: (key: string) => Promise<void> | undefined = chains.get.bind(chains);
    Object.defineProperty(chains, "get", {
      configurable: true,
      value: (key: string) => {
        const pending = get(key);
        // 只在真实下一工具读取检查点链时释放保存；实际 I/O 仍须等保存提交完成，不能用计时猜顺序。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (insideCreateGate && checkpointHeld && pending) {
          boundaryWaits += 1;
          releaseCheckpoint.resolve();
        }
        return pending;
      },
    });
    provider.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("todo_set", {
            expectedRevision: 0,
            items: [{ text: "保存进度后创建文件", status: "in_progress", priority: "high" }],
          }),
          fauxToolCall("vault_create", {
            path: "effect.md",
            content: "checkpoint committed first",
          }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("任务已完成"),
    ]);
    execution = backend
      .prompt({
        sessionId,
        requestId: "checkpoint-before-tool",
        prompt: [{ type: "text", text: "先记录待办，再创建文件。" }],
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    await Promise.race([ioAttempted.promise, execution]);
    assert.equal(checkpointSaved, true, "共同工具入口未等待实际工作检查点保存");
    assert.equal(await execution, null);
    assert.equal(writes, 1);
    assert.ok(boundaryWaits > 0);
    assert.equal(
      await fs.readFile(path.join(vaultRoot, "effect.md"), "utf8"),
      "checkpoint committed first"
    );
    assert.equal(provider.state.callCount, 2);
    return {
      status: "passed",
      checks: [
        "same_model_batch_todo_checkpoint_precedes_actual_file_write",
        "execution_gate_waits_actual_commit_without_self_deadlock",
      ],
      writes,
      providerCalls: provider.state.callCount,
    };
  } finally {
    releaseCheckpoint.resolve();
    await execution;
    if (chains) Reflect.deleteProperty(chains, "get");
    Reflect.set(PiRuntime.prototype, "checkpointWorkItem", originalCheckpoint);
    CapabilityCatalog.prototype.setExecutionGate = originalGate;
    await backend.shutdown();
  }
}
