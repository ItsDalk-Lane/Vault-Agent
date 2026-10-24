import { TFile, type App } from "obsidian";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { PermissionDecision, PermissionPrompt } from "@/agentMode/session/types";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { RuntimePool } from "@/agentMode/sdk/pi/runtime/RuntimePool";
import type { UnsentRootInput } from "@/agentMode/sdk/pi/runtime/UnsentRootInput";
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

export async function runDeletionPendingRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const writes: string[] = [];
  const files = new Map<string, TFile>();
  const app = {
    vault: {
      configDir: ".fixture-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: (target: string) => files.get(target) ?? null,
      getFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()],
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      create: async (target: string, content: string) => {
        await fs.writeFile(path.join(vaultRoot, target), content, { flag: "wx" });
        writes.push(target);
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
        configuredModelId: "saved-model",
        providerId: "fixture",
        info: { id: "fixture-model", toolCall: true, limits: { context: 200_000, output: 4096 } },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      backends: {},
      skills: { folder: "skills" },
      offerFeedbackCards: false,
    },
    backends: { pi: { enabledModels: ["saved-model"] } },
  } as unknown as VaultAgentSettings;
  const faux = fauxProvider();
  const options = {
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "deletion-pending-fixture",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  };
  let backend = new PiBackendProcess(options);
  const acquire = Object.getOwnPropertyDescriptor(RuntimePool.prototype, "acquire")!
    .value as RuntimePool["acquire"];
  const checks: string[] = [];
  try {
    await backend.start();
    const locations = backend.getLocalStoragePaths();
    const assertRemoved = async (sessionId: string) => {
      assert.equal(await backend.sessionExistsLocally({ sessionId, cwd: vaultRoot }), false);
      await assert.rejects(fs.access(path.join(locations.sessionsRoot, sessionId)), {
        code: "ENOENT",
      });
      assert.equal(
        (await backend.listSessions({})).sessions.some(
          (session) => session.sessionId === sessionId
        ),
        false
      );
      const index = JSON.parse(await fs.readFile(locations.indexPath, "utf8")) as {
        entries: { sessionId: string }[];
      };
      assert.equal(
        index.entries.some((session) => session.sessionId === sessionId),
        false
      );
      await assert.rejects(backend.loadSession({ sessionId, cwd: vaultRoot }), {
        code: "SESSION_NOT_FOUND",
      });
      await assert.rejects(fs.access(path.join(locations.sessionsRoot, sessionId)), {
        code: "ENOENT",
      });
    };

    const approvalId = "root-delete-pending-approval";
    await backend.newSession({ sessionId: approvalId, cwd: vaultRoot });
    const permissionShown = deferred<PermissionPrompt>();
    const pendingProjected = deferred<void>();
    const permissionAborted = deferred<void>();
    backend.setPermissionPrompter((prompt) => {
      permissionShown.resolve(prompt);
      return new Promise<PermissionDecision>((resolve) => {
        const abort = () => {
          permissionAborted.resolve();
          resolve({ outcome: { outcome: "cancelled" } });
        };
        prompt.signal?.addEventListener("abort", abort, { once: true });
        if (prompt.signal?.aborted) abort();
      });
    });
    backend.registerSessionHandler(approvalId, ({ update }) => {
      if (
        update.sessionUpdate === "session_projection" &&
        update.projection.pending.permissions.length > 0
      )
        pendingProjected.resolve();
    });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("vault_create", { path: "unapproved.md", content: "Must never be written" })],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("A deleted approval must never continue to this response"),
    ]);
    const awaitingApproval = backend.prompt({
      sessionId: approvalId,
      requestId: "pending-write",
      prompt: [{ type: "text", text: "Wait for approval before creating the note" }],
    });
    const [permission] = await Promise.race([
      Promise.all([permissionShown.promise, pendingProjected.promise]),
      awaitingApproval.then(() => {
        throw new Error("The write finished before the pending approval was visible");
      }),
    ]);
    assert.equal(writes.length, 0);
    const beforeApprovalDelete = faux.state.callCount;
    await backend.deleteSession({ sessionId: approvalId });
    await permissionAborted.promise;
    assert.equal((await awaitingApproval).stopReason, "cancelled");
    await assertRemoved(approvalId);
    await assert.rejects(
      backend.decidePermission({
        sessionId: approvalId,
        requestId: permission.toolCall.toolCallId,
        decision: { outcome: { outcome: "selected", optionId: "allow_once" } },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error, "a deleted approval rejects the late action");
        return true;
      }
    );
    assert.equal(faux.state.callCount, beforeApprovalDelete);
    assert.deepEqual(writes, []);
    assert.deepEqual(await fs.readdir(vaultRoot), []);
    checks.push("pending_approval_delete_cancels_window_without_write_or_model_continuation");

    const queuedId = "root-delete-queued-input";
    const holderIds = ["root-held-first", "root-held-second"];
    await backend.newSession({ sessionId: queuedId, cwd: vaultRoot });
    await backend.closeSession({ sessionId: queuedId });
    for (const sessionId of holderIds) await backend.newSession({ sessionId, cwd: vaultRoot });
    const entered = [deferred<void>(), deferred<void>()];
    const released = [deferred<void>(), deferred<void>()];
    let queuedCalls = 0;
    faux.setResponses(
      Array.from({ length: 6 }, () => async (context, request) => {
        const text = JSON.stringify(context);
        const index = text.includes("HOLD-FIRST") ? 0 : text.includes("HOLD-SECOND") ? 1 : -1;
        if (index < 0) {
          queuedCalls++;
          return fauxAssistantMessage("A deleted queued input must never reach a model");
        }
        const signal = request?.signal;
        assert.ok(signal);
        let abort!: () => void;
        const interrupted = new Promise<never>((_resolve, reject) => {
          abort = () => reject(new Error("The holder was stopped"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        entered[index].resolve();
        try {
          await Promise.race([released[index].promise, interrupted]);
          return fauxAssistantMessage("Holder completed");
        } finally {
          signal.removeEventListener("abort", abort);
        }
      })
    );
    const holders = holderIds.map((sessionId, index) =>
      backend.prompt({
        sessionId,
        requestId: `holder-${index}`,
        prompt: [{ type: "text", text: index === 0 ? "HOLD-FIRST" : "HOLD-SECOND" }],
      })
    );
    await Promise.race([
      Promise.all(entered.map((gate) => gate.promise)),
      Promise.all(holders).then(() => {
        throw new Error("The two holders finished before filling both execution slots");
      }),
    ]);
    const queued = deferred<void>();
    RuntimePool.prototype.acquire = function (
      this: RuntimePool,
      rootKey: string,
      acquireOptions?: Parameters<RuntimePool["acquire"]>[1]
    ): ReturnType<RuntimePool["acquire"]> {
      const waiting = acquire.call(this, rootKey, acquireOptions) as ReturnType<
        RuntimePool["acquire"]
      >;
      if (rootKey === queuedId && acquireOptions?.waitForCapacity !== false) queued.resolve();
      return waiting;
    };
    const queuedWork = backend.prompt({
      sessionId: queuedId,
      requestId: "never-admit-deleted-input",
      prompt: [{ type: "text", text: "DELETE-THIS-QUEUED-INPUT" }],
    });
    await Promise.race([
      queued.promise,
      queuedWork.then(() => {
        throw new Error("The third request finished without entering the execution queue");
      }),
    ]);
    const queuedMetadata = JSON.parse(
      await fs.readFile(path.join(locations.sessionsRoot, queuedId, "session.json"), "utf8")
    ) as { unsentInput?: UnsentRootInput };
    assert.ok(queuedMetadata.unsentInput?.kind === "prompt");
    assert.equal(queuedMetadata.unsentInput.input.requestId, "never-admit-deleted-input");
    assert.equal(queuedCalls, 0);
    await backend.deleteSession({ sessionId: queuedId });
    assert.equal((await queuedWork).stopReason, "cancelled");
    await assertRemoved(queuedId);
    for (const gate of released) gate.resolve();
    assert.ok((await Promise.all(holders)).every((result) => result.stopReason === "end_turn"));
    assert.equal(queuedCalls, 0, "freeing execution slots cannot revive the deleted queued input");
    await assertRemoved(queuedId);
    RuntimePool.prototype.acquire = acquire;
    for (const sessionId of holderIds) await backend.deleteSession({ sessionId });
    assert.deepEqual(await fs.readdir(locations.sessionsRoot), []);
    assert.deepEqual(await fs.readdir(locations.deletionsRoot), []);
    checks.push("queued_input_delete_removes_saved_request_and_never_runs_after_slots_free");

    const callsBeforeReopen = faux.state.callCount;
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    await assertRemoved(approvalId);
    await assertRemoved(queuedId);
    assert.equal(faux.state.callCount, callsBeforeReopen);
    assert.deepEqual(await fs.readdir(locations.sessionsRoot), []);
    checks.push("deleted_pending_sessions_remain_missing_after_cold_restart");

    const ids = Array.from(
      { length: 507 },
      (_, index) => `root-listed-${String(index).padStart(3, "0")}`
    );
    await Promise.all(
      ids.map(async (sessionId, index) => {
        const sessionDir = path.join(locations.sessionsRoot, sessionId);
        await fs.mkdir(sessionDir);
        await fs.writeFile(
          path.join(sessionDir, "session.json"),
          JSON.stringify({
            sessionId,
            cwd: vaultRoot,
            title: `Saved chat ${index}`,
            createdAt: new Date(1_700_000_000_000 + index).toISOString(),
            modelId: "saved-model",
            mode: "default",
            effort: null,
          })
        );
      })
    );
    const listed = (await backend.listSessions({ cwd: vaultRoot })).sessions;
    assert.deepEqual(listed.map((session) => session.sessionId).sort(), ids);
    const index = JSON.parse(await fs.readFile(locations.indexPath, "utf8")) as {
      entries: { sessionId: string }[];
    };
    assert.deepEqual(index.entries.map((session) => session.sessionId).sort(), ids);
    assert.equal(faux.state.callCount, callsBeforeReopen);
    for (const sessionId of ids)
      assert.deepEqual(await fs.readdir(path.join(locations.sessionsRoot, sessionId)), [
        "session.json",
      ]);
    checks.push("disk_listing_and_rebuilt_index_include_every_record_beyond_500");
    return { status: "passed", checks, listedSessions: listed.length, queuedCalls };
  } finally {
    RuntimePool.prototype.acquire = acquire;
    await backend.shutdown();
  }
}
