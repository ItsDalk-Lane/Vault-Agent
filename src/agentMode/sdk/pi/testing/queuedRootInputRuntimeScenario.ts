import { FileSystemAdapter, TFile, TFolder, type App } from "obsidian";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import type { BackendDescriptor, PromptInput } from "@/agentMode/session/types";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { RuntimePool } from "@/agentMode/sdk/pi/runtime/RuntimePool";
import { StoreLocator } from "@/agentMode/sdk/pi/storage/StoreLocator";
import {
  restoreUnsentRootInput,
  type UnsentRootInput,
} from "@/agentMode/sdk/pi/runtime/UnsentRootInput";
import { setSettings, type VaultAgentSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");
const childProcess = requireNodeModule<typeof import("node:child_process")>("node:child_process");

interface QueuedInputReport {
  status: "passed";
  continuedCalls: number;
  checks: string[];
}

interface HandoffCut {
  sessionId: string;
  requestId: string;
  cut: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function trackPrompt(label: string, pending: ReturnType<PiBackendProcess["prompt"]>) {
  return pending.then(
    (value) => ({ label, value, error: null }),
    (error: unknown) => {
      process.stderr.write(
        `queuedRootInput:${label}:rejected:${error instanceof Error ? error.stack : String(error)}\n`
      );
      return { label, value: null, error };
    }
  );
}

export async function runQueuedRootInputRuntimeScenario(
  directory: string
): Promise<QueuedInputReport> {
  const executionPhase = process.env.PI_QUEUED_ROOT_PHASE ?? "all";
  const cut = process.env.PI_QUEUED_ROOT_CUT;
  const checks: string[] = [];
  let continuedCalls = 0;
  let phase = "initializing";
  const mark = (value: string) => {
    phase = value;
    process.stderr.write(`queuedRootInput:${value}\n`);
  };
  const deadline = window.setTimeout(() => {
    throw new Error(`The queued handoff did not settle at ${phase}`);
  }, 40_000);
  try {
    for (const action of executionPhase === "all"
      ? (["close", "stop", "shutdown", "slot-release", "stage-failure"] as const)
      : (["close"] as const)) {
      mark(`${action}:starting`);
      const rootDirectory = path.join(directory, action);
      const vaultRoot = path.join(rootDirectory, "vault");
      const privateRoot = path.join(rootDirectory, "private");
      await fs.mkdir(vaultRoot, { recursive: true });
      const note = Object.assign(new TFile(), {
        path: "queue-source.md",
        name: "queue-source.md",
        basename: "queue-source",
        extension: "md",
        stat: { ctime: 1, mtime: 1, size: 51 },
      });
      await fs.writeFile(
        path.join(vaultRoot, note.path),
        "QUEUE-SOURCE-7PLUS4\n第一批：7\n第二批：4\n"
      );
      const files = new Map([[note.path, note]]);
      const folder = Object.assign(new TFolder(), { path: "", children: [note] });
      const adapter = Object.assign(new FileSystemAdapter(), {
        getBasePath: () => vaultRoot,
        exists: async (name: string) =>
          !!(await fs.stat(path.join(vaultRoot, name)).catch(() => null)),
        read: (name: string) => fs.readFile(path.join(vaultRoot, name), "utf8"),
        readBinary: async (name: string) => {
          const bytes = await fs.readFile(path.join(vaultRoot, name));
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      });
      const app = {
        vault: {
          configDir: ".fixture-config",
          adapter,
          getRoot: () => folder,
          getFiles: () => [...files.values()],
          getMarkdownFiles: () => [...files.values()],
          getAbstractFileByPath: (name: string) => files.get(name) ?? null,
          read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
          on: () => ({}),
          offref: () => undefined,
        },
        workspace: {
          getActiveFile: () => null,
          getMostRecentLeaf: () => null,
          getLeavesOfType: () => [],
          iterateAllLeaves: () => undefined,
        },
        metadataCache: {
          resolvedLinks: {},
          unresolvedLinks: {},
          getFileCache: () => null,
          on: () => ({}),
          offref: () => undefined,
        },
      } as unknown as App;
      const settings = {
        providers: {
          fixture: {
            providerId: "fixture",
            providerType: "openai-compatible",
            displayName: "Fixture",
            baseUrl: "https://fixture.invalid/v1",
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
          backends: { pi: { defaultModel: { baseModelId: "saved-model", effort: null } } },
          offerFeedbackCards: false,
          notificationSound: false,
        },
        backends: { pi: { enabledModels: ["saved-model"] } },
      } as unknown as VaultAgentSettings;
      setSettings(settings);
      const keychain = {
        isAvailable: () => true,
        getVaultId: () => "queued-input-fixture",
        getSecretById: (id: string) => (id === "fixture-key" ? "fixture-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      };
      const locator = new StoreLocator({
        platform: process.platform,
        homeDir: privateRoot,
        env: {},
        vaultRoot,
        vaultId: keychain.getVaultId(),
      });
      const firstEntered = deferred<void>();
      const secondEntered = deferred<void>();
      const releaseFirst = deferred<void>();
      const queued = deferred<void>();
      let holderCalls = 0;
      let answerCalls = 0;
      let queuedSessionId: string | null = null;
      const contexts: string[] = [];
      const faux = fauxProvider();
      faux.setResponses(
        Array.from({ length: 12 }, () => async (context, request) => {
          const text = JSON.stringify(context);
          if (text.includes("HOLD-FIRST") || text.includes("HOLD-SECOND")) {
            holderCalls += 1;
            const first = text.includes("HOLD-FIRST");
            const signal = request?.signal;
            assert.ok(signal);
            const interrupted = new Promise<never>((_resolve, reject) => {
              const abort = () => reject(new Error("The holder was paused by its owner"));
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            });
            if (first) firstEntered.resolve();
            else secondEntered.resolve();
            if (first) {
              await Promise.race([releaseFirst.promise, interrupted]);
              return fauxAssistantMessage("执行位置已释放");
            }
            return interrupted;
          }
          answerCalls += 1;
          contexts.push(text);
          assert.ok(
            text.includes("QUEUE-EXPANDED-7PLUS4"),
            "the expanded original instruction reaches the model"
          );
          assert.ok(
            text.includes("QUEUE-SELECTION-7PLUS4"),
            "the original selected material reaches the model"
          );
          assert.ok(
            text.includes("第一批：7") && text.includes("第二批：4"),
            "the complete selected quantities survive the handoff instead of being replaced by another chat's total"
          );
          assert.ok(
            text.includes("queue-source.md"),
            "the attached note provenance reaches the model"
          );
          return fauxAssistantMessage("QUEUE-RESULT-11：7 + 4 = 11");
        })
      );
      const options = {
        host: {
          app,
          keychain,
          getSettings: () => settings,
          privateRoot,
          streamsFactory: () => faux.provider,
        },
      };
      let backend = new PiBackendProcess(options);
      const descriptor: BackendDescriptor = {
        id: "pi",
        displayName: "Vault Agent",
        Icon: () => null,
        routesVaultAgentModels: false,
        restartOnProviderConfigChange: false,
        summarizesSessionTitle: false,
        planLifecycle: "independent",
        createBackendProcess: () => backend,
        wire: {
          encode: (selection) => selection.baseModelId,
          decode: (id) => ({ selection: { baseModelId: id, effort: null }, provider: null }),
        },
        applySelection: (session, selection) => session.applyModelWireId(selection.baseModelId),
        getModeMapping: () => ({
          kind: "setMode",
          canonical: { default: "default", auto: "auto", plan: "plan" },
        }),
      };
      const createManager = () =>
        new AgentSessionManager(
          app,
          { manifest: { version: "1.0.0" } } as ConstructorParameters<
            typeof AgentSessionManager
          >[1],
          {
            permissionPrompter: async () => ({ outcome: { outcome: "cancelled" } }),
            resolveDescriptor: () => descriptor,
            modelPreloader: {
              getCachedModelCatalog: () => null,
              preload: async () => undefined,
              takeWarm: () => null,
              getWarmProcs: () => [],
              shutdown: () => undefined,
            } as unknown as ConstructorParameters<typeof AgentSessionManager>[2]["modelPreloader"],
          }
        );
      let manager = createManager();
      const freshQueued = deferred<void>();
      let watchFresh = false;
      const acquireDescriptor = Object.getOwnPropertyDescriptor(RuntimePool.prototype, "acquire")!;
      const originalAcquire = acquireDescriptor.value as RuntimePool["acquire"];
      RuntimePool.prototype.acquire = function (
        this: RuntimePool,
        rootKey: string,
        acquireOptions?: Parameters<RuntimePool["acquire"]>[1]
      ): ReturnType<RuntimePool["acquire"]> {
        const pending = originalAcquire.call(this, rootKey, acquireOptions) as ReturnType<
          RuntimePool["acquire"]
        >;
        if (rootKey === queuedSessionId && acquireOptions?.waitForCapacity !== false)
          queued.resolve();
        if (watchFresh && rootKey !== queuedSessionId && !rootKey.startsWith("root-held-"))
          freshQueued.resolve();
        return pending;
      };
      try {
        if (executionPhase === "writer-probe") {
          const sessionId = process.env.PI_QUEUED_ROOT_PROBE_ID;
          assert.ok(sessionId);
          const metadataPath = path.join(
            path.dirname(locator.sessionStorePaths(sessionId).metaPath),
            "session.json"
          );
          const before = await fs.readFile(metadataPath, "utf8");
          const originalOwner = JSON.parse(
            await fs.readFile(
              path.join(locator.sessionStorePaths(sessionId).leaseDir, "owner.json"),
              "utf8"
            )
          ) as { pid: number; bootId: string };
          assert.notEqual(originalOwner.pid, process.pid);
          process.kill(originalOwner.pid, 0);
          const os = requireNodeModule<typeof import("node:os")>("node:os");
          process.stderr.write(
            `queuedRootInput:remote-live-owner:${JSON.stringify({ parentPid: originalOwner.pid, parentBootId: originalOwner.bootId, childPid: process.pid, childBootEstimate: String(Math.round((Date.now() - os.uptime() * 1000) / 1000)), parentAlive: true })}\n`
          );
          try {
            await backend.start();
            await assert.rejects(
              backend
                .prompt({
                  sessionId,
                  requestId: "other-host-input",
                  prompt: [{ type: "text", text: "OTHER-WRITER-MUST-NOT-REPLACE" }],
                })
                .catch((error: unknown) => {
                  const fact = error as {
                    name?: unknown;
                    message?: unknown;
                    code?: unknown;
                    cause?: unknown;
                    stack?: unknown;
                  };
                  process.stderr.write(
                    `queuedRootInput:remote-writer-error:${JSON.stringify({ name: fact?.name, message: fact?.message, code: fact?.code, cause: fact?.cause instanceof Error ? fact.cause.message : fact?.cause, stack: fact?.stack })}\n`
                  );
                  throw error;
                }),
              { code: "STORE_BUSY" }
            );
            assert.equal(
              await fs.readFile(metadataPath, "utf8"),
              before,
              "another live process cannot modify pending metadata outside the existing SDK writer lease"
            );
            assert.equal(answerCalls, 0);
          } finally {
            await backend.shutdown();
          }
          return { status: "passed", continuedCalls: 0, checks: ["remote_writer_blocked"] };
        }
        if (executionPhase === "verify") {
          const marker = JSON.parse(
            await fs.readFile(path.join(rootDirectory, "handoff-cut.json"), "utf8")
          ) as HandoffCut;
          const restored = await manager.loadNativeSessionFromHistory("pi", marker.sessionId);
          assert.equal(answerCalls, 0, "a crashed handoff cold-open cannot start a provider");
          await restored.recoverSession("continue");
          assert.equal(
            answerCalls,
            1,
            "Continue resumes one original request across the persisted handoff cut"
          );
          await assertSingleHandoff(
            backend,
            marker.sessionId,
            marker.requestId,
            locator.sessionStorePaths(marker.sessionId).storeDir
          );
          await restored.recoverSession("continue");
          assert.equal(
            answerCalls,
            1,
            "a repeated Continue cannot duplicate the original crash-recovered request"
          );
          return {
            status: "passed",
            continuedCalls: contexts.length,
            checks: [`crash_${marker.cut}_cold_zero_single_original_handoff`],
          };
        }
        const session = await manager.createSession("pi", GLOBAL_SCOPE, {
          baseModelId: "saved-model",
          effort: null,
        });
        await session.ready;
        mark(`${action}:session-ready`);
        queuedSessionId = session.getBackendSessionId();
        assert.ok(queuedSessionId);
        const sessionId = queuedSessionId;
        backend.setSessionObserved({ sessionId, observed: false });
        const directoryForSession = path.dirname(locator.sessionStorePaths(sessionId).metaPath);
        const metadataPath = path.join(directoryForSession, "session.json");
        const readMetadata = async () =>
          JSON.parse(await fs.readFile(metadataPath, "utf8")) as { unsentInput?: UnsentRootInput };
        if (action === "close") {
          const before = await fs.readFile(metadataPath, "utf8");
          const output = childProcess.execFileSync(process.execPath, [process.argv[1], directory], {
            env: {
              ...process.env,
              PI_QUEUED_ROOT_PHASE: "writer-probe",
              PI_QUEUED_ROOT_PROBE_ID: sessionId,
            },
            encoding: "utf8",
            timeout: 20_000,
          });
          const report = JSON.parse(output.trim().split("\n").at(-1)!) as QueuedInputReport;
          assert.deepEqual(report.checks, ["remote_writer_blocked"]);
          assert.equal(
            await fs.readFile(metadataPath, "utf8"),
            before,
            "the real other process leaves this owner's metadata bytes unchanged"
          );
          assert.equal(answerCalls, 0);
        }
        for (const id of ["root-held-first", "root-held-second"]) {
          await backend.newSession({ sessionId: id, cwd: vaultRoot });
          await backend.setSessionModel({ sessionId: id, modelId: "saved-model" });
        }
        mark(`${action}:holders-created`);
        const firstTurn = trackPrompt(
          `${action}:holder-first`,
          backend.prompt({
            sessionId: "root-held-first",
            requestId: "holder-first",
            prompt: [{ type: "text", text: "HOLD-FIRST" }],
          })
        );
        await firstEntered.promise;
        mark(`${action}:first-held`);
        const secondTurn = trackPrompt(
          `${action}:holder-second`,
          backend.prompt({
            sessionId: "root-held-second",
            requestId: "holder-second",
            prompt: [{ type: "text", text: "HOLD-SECOND" }],
          })
        );
        await secondEntered.promise;
        mark(`${action}:second-held`);
        if (action === "close") {
          watchFresh = true;
          const fresh = await manager.createSession("pi", GLOBAL_SCOPE, {
            baseModelId: "saved-model",
            effort: null,
          });
          const ready = fresh.ready.then(
            () => null,
            (error: unknown) => error
          );
          await freshQueued.promise;
          await manager.closeSession(fresh.internalId, { releaseBackend: true });
          await ready;
          watchFresh = false;
          assert.equal(
            fresh.getStatus(),
            "closed",
            "closing a new tab must settle its real pending ready without waiting for an occupied slot"
          );
          assert.equal(answerCalls, 0);
          mark(`${action}:new-ready-closed`);
        }
        if (action === "stage-failure") {
          const entered = deferred<void>();
          const release = deferred<void>();
          const shuttingDown = deferred<void>();
          const failure = Object.assign(
            new Error("Injected pending-input metadata write failure"),
            { code: "EIO" }
          );
          const write = fs.writeFile;
          const shutdown = backend.shutdown.bind(backend);
          let shutdownFailure: unknown;
          let injected = false;
          fs.writeFile = async (file, data, writeOptions) => {
            if (!injected && typeof file === "string" && file.startsWith(`${metadataPath}.`)) {
              injected = true;
              entered.resolve();
              await release.promise;
              throw failure;
            }
            return write(file, data, writeOptions);
          };
          backend.shutdown = async () => {
            const closing = shutdown();
            shuttingDown.resolve();
            try {
              await closing;
            } catch (error) {
              shutdownFailure = error;
              throw error;
            }
          };
          try {
            const failedPrompt = backend
              .prompt({
                sessionId,
                requestId: "failed-stage-input",
                prompt: [{ type: "text", text: "THIS-UNSAVED-REQUEST-MUST-NEVER-RUN" }],
              })
              .then(
                (value) => ({ value, error: null }),
                (error: unknown) => ({ value: null, error })
              );
            await entered.promise;
            const closing = manager.shutdown();
            await shuttingDown.promise;
            release.resolve();
            await closing;
            const result = await failedPrompt;
            assert.equal(
              result.error,
              failure,
              "a real failed metadata write must remain a failure even when shutdown also aborts admission"
            );
            assert.equal(
              shutdownFailure,
              failure,
              "shutdown reports the original failed save after cleaning every other root"
            );
            for (const id of [sessionId, "root-held-first", "root-held-second"])
              await assert.rejects(
                fs.access(path.join(locator.sessionStorePaths(id).leaseDir, "owner.json")),
                { code: "ENOENT" },
                "one failed pending save cannot retain another root's writer lease"
              );
            for (const holder of await Promise.all([firstTurn, secondTurn])) {
              assert.equal(holder.error, null);
              assert.equal(
                holder.value?.stopReason,
                "max_turn_requests",
                "other active roots are saved as resumable pauses rather than cancelled by another request's storage failure"
              );
            }
            assert.equal(holderCalls, 2);
            assert.equal(
              answerCalls,
              0,
              "a rejected pending save cannot be executed by shutdown or a newly freed slot"
            );
            assert.equal((await readMetadata()).unsentInput, undefined);
            checks.push("failed_pending_save_reports_original_error_after_releasing_all_writers");
            continue;
          } finally {
            fs.writeFile = write;
            backend.shutdown = shutdown;
          }
        }
        const send = session.sendPrompt(
          "QUEUE-EXPANDED-7PLUS4：完整核对选中资料，第一批7，第二批4，给出总数11。",
          {
            notes: [note],
            urls: [],
            selectedTextContexts: [
              {
                id: "queue-selection",
                sourceType: "note",
                noteTitle: note.basename,
                notePath: note.path,
                startLine: 2,
                endLine: 3,
                content: "QUEUE-SELECTION-7PLUS4\n第一批：7\n第二批：4",
              },
            ],
          },
          [{ type: "resource_link", uri: `vault:${note.path}`, name: "QUEUE-ATTACHMENT-SOURCE" }]
        );
        await queued.promise;
        mark(`${action}:third-queued`);
        assert.equal(holderCalls, 2);
        assert.equal(answerCalls, 0, "the queued third root must not invoke a model");
        const saved = (await readMetadata()).unsentInput;
        assert.equal(
          saved?.kind,
          "prompt",
          "the full third-root input is durable before waiting for capacity"
        );
        assert.ok(saved && saved.kind === "prompt");
        const originalRequestId = saved.input.requestId;
        assert.ok(originalRequestId, "the queued handoff has a stable original request id");
        const restoredDraft = await restoreUnsentRootInput(saved, directoryForSession);
        assert.equal(restoredDraft.kind, "prompt");
        assert.ok(restoredDraft.kind === "prompt");
        const originalInput: PromptInput = restoredDraft.input;
        assert.ok(JSON.stringify(originalInput).includes("QUEUE-EXPANDED-7PLUS4"));
        assert.ok(JSON.stringify(originalInput).includes("QUEUE-SELECTION-7PLUS4"));
        assert.ok(JSON.stringify(originalInput).includes("vault:queue-source.md"));
        mark(`${action}:input-durable`);
        if (action === "stop") {
          await session.cancel();
          await send.turn;
          assert.equal(
            (await readMetadata()).unsentInput,
            undefined,
            "Stop removes the unsubmitted request"
          );
          await manager.closeSession(session.internalId, { releaseBackend: true });
        } else if (action === "shutdown") {
          await manager.shutdown();
          await send.turn;
        } else {
          const closing = manager.closeSession(session.internalId, { releaseBackend: true });
          if (action === "slot-release") releaseFirst.resolve();
          await closing;
          await send.turn;
        }
        assert.equal(
          answerCalls,
          0,
          "closing or stopping a queued request never wakes it when a slot is freed"
        );
        mark(`${action}:closed`);
        await manager.shutdown();
        const holders = await Promise.all([firstTurn, secondTurn]);
        for (const holder of holders)
          assert.equal(
            holder.error,
            null,
            `${holder.label} must settle before its owner closes SDK storage`
          );
        mark(`${action}:unloaded`);
        assert.equal(answerCalls, 0, "unloading the runtime never executes a queued request");
        const snapshot = (await readMetadata()).unsentInput;
        if (action !== "stop") {
          assert.deepEqual(
            snapshot,
            saved,
            "closing and unloading retain the complete original handoff"
          );
        }
        backend = new PiBackendProcess(options);
        manager = createManager();
        const restored = await manager.loadNativeSessionFromHistory("pi", sessionId);
        mark(`${action}:cold-open`);
        assert.equal(answerCalls, 0, "opening queued history makes zero model requests");
        if (action === "stop") {
          assert.notEqual(restored.getRecoveryState()?.status, "available");
          await restored.recoverSession("continue");
          mark(`${action}:continued`);
          assert.equal(answerCalls, 0, "Continue after Stop cannot resurrect the removed request");
        } else {
          assert.equal(restored.getRecoveryState()?.status, "available");
          assert.ok(
            restored.store
              .getDisplayMessages()
              .some((message) => message.message.includes("QUEUE-EXPANDED-7PLUS4")),
            "the cold chat displays the original unsubmitted text"
          );
          const append = fs.appendFile;
          if (executionPhase === "cut") {
            assert.ok(cut);
            let workDocumentId: unknown;
            const workGoals = new Set<unknown>();
            fs.appendFile = async (file, data, appendOptions) => {
              await append(file, data, appendOptions);
              if (typeof file !== "string") return;
              const content = typeof data === "string" ? data : new TextDecoder().decode(data);
              if (
                path.basename(file).startsWith("doc-") &&
                content.includes("QUEUE-EXPANDED-7PLUS4")
              ) {
                for (const line of content.trim().split("\n")) {
                  const record = JSON.parse(line) as { payload?: { id?: unknown } };
                  if (record.payload?.id !== undefined) workGoals.add(record.payload.id);
                }
              }
              if (!file.endsWith("main.jsonl")) return;
              const transaction = JSON.parse(content) as {
                writes: {
                  type: string;
                  id?: unknown;
                  record?: { id?: unknown; kind?: string; docKind?: string };
                  value?: {
                    kind?: string;
                    type?: string;
                    requestId?: string;
                    status?: string;
                    data?: { requestId?: string; status?: string };
                  };
                }[];
              };
              for (const write of transaction.writes)
                if (
                  write.type === "document.create" &&
                  (write.record?.kind === "va.work-items" ||
                    write.record?.docKind === "va.work-items")
                )
                  workDocumentId = write.record.id;
              const afterWork =
                cut === "work-item" &&
                workGoals.has(workDocumentId) &&
                transaction.writes.some(
                  (write) =>
                    (write.type === "document.change" && write.id === workDocumentId) ||
                    (write.type === "document.create" && write.record?.id === workDocumentId)
                );
              const afterRun =
                cut === "run-record" &&
                transaction.writes.some(
                  (write) =>
                    write.type === "entry" &&
                    write.value?.kind === "va.run" &&
                    write.value.data?.requestId === originalRequestId &&
                    write.value.data.status === "running"
                );
              const afterSubmit =
                cut === "sdk-input" &&
                transaction.writes.some(
                  (write) =>
                    write.type === "submission" &&
                    write.value?.type === "input" &&
                    write.value.requestId === originalRequestId
                );
              if (!afterWork && !afterRun && !afterSubmit) return;
              assert.equal(
                answerCalls,
                0,
                "the process cut must occur before the original provider dispatch"
              );
              await fs.writeFile(
                path.join(rootDirectory, "handoff-cut.json"),
                JSON.stringify({
                  sessionId,
                  requestId: originalRequestId,
                  cut,
                } satisfies HandoffCut)
              );
              await new Promise<void>((resolve) =>
                process.stdout.write(
                  `${JSON.stringify({ status: "passed", continuedCalls: 0, checks: [`cut_${cut}`] })}\n`,
                  () => resolve()
                )
              );
              process.exit(0);
            };
          }
          try {
            await restored.recoverSession("continue");
          } finally {
            fs.appendFile = append;
          }
          if (executionPhase === "cut")
            assert.fail(`the requested crash cut ${cut} was never reached`);
          assert.equal(answerCalls, 1, "Continue submits exactly one original queued input");
          assert.equal(
            (await readMetadata()).unsentInput,
            undefined,
            "only a successful SDK handoff clears the pending input"
          );
          assert.ok(
            restored.store
              .getDisplayMessages()
              .some((message) => message.message.includes("QUEUE-RESULT-11"))
          );
          await assertSingleHandoff(
            backend,
            sessionId,
            originalRequestId,
            locator.sessionStorePaths(sessionId).storeDir
          );
          await restored.recoverSession("continue");
          assert.equal(answerCalls, 1, "a second Continue does not resubmit the handed-off input");
          continuedCalls += contexts.length;
        }
        checks.push(`${action}_cold_zero_original_input_and_request_identity`);
      } finally {
        Object.defineProperty(RuntimePool.prototype, "acquire", acquireDescriptor);
        await manager.shutdown();
      }
    }
    if (executionPhase === "all") {
      for (const point of ["work-item", "run-record", "sdk-input"]) {
        const target = path.join(directory, `crash-${point}`);
        for (const step of ["cut", "verify"]) {
          const output = childProcess.execFileSync(process.execPath, [process.argv[1], target], {
            env: { ...process.env, PI_QUEUED_ROOT_PHASE: step, PI_QUEUED_ROOT_CUT: point },
            encoding: "utf8",
            timeout: 20_000,
          });
          const report = JSON.parse(output.trim().split("\n").at(-1)!) as QueuedInputReport;
          assert.equal(report.status, "passed");
          if (step === "verify") checks.push(...report.checks);
        }
      }
      checks.push(
        "second_writer_cannot_replace_metadata_outside_store_lease",
        "new_tab_close_settles_queued_ready_without_provider"
      );
    }
    return { status: "passed", continuedCalls, checks };
  } finally {
    window.clearTimeout(deadline);
  }
}

async function assertSingleHandoff(
  backend: PiBackendProcess,
  sessionId: string,
  requestId: string,
  storeDir: string
) {
  const document = JSON.parse(
    (await backend.exportSession({ sessionId, format: "json" })).content
  ) as {
    session: {
      extras: {
        entries: {
          kind: string;
          data?: { requestId?: string; runId?: string };
          model?: { role?: string; content?: { type?: string; text?: string }[] }[];
        }[];
      };
    };
  };
  const entries = document.session.extras.entries;
  assert.equal(
    entries.filter((entry) => entry.kind === "va.input" && entry.data?.requestId === requestId)
      .length,
    1,
    "one original request owns only one durable input receipt"
  );
  assert.equal(
    new Set(
      entries
        .filter((entry) => entry.kind === "va.run" && entry.data?.requestId === requestId)
        .map((entry) => entry.data?.runId)
    ).size,
    1,
    "bookkeeping before SDK handoff reuses the original work and budget identity"
  );
  assert.equal(
    entries.filter(
      (entry) =>
        entry.kind === "pi.user" &&
        entry.model?.some((message) =>
          message.content?.some((part) => part.text?.includes("QUEUE-EXPANDED-7PLUS4"))
        )
    ).length,
    1,
    "the SDK receives the original user message exactly once"
  );
  const workIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const object = value as Record<string, unknown>;
    const checkpoint = object.checkpoint as { goal?: unknown } | undefined;
    if (
      typeof object.id === "string" &&
      Array.isArray(object.grants) &&
      typeof checkpoint?.goal === "string" &&
      checkpoint.goal.includes("QUEUE-EXPANDED-7PLUS4")
    )
      workIds.add(object.id);
    for (const field of Object.values(object)) visit(field);
  };
  for (const file of await fs.readdir(storeDir)) {
    if (!file.startsWith("doc-") || !file.endsWith(".jsonl")) continue;
    for (const line of (await fs.readFile(path.join(storeDir, file), "utf8")).trim().split("\n"))
      if (line) visit(JSON.parse(line));
  }
  assert.equal(
    workIds.size,
    1,
    "a crash before SDK submission cannot leave an orphan WorkItem with a separate budget grant"
  );
}
