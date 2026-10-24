import { requireNodeModule } from "@/utils/desktopRuntime";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { TFile, type App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";

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

export async function runSubagentResourcesRuntimeScenario(directory: string) {
  const assert: typeof import("node:assert/strict") =
    requireNodeModule<typeof import("node:assert/strict")>("node:assert/strict");
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
        displayName: "Fixture",
        apiKeyKeychainId: "fixture-key",
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: ["fixture-model", "fixture-child"].map((id) => ({
      configuredModelId: id,
      providerId: "fixture",
      info: { id, displayName: id, toolCall: true, limits: { context: 200_000, output: 4096 } },
      configuredAt: 1,
    })),
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: {
        pi: { defaultMode: "auto", enabledSubagentProfiles: ["researcher", "reviewer", "writer"] },
      },
    },
    backends: { pi: { enabledModels: ["fixture-model", "fixture-child"] } },
  } as unknown as VaultAgentSettings;
  const files = new Map<string, TFile>();
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: (target: string) => files.get(target) ?? null,
      getFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()],
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      process: async (file: TFile, transform: (content: string) => string) => {
        const content = transform(await fs.readFile(path.join(vaultRoot, file.path), "utf8"));
        await fs.writeFile(path.join(vaultRoot, file.path), content);
        file.stat.size = content.length;
        return content;
      },
      on: () => ({}),
      offref: () => undefined,
    },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
    workspace: { iterateAllLeaves: () => undefined },
  } as unknown as App;
  const faux = fauxProvider({ models: [{ id: "fixture-model" }, { id: "fixture-child" }] });
  const options = {
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "subagent-fixture",
        getSecretById: (id: string) => (id === "fixture-key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  };
  let firstLevelReady!: () => void;
  const firstLevelGate = new Promise<void>((resolve) => {
    firstLevelReady = resolve;
  });
  let firstLevelCalls = 0;
  let leafCalls = 0;
  let parentAnswers = 0;
  let nestedRootCalls = 0;
  faux.setResponses(
    Array.from({ length: 40 }, () => async (context, _request, _state, model) => {
      if (model.id === "fixture-model") {
        nestedRootCalls += 1;
        return nestedRootCalls === 1
          ? fauxAssistantMessage(
              [1, 2, 3].map((index) =>
                fauxToolCall(
                  "start_background_task",
                  {
                    profileId: "researcher",
                    task: `parent-${index}`,
                    description: `First level ${index}`,
                    modelKey: "fixture-child",
                    commandId: `nested-parent-${index}`,
                  },
                  { id: `parent-${index}` }
                )
              ),
              { stopReason: "toolUse" }
            )
          : fauxAssistantMessage("all nested children verified");
      }
      const transcript = JSON.stringify(context.messages);
      if (context.messages.some((message) => message.role === "toolResult")) {
        parentAnswers += 1;
        return fauxAssistantMessage("parent verified its leaf");
      }
      if (transcript.includes("leaf-task-")) {
        leafCalls += 1;
        return fauxAssistantMessage(`leaf-answer-${leafCalls}`);
      }
      firstLevelCalls += 1;
      if (firstLevelCalls === 3) firstLevelReady();
      await firstLevelGate;
      return fauxAssistantMessage(
        [
          fauxToolCall("delegate_task", {
            profileId: "researcher",
            task: `leaf-task-${firstLevelCalls}`,
            description: "Second level leaf",
            modelKey: "fixture-child",
          }),
        ],
        { stopReason: "toolUse" }
      );
    })
  );
  const nestedBackend = new PiBackendProcess(options);
  let backgroundSettled!: () => void;
  const nestedSettled = new Promise<void>((resolve) => {
    backgroundSettled = resolve;
  });
  try {
    await nestedBackend.start();
    const nested = await nestedBackend.newSession({
      sessionId: "root-nested-three",
      cwd: vaultRoot,
    });
    await nestedBackend.setSessionModel({ sessionId: nested.sessionId, modelId: "fixture-model" });
    nestedBackend.registerSessionHandler(nested.sessionId, (event) => {
      if (
        event.update.sessionUpdate === "session_projection" &&
        event.update.projection.activeBackgroundTaskIds?.length === 0 &&
        parentAnswers === 3
      )
        backgroundSettled();
    });
    await nestedBackend.prompt({
      sessionId: nested.sessionId,
      requestId: "nested-three",
      prompt: [
        { type: "text", text: "Delegate three independent parents that each wait for a leaf." },
      ],
    });
    await nestedSettled;
    assert.equal(firstLevelCalls, 3);
    assert.equal(
      leafCalls,
      3,
      "all three waiting parents must release their slots for nested leaves"
    );
    assert.equal(nestedRootCalls, 2);
  } finally {
    await nestedBackend.shutdown();
  }

  let stopParents = 0;
  let stopLeaves = 0;
  let stoppedLeaves = 0;
  let stopRootCalls = 0;
  let leavesStarted!: () => void;
  const allLeaves = new Promise<void>((resolve) => {
    leavesStarted = resolve;
  });
  faux.setResponses(
    Array.from({ length: 40 }, () => async (context, request, _state, model) => {
      if (model.id === "fixture-model") {
        stopRootCalls += 1;
        return stopRootCalls === 1
          ? fauxAssistantMessage(
              [1, 2, 3].map((index) =>
                fauxToolCall("start_background_task", {
                  profileId: "researcher",
                  task: `stop-parent-${index}`,
                  description: "Waiting parent",
                  modelKey: "fixture-child",
                  commandId: `stop-parent-${index}`,
                })
              ),
              { stopReason: "toolUse" }
            )
          : fauxAssistantMessage("root input ended; nested children remain active");
      }
      if (JSON.stringify(context.messages).includes("stop-leaf-")) {
        stopLeaves += 1;
        return new Promise<never>((_resolve, reject) => {
          const signal = request?.signal;
          assert.ok(signal);
          const abort = () => {
            stoppedLeaves += 1;
            reject(new Error("nested leaf stopped"));
          };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          if (stopLeaves === 3) leavesStarted();
        });
      }
      stopParents += 1;
      return fauxAssistantMessage(
        [
          fauxToolCall("delegate_task", {
            profileId: "researcher",
            task: `stop-leaf-${stopParents}`,
            description: "Wait for tree stop",
            modelKey: "fixture-child",
          }),
        ],
        { stopReason: "toolUse" }
      );
    })
  );
  const nestedStopBackend = new PiBackendProcess(options);
  const stopId = "root-stop-waiting-parents";
  try {
    await nestedStopBackend.start();
    await nestedStopBackend.newSession({ sessionId: stopId, cwd: vaultRoot });
    await nestedStopBackend.setSessionModel({ sessionId: stopId, modelId: "fixture-model" });
    await nestedStopBackend.prompt({
      sessionId: stopId,
      requestId: "nested-stop",
      prompt: [
        {
          type: "text",
          text: "Start three waiting parents and stop the entire tree while their leaves run.",
        },
      ],
    });
    await allLeaves;
    const beforeStop = faux.state.callCount;
    await nestedStopBackend.cancel({ sessionId: stopId });
    assert.equal(stopParents, 3);
    assert.equal(
      stoppedLeaves,
      3,
      "tree stop must abort every leaf while each parent has yielded its slot"
    );
    assert.equal(faux.state.callCount, beforeStop);
    await nestedStopBackend.closeSession({ sessionId: stopId });
    await nestedStopBackend.loadSession({ sessionId: stopId, cwd: vaultRoot });
    assert.equal(
      faux.state.callCount,
      beforeStop,
      "cold opening stopped waiting parents must not create another request"
    );
  } finally {
    await nestedStopBackend.shutdown();
  }

  let longChildCalls = 0;
  let longParentCalls = 0;
  faux.setResponses(
    Array.from({ length: 50 }, () => (_context, _request, _state, model) => {
      if (model.id === "fixture-model") {
        longParentCalls += 1;
        return longParentCalls === 1
          ? fauxAssistantMessage(
              [
                fauxToolCall("delegate_task", {
                  profileId: "researcher",
                  task: "Read each requested range and retain the original child through budget pause.",
                  description: "Shared root budget continuation",
                  modelKey: "fixture-child",
                }),
              ],
              { stopReason: "toolUse" }
            )
          : fauxAssistantMessage("parent received long-child-completed");
      }
      longChildCalls += 1;
      return longChildCalls <= 34
        ? fauxAssistantMessage(
            [fauxToolCall("vault_search", { query: `range-${longChildCalls}` })],
            { stopReason: "toolUse" }
          )
        : fauxAssistantMessage("long-child-completed");
    })
  );
  const longId = "root-long-child-budget";
  let longBackend = new PiBackendProcess(options);
  const longBefore = faux.state.callCount;
  let budgetPaused!: () => void;
  const longPaused = new Promise<void>((resolve) => {
    budgetPaused = resolve;
  });
  try {
    await longBackend.start();
    await longBackend.newSession({ sessionId: longId, cwd: vaultRoot });
    await longBackend.setSessionModel({ sessionId: longId, modelId: "fixture-model" });
    longBackend.registerSessionHandler(longId, (event) => {
      if (
        event.update.sessionUpdate === "recovery_state" &&
        event.update.recovery.status === "available" &&
        event.update.recovery.message?.includes("32")
      )
        budgetPaused();
    });
    const result = await longBackend.prompt({
      sessionId: longId,
      requestId: "long-child",
      prompt: [
        {
          type: "text",
          text: "Read all ranges using one child; continue after shared budget pause.",
        },
      ],
    });
    assert.equal(result.stopReason, "max_turn_requests");
    await longPaused;
    assert.equal(faux.state.callCount - longBefore, 32);
    assert.equal(
      longChildCalls,
      31,
      "the same child must pass sixteen requests before shared-budget pause"
    );
    await longBackend.shutdown();
    longBackend = new PiBackendProcess(options);
    await longBackend.start();
    await longBackend.loadSession({ sessionId: longId, cwd: vaultRoot });
    assert.equal(faux.state.callCount - longBefore, 32, "cold opening must not restart a child");
    await longBackend.recoverSession({ sessionId: longId, action: "continue" });
    assert.equal(longChildCalls, 35);
    assert.equal(longParentCalls, 2, "resuming a child must not create another parent input");
    const exported = await longBackend.exportSession({ sessionId: longId, format: "json" });
    assert.ok(exported.content.includes("long-child-completed"));
    const stored = JSON.parse(exported.content) as DiagnosticExport;
    assert.equal(
      stored.session.extras.entries.filter((entry) => entry.kind === "va.budget").length,
      37
    );
    await longBackend.closeSession({ sessionId: longId });
    await longBackend.loadSession({ sessionId: longId, cwd: vaultRoot });
    assert.equal(faux.state.callCount - longBefore, 37);
  } finally {
    await longBackend.shutdown();
  }
  return {
    status: "passed",
    scenario: "production-subagent-resources",
    nestedThreeParents: { firstLevelCalls, leafCalls, sharedSlots: true },
    stoppedWaitingParents: {
      parents: stopParents,
      leaves: stopLeaves,
      aborted: stoppedLeaves,
      coldDispatches: 0,
    },
    longChildBudget: {
      childCalls: longChildCalls,
      parentCalls: longParentCalls,
      coldDispatches: 0,
      totalRequests: 37,
    },
  };
}
