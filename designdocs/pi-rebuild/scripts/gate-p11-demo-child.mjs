import {
  enabledFanoutModels,
  isFanoutModels,
  resolveAnswererModels,
} from "@/agentMode/session/fanout/answerers";
import {
  FANOUT_ENGINE_ID,
  modelKeyForLegacyBackend,
  parseFanoutComposite,
  readFanoutTurn,
  serializeFanoutComposite,
  type FanoutTurn,
} from "@/agentMode/session/fanout/fanoutTypes";
import { FanoutRunner } from "@/agentMode/sdk/pi/features/fanout/FanoutRunner";
import { FanoutSynthesis } from "@/agentMode/sdk/pi/features/fanout/FanoutSynthesis";
import { FanoutRecovery } from "@/agentMode/sdk/pi/features/fanout/FanoutRecovery";
import { projectFanoutTurn } from "@/agentMode/sdk/pi/events/FanoutProjection";

// GATE-P11 child: drives the real fan-out modules over fake hosts — modelKey selection, read-only
// concurrent candidates, synthesis with real sources, the card projection and crash recovery with
// historical export:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const report = {};

const models = [
  { modelKey: "anthropic/claude", engineId: "pi", hasKey: true, label: "Claude" },
  { modelKey: "openai/gpt", engineId: "pi", hasKey: true, label: "GPT" },
  { modelKey: "pi/synth", engineId: "pi", hasKey: true, label: "Synthesizer" },
  { modelKey: "pi/no-key", engineId: "pi", hasKey: false },
];
const selected = resolveAnswererModels({
  mentionedModelKeys: ["anthropic/claude", "openai/gpt", "anthropic/claude"],
  availableModels: models,
});
report.selection =
  FANOUT_ENGINE_ID === "pi" &&
  selected.join(",") === "anthropic/claude,openai/gpt" &&
  enabledFanoutModels(models).length === 3 &&
  isFanoutModels(selected, "anthropic/claude") === true;
let foreignEngine = "";
try {
  resolveAnswererModels({
    mentionedModelKeys: ["anthropic/claude", "codex-cli/default"],
    availableModels: [
      { modelKey: "anthropic/claude", engineId: "pi", hasKey: true },
      { modelKey: "codex-cli/default", engineId: "codex-cli", hasKey: true },
    ],
  });
} catch (thrown) {
  foreignEngine = thrown?.code ?? "";
}
let noKey = "";
try {
  resolveAnswererModels({
    mentionedModelKeys: ["anthropic/claude", "pi/no-key"],
    availableModels: models,
  });
} catch (thrown) {
  noKey = thrown?.code ?? "";
}
report.selectionGuards = foreignEngine === "FANOUT_ENGINE_MISMATCH" && noKey === "FANOUT_MODEL_NO_KEY";

// read-only concurrent candidates
const dispatchCalls = [];
const runner = new FanoutRunner({
  fanoutId: "fanout-1",
  context: { prompt: "approved question", digest: "digest-1" },
  parentTools: ["vault_read", "vault_search", "vault_write"],
  parentEffects: ["read", "state", "write"],
  ports: {
    runSlot: async (input) => {
      dispatchCalls.push({
        slotId: input.slotId,
        modelKey: input.modelKey,
        requestId: input.requestId,
        tools: input.tools.join(","),
        effects: input.effects.join(","),
      });
      if (input.slotId === "slot-2") {
        return { status: "error", error: "provider timeout" };
      }
      return {
        status: "done",
        text: `${input.modelKey} answer`,
        usage: { usd: 0.01, usageId: `usage-${input.slotId}` },
      };
    },
    persist: async () => undefined,
    load: async () => [],
  },
});
const runSummary = await runner.run([
  { slotId: "slot-1", modelKey: "anthropic/claude" },
  { slotId: "slot-2", modelKey: "openai/gpt" },
]);
report.candidates =
  runSummary.succeeded === 1 &&
  runSummary.failed === 1 &&
  runSummary.synthesisAllowed === true &&
  dispatchCalls.length === 2 &&
  dispatchCalls.every(
    (call) =>
      call.tools === "vault_read,vault_search" &&
      call.effects === "read,state" &&
      call.requestId === `fanout:fanout-1:${call.slotId}`
  ) &&
  runSummary.results[0].usage?.usageId === "usage-slot-1";

// synthesis over the real candidate results
const synthesisCalls = [];
const synthesisPorts = {
  runSynthesis: async (input) => {
    synthesisCalls.push({ modelKey: input.modelKey, requestId: input.requestId, prompt: input.prompt });
    return { status: "done", text: "Only Claude answered 42; GPT timed out." };
  },
  persist: async () => undefined,
};
const synthesis = new FanoutSynthesis({
  fanoutId: "fanout-1",
  synthesisModelKey: "pi/synth",
  availableModels: models,
  ports: synthesisPorts,
});
const synthesisRecord = await synthesis.synthesize(
  runSummary.results.map((slot) => ({
    slotId: slot.slotId,
    modelKey: slot.modelKey,
    status: slot.status === "done" ? "done" : "error",
    text: slot.text,
    ...(slot.error !== undefined ? { error: slot.error } : {}),
  }))
);
const allFailed = await synthesis.synthesize([
  { slotId: "slot-1", modelKey: "anthropic/claude", status: "error", text: "", error: "boom" },
  { slotId: "slot-2", modelKey: "openai/gpt", status: "error", text: "", error: "boom" },
]);
report.synthesis =
  synthesisRecord.state === "synthesized" &&
  synthesisRecord.synthesisModelKey === "pi/synth" &&
  synthesisCalls.length === 1 &&
  synthesisCalls[0].requestId === "fanout-synthesis:fanout-1" &&
  synthesisCalls[0].prompt.includes("anthropic/claude answer") &&
  synthesisCalls[0].prompt.includes("provider timeout") &&
  allFailed.state === "skipped_all_failed" &&
  synthesisCalls.length === 1;

// card projection: unfinished candidate, empty answer, copy, synthesis sources
const projectionTurn = {
  answers: {
    "slot-1": {
      backendId: "slot-1",
      status: "done",
      text: "claude answer body",
      modelKey: "anthropic/claude",
    },
    "slot-2": {
      backendId: "slot-2",
      status: "running",
      text: "",
      modelKey: "openai/gpt",
    },
    "slot-3": {
      backendId: "slot-3",
      status: "done",
      text: "   ",
      modelKey: "pi/third",
    },
  },
  summary: { status: "streaming", text: "" },
};
const card = projectFanoutTurn({
  turn: projectionTurn,
  labelFor: (modelKey) => models.find((model) => model.modelKey === modelKey)?.label,
  synthesis: synthesisRecord,
});
report.card =
  card.candidates.find((entry) => entry.slotId === "slot-2")?.state === "running" &&
  card.candidates.find((entry) => entry.slotId === "slot-3")?.state === "error" &&
  card.candidates.find((entry) => entry.slotId === "slot-3")?.emptyAnswer === true &&
  card.candidates.find((entry) => entry.slotId === "slot-1")?.label === "Claude" &&
  card.summary.synthesisModelKey === "pi/synth" &&
  card.summary.sources.map((source) => source.slotId).join(",") === "slot-1" &&
  card.summary.copyText.includes("claude answer body");

// recovery: reopen reads only, resume only pending after confirmation, synthesis once, history intact
const storedSlots = [
  {
    fanoutId: "fanout-1",
    slotId: "slot-1",
    modelKey: "anthropic/claude",
    requestId: "fanout:fanout-1:slot-1",
    status: "done",
    text: "claude answer",
  },
  {
    fanoutId: "fanout-1",
    slotId: "slot-2",
    modelKey: "openai/gpt",
    requestId: "fanout:fanout-1:slot-2",
    status: "cancelled",
    text: "",
  },
];
const recoveryCalls = { resumed: [], synthesis: 0, persisted: [], followUps: [], writes: [] };
const historyComposite = [
  "<!--copilot:multi-agent v=1-->",
  "<!--copilot:summary-->",
  "### Summary",
  "old summary",
  '<!--copilot:agent id="codex" name="Codex" status="done"-->',
  "### Codex",
  "old answer",
  "<!--copilot:multi-agent-end-->",
].join("\n");
const recovery = new FanoutRecovery({
  fanoutId: "fanout-1",
  ports: {
    load: async () => ({ slots: storedSlots, composite: historyComposite }),
    resumeSlots: async (slots) => {
      recoveryCalls.resumed.push(slots.map((slot) => slot.slotId).join(","));
      return {
        fanoutId: "fanout-1",
        results: slots.map((slot) => ({
          fanoutId: "fanout-1",
          slotId: slot.slotId,
          modelKey: slot.modelKey,
          requestId: `fanout:fanout-1:${slot.slotId}`,
          status: "done",
          text: "resumed answer",
        })),
        succeeded: slots.length,
        failed: 0,
        cancelled: 0,
        synthesisAllowed: true,
      };
    },
    persistState: async (input) => recoveryCalls.persisted.push(input.pendingSlotIds.join(",")),
    startFollowUpRun: async (input) => {
      recoveryCalls.followUps.push(input.prompt);
      return { runId: "run-follow-up-1", permissions: "default" };
    },
    writeVault: async (path) => recoveryCalls.writes.push(path),
  },
  synthesis: {
    synthesize: async (candidates) => {
      recoveryCalls.synthesis += 1;
      return {
        fanoutId: "fanout-1",
        state: "synthesized",
        synthesisModelKey: "pi/synth",
        requestId: "fanout-synthesis:fanout-1",
        text: `synthesis of ${candidates.length} candidates`,
        succeededSlotIds: candidates.filter((c) => c.status === "done").map((c) => c.slotId),
        failureNotes: [],
        consensusVerified: true,
        warnings: [],
        evaluation: { kind: "unavailable", reason: "none" },
      };
    },
  },
});
const reopened = await recovery.reopen();
const unconfirmed = await recovery.resumePending({ userConfirmed: false });
const resumed = await recovery.resumePending({ userConfirmed: true });
const resumedAgain = await recovery.resumePending({ userConfirmed: true });
const followUp = await recovery.requestFollowUp({ prompt: "Apply the changes now." });
report.recovery =
  reopened.completed.length === 1 &&
  reopened.pending.map((slot) => slot.slotId).join(",") === "slot-2" &&
  recoveryCalls.resumed.length === 1 &&
  recoveryCalls.resumed[0] === "slot-2" &&
  unconfirmed.resumedSlotIds.length === 0 &&
  recoveryCalls.resumed.length === 1 &&
  recoveryCalls.synthesis === 1 &&
  resumedAgain.synthesis?.requestId === "fanout-synthesis:fanout-1" &&
  recoveryCalls.synthesis === 1 &&
  reopened.card.summary.text === "old summary" &&
  reopened.card.candidates[0].label === "Codex" &&
  followUp.permissions === "default" &&
  recoveryCalls.followUps.length === 1 &&
  recoveryCalls.writes.length === 0;

// history export round-trip (old Markdown → parse → read → serialize)
const legacyParsed = parseFanoutComposite(historyComposite);
const legacyRead = readFanoutTurn(
  legacyParsed ?? { answers: {}, summary: { status: "done", text: "" } }
);
const exported = serializeFanoutComposite(legacyRead, (slotId) => slotId);
const exportedTurn = parseFanoutComposite(exported);
report.history =
  legacyRead.answers.codex?.modelKey === modelKeyForLegacyBackend("codex") &&
  legacyRead.answers.codex?.label === "Codex" &&
  exportedTurn?.answers.codex?.text === "old answer" &&
  exportedTurn?.answers.codex?.modelKey === modelKeyForLegacyBackend("codex");

report.result = "passed";
process.stdout.write(JSON.stringify(report));
