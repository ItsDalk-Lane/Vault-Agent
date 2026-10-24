import { Todos } from "@/agentMode/sdk/pi/features/Todos";
import { Plans } from "@/agentMode/sdk/pi/features/Plans";
import { PlanDecisionService } from "@/agentMode/sdk/pi/features/PlanDecision";
import { Questions } from "@/agentMode/sdk/pi/features/Questions";
import { QuestionBridge } from "@/agentMode/sdk/pi/features/QuestionBridge";
import { CompactionService } from "@/agentMode/sdk/pi/features/Compaction";
import { FeedbackService } from "@/agentMode/sdk/pi/features/Feedback";
import { BudgetProjectionTracker, projectBudget } from "@/agentMode/sdk/pi/features/BudgetProjection";
import { toCurrentPlan } from "@/agentMode/sdk/pi/events/PlanProjection";
import { toCompactionPart } from "@/agentMode/sdk/pi/events/CompactionProjection";

// GATE-P08 child: drives the real control-feature modules over fake stores/prompter/uploader to
// prove every control tool runs, an approved plan does not gain write permission, compaction keeps
// the original history, and feedback never uploads without the user's confirmation:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryTodoStore {
  state = { revision: 0, items: [] };
  results = new Map();
  commits = 0;
  events = [];
  async read() {
    return this.state;
  }
  async findResult(callId) {
    return this.results.get(callId);
  }
  async commit(input) {
    if (input.expectedRevision !== this.state.revision) throw new Error("revision conflict");
    this.commits += 1;
    this.events.push(input.event);
    this.results.set(input.callId, input.result);
    this.state = input.next;
  }
}

class MemoryPlanStore {
  current = null;
  events = [];
  async read() {
    return this.current;
  }
  async commit(input) {
    this.events.push(input.event);
    this.current = input.plan;
  }
}

class FakeMode {
  mode = "plan";
  convergeCalls = 0;
  current() {
    return this.mode;
  }
  async convergeToDefault() {
    this.convergeCalls += 1;
    this.mode = "default";
  }
}

class MemoryQuestionStore {
  documents = new Map();
  async read(requestId) {
    return this.documents.get(requestId);
  }
  async save(document) {
    this.documents.set(document.requestId, document);
  }
}

class MemoryCompactionTasks {
  starts = [];
  finishes = [];
  placement = { placed: true, appliedToContextHead: true, preTokens: 120, postTokens: 40 };
  #next = 1;
  async startCompaction(input) {
    this.starts.push(input);
    return { taskId: `task-${this.#next++}` };
  }
  async runCompaction(input) {
    return { submissionId: `submission-${input.taskId}`, placement: this.placement };
  }
  async finishCompaction(input) {
    this.finishes.push(input);
  }
}

class MemoryCompactionContext {
  entriesList = [
    { id: "entry-1", kind: "user" },
    { id: "entry-2", kind: "assistant" },
  ];
  async entries() {
    return this.entriesList;
  }
  async contextHead() {
    return { entryId: "entry-2" };
  }
}

class MemorySnapshots {
  saved = [];
  async save(snapshot) {
    this.saved.push(snapshot);
  }
}

class MemoryFeedbackStore {
  state = { turnedOff: false, offers: [] };
  async load() {
    return this.state;
  }
  async save(state) {
    this.state = state;
  }
}

class FakeReporter {
  submissions = [];
  async submit(payload) {
    this.submissions.push(payload);
    return { reportId: "report-1", issueUrl: "https://example.test/issues/1" };
  }
}

async function main() {
  const startedAt = Date.now();

  const todoStore = new MemoryTodoStore();
  const todos = new Todos({ store: todoStore, now: () => 1_000 });
  const todoFirst = await todos.setTodos({
    callId: "call-1",
    expectedRevision: 0,
    items: [
      { text: "read the design", status: "completed", priority: "high" },
      { text: "write the code", status: "in_progress", priority: "medium" },
    ],
  });
  const todoReplay = await todos.setTodos({
    callId: "call-1",
    expectedRevision: 0,
    items: [
      { text: "read the design", status: "completed", priority: "high" },
      { text: "write the code", status: "in_progress", priority: "medium" },
    ],
  });
  let todoConflict = "";
  try {
    await todos.setTodos({ callId: "call-2", expectedRevision: 0, items: [] });
  } catch (error) {
    todoConflict = error?.code ?? "";
  }
  const todoPlanEntries = todos.toPlanEntries(todoFirst);
  const todoSessionUpdate = todos.toSessionUpdate(todoFirst);

  const planStore = new MemoryPlanStore();
  const plans = new Plans({ store: planStore, now: () => 1_000 });
  const planV1 = await plans.propose({
    title: "Ship the refactor",
    body: "1. read the design",
    steps: ["read the design"],
    pendingToolCallId: "tool-call-1",
  });
  const planV2 = await plans.propose({
    title: "Ship the refactor",
    body: "1. read the design\n2. write the code",
    steps: ["read the design", "write the code"],
    pendingToolCallId: "tool-call-2",
  });
  let stalePlanApproval = "";
  try {
    await plans.decide({ planId: planV1.planId, revision: 1, action: "approve" });
  } catch (error) {
    stalePlanApproval = error?.code ?? "";
  }
  const projectedPlan = toCurrentPlan(planV2);

  const mode = new FakeMode();
  const feedbackInputs = [];
  const writeGateCalls = [];
  const planDecision = new PlanDecisionService({
    plans,
    mode,
    feedback: {
      submit: async (input) => {
        feedbackInputs.push(input);
      },
    },
    writeGate: {
      isWriteApprovalRequired: async (path) => {
        writeGateCalls.push(path);
        return true;
      },
    },
  });
  const approved = await planDecision.decide({
    decisionId: "decision-1",
    planId: planV2.planId,
    revision: planV2.revision,
    action: "approve",
  });
  const replayedDecision = await planDecision.decide({
    decisionId: "decision-1",
    planId: planV2.planId,
    revision: planV2.revision,
    action: "approve",
  });

  const questionStore = new MemoryQuestionStore();
  const questions = new Questions({ store: questionStore, now: () => 1_000 });
  const prompts = [];
  const bridge = new QuestionBridge({
    questions,
    sessionId: "session-1",
    prompter: async (prompt) => {
      prompts.push(prompt);
      return { files: "A, B", other: "my own answer" };
    },
  });
  const questionResult = await bridge.ask({
    requestId: "ask-1",
    questions: [
      {
        question: "Which files?",
        options: [{ label: "A" }, { label: "B" }, { label: "C" }],
        multiSelect: true,
        answerKey: "files",
      },
      {
        question: "Anything else?",
        options: [{ label: "Yes" }, { label: "No" }],
        allowOther: true,
        answerKey: "other",
      },
    ],
  });
  const questionReplay = await bridge.ask({
    requestId: "ask-1",
    questions: [
      {
        question: "Which files?",
        options: [{ label: "A" }, { label: "B" }, { label: "C" }],
        multiSelect: true,
        answerKey: "files",
      },
      {
        question: "Anything else?",
        options: [{ label: "Yes" }, { label: "No" }],
        allowOther: true,
        answerKey: "other",
      },
    ],
  });

  const compactionTasks = new MemoryCompactionTasks();
  const compactionContext = new MemoryCompactionContext();
  const compactionSnapshots = new MemorySnapshots();
  const compaction = new CompactionService({
    tasks: compactionTasks,
    context: compactionContext,
    snapshots: compactionSnapshots,
    now: () => 1_000,
  });
  const entriesBefore = [...compactionContext.entriesList];
  const dispatched = await compaction.dispatch({ text: "/compact" });
  const staleTasks = new MemoryCompactionTasks();
  staleTasks.placement = { placed: false, reason: "stale" };
  const staleCompaction = new CompactionService({
    tasks: staleTasks,
    context: compactionContext,
    snapshots: new MemorySnapshots(),
    now: () => 1_000,
  });
  const staleRecord = await staleCompaction.compact("auto");

  const feedbackStore = new MemoryFeedbackStore();
  const reporter = new FakeReporter();
  const feedback = new FeedbackService({
    store: feedbackStore,
    reporter,
    redaction: { secretValues: ["sk-gate-secret"], privatePathPrefixes: ["/vault"] },
    backendId: "pi",
    sessionId: "session-1",
    now: () => 1_000,
  });
  await feedback.initialize();
  await feedback.observeError({ kind: "provider_error", code: "TIMEOUT", message: "boom sk-gate-secret /vault/x.md" });
  const feedbackOffer = await feedback.observeError({
    kind: "provider_error",
    code: "TIMEOUT",
    message: "boom sk-gate-secret /vault/x.md",
  });
  const offerId = feedbackOffer.shown ? feedbackOffer.offer.id : undefined;
  const beforeConfirm = await feedback.report(offerId ?? "", {
    confirmedByUser: false,
    includeEvidence: true,
  });
  const uploadsBeforeConfirm = reporter.submissions.length;
  const afterConfirm = await feedback.report(offerId ?? "", {
    confirmedByUser: true,
    includeEvidence: false,
  });

  const byok = projectBudget({
    usage: { usedTokens: 1_000, contextWindow: 200_000, inputTokens: 120, outputTokens: 30, updatedAt: 1_000 },
  });
  const localBudget = projectBudget({
    localLimits: { requestLimit: 32 },
    counters: { requests: 8, tools: 0, activeMs: 0 },
  });
  const tracker = new BudgetProjectionTracker();
  tracker.applyUsage({ usedTokens: 1_000, inputTokens: 120, updatedAt: 1_000 });
  const replaced = tracker.applyUsage({ usedTokens: 1_000, inputTokens: 120, updatedAt: 2_000 });

  const report = {
    result: "passed",
    todos: {
      revision: todoFirst.revision,
      progress: todoFirst.progress,
      duplicateReplay: todoReplay.duplicate,
      revisionAfterReplay: todoStore.state.revision,
      conflictCode: todoConflict,
      planEntries: todoPlanEntries.length,
      sessionItems: todoSessionUpdate.items.length,
    },
    plans: {
      planIdStable: planV1.planId === planV2.planId,
      revision: planV2.revision,
      bodyReplaced: planV2.body.includes("write the code"),
      staleApprovalCode: stalePlanApproval,
      projectedBody: projectedPlan.body,
      events: planStore.events.length,
    },
    planDecision: {
      mode: approved.mode,
      resumedRun: approved.resumedRun,
      writeStillApprovalRequired: approved.writeStillApprovalRequired,
      writeGateCalls: writeGateCalls.length,
      duplicateReplay: replayedDecision.duplicate,
      feedbackInputs: feedbackInputs.length,
    },
    questions: {
      status: questionResult.status,
      answers: questionResult.answers,
      replay: questionReplay.replayed,
      prompts: prompts.length,
    },
    compaction: {
      handled: dispatched.handled,
      status: dispatched.record?.status,
      entriesPreserved:
        JSON.stringify(entriesBefore) === JSON.stringify(compactionContext.entriesList),
      retained: dispatched.record?.retainedEntryIds,
      staleStatus: staleRecord.status,
      partKind: dispatched.record ? toCompactionPart(dispatched.record).kind : "",
    },
    feedback: {
      shown: feedbackOffer.shown,
      sanitized: !JSON.stringify(feedbackOffer).includes("sk-gate-secret"),
      beforeConfirm,
      uploadsBeforeConfirm,
      afterConfirmStatus: afterConfirm.status,
      uploadsAfterConfirm: reporter.submissions.length,
      noteHasEvidence: reporter.submissions[0]?.note.includes("Evidence:") ?? false,
    },
    budget: {
      byokWindows: byok.windows.length,
      byokHasBudget: byok.hasBudget,
      localLabels: localBudget.localBudget?.windows.map((window) => window.label) ?? [],
      localPercent: localBudget.localBudget?.windows[0]?.percent ?? null,
      cumulativeAfterReplay: replaced.cumulative.inputTokens,
      contextAfterReplay: replaced.context.usedTokens,
    },
    durationMs: Date.now() - startedAt,
  };
  process.stdout.write(JSON.stringify(report));
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
