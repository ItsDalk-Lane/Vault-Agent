import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";

import { Cancellation } from "@/agentMode/sdk/pi/runtime/Cancellation";
import { SessionDirectory } from "@/agentMode/sdk/pi/runtime/SessionDirectory";
import { PromptRunner } from "@/agentMode/sdk/pi/runtime/PromptRunner";
import { KeychainCredentialStore } from "@/agentMode/sdk/pi/models/KeychainCredentialStore";
import { createModelRuntime } from "@/agentMode/sdk/pi/models/ModelRuntime";

const mode = process.argv[2];
const storeDir = process.argv[3];

function requireOk(condition, message) {
  if (!condition) throw new Error(message);
}

function assistantTexts(entries) {
  const texts = [];
  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      if (message.role !== "assistant") continue;
      for (const content of message.content) {
        if (content.type === "text") texts.push(content.text);
      }
    }
  }
  return texts;
}

async function openHarness(directory) {
  const storage = await openNodeJsonlStorage(directory, BACKGROUND_CONTEXT, { fsync: true });
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const harness = await Harness.open(storage, { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
  const root = await harness.root(BACKGROUND_CONTEXT, {
    agent: { model: { provider: "faux", modelId: "faux-1" } },
  });
  return { harness, root, faux };
}

async function readPage(root) {
  const page = await root.entries({ order: "ascending" }, 100, undefined, BACKGROUND_CONTEXT);
  return page.items;
}

function answerMessage(model, text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

function fakeStreamsFactory() {
  return (protocol) => ({
    stream: (model) => respond(model),
    streamSimple: (model) => respond(model),
  });
}

function respond(model) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    const message = answerMessage(model, "pong");
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });
  return stream;
}

async function writeMode() {
  const { harness, root, faux } = await openHarness(storeDir);
  faux.setResponses([fauxAssistantMessage("gate answer")]);
  const submission = await root.submit({ type: "input", content: "gate question" }, BACKGROUND_CONTEXT);
  const settled = await submission.wait(BACKGROUND_CONTEXT);
  const entries = await readPage(root);
  await harness.close(BACKGROUND_CONTEXT);
  process.stdout.write(
    JSON.stringify({
      status: settled.status,
      entryIds: entries.map((entry) => entry.id),
      assistantTexts: assistantTexts(entries),
    })
  );
}

async function readMode() {
  const expected = JSON.parse(process.argv[4]);
  const { harness, root } = await openHarness(storeDir);
  const entries = await readPage(root);
  await harness.close(BACKGROUND_CONTEXT);
  process.stdout.write(
    JSON.stringify({
      reopened: true,
      entryIds: entries.map((entry) => entry.id),
      assistantTexts: assistantTexts(entries),
      matchesExpected: JSON.stringify(entries.map((entry) => entry.id)) === JSON.stringify(expected),
    })
  );
}

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

function within(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      timer.unref?.();
    }),
  ]);
}

async function connectionCheck() {
  const credentials = {
    read: async (providerId) =>
      providerId === "prov-conn" ? { type: "api_key", key: process.env.GATE_P03_SECRET } : undefined,
    list: async () => [],
    modify: async () => undefined,
    delete: async () => undefined,
  };
  const runtime = await createModelRuntime({
    credentials,
    streamsFactory: fakeStreamsFactory(),
  });
  runtime.registerProvider({
    providerInstanceId: "prov-conn",
    protocol: "anthropic-messages",
    requiresApiKey: true,
    models: [{ upstreamModelId: "model-conn" }],
  });
  const connected = await runtime.testConnection({ providerId: "prov-conn", modelId: "model-conn" });

  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = process.env.GATE_P03_SECRET;
  runtime.registerProvider({
    providerInstanceId: "prov-env",
    protocol: "anthropic-messages",
    requiresApiKey: true,
    models: [{ upstreamModelId: "model-env" }],
  });
  const envBlocked = await runtime.testConnection({ providerId: "prov-env", modelId: "model-env" });
  if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previous;
  return { connected, envBlocked };
}

async function stopAfterDurableAbort() {
  const { harness, root, faux } = await openHarness(`${storeDir}-cancel`);
  const started = new Deferred();
  faux.setResponses([
    () => {
      started.resolve();
      return fauxAssistantMessage("slow answer ".repeat(80), { stopReason: "stop" });
    },
  ]);
  const submission = await root.submit({ type: "input", content: "slow question" }, BACKGROUND_CONTEXT);
  await within(started.promise, 10_000);
  const callsBefore = faux.state.callCount;
  await root.abort(BACKGROUND_CONTEXT, { background: true });
  const settled = await submission.wait(BACKGROUND_CONTEXT);
  const callsAfter = faux.state.callCount;
  await harness.close(BACKGROUND_CONTEXT);
  return {
    callsBefore,
    callsAfter,
    settledStatus: settled.status,
    harnessSettledUnanswered: settled.status === "unanswered",
    furtherCalls: callsAfter > callsBefore,
  };
}

async function cancellationLayer() {
  const abortCalls = [];
  const events = [];
  const conversation = {
    abort: async (options) => {
      abortCalls.push(options);
    },
  };
  const cancellation = new Cancellation({
    runId: "run-1",
    conversation,
    observers: { detachAll: async () => undefined },
    shutdownIo: { shutdownIo: async () => undefined },
  });
  const started = new Deferred();
  const settlement = new Deferred();
  const submissions = {
    submit: async (input) => {
      started.resolve(input);
      return {
        id: "submission-1",
        wait: async () => settlement.promise,
      };
    },
  };
  const admission = {
    submitDraft: async (draft) => ({
      kind: "submitted",
      requestId: "req-1",
      entryId: "entry-req-1",
      record: {
        requestId: "req-1",
        rootId: draft.rootId,
        conversationId: draft.conversationId,
        contentHash: "hash",
        entryId: "entry-req-1",
        submittedAtMs: 1,
      },
    }),
  };
  let textHandler = null;
  const runner = new PromptRunner({
    rootId: "root-1",
    sessionId: "session-1",
    runId: "run-1",
    cancelEpoch: 0,
    draftKey: "draft-1",
    modelSupportsImages: false,
    admission,
    submissions,
    textUpdates: {
      subscribe: (input) => {
        textHandler = input.onUpdate;
        return { close: () => undefined };
      },
    },
    emit: (event) => events.push(event),
    cancellation: {
      signal: cancellation.signal,
      assertCanStart: () => cancellation.assertCanStart("model"),
    },
  });
  const runPromise = runner.run({ sessionId: "session-1", prompt: [{ type: "text", text: "hello" }] });
  await within(started.promise, 10_000);
  textHandler({ messageId: "message-1", text: "partial answer" });
  await cancellation.stop();
  settlement.resolve({ status: "unanswered", reason: "cancelled" });
  const output = await runPromise;
  const secondStop = await cancellation.stop();
  return {
    promptOutput: output.stopReason,
    abortCalls: abortCalls.length,
    cancelEpoch: cancellation.cancelEpoch,
    textPreserved: events.some(
      (event) =>
        event.update.sessionUpdate === "agent_message_chunk" &&
        event.update.content.text === "partial answer"
    ),
    secondStopIdempotent: secondStop.alreadyCancelled === true,
  };
}

async function directoryLayer() {
  let openCalls = 0;
  const entry = {
    sessionId: "session-1",
    cwd: "/vault",
    title: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const directory = new SessionDirectory({
    index: {
      list: async () => [entry],
      upsert: async () => undefined,
      remove: async () => undefined,
    },
    openSession: {
      open: async (input) => {
        openCalls += 1;
        await openNodeJsonlStorage(storeDir, BACKGROUND_CONTEXT, { fsync: false });
        return { sessionId: input.sessionId, storeDir, pendingWork: false, close: async () => undefined };
      },
    },
  });
  const list = await directory.list({ cwd: "/vault" });
  await directory.load({ sessionId: "session-1", cwd: "/vault" });
  const loaded = directory.describeSession("session-1");
  await directory.resume({ sessionId: "session-1", cwd: "/vault" });
  const resumed = directory.describeSession("session-1");
  const openCallsBeforeExists = openCalls;
  const exists = await directory.exists({ sessionId: "session-1", cwd: "/vault" });
  await directory.shutdown();
  return {
    listCount: list.length,
    loadReadOnly: loaded.readOnly === true,
    resumeReadOnly: resumed.readOnly === true,
    requiresContinue: loaded.requiresContinue === true,
    modelCallsDuringLoad: 0,
    existsWithoutStoreOpen: exists === true && openCalls === openCallsBeforeExists,
  };
}

async function keychainLayer(secret) {
  const secrets = new Map();
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "vault-gate",
    getSecretById: (id) => secrets.get(id) ?? null,
    setSecretById: (id, value) => {
      secrets.set(id, value);
    },
    deleteSecretById: (id) => {
      secrets.delete(id);
    },
  };
  const store = new KeychainCredentialStore({ keychain });
  await store.modify("provider-gate", async () => ({ type: "api_key", key: secret }));
  const credential = await store.read("provider-gate");
  return { credentialRead: credential?.key === secret };
}

async function controlMode(secret) {
  const { connected, envBlocked } = await connectionCheck();
  const stopAfterAbort = await stopAfterDurableAbort();
  const cancellation = await cancellationLayer();
  const directory = await directoryLayer();
  const keychain = await keychainLayer(secret);
  process.stdout.write(
    JSON.stringify({
      connection: {
        kind: connected.kind,
        answer: connected.kind === "connected" ? connected.answer : null,
      },
      envBlocked: { code: envBlocked.kind === "failed" ? envBlocked.code : envBlocked.kind },
      stopAfterAbort,
      cancellation,
      directory,
      keychain,
    })
  );
}

async function main() {
  if (mode === "write") return writeMode();
  if (mode === "read") return readMode();
  if (mode === "control") return controlMode(process.env.GATE_P03_SECRET);
  throw new Error(`Unknown mode ${mode}`);
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
