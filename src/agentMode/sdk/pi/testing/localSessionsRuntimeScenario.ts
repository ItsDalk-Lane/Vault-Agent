import type { ListedSessionInfo, SessionEvent } from "@/agentMode/session/types";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { TFile, type App } from "obsidian";
import type { VaultAgentSettings } from "@/settings/model";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { RuntimePool } from "@/agentMode/sdk/pi/runtime/RuntimePool";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runLocalSessionsRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "local-sessions-vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const readMarker = "LARGE-SESSION-READ-COMPLETED";
  const note = Object.assign(new TFile(), {
    path: "large-session-source.md",
    name: "large-session-source.md",
    basename: "large-session-source",
    extension: "md",
    stat: { ctime: 1, mtime: 1, size: readMarker.length },
  });
  await fs.writeFile(path.join(vaultRoot, note.path), readMarker);
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
      getFiles: () => [note],
      getMarkdownFiles: () => [note],
      getAbstractFileByPath: (target: string) => (target === note.path ? note : null),
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      on: () => ({}),
      offref: () => undefined,
    },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
    workspace: {},
  } as unknown as App;
  const faux = fauxProvider();
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "local-sessions-fixture",
    getSecretById: (id: string) => (id === "fixture-key" ? "fixture-key" : null),
    setSecretById: () => undefined,
    deleteSecretById: () => undefined,
  };
  const host = {
    app,
    keychain,
    getSettings: () => settings,
    privateRoot: path.join(directory, "private"),
    streamsFactory: () => faux.provider,
  };
  const backend = new PiBackendProcess({ host });
  let notifications = 0;
  try {
    await backend.start();
    const locations = backend.getLocalStoragePaths();
    assert.ok(locations.dataRoot.endsWith(path.join(".vault-agent", "v2")));
    const unsubscribe = backend.subscribeStorageChanges(() => {
      notifications++;
    });
    const sessionId = "root-large-session";
    await backend.newSession({ sessionId, cwd: vaultRoot });
    await backend.setSessionModel({ sessionId, modelId: "saved-model" });
    faux.setResponses([fauxAssistantMessage("Original answer")]);
    await backend.prompt({ sessionId, prompt: [{ type: "text", text: "Original question" }] });
    await backend.updateSessionMetadata({
      sessionId,
      title: "Saved title",
      titleSource: "agent",
      pinnedAt: 123,
      lastAccessedAtMs: 456,
    });
    await backend.closeSession({ sessionId });
    const sessionDir = path.join(locations.sessionsRoot, sessionId);
    const [
      { Harness, createRegistry },
      { createModels },
      { openNodeJsonlStorage },
      { BACKGROUND_CONTEXT },
    ] = await Promise.all([
      import("@earendil-works/pi-durable"),
      import("@earendil-works/pi-ai"),
      import("@earendil-works/pi-durable/storage/jsonl/node"),
      import("@earendil-works/chord/context"),
    ]);
    const harness = await Harness.open(
      await openNodeJsonlStorage(sessionDir, BACKGROUND_CONTEXT, { fsync: true }),
      { models: createModels(), registry: createRegistry() },
      BACKGROUND_CONTEXT
    );
    const conversation = await harness.root(BACKGROUND_CONTEXT);
    await conversation.commit(
      (tx) =>
        tx.appendEntry(conversation.id, {
          kind: "fixture-large-history",
          data: { text: "x".repeat(65 * 1024 * 1024) },
        }),
      BACKGROUND_CONTEXT
    );
    await harness.close(BACKGROUND_CONTEXT);
    assert.ok((await fs.stat(path.join(sessionDir, "main.jsonl"))).size > 64 * 1024 * 1024);
    const holderIds = ["root-large-holder-a", "root-large-holder-b"];
    const holderSignals = holderIds.map(() => {
      let entered!: () => void;
      const running = new Promise<void>((resolve) => {
        entered = resolve;
      });
      return { entered, running };
    });
    for (const holderId of holderIds) {
      await backend.newSession({ sessionId: holderId, cwd: vaultRoot });
      await backend.setSessionModel({ sessionId: holderId, modelId: "saved-model" });
    }
    faux.setResponses([
      ...holderSignals.map(
        ({ entered }) =>
          (_context: unknown, request?: { signal?: AbortSignal }) =>
            new Promise<ReturnType<typeof fauxAssistantMessage>>((_resolve, reject) => {
              const signal = request?.signal;
              assert.ok(signal);
              const abort = () => reject(new Error("Released large-session queue holder"));
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
              entered();
            })
      ),
      fauxAssistantMessage([fauxToolCall("vault_read", { path: note.path })], {
        stopReason: "toolUse",
      }),
      (context) => {
        const read = context.messages.findLast(
          (message) => message.role === "toolResult" && message.toolName === "vault_read"
        );
        assert.ok(read && read.role === "toolResult");
        assert.ok(JSON.stringify(read.content).includes(readMarker));
        assert.notEqual(read.isError, true);
        return fauxAssistantMessage("Large session completed");
      },
    ]);
    const heldPrompts = [];
    for (const [index, holderId] of holderIds.entries()) {
      heldPrompts.push(
        backend
          .prompt({ sessionId: holderId, prompt: [{ type: "text", text: "Hold this slot" }] })
          .catch((error: unknown) => error)
      );
      await holderSignals[index].running;
    }
    let queued!: () => void;
    const queueEntered = new Promise<void>((resolve) => {
      queued = resolve;
    });
    const acquireDescriptor = Object.getOwnPropertyDescriptor(RuntimePool.prototype, "acquire")!;
    const originalAcquire = acquireDescriptor.value as RuntimePool["acquire"];
    RuntimePool.prototype.acquire = function (
      this: RuntimePool,
      rootKey: string,
      options?: Parameters<RuntimePool["acquire"]>[1]
    ): ReturnType<RuntimePool["acquire"]> {
      const pending = originalAcquire.call(this, rootKey, options) as ReturnType<
        RuntimePool["acquire"]
      >;
      if (rootKey === sessionId && options?.waitForCapacity !== false) queued();
      return pending;
    };
    try {
      const callsBeforeQueue = faux.state.callCount;
      const pendingLarge = backend.prompt({
        sessionId,
        prompt: [
          { type: "text", text: "Read the fixture after this large session leaves the queue" },
        ],
      });
      void pendingLarge.catch(() => undefined);
      await queueEntered;
      assert.equal(faux.state.callCount, callsBeforeQueue);
      await backend.cancel({ sessionId: holderIds[0] });
      await heldPrompts[0];
      await backend.closeSession({ sessionId: holderIds[0] });
      assert.equal((await pendingLarge).stopReason, "end_turn");
      assert.equal(faux.state.callCount, callsBeforeQueue + 2);
    } finally {
      Object.defineProperty(RuntimePool.prototype, "acquire", acquireDescriptor);
      for (const holderId of holderIds) await backend.deleteSession({ sessionId: holderId });
      await Promise.all(heldPrompts);
    }
    await backend.closeSession({ sessionId });
    const largeCold = new PiBackendProcess({ host });
    const callsBeforeLargeCold = faux.state.callCount;
    await largeCold.start();
    try {
      await largeCold.loadSession({ sessionId, cwd: vaultRoot });
      const restored = await largeCold.exportSession({ sessionId, format: "json" });
      assert.ok(restored.content.includes("Large session completed"));
      assert.ok(restored.content.includes(readMarker));
      assert.equal(faux.state.callCount, callsBeforeLargeCold);
    } finally {
      await largeCold.shutdown();
    }
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    await fs.mkdir(path.join(sessionDir, "attachments"), { recursive: true });
    await fs.writeFile(path.join(sessionDir, "attachments", "copy-proof"), "private attachment");
    const callsBeforeFork = faux.state.callCount;
    const fork = await backend.forkSession({ sessionId });
    assert.notEqual(fork.sessionId, sessionId);
    assert.equal(faux.state.callCount, callsBeforeFork);
    await backend.deleteSession({ sessionId });
    assert.equal(await backend.sessionExistsLocally({ sessionId, cwd: vaultRoot }), false);
    await assert.rejects(backend.loadSession({ sessionId, cwd: vaultRoot }), {
      code: "SESSION_NOT_FOUND",
    });
    assert.equal(
      await fs.readFile(
        path.join(locations.sessionsRoot, fork.sessionId, "attachments", "copy-proof"),
        "utf8"
      ),
      "private attachment"
    );
    const copied = (await backend.listSessions({ cwd: vaultRoot })).sessions.find(
      (item) => item.sessionId === fork.sessionId
    );
    assert.ok(copied);
    assert.equal(copied.pinnedAt, undefined);
    assert.equal(copied.titleSource, "agent");
    await backend.updateSessionMetadata({
      sessionId: fork.sessionId,
      title: "Independent title",
      pinnedAt: 789,
      lastAccessedAtMs: 987,
    });
    const index = JSON.parse(await fs.readFile(locations.indexPath, "utf8")) as {
      entries: ListedSessionInfo[];
    };
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0].title, "Independent title");
    assert.equal(index.entries[0].lastAccessedAtMs, 987);
    assert.equal(index.entries[0].pinnedAt, 789);
    const remote = new PiBackendProcess({ host });
    await remote.start();
    try {
      await assert.rejects(remote.deleteSession({ sessionId: fork.sessionId }), {
        code: "STORE_BUSY",
      });
    } finally {
      await remote.shutdown();
    }
    let entered!: () => void;
    const running = new Promise<void>((resolve) => {
      entered = resolve;
    });
    faux.setResponses([
      (_context, request) =>
        new Promise((_resolve, reject) => {
          const signal = request?.signal;
          assert.ok(signal);
          const abort = () => reject(new Error("Deleted active session"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          entered();
        }),
    ]);
    const pending = backend.prompt({
      sessionId: fork.sessionId,
      prompt: [{ type: "text", text: "Wait until deleted" }],
    });
    await running;
    await assert.rejects(backend.forkSession({ sessionId: fork.sessionId }), {
      code: "SESSION_NOT_STABLE",
    });
    await backend.deleteSession({ sessionId: fork.sessionId });
    await pending;
    assert.deepEqual((await backend.listSessions({})).sessions, []);
    assert.deepEqual(await fs.readdir(locations.sessionsRoot), []);
    assert.deepEqual(await fs.readdir(locations.deletionsRoot), []);
    assert.ok(notifications > 0);
    await backend.newSession({ sessionId: "root-index-failure", cwd: vaultRoot });
    const rename = fs.rename;
    fs.rename = async (source, target) => {
      if (target === locations.indexPath)
        throw Object.assign(new Error("index unavailable"), { code: "EACCES" });
      await rename(source, target);
    };
    try {
      await assert.rejects(backend.deleteSession({ sessionId: "root-index-failure" }), {
        code: "EACCES",
      });
      assert.equal(
        await backend.sessionExistsLocally({ sessionId: "root-index-failure", cwd: vaultRoot }),
        false
      );
      await backend.shutdown();
    } finally {
      fs.rename = rename;
    }
    const seeded = new PiBackendProcess({ host });
    await seeded.start();
    const activeParent = "root-delete-active-child";
    const activeChild = "root-active-child";
    await seeded.newSession({ sessionId: activeParent, cwd: vaultRoot });
    await seeded.setSessionModel({ sessionId: activeParent, modelId: "saved-model" });
    await seeded.newSession({
      sessionId: activeChild,
      cwd: vaultRoot,
      parentSessionId: activeParent,
      parentRunId: "active-child-run",
    });
    let candidateEntered!: () => void;
    const candidateRunning = new Promise<void>((resolve) => {
      candidateEntered = resolve;
    });
    let candidateAborted = false;
    faux.setResponses([
      (_context, request) =>
        new Promise((_resolve, reject) => {
          const signal = request?.signal;
          assert.ok(signal);
          const abort = () => {
            candidateAborted = true;
            reject(new Error("Candidate deleted with parent"));
          };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          candidateEntered();
        }),
    ]);
    const candidatePrompt = seeded
      .prompt({
        sessionId: activeChild,
        prompt: [{ type: "text", text: "Wait for parent deletion" }],
      })
      .catch((error: unknown) => error);
    await candidateRunning;
    await seeded.deleteSession({ sessionId: activeParent });
    await candidatePrompt;
    assert.equal(candidateAborted, true);
    await assert.rejects(fs.access(path.join(locations.sessionsRoot, activeParent)), {
      code: "ENOENT",
    });
    assert.equal(
      await seeded.sessionExistsLocally({ sessionId: activeChild, cwd: vaultRoot }),
      false
    );
    const parentId = "root-delete-with-child";
    const childId = "root-cold-child";
    await seeded.newSession({ sessionId: parentId, cwd: vaultRoot });
    await seeded.setSessionModel({ sessionId: parentId, modelId: "saved-model" });
    await seeded.newSession({
      sessionId: childId,
      cwd: vaultRoot,
      parentSessionId: parentId,
      parentRunId: "cold-child-run",
    });
    faux.setResponses([fauxAssistantMessage("Completed candidate history")]);
    await seeded.prompt({
      sessionId: childId,
      prompt: [{ type: "text", text: "Complete a saved candidate" }],
      requestId: "cold-candidate-request",
    });
    await seeded.closeSession({ sessionId: childId });
    await seeded.recordFanoutTurn({
      sessionId: parentId,
      turn: {
        checkpoint: {
          fanoutId: "cold-child-run",
          mainModelKey: "saved-model",
          prompt: [{ type: "text", text: "Complete a saved candidate" }],
          originalPromptText: "Complete a saved candidate",
        },
        answers: {
          fixture: {
            backendId: "pi",
            status: "done",
            text: "Completed candidate history",
            completion: {
              sessionId: childId,
              requestId: "cold-candidate-request",
              stopReason: "end_turn",
            },
          },
        },
        summary: { status: "done", complete: true, text: "Completed candidate summary" },
      },
    });
    const originalTranscript = await fs.readFile(
      path.join(locations.sessionsRoot, parentId, "main.jsonl"),
      "utf8"
    );
    const childFork = await seeded.forkSession({ sessionId: parentId });
    const forkTranscript = await fs.readFile(
      path.join(locations.sessionsRoot, childFork.sessionId, "main.jsonl"),
      "utf8"
    );
    assert.ok(
      forkTranscript.startsWith(originalTranscript),
      "forking must preserve the Durable transcript bytes instead of rewriting its historical prompts"
    );
    const callsBeforeChildReopen = faux.state.callCount;
    await seeded.shutdown();
    const cold = new PiBackendProcess({ host });
    await cold.start();
    const childDir = path.join(locations.sessionsRoot, parentId, "children", childId);
    let childEntered!: () => void;
    const childEntering = new Promise<void>((resolve) => {
      childEntered = resolve;
    });
    let releaseChild!: () => void;
    const childGate = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    const mkdir = fs.mkdir;
    fs.mkdir = (async (
      target: Parameters<typeof fs.mkdir>[0],
      options: Parameters<typeof fs.mkdir>[1]
    ) => {
      if (target === childDir) {
        childEntered();
        await childGate;
      }
      return mkdir(target, options);
    }) as typeof fs.mkdir;
    const childOpening = cold
      .loadSession({ sessionId: childId, cwd: vaultRoot })
      .catch((error: unknown) => error);
    try {
      await childEntering;
      const coldOperations = (
        cold as unknown as { runtime: { operationTasks: Map<string, Set<Promise<unknown>>> } }
      ).runtime.operationTasks;
      assert.ok(
        coldOperations.get(parentId)?.size,
        "the parent deletion barrier must include its in-flight cold child opening"
      );
      const deleting = cold.deleteSession({ sessionId: parentId });
      releaseChild();
      const childResult = await childOpening;
      assert.ok(
        !(childResult instanceof Error),
        "deletion must let the already accepted child open finish before closing its store"
      );
      await deleting;
      await assert.rejects(fs.access(path.join(locations.sessionsRoot, parentId)), {
        code: "ENOENT",
      });
      const copiedEvents: SessionEvent[] = [];
      const detachCopied = cold.registerSessionHandler(childFork.sessionId, (event) =>
        copiedEvents.push(event)
      );
      await cold.loadSession({ sessionId: childFork.sessionId, cwd: vaultRoot });
      detachCopied();
      const copiedProjection = copiedEvents
        .filter((event) => event.update.sessionUpdate === "session_projection")
        .at(-1)?.update;
      assert.ok(copiedProjection?.sessionUpdate === "session_projection");
      const copiedTurn = copiedProjection.projection.messages.find(
        (message) => message.fanout
      )?.fanout;
      const copiedChildId = copiedTurn?.answers.fixture.completion?.sessionId;
      assert.ok(copiedChildId);
      assert.notEqual(
        copiedChildId,
        childId,
        "the fork's saved candidate must point to its own copied child identity"
      );
      await cold.loadSession({ sessionId: copiedChildId, cwd: vaultRoot });
      const copiedMetadata = JSON.parse(
        await fs.readFile(
          path.join(
            locations.sessionsRoot,
            childFork.sessionId,
            "children",
            copiedChildId,
            "session.json"
          ),
          "utf8"
        )
      ) as { conversationId: string };
      const copiedHistory = await cold.readSubagentHistory({
        sessionId: childFork.sessionId,
        conversationId: copiedMetadata.conversationId,
      });
      assert.ok(
        copiedHistory.some((message) => message.message.includes("Completed candidate history"))
      );
      assert.equal(
        faux.state.callCount,
        callsBeforeChildReopen,
        "opening copied candidate history must not run a provider"
      );
      // 逐轮分支：三轮对话从第二轮终态分叉，副本恰含前两轮、可继续对话、源不变。https://github.com/ItsDalk-Lane/Vault-Agent/issues/12
      const branchSourceId = "root-turn-fork-source";
      await cold.newSession({ sessionId: branchSourceId, cwd: vaultRoot });
      await cold.setSessionModel({ sessionId: branchSourceId, modelId: "saved-model" });
      for (const round of [1, 2, 3]) {
        faux.setResponses([fauxAssistantMessage(`Round ${round} answer`)]);
        await cold.prompt({
          sessionId: branchSourceId,
          prompt: [{ type: "text", text: `Round ${round}` }],
        });
      }
      const projectedMessages = async (targetId: string) => {
        const events: SessionEvent[] = [];
        const detach = cold.registerSessionHandler(targetId, (event) => events.push(event));
        await cold.loadSession({ sessionId: targetId, cwd: vaultRoot });
        detach();
        const projection = events
          .filter((event) => event.update.sessionUpdate === "session_projection")
          .at(-1)?.update;
        assert.ok(projection?.sessionUpdate === "session_projection");
        return projection.projection.messages;
      };
      const userTextsOf = async (targetId: string): Promise<string[]> =>
        (await projectedMessages(targetId))
          .filter((message) => message.sender === "user")
          .map((message) => message.message);
      const endEntryIds = (await projectedMessages(branchSourceId))
        .map((message) => message.turnEndEntryId)
        .filter((entryId): entryId is string => typeof entryId === "string");
      assert.equal(endEntryIds.length, 3);
      assert.equal(new Set(endEntryIds).size, 3);
      const [firstEndId, secondEndId] = endEntryIds;
      assert.ok(firstEndId && secondEndId);
      const turnFork = await cold.forkSession({
        sessionId: branchSourceId,
        atEntryId: secondEndId,
      });
      assert.notEqual(turnFork.sessionId, branchSourceId);
      assert.deepEqual(await userTextsOf(turnFork.sessionId), ["Round 1", "Round 2"]);
      assert.deepEqual(await userTextsOf(branchSourceId), ["Round 1", "Round 2", "Round 3"]);
      faux.setResponses([fauxAssistantMessage("Round 4 answer")]);
      await cold.prompt({
        sessionId: turnFork.sessionId,
        prompt: [{ type: "text", text: "Round 4" }],
      });
      const continued = await cold.exportSession({
        sessionId: turnFork.sessionId,
        format: "json",
      });
      assert.ok(continued.content.includes("Round 4 answer"));
      // 分叉副本内的条目 id 是重新分配的，分叉的分叉必须用副本自己的轮末条目 id。https://github.com/ItsDalk-Lane/Vault-Agent/issues/12
      const forkEndIds = (await projectedMessages(turnFork.sessionId))
        .map((message) => message.turnEndEntryId)
        .filter((entryId): entryId is string => typeof entryId === "string");
      const forkOfFork = await cold.forkSession({
        sessionId: turnFork.sessionId,
        atEntryId: forkEndIds[0],
      });
      assert.deepEqual(await userTextsOf(forkOfFork.sessionId), ["Round 1"]);
      await assert.rejects(
        cold.forkSession({ sessionId: branchSourceId, atEntryId: "999999" }),
        (error: unknown) => (error as { code?: string }).code === "SESSION_NOT_FOUND"
      );
      await cold.deleteSession({ sessionId: forkOfFork.sessionId });
      await cold.deleteSession({ sessionId: turnFork.sessionId });
      await cold.deleteSession({ sessionId: branchSourceId });
      const diagnosticRootId = "root-readonly-diagnostic";
      const diagnosticRoot = await cold.newSession({
        sessionId: diagnosticRootId,
        cwd: vaultRoot,
        readOnly: true,
      });
      assert.equal(diagnosticRoot.state.readOnly, true);
      const diagnosticBytes = new Uint8Array([80, 75, 3, 4]);
      const savedReport = await cold.writeSessionDiagnostic({
        sessionId: diagnosticRootId,
        name: "saved-report.zip",
        content: diagnosticBytes,
      });
      const diagnosticsDirectory = path.join(
        locations.sessionsRoot,
        diagnosticRootId,
        "diagnostics"
      );
      assert.equal(path.dirname(savedReport.zipDir), diagnosticsDirectory);
      assert.equal(path.dirname(savedReport.zipPath), savedReport.zipDir);
      assert.deepEqual(new Uint8Array(await fs.readFile(savedReport.zipPath)), diagnosticBytes);
      await assert.rejects(
        cold.writeSessionDiagnostic({
          sessionId: diagnosticRootId,
          name: "../outside.zip",
          content: diagnosticBytes,
        })
      );
      await cold.closeSession({ sessionId: diagnosticRootId });
      const savedColdReport = await cold.writeSessionDiagnostic({
        sessionId: diagnosticRootId,
        name: "cold-report.zip",
        content: diagnosticBytes,
      });
      assert.deepEqual(new Uint8Array(await fs.readFile(savedColdReport.zipPath)), diagnosticBytes);
      const originalWriteFile = fs.writeFile;
      const reportWriteFailure = Object.assign(new Error("Diagnostic disk is full"), {
        code: "ENOSPC",
      });
      let failedReportPath = "";
      fs.writeFile = async (...args: Parameters<typeof fs.writeFile>) => {
        if (typeof args[0] === "string" && args[0].endsWith("failed-report.zip")) {
          failedReportPath = args[0];
          await originalWriteFile(args[0], diagnosticBytes.subarray(0, 2));
          throw reportWriteFailure;
        }
        return originalWriteFile(...args);
      };
      try {
        await assert.rejects(
          cold.writeSessionDiagnostic({
            sessionId: diagnosticRootId,
            name: "failed-report.zip",
            content: diagnosticBytes,
          }),
          (error: unknown) => error === reportWriteFailure
        );
        assert.ok(failedReportPath);
        await assert.rejects(fs.access(path.dirname(failedReportPath)), { code: "ENOENT" });
        const originalRemove = fs.rm;
        fs.rm = async (...args: Parameters<typeof fs.rm>) => {
          if (args[0] === path.dirname(failedReportPath))
            throw Object.assign(new Error("Diagnostic cleanup denied"), { code: "EACCES" });
          return originalRemove(...args);
        };
        try {
          await assert.rejects(
            cold.writeSessionDiagnostic({
              sessionId: diagnosticRootId,
              name: "failed-report.zip",
              content: diagnosticBytes,
            }),
            (error: unknown) => error === reportWriteFailure
          );
        } finally {
          fs.rm = originalRemove;
          await originalRemove(path.dirname(failedReportPath), { recursive: true, force: true });
        }
      } finally {
        fs.writeFile = originalWriteFile;
      }
      let reportEntered!: () => void;
      const reportEntering = new Promise<void>((resolve) => {
        reportEntered = resolve;
      });
      let releaseReport!: () => void;
      const reportGate = new Promise<void>((resolve) => {
        releaseReport = resolve;
      });
      const writeFile = fs.writeFile;
      fs.writeFile = (async (...args: Parameters<typeof fs.writeFile>) => {
        if (
          typeof args[0] === "string" &&
          args[0].startsWith(diagnosticsDirectory) &&
          args[0].endsWith("pending-report.zip")
        ) {
          reportEntered();
          await reportGate;
        }
        return writeFile(...args);
      }) as typeof fs.writeFile;
      const writingReport = cold.writeSessionDiagnostic({
        sessionId: diagnosticRootId,
        name: "pending-report.zip",
        content: diagnosticBytes,
      });
      void writingReport.catch(() => undefined);
      try {
        await reportEntering;
        const deletingDiagnostic = cold.deleteSession({ sessionId: diagnosticRootId });
        releaseReport();
        await writingReport;
        await deletingDiagnostic;
      } finally {
        releaseReport();
        await writingReport.catch(() => undefined);
        fs.writeFile = writeFile;
      }
      await assert.rejects(fs.access(path.join(locations.sessionsRoot, diagnosticRootId)), {
        code: "ENOENT",
      });
      const missingTranscriptId = "root-missing-transcript";
      await cold.newSession({ sessionId: missingTranscriptId, cwd: vaultRoot });
      await cold.setSessionModel({ sessionId: missingTranscriptId, modelId: "saved-model" });
      faux.setResponses([fauxAssistantMessage("Preserved history before the missing transcript")]);
      await cold.prompt({
        sessionId: missingTranscriptId,
        prompt: [{ type: "text", text: "Keep this history intact" }],
      });
      await cold.closeSession({ sessionId: missingTranscriptId });
      const missingTranscriptDirectory = path.join(locations.sessionsRoot, missingTranscriptId);
      const protectedFiles = ["session.json", "meta.json", "recovery-view.json"];
      const originalProtected = await Promise.all(
        protectedFiles.map((name) => fs.readFile(path.join(missingTranscriptDirectory, name)))
      );
      const missingMain = path.join(missingTranscriptDirectory, "main.jsonl");
      await fs.rename(missingMain, path.join(directory, "missing-transcript-main.jsonl"));
      const missingBackend = new PiBackendProcess({ host });
      const callsBeforeMissing = faux.state.callCount;
      await missingBackend.start();
      try {
        await assert.rejects(
          missingBackend.loadSession({ sessionId: missingTranscriptId, cwd: vaultRoot }),
          { code: "SESSION_TRANSCRIPT_MISSING" }
        );
        await assert.rejects(fs.access(missingMain), { code: "ENOENT" });
        for (const [index, name] of protectedFiles.entries())
          assert.deepEqual(
            await fs.readFile(path.join(missingTranscriptDirectory, name)),
            originalProtected[index]
          );
        assert.equal(faux.state.callCount, callsBeforeMissing);
      } finally {
        await missingBackend.shutdown();
      }
      await assert.rejects(
        cold.writeSessionDiagnostic({
          sessionId: diagnosticRootId,
          name: "late-report.zip",
          content: diagnosticBytes,
        }),
        { code: "SESSION_NOT_FOUND" }
      );
      await assert.rejects(fs.access(path.join(locations.sessionsRoot, diagnosticRootId)), {
        code: "ENOENT",
      });
    } finally {
      releaseChild();
      await childOpening;
      fs.mkdir = mkdir;
      await cold.shutdown();
    }
    unsubscribe();
    return {
      status: "passed",
      checks: [
        "large_transcript_runs_without_storage_pause",
        "large_transcript_queued_tool_turn_completes_and_reopens_cold",
        "fork_is_independent_and_does_not_run",
        "metadata_and_index_are_external",
        "remote_writer_blocks_delete",
        "active_delete_stops_work_and_removes_all_data",
        "storage_changes_are_observable",
        "index_failure_does_not_reopen_deleted_chat_or_repeat_at_shutdown",
        "cold_child_open_cannot_recreate_deleted_parent",
        "active_child_delete_aborts_provider_and_cleans_parent",
        "completed_child_fork_history_is_independent_without_rewriting_transcript",
        "diagnostics_belong_to_readonly_session_and_delete_waits_for_writes",
        "failed_diagnostic_write_removes_its_partial_report",
        "missing_transcript_restore_rejects_without_replacing_saved_metadata_or_snapshot",
      ],
    };
  } finally {
    await backend.shutdown();
  }
}
