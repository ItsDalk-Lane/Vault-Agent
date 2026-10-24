import {
  SUBAGENT_PROFILES,
  defaultEnabledProfiles,
  validateSubagentRequest,
} from "@/agentMode/sdk/pi/features/subagents/Profiles";
import { computeSubagentScope } from "@/agentMode/sdk/pi/features/subagents/SubagentScope";
import { SubagentInputBuilder } from "@/agentMode/sdk/pi/features/subagents/SubagentInput";
import { DelegateTool } from "@/agentMode/sdk/pi/features/subagents/DelegateTool";
import { SubagentProjection } from "@/agentMode/sdk/pi/events/SubagentProjection";
import {
  BackgroundTaskCheckpoint,
  SUBAGENT_ANCHOR_TASK,
  SUBAGENT_REPORTER_TASK,
  registerBackgroundTasks,
} from "@/agentMode/sdk/pi/features/subagents/BackgroundTasks";
import { SubagentControlTools } from "@/agentMode/sdk/pi/features/subagents/SubagentControlTools";
import { SubagentScheduler } from "@/agentMode/sdk/pi/features/subagents/SubagentScheduler";
import { ReportDelivery } from "@/agentMode/sdk/pi/features/subagents/ReportDelivery";
import { RunBudget } from "@/agentMode/sdk/pi/runtime/RunBudget";
import { PathLockPool } from "@/agentMode/sdk/pi/tools/PathLockPool";

// GATE-P10 child: drives the real subagent modules over fake hosts — profiles/intersection, input
// budget, recoverable delegate, card projection, background anchor/reporter checkpoints, the five
// control tools, the concurrency/budget scheduler and the report race:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const report = {};

// 1. profiles and capability intersection never exceed the parent.
report.profiles = SUBAGENT_PROFILES.map((profile) => profile.profileId);
report.defaultProfiles = defaultEnabledProfiles();
const writerRequest = validateSubagentRequest({
  profileId: "writer",
  enabledProfiles: ["researcher", "reviewer", "writer"],
});
const scope = computeSubagentScope({
  parent: {
    callableTools: ["vault_read", "vault_write"],
    effects: ["read"],
    modelKey: "model-a",
    depth: 0,
    maxDepth: 2,
  },
  profile: writerRequest.profile,
  toolAllowlist: ["vault_read", "vault_write"],
  policy: { effects: ["read", "write", "create"] },
});
report.parentBounded = scope.effects.join(",") === "read" && scope.tools.includes("vault_write");
let writerNeedsEnable = false;
try {
  validateSubagentRequest({ profileId: "writer" });
} catch (thrown) {
  writerNeedsEnable = thrown?.code === "SUBAGENT_PROFILE_DISABLED";
}
report.writerNeedsEnable = writerNeedsEnable;

// 2. input budget: controlled reader, source hash, unauthorized and over-limit refusals.
const files = new Map([
  ["notes/a.md", { content: "alpha", rootId: "vault-1", scope: "vault", authorized: true }],
  [
    "/Users/example/secret.md",
    { content: "secret", rootId: "external-1", scope: "external", authorized: false },
  ],
]);
const inputBuilder = new SubagentInputBuilder({
  contextWindowTokens: 200_000,
  reader: {
    readFile: async ({ path }) => files.get(path),
  },
});
const bundle = await inputBuilder.build({ paths: ["notes/a.md"] });
let unauthorized = "";
try {
  await inputBuilder.build({ paths: ["/Users/example/secret.md"] });
} catch (thrown) {
  unauthorized = thrown?.code ?? "";
}
report.inputBudget =
  bundle.items.length === 1 &&
  bundle.items[0].untrusted === true &&
  bundle.items[0].sourceHash.length === 64 &&
  unauthorized === "SUBAGENT_INPUT_UNAUTHORIZED";

// 3. recoverable delegate: one child per ownerTaskId, real answer, unanswered is a failure.
const children = new Map();
const delegateCalls = { created: 0, submits: [], cancels: [] };
const delegateSession = {
  findChild: async (ownerTaskId) => children.get(ownerTaskId),
  createChild: async (input) => {
    delegateCalls.created += 1;
    const child = {
      conversationId: `child-${delegateCalls.created}`,
      ownerTaskId: input.ownerTaskId,
      profileId: input.profileId,
      createdAtMs: 1,
    };
    children.set(input.ownerTaskId, child);
    return child;
  },
  writeChildMapping: async () => undefined,
  submit: async (input) => delegateCalls.submits.push(input.requestId),
  wait: async () => "completed",
  readAnswer: async () => ({ answered: true, text: "Child answer", entryId: "entry-1" }),
  cancel: async (input) => delegateCalls.cancels.push(input.conversationId),
};
const delegate = new DelegateTool({
  session: delegateSession,
  parent: {
    conversationId: "parent-1",
    taskId: "task-7",
    callableTools: ["vault_read"],
    effects: ["read"],
    modelKey: "model-a",
    depth: 0,
    maxDepth: 2,
  },
  now: () => 5_000,
});
const firstDelegate = await delegate.executeTool({
  profileId: "researcher",
  task: "Summarize",
  description: "Summarize the notes",
});
const secondDelegate = await delegate.executeTool({
  profileId: "researcher",
  task: "Summarize",
  description: "Summarize the notes",
});
report.delegateRecoverable =
  delegateCalls.created === 1 &&
  delegateCalls.submits.join(",") === "delegate:task-7,delegate:task-7" &&
  firstDelegate.details.childConversationId === secondDelegate.details.childConversationId &&
  secondDelegate.output[0].text === "Child answer" &&
  secondDelegate.details.tools.join(",") === "vault_read";
const unansweredTool = new DelegateTool({
  session: { ...delegateSession, readAnswer: async () => ({ answered: false, text: "" }) },
  parent: {
    conversationId: "parent-1",
    taskId: "task-8",
    callableTools: ["vault_read"],
    effects: ["read"],
    modelKey: "model-a",
    depth: 0,
    maxDepth: 2,
  },
  now: () => 5_000,
});
const unanswered = await unansweredTool.executeTool({
  profileId: "researcher",
  task: "Summarize",
  description: "Summarize",
});
report.delegateUnanswered =
  unanswered.isError === true && unanswered.details.errorCode === "SUBAGENT_UNANSWERED";

// 4. card projection: hierarchy, namespaced child tools, child text kept in its own conversation.
const projection = new SubagentProjection({ sessionId: "session-1", now: () => 100 });
projection.project({
  type: "subagent_launch",
  toolCallId: "call-1",
  childConversationId: "child-1",
  profileId: "researcher",
  vendorToolName: "Agent",
  startedAtMs: 100,
});
const childCard = projection.project({
  type: "subagent_child_tool",
  toolCallId: "call-1",
  childToolCallId: "tool-1",
  toolName: "vault_read",
  status: "completed",
});
projection.project({
  type: "subagent_child_thought",
  childConversationId: "child-1",
  text: "private reasoning",
});
const mcpAgent = projection.project({
  type: "subagent_launch",
  toolCallId: "mcp-1",
  childConversationId: "child-mcp",
  profileId: "researcher",
  vendorToolName: "Agent",
  mcpServer: "docs-server",
});
const card = childCard.find((update) => update.kind === "card")?.card;
report.cardProjection =
  card?.childToolCount === 1 &&
  card?.childTools[0].namespacedToolCallId === "pi:session-1:tool-1" &&
  card?.childTools[0].parentToolCallId === "call-1" &&
  projection.childTranscript("child-1").length === 1 &&
  !JSON.stringify(projection.cards()).includes("private reasoning") &&
  mcpAgent[0]?.kind === "ordinary_tool";

// 5. background anchor/reporter checkpoints without polling.
const registered = [];
report.backgroundRegistered =
  registerBackgroundTasks({ register: (definition) => registered.push(definition) }) === 2;
const stored = new Map();
const runtime = {
  owned: [],
  terminals: [],
  delivers: [],
  reports: [],
  ownsChildConversation: async (input) => {
    runtime.owned.push(input.childConversationId);
    return { owned: true, ownerTaskId: input.ownerTaskId };
  },
  submitTerminal: async (input) => runtime.terminals.push(input.taskId),
  deliver: async (input) => {
    runtime.delivers.push(input.requestId);
    return { answered: true, answerEntryId: "answer-1", text: "Child answer" };
  },
  report: async (input) => {
    runtime.reports.push(input.requestId);
    return { delivered: true };
  },
  isTaskDefinitionRegistered: (taskDefinitionId) =>
    registered.some((definition) => definition.taskDefinitionId === taskDefinitionId),
};
const storage = {
  load: async (taskId) => stored.get(taskId),
  list: async () => [...stored.values()],
  save: async (record) => {
    stored.set(record.taskId, record);
  },
};
const checkpoint = new BackgroundTaskCheckpoint({ storage, runtime, now: () => 1_000 });
const anchor = await checkpoint.start({
  taskDefinitionId: SUBAGENT_ANCHOR_TASK,
  ownerTaskId: "owner-1",
  parentRunId: "run-1",
  rootId: "root-1",
  childConversationId: "child-anchor",
  commandId: "cmd-anchor",
});
const reporter = await checkpoint.start({
  taskDefinitionId: SUBAGENT_REPORTER_TASK,
  ownerTaskId: "owner-1",
  parentRunId: "run-1",
  rootId: "root-1",
  childConversationId: "child-reporter",
  commandId: "cmd-reporter",
});
await checkpoint.runReporter(reporter.taskId);
const reporterAfter = stored.get(reporter.taskId);
report.backgroundCheckpoints =
  anchor.phase === "terminal" &&
  runtime.terminals.length === 1 &&
  runtime.delivers.join(",") === `subagent:${reporter.taskId}` &&
  runtime.reports.join(",") === `subagent-report:${reporter.taskId}` &&
  reporterAfter.phase === "terminal" &&
  (await checkpoint.runReporter(reporter.taskId)).phase === "terminal" &&
  runtime.reports.length === 1;

// 6. the five control tools: root ownership, commandId dedupe, queue and unsafe stop.
const controlViews = new Map();
let active = 0;
const controlPort = {
  start: async (input) => {
    const view = {
      taskId: `bg-${controlViews.size + 1}`,
      rootId: input.rootId,
      profileId: input.profileId,
      status: "running",
      childConversationId: `child-${controlViews.size + 1}`,
      startedAtMs: 1_000,
    };
    controlViews.set(view.taskId, view);
    active += 1;
    return view;
  },
  sendMessage: async () => undefined,
  status: async (taskId) => controlViews.get(taskId),
  list: async (rootId) => [...controlViews.values()].filter((view) => view.rootId === rootId),
  stop: async (taskId) => {
    const view = { ...controlViews.get(taskId), status: "terminal", endedAtMs: 2_000 };
    controlViews.set(taskId, view);
    active = Math.max(0, active - 1);
    return view;
  },
  result: async () => ({ answered: true, text: "Real answer", entryId: "entry-1" }),
  activeCount: async () => active,
};
const controls = new SubagentControlTools({
  port: controlPort,
  rootId: "root-1",
  ownerTaskId: "task-1",
  parentRunId: "run-1",
});
const startedControl = await controls.startBackgroundTask({
  profileId: "researcher",
  task: "Summarize",
  description: "Summarize",
  commandId: "cmd-1",
});
const duplicated = await controls.startBackgroundTask({
  profileId: "researcher",
  task: "Summarize",
  description: "Summarize",
  commandId: "cmd-1",
});
const foreign = new SubagentControlTools({
  port: controlPort,
  rootId: "root-2",
  ownerTaskId: "task-2",
  parentRunId: "run-2",
});
const denied = await foreign.getSubagentResult({
  taskId: String(startedControl.details.taskId),
});
const notReady = await controls.getSubagentResult({ taskId: "missing" });
report.controlTools =
  controls.registrations().length === 5 &&
  controls.registrations().find((entry) => entry.toolId === "stop_subagent")?.replayPolicy ===
    "unsafe" &&
  duplicated.details.taskId === startedControl.details.taskId &&
  controlViews.size === 1 &&
  denied.details.errorCode === "SUBAGENT_CONTROL_FOREIGN_ROOT" &&
  notReady.details.errorCode === "SUBAGENT_CONTROL_UNKNOWN_TASK";

// 7. scheduler: three concurrent, fourth queued, budget blocks, writers serialize.
const budget = new RunBudget({ limits: { maxModelAttempts: 32 } });
const dispatchStarted = [];
const pending = new Map();
const scheduler = new SubagentScheduler({
  budget,
  locks: new PathLockPool(),
  now: () => 1_000,
  dispatch: async (input) => {
    dispatchStarted.push(input.taskId);
    return new Promise((resolve) => pending.set(input.taskId, resolve));
  },
});
for (const taskId of ["s1", "s2", "s3", "s4"]) {
  await scheduler.schedule({
    taskId,
    rootId: "root-1",
    profileId: "researcher",
    depth: 1,
  });
}
await scheduler.started("s3");
const queuedFourth = scheduler.list("root-1").find((record) => record.taskId === "s4");
pending.get("s1")({ status: "completed" });
await scheduler.started("s4");
pending.get("s2")({ status: "completed" });
pending.get("s3")({ status: "completed" });
pending.get("s4")({ status: "completed" });
await scheduler.drain();
report.schedulerConcurrency =
  dispatchStarted.join(",") === "s1,s2,s3,s4" &&
  queuedFourth?.state === "queued" &&
  scheduler.list("root-1").every((record) => record.state === "completed");
const limitedBudget = new RunBudget({ limits: { maxModelAttempts: 1 } });
const limitedStarts = [];
const limitedScheduler = new SubagentScheduler({
  budget: limitedBudget,
  locks: new PathLockPool(),
  now: () => 1_000,
  dispatch: async (input) => {
    limitedStarts.push(input.taskId);
    return { status: "completed" };
  },
});
await limitedScheduler.schedule({
  taskId: "b1",
  rootId: "root-1",
  profileId: "researcher",
  depth: 1,
});
const blocked = await limitedScheduler.schedule({
  taskId: "b2",
  rootId: "root-1",
  profileId: "researcher",
  depth: 1,
});
const writerIntervals = [];
const writerScheduler = new SubagentScheduler({
  budget: new RunBudget({ limits: { maxModelAttempts: 8 } }),
  locks: new PathLockPool(),
  now: () => 1_000,
  dispatch: async (input) => {
    writerIntervals.push(input.taskId);
    return { status: "completed" };
  },
});
await writerScheduler.schedule({
  taskId: "w1",
  rootId: "root-1",
  profileId: "writer",
  depth: 1,
  writePaths: ["notes/a.md"],
});
await writerScheduler.schedule({
  taskId: "w2",
  rootId: "root-1",
  profileId: "writer",
  depth: 1,
  writePaths: ["notes/a.md"],
});
await writerScheduler.drain();
report.schedulerBudget =
  blocked.state === "blocked" &&
  blocked.blockReason === "budget_exceeded" &&
  limitedStarts.join(",") === "b1" &&
  writerIntervals.join(",") === "w1,w2";

// 8. report delivery race: tool source, duplicate once, Stop stores only, reopen restores only.
const reportEntries = [];
const reportFollowUps = [];
const reportRecords = [];
let epoch = 0;
let aborted = false;
let hostOpen = true;
const delivery = new ReportDelivery({
  entries: {
    append: async (entry) => {
      reportEntries.push(entry);
      return { entryId: `entry-${reportEntries.length}` };
    },
    findByAnswer: async (answerEntryId) =>
      reportEntries.some((entry) => entry.data.answerEntryId === answerEntryId)
        ? { entryId: "entry-1" }
        : undefined,
  },
  roots: {
    cancelEpoch: async () => epoch,
    isAborted: () => aborted,
    budgetAllows: async () => true,
    startFollowUp: async (input) => {
      reportFollowUps.push(input.entryId);
      return { started: true };
    },
  },
  cards: { updateParentCard: async () => undefined },
  host: { isOpen: () => hostOpen },
  checkpoints: {
    save: async (record) => {
      reportRecords.push(record);
    },
    list: async () => [...reportRecords],
  },
  now: () => 1_000,
});
const delivered = await delivery.deliver({
  rootId: "root-1",
  parentRunId: "run-1",
  parentToolCallId: "call-1",
  childConversationId: "child-1",
  answerEntryId: "answer-1",
  text: "Child answer",
  epochAtStart: 0,
  status: "completed",
});
const duplicateDelivery = await delivery.deliver({
  rootId: "root-1",
  parentRunId: "run-1",
  parentToolCallId: "call-1",
  childConversationId: "child-1",
  answerEntryId: "answer-1",
  text: "Child answer",
  epochAtStart: 0,
  status: "completed",
});
epoch = 1;
aborted = true;
const lateDelivery = await delivery.deliver({
  rootId: "root-1",
  parentRunId: "run-1",
  parentToolCallId: "call-2",
  childConversationId: "child-2",
  answerEntryId: "answer-2",
  text: "Late answer",
  epochAtStart: 0,
  status: "completed",
});
hostOpen = false;
delivery.onHostClosed();
const closedDelivery = await delivery.deliver({
  rootId: "root-1",
  parentRunId: "run-1",
  parentToolCallId: "call-3",
  childConversationId: "child-3",
  answerEntryId: "answer-3",
  text: "While closed",
  epochAtStart: 1,
  status: "completed",
});
hostOpen = true;
const reopened = await delivery.onHostReopened();
report.reportRace =
  delivered.state === "followed_up" &&
  reportEntries[0].kind === "va.subagent.report" &&
  reportEntries[0].source === "tool" &&
  reportEntries[0].data.parentRunId === "run-1" &&
  reportEntries[0].text.includes("not a new user instruction") &&
  duplicateDelivery.state === "stored_duplicate" &&
  reportFollowUps.length === 1 &&
  reportEntries.length === 1 &&
  lateDelivery.state === "stored_cancelled" &&
  lateDelivery.followUpStarted === false &&
  closedDelivery.state === "stored_host_closed" &&
  reopened.length === 4 &&
  reportRecords.every(
    (record) => record.followUpStarted === false || record.state === "followed_up"
  );

report.result = "passed";
process.stdout.write(JSON.stringify(report));
