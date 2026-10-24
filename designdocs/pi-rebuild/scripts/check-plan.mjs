import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const print = (value) => process.stdout.write(String(value) + "\n");
const printError = (value) => process.stderr.write(String(value) + "\n");

const arg = process.argv.indexOf("--root");
const root =
  arg >= 0
    ? path.resolve(process.argv[arg + 1])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const exists = (rel) => fs.existsSync(path.join(root, rel));
let plan, state, features, scenarios, flows;
try {
  plan = read("execution/TASKS.json");
  state = read("execution/STATE.json");
  features = read("fixtures/feature-matrix.json").features;
  scenarios = read("fixtures/acceptance-scenarios.json").scenarios;
  flows = read("fixtures/agent-flows.json").flows;
} catch (error) {
  printError(`Cannot read execution pack: ${error.message}`);
  process.exit(2);
}
const tasks = plan.tasks;
const byId = new Map(tasks.map((t) => [t.id, t]));
const scenarioIds = new Set(scenarios.map((s) => s.id));
const phases = new Map(plan.phases.map((p) => [p.id, p]));
check(byId.size === tasks.length, "Duplicate task IDs");
check(new Set(features.map((f) => f.id)).size === features.length, "Duplicate feature IDs");
check(scenarioIds.size === scenarios.length, "Duplicate scenario IDs");
check(
  state.phase0?.status === "accepted_user_report",
  "P00 user acceptance must remain recorded without invented rerun"
);
const allowed = new Set(["todo", "in_progress", "blocked", "verify_failed", "done"]);
for (const id of Object.keys(state.tasks)) check(byId.has(id), `Unknown state task ${id}`);
for (const t of tasks) {
  check(/^P\d{2}-T\d{2}$/.test(t.id), `Invalid task ID ${t.id}`);
  check(phases.has(t.phase), `Unknown phase ${t.phase}`);
  check(exists(t.card), `Missing task card ${t.card}`);
  check(t.steps.length >= 3 && t.assertions.length >= 3, `Insufficient detail ${t.id}`);
  check(t.files.length > 0, `Missing file scope ${t.id}`);
  check(t.documentationOnly || !!t.testFile, `Missing test target ${t.id}`);
  check(state.tasks[t.id] && allowed.has(state.tasks[t.id].status), `Invalid state ${t.id}`);
  for (const dep of t.dependencies) check(byId.has(dep), `Unknown dependency ${dep} in ${t.id}`);
  for (const d of t.designs) check(exists(`design/${d}`), `Missing design ${d}`);
  for (const id of t.scenarioIds) check(scenarioIds.has(id), `Unknown scenario ${id}`);
  const s = state.tasks[t.id];
  if (s?.status === "done") {
    for (const dep of t.dependencies)
      check(
        state.tasks[dep]?.status === "done",
        `Done task ${t.id} has unfinished dependency ${dep}`
      );
    if (t.requiredPreviousGate !== "P00")
      check(
        state.phaseGates[t.requiredPreviousGate]?.status === "passed",
        `${t.id} skipped previous gate`
      );
    if (!exists(s.evidencePath)) {
      errors.push(`Done task ${t.id} has no evidence`);
      continue;
    }
    try {
      const ev = read(s.evidencePath);
      check(ev.taskId === t.id && ev.status === "passed", `Evidence not passed for ${t.id}`);
      for (const field of ["notRun", "not_run"])
        check(
          ev[field] === undefined || (Array.isArray(ev[field]) && ev[field].length === 0),
          `Done task ${t.id} has unexecuted acceptance work in ${field}`
        );
      for (const step of [
        ...(ev.requiredStepChecks ?? []),
        ...(ev.revalidation?.requiredStepChecks ?? []),
      ]) {
        check(
          step.result === "passed" && step.required !== false,
          `Done task ${t.id} has an unverified original step`
        );
        check(
          typeof step.evidence === "string" && step.evidence.trim().length > 0,
          `Done task ${t.id} has an original step without evidence`
        );
      }
      check(Array.isArray(ev.commands) && ev.commands.length > 0, `No actual commands for ${t.id}`);
      for (const cmd of ev.commands ?? [])
        check(cmd.exitCode === 0 && cmd.result === "passed", `Unpassed command for ${t.id}`);
      if (!t.documentationOnly)
        check(
          (ev.commands ?? []).some((c) => Number(c.testCount) > 0),
          `No nonzero test count for ${t.id}`
        );
      for (const required of t.requiredCommands)
        check(
          (ev.commands ?? []).some((c) => c.command === required),
          `Missing required command for ${t.id}: ${required}`
        );
      for (const scenario of t.scenarioIds)
        check(
          (ev.scenarioIds ?? []).includes(scenario),
          `Missing scenario evidence for ${t.id}: ${scenario}`
        );
      const manualChecks = Array.isArray(ev.manualChecks) ? ev.manualChecks : [];
      for (const scenario of t.scenarioIds) {
        const results = manualChecks.filter((item) => item.scenarioId === scenario);
        check(
          results.length === 1,
          `Required assertion ${scenario} must have exactly one result for ${t.id}`
        );
        for (const item of results) {
          check(
            item.result === "passed" && item.required !== false,
            `Required assertion ${scenario} has not passed for ${t.id}`
          );
          check(
            typeof item.evidence === "string" && item.evidence.trim().length > 0,
            `Required assertion ${scenario} has no actual evidence for ${t.id}`
          );
        }
      }
      for (const item of manualChecks)
        check(
          item.result === "passed" ||
            (item.required === false && !t.scenarioIds.includes(item.scenarioId)),
          `Unpassed required manual check for ${t.id}`
        );
    } catch (error) {
      errors.push(`Invalid evidence ${t.id}: ${error.message}`);
    }
  }
}
const visiting = new Set(),
  visited = new Set();
function visit(id) {
  if (visited.has(id) || !byId.has(id)) return;
  if (visiting.has(id)) {
    errors.push(`Dependency cycle at ${id}`);
    return;
  }
  visiting.add(id);
  for (const dep of byId.get(id).dependencies) visit(dep);
  visiting.delete(id);
  visited.add(id);
}
for (const t of tasks) visit(t.id);
for (const p of plan.phases) {
  check(exists(`execution/phases/${p.id}.md`), `Missing phase document ${p.id}`);
  check(p.taskIds.length > 0, `Empty phase ${p.id}`);
  for (const id of p.taskIds) check(byId.get(id)?.phase === p.id, `Wrong phase mapping ${id}`);
  const gate = state.phaseGates[p.id];
  check(gate !== undefined, `Missing gate state ${p.id}`);
  if (gate?.status === "passed") {
    check(
      p.taskIds.every((id) => state.tasks[id]?.status === "done"),
      `Passed gate ${p.id} has unfinished tasks`
    );
    check(exists(gate.evidencePath), `Passed gate ${p.id} lacks evidence`);
    if (exists(gate.evidencePath)) {
      const ev = read(gate.evidencePath);
      check(ev.status === "passed" && ev.phaseId === p.id, `Gate evidence not passed ${p.id}`);
      for (const taskId of p.taskIds)
        check((ev.taskIds ?? []).includes(taskId), `Gate ${p.id} omits required task ${taskId}`);
      check(
        (ev.notRun ?? []).length === 0 && (ev.not_run ?? []).length === 0,
        `Gate ${p.id} has unexecuted acceptance work`
      );
      for (const required of ["npm run build", "npm run lint"])
        check(
          (ev.commands ?? []).some(
            (c) => c.command === required && c.exitCode === 0 && c.result === "passed"
          ),
          `Gate ${p.id} missing passed command ${required}`
        );
      for (const cmd of ev.commands ?? [])
        check(cmd.exitCode === 0 && cmd.result === "passed", `Gate ${p.id} has unpassed command`);
      check(
        (ev.manualChecks ?? []).some((c) => c.result === "passed"),
        `Gate ${p.id} lacks a passed runnable demo`
      );
      for (const item of ev.manualChecks ?? [])
        check(
          item.result === "passed" || item.required === false,
          `Gate ${p.id} has unpassed required manual check`
        );
      check(
        (ev.commands ?? []).length > 0 || (ev.manualChecks ?? []).length > 0,
        `Empty gate evidence ${p.id}`
      );
    }
  }
}
for (const f of features) {
  check(f.producer && !/\.test\./.test(f.producer), `Feature ${f.id} has no production producer`);
  check(f.taskIds.length > 0 && f.scenarioIds.length > 0, `Unmapped feature ${f.id}`);
  for (const id of f.taskIds) check(byId.has(id), `Unknown feature task ${id}`);
  for (const id of f.scenarioIds) check(scenarioIds.has(id), `Unknown feature scenario ${id}`);
}
for (const s of scenarios) check(byId.has(s.taskId), `Scenario ${s.id} has unknown task`);
for (const f of flows)
  check(
    byId.has(f.taskId) && f.steps.length >= 3 && f.expected.length >= 3,
    `Invalid flow ${f.id}`
  );
const running = Object.entries(state.tasks).filter(([, s]) => s.status === "in_progress");
check(running.length <= 1, "Only one atomic task may be in progress");
if (state.currentTaskId !== null) {
  check(byId.has(state.currentTaskId), "Unknown currentTaskId");
  check(
    ["in_progress", "blocked", "verify_failed"].includes(state.tasks[state.currentTaskId]?.status),
    "Current task is not active or awaiting repair"
  );
}
if (running.length === 1)
  check(state.currentTaskId === running[0][0], "Current task must match in-progress task");
if (state.nextTaskId !== null) check(byId.has(state.nextTaskId), "Unknown nextTaskId");
function allFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]
    );
}
for (const file of allFiles(root).filter((p) => p.endsWith(".md"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1];
    if (/^[a-z]+:/i.test(link) || link.startsWith("#")) continue;
    const target = decodeURIComponent(link.split("#")[0]);
    if (target)
      check(
        fs.existsSync(path.resolve(path.dirname(file), target)),
        `Broken Markdown link ${path.relative(root, file)} -> ${target}`
      );
  }
}
const doneTasks = tasks.filter((task) => state.tasks[task.id]?.status === "done").length;
const passedGates = plan.phases.filter(
  (phase) => state.phaseGates[phase.id]?.status === "passed"
).length;
const report = {
  result: errors.length ? "failed" : "passed",
  scope: "document_consistency",
  completion:
    errors.length === 0 && doneTasks === tasks.length && passedGates === plan.phases.length
      ? "complete"
      : "incomplete",
  doneTasks,
  passedGates,
  phases: plan.phases.length,
  tasks: tasks.length,
  features: features.length,
  assertions: scenarios.length,
  flows: flows.length,
  errors,
};
print(JSON.stringify(report, null, 2));
process.exit(errors.length ? 1 : 0);
