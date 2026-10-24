import { TFile } from "obsidian";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { requireNodeModule } from "@/utils/desktopRuntime";
const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import {
  restoreUnsentRootInput,
  type UnsentRootInput,
} from "@/agentMode/sdk/pi/runtime/UnsentRootInput";
import { StoreLocator } from "@/agentMode/sdk/pi/storage/StoreLocator";
import { FanoutOrchestrator } from "@/agentMode/session/fanout/FanoutOrchestrator";
import { configuredFanoutModels } from "@/agentMode/session/fanout/answerers";

export async function runQueuedFanoutRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "fanout-vault");
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
    configuredModels: ["model-a", "model-b"].map((id) => ({
      configuredModelId: `saved-${id}`,
      providerId: "fixture",
      info: {
        id,
        displayName: id,
        toolCall: true,
        modalities: { input: ["text", "image"] },
        limits: { context: 128_000 },
      },
      configuredAt: 1,
    })),
    agentMode: {
      activeBackend: "pi",
      skills: { folder: "skills" },
      backends: {},
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["saved-model-a", "saved-model-b"] } },
  } as unknown as VaultAgentSettings;
  const fixtureFiles = new Map<string, TFile>();
  let beforeRead = async (_file: TFile) => {};
  const app = {
    vault: {
      configDir: ".fixture-config",
      adapter: { getBasePath: () => vaultRoot },
      getFiles: () => [...fixtureFiles.values()],
      getMarkdownFiles: () => [...fixtureFiles.values()],
      getAbstractFileByPath: (target: string) => fixtureFiles.get(target) ?? null,
      read: async (file: TFile) => {
        await beforeRead(file);
        return fs.readFile(path.join(vaultRoot, file.path), "utf8");
      },
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
  } as unknown as App;
  const secrets = new Map<string, string>([["fixture-key", "test-key"]]);
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "fanout-fixture",
    getSecretById: (id: string) => secrets.get(id) ?? null,
    setSecretById: (id: string, value: string) => {
      secrets.set(id, value);
    },
    deleteSecretById: (id: string) => {
      secrets.delete(id);
    },
  };
  const faux = fauxProvider();
  const calledModels: string[] = [];
  const contexts: string[] = [];
  faux.setResponses(
    Array.from({ length: 12 }, () => (_context, _options, _state, model) => {
      calledModels.push(model.id);
      contexts.push(JSON.stringify(_context));
      return fauxAssistantMessage(
        calledModels.length > 2 ? "Combined answer" : `Answer from ${model.id}`
      );
    })
  );
  const options = {
    host: {
      app,
      keychain,
      getSettings: () => settings,
      privateRoot: path.join(directory, "fanout-private"),
      streamsFactory: () => faux.provider,
    },
  };
  const makeOrchestrator = (backend: PiBackendProcess, cwd = vaultRoot) => {
    const readers = new Set<string>();
    backend.setReadOnlySessionPredicate((id) => readers.has(id));
    return new FanoutOrchestrator({
      ensureBackendForFanout: async (id) => {
        assert.equal(id, "pi");
        return { proc: backend, descriptor: {} as never };
      },
      getDefaultSelection: () => ({ baseModelId: "saved-model-a", effort: null }),
      getFanoutModels: () => configuredFanoutModels(settings),
      getDisplayName: (key) => key,
      getCwd: () => cwd,
      registerReadOnlySession: (id) => {
        readers.add(id);
        return () => {
          readers.delete(id);
        };
      },
      excludeSubSessionFromHistory: () => undefined,
    });
  };
  let backend = new PiBackendProcess(options);
  const queuedId = "root-queued-fanout";
  const busyIds = ["root-busy-a", "root-busy-b"];
  const locator = new StoreLocator({
    platform: process.platform,
    homeDir: options.host.privateRoot,
    env: {},
    vaultRoot,
    vaultId: keychain.getVaultId(),
  });
  const metadataPath = path.join(
    path.dirname(locator.sessionStorePaths(queuedId).metaPath),
    "session.json"
  );
  let busyStarted!: () => void;
  const busyRunning = new Promise<void>((resolve) => {
    busyStarted = resolve;
  });
  let releaseBusy!: () => void;
  const busyGate = new Promise<void>((resolve) => {
    releaseBusy = resolve;
  });
  const imageData =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=";
  const selectedText = "Selected apples total 9";
  await fs.writeFile(path.join(vaultRoot, "selection.md"), selectedText);
  fixtureFiles.set(
    "selection.md",
    Object.assign(new TFile(), {
      path: "selection.md",
      extension: "md",
      stat: { size: selectedText.length },
    })
  );
  let candidateAttachmentCalls = 0;
  let busyCalls = 0;
  faux.setResponses(
    Array.from({ length: 10 }, () => async (context) => {
      busyCalls += 1;
      if (busyCalls <= 2) {
        if (busyCalls === 2) busyStarted();
        await busyGate;
      }
      const modelContext = JSON.stringify(context);
      if (modelContext.includes(imageData)) {
        candidateAttachmentCalls += 1;
        assert.ok(
          modelContext.includes(selectedText),
          "restored candidate retains selected material with the image"
        );
      }
      return fauxAssistantMessage("Actual completed model output");
    })
  );
  const draftSaved = new Promise<void>((resolve, reject) => {
    let watcher: ReturnType<typeof import("node:fs").watch> | undefined;
    const timer = window.setTimeout(() => {
      watcher?.close();
      reject(
        new Error("Queued fanout must save its original input before waiting for runtime capacity")
      );
    }, 4000);
    void fs
      .mkdir(path.dirname(metadataPath), { recursive: true })
      .then(() => {
        const fsSync = requireNodeModule<typeof import("node:fs")>("node:fs");
        watcher = fsSync.watch(path.dirname(metadataPath), () => {
          void fs
            .readFile(metadataPath, "utf8")
            .then((text) => {
              const metadata = JSON.parse(text) as { unsentInput?: { kind: string } };
              if (metadata.unsentInput?.kind === "fanout") {
                window.clearTimeout(timer);
                watcher?.close();
                resolve();
              }
            })
            .catch(() => undefined);
        });
      })
      .catch(reject);
  });
  let session: AgentSession | undefined;
  let busyTurns: Promise<unknown>[] = [];
  let queuedTurn: Promise<unknown> | undefined;
  try {
    await backend.start();
    const queued = await backend.newSession({ sessionId: queuedId, cwd: vaultRoot });
    const orchestrator = makeOrchestrator(backend);
    session = new AgentSession({
      backend,
      backendSessionId: queuedId,
      internalId: "queued-fanout",
      backendId: "pi",

      runFanoutTurn: (input) => orchestrator.run(input),
    });
    session.completeResume(queued.state);
    await session.ready;
    for (const id of busyIds) {
      await backend.newSession({ sessionId: id, cwd: vaultRoot });
      await backend.setSessionModel({ sessionId: id, modelId: "saved-model-a" });
    }
    busyTurns = busyIds.map((sessionId) =>
      backend.prompt({
        sessionId,
        prompt: [
          { type: "text", text: "Keep this actual request active until explicitly released" },
        ],
      })
    );
    for (const busyTurn of busyTurns) void busyTurn.catch(() => undefined);
    await busyRunning;
    const sent = session.sendPrompt(
      "Compare the two configured models after capacity becomes available",
      {
        notes: [],
        urls: [],
        selectedTextContexts: [
          {
            id: "own-selection",
            content: selectedText,
            sourceType: "note",
            noteTitle: "selection",
            notePath: "selection.md",
            startLine: 1,
            endLine: 1,
          },
        ],
      },
      [
        { type: "text", text: "Compare the supplied selected text and image" },
        { type: "image", mimeType: "image/png", data: imageData },
      ],
      ["saved-model-a", "saved-model-b"]
    );
    const sentSettled = sent.turn.catch(() => "rejected" as const);
    queuedTurn = sentSettled;
    await draftSaved;
    assert.equal(busyCalls, 2, "queued fanout must not request either candidate");
    const saved = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      unsentInput: Extract<UnsentRootInput, { kind: "fanout" }>;
    };
    assert.equal(
      JSON.stringify(saved).includes(imageData),
      false,
      "session metadata contains only image references"
    );
    assert.ok(saved.unsentInput.images?.length);
    assert.ok(
      saved.unsentInput.turn.checkpoint?.context?.materials.some(
        (material) =>
          material.origin === "note" &&
          (material.sourcePath === "selection.md" || material.text.includes("selection.md")) &&
          material.text.includes(selectedText)
      )
    );
    const originalFanoutId = saved.unsentInput.turn.checkpoint!.fanoutId;
    await session.pause();
    await session.releaseBackendSession();
    await sentSettled;
    assert.equal(
      busyCalls,
      2,
      "closing queued fanout must not disturb or start another provider request"
    );
    await session.dispose();
    session = new AgentSession({
      backend,
      backendSessionId: queuedId,
      internalId: "queued-readonly-while-busy",
      backendId: "pi",

      runFanoutTurn: (input) => orchestrator.run(input),
    });
    const whileBusy = await backend.loadSession({ sessionId: queuedId, cwd: vaultRoot });
    session.completeResume(whileBusy.state);
    await session.ready;
    assert.equal(whileBusy.state.readOnly, true);
    assert.equal(busyCalls, 2, "read-only reopening cannot queue another provider request");
    const readonlyQueuedCard = session.store
      .getDisplayMessages()
      .find((message) => message.fanout?.checkpoint?.fanoutId === originalFanoutId);
    assert.ok(
      readonlyQueuedCard,
      "read-only opening while other roots work must still show the saved comparison"
    );
    assert.equal(readonlyQueuedCard.fanout?.summary.status, "paused");
    await session.resumeFanout(readonlyQueuedCard.id);
    assert.equal(
      busyCalls,
      2,
      "a read-only comparison cannot acquire a writer or start candidates"
    );
    await session.dispose();
    session = undefined;
    releaseBusy();
    await Promise.all(busyTurns);
    await backend.shutdown();
    const beforeCold = faux.state.callCount;
    backend = new PiBackendProcess(options);
    await backend.start();
    const resumedOrchestrator = makeOrchestrator(backend);
    session = new AgentSession({
      backend,
      backendSessionId: queuedId,
      internalId: "reopened-queued-fanout",
      backendId: "pi",

      runFanoutTurn: (input) => resumedOrchestrator.run(input),
    });
    const loaded = await backend.loadSession({ sessionId: queuedId, cwd: vaultRoot });
    session.completeResume(loaded.state);
    await session.ready;
    assert.equal(faux.state.callCount, beforeCold, "cold opening cannot start unsent fanout");
    const cards = session.store.getDisplayMessages().filter((message) => message.fanout);
    assert.equal(cards.length, 1, "cold opening must restore exactly the original fanout card");
    assert.equal(cards[0].fanout!.checkpoint!.fanoutId, originalFanoutId);
    assert.equal(cards[0].fanout!.summary.status, "paused");
    await session.resumeFanout(cards[0].id);
    assert.equal(
      faux.state.callCount,
      beforeCold + 3,
      "explicit continue runs each original candidate and one summary exactly once"
    );
    const completed = session.store
      .getDisplayMessages()
      .find((message) => message.fanout?.checkpoint?.fanoutId === originalFanoutId)?.fanout;
    assert.equal(completed?.summary.complete, true);
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      unsentInput?: unknown;
    };
    assert.equal(
      metadata.unsentInput,
      undefined,
      "handoff to durable fanout removes temporary metadata draft"
    );
    await session.dispose();
    session = undefined;
    const cutId = "root-fanout-handoff-cut";
    const restoredDraft = await restoreUnsentRootInput(
      saved.unsentInput,
      path.dirname(metadataPath)
    );
    assert.equal(restoredDraft.kind, "fanout");
    if (restoredDraft.kind !== "fanout") throw new Error("Wrong restored draft kind");
    const cutTurn = restoredDraft.turn;
    cutTurn.checkpoint!.fanoutId = "stable-handoff-cut";
    await backend.newSession({ sessionId: cutId, cwd: vaultRoot });
    await backend.newSession({ sessionId: "root-cut-idle-a", cwd: vaultRoot });
    await backend.newSession({ sessionId: "root-cut-idle-b", cwd: vaultRoot });
    const cutMetadataPath = path.join(
      path.dirname(locator.sessionStorePaths(cutId).metaPath),
      "session.json"
    );
    const originalRename: typeof fs.rename = fs.rename;
    let faultReached = false;
    fs.rename = async (from, to) => {
      if (String(to) === cutMetadataPath) {
        const pending = JSON.parse(await fs.readFile(from, "utf8")) as { unsentInput?: unknown };
        const prior = JSON.parse(await fs.readFile(cutMetadataPath, "utf8")) as {
          unsentInput?: unknown;
        };
        if (!pending.unsentInput && prior.unsentInput) {
          faultReached = true;
          throw Object.assign(
            new Error("Injected metadata removal failure after actual fanout commit"),
            { code: "EIO" }
          );
        }
      }
      return originalRename(from, to);
    };
    const beforeCut = faux.state.callCount;
    try {
      await assert.rejects(
        backend.recordFanoutTurn({ sessionId: cutId, turn: cutTurn }),
        /Injected metadata removal failure/
      );
    } finally {
      fs.rename = originalRename;
    }
    assert.equal(faultReached, true);
    assert.equal(
      faux.state.callCount,
      beforeCut,
      "metadata handoff failure cannot start a candidate"
    );
    assert.ok(
      (await backend.exportSession({ sessionId: cutId, format: "json" })).content.includes(
        "va.fanout"
      ),
      "fanout reached actual durable commit before the injected failure"
    );
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    const cutOrchestrator = makeOrchestrator(backend);
    session = new AgentSession({
      backend,
      backendSessionId: cutId,
      internalId: "cut-reopened",
      backendId: "pi",

      runFanoutTurn: (input) => cutOrchestrator.run(input),
    });
    const cutLoaded = await backend.loadSession({ sessionId: cutId, cwd: vaultRoot });
    session.completeResume(cutLoaded.state);
    await session.ready;
    assert.equal(
      faux.state.callCount,
      beforeCut,
      "cold handoff reconciliation must not request a model"
    );
    const cutCards = session.store.getDisplayMessages().filter((message) => message.fanout);
    assert.equal(cutCards.length, 1);
    assert.equal(cutCards[0].fanout?.checkpoint?.fanoutId, "stable-handoff-cut");
    assert.equal(
      cutCards[0].fanout?.summary.status,
      "paused",
      "an initial committed card with no candidates must reopen paused"
    );
    assert.equal(cutCards[0].fanout?.checkpoint?.awaitingAdmission, true);
    await session.resumeFanout(cutCards[0].id);
    assert.equal(faux.state.callCount, beforeCut + 3);
    assert.equal(
      candidateAttachmentCalls,
      4,
      "both candidates receive the original image and selected source in each resumed comparison"
    );
    return {
      status: "passed",
      scenario: "queued-fanout",
      checks: [
        "queued_original_input_saved_before_pool_wait",
        "pause_close_retract_waiter_without_touching_busy_roots",
        "cold_open_does_not_request_models",
        "explicit_continue_preserves_original_fanout_identity",
        "each_candidate_and_summary_runs_once",
        "temporary_draft_removed_after_durable_handoff",
        "fanout_image_cached_and_selected_source_restored",
        "readonly_reopen_shows_queued_comparison_without_writer",
        "commit_before_metadata_clear_cold_reconciles_without_restart",
      ],
    };
  } finally {
    releaseBusy();
    await session?.cancel();
    await session?.dispose();
    await Promise.allSettled(busyTurns);
    await queuedTurn;
    await backend.shutdown();
    await draftSaved.catch(() => undefined);
  }
}
