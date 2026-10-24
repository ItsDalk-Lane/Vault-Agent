import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(root, "scripts/check-plan.mjs");
const issue = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/1";
const read = (directory, relative) =>
  JSON.parse(fs.readFileSync(path.join(directory, relative), "utf8"));
const write = (directory, relative, value) =>
  fs.writeFileSync(path.join(directory, relative), JSON.stringify(value, null, 2) + "\n");

function freshState(directory) {
  const state = read(directory, "execution/STATE.json");
  for (const id of Object.keys(state.tasks)) state.tasks[id] = { status: "todo" };
  for (const id of Object.keys(state.phaseGates)) state.phaseGates[id] = { status: "pending" };
  state.currentTaskId = null;
  state.nextTaskId = "P01-T01";
  write(directory, "execution/STATE.json", state);
}

function completeTask(directory, taskId = "P01-T01") {
  const task = read(directory, "execution/TASKS.json").tasks.find((entry) => entry.id === taskId);
  const state = read(directory, "execution/STATE.json");
  const evidencePath = `execution/evidence/${taskId}.json`;
  state.tasks[taskId] = { status: "done", evidencePath };
  write(directory, "execution/STATE.json", state);
  write(directory, evidencePath, {
    taskId,
    status: "passed",
    scenarioIds: task.scenarioIds,
    commands: task.requiredCommands.map((command) => ({
      command,
      exitCode: 0,
      result: "passed",
      testCount: 1,
    })),
    manualChecks: task.scenarioIds.map((scenarioId) => ({
      scenarioId,
      result: "passed",
      evidence: "检查器独立测试夹具，不是产品验收结果。",
    })),
  });
  return evidencePath;
}

function editTaskEvidence(directory, edit) {
  const relative = completeTask(directory);
  const evidence = read(directory, relative);
  edit(evidence);
  write(directory, relative, evidence);
}

function completePhase(directory) {
  const phase = read(directory, "execution/TASKS.json").phases[0];
  for (const taskId of phase.taskIds) completeTask(directory, taskId);
  const state = read(directory, "execution/STATE.json");
  const evidencePath = "execution/evidence/GATE-P01.json";
  state.phaseGates.P01 = { status: "passed", evidencePath };
  write(directory, "execution/STATE.json", state);
  write(directory, evidencePath, {
    phaseId: "P01",
    status: "passed",
    taskIds: phase.taskIds,
    commands: ["npm run build", "npm run lint"].map((command) => ({
      command,
      exitCode: 0,
      result: "passed",
    })),
    manualChecks: [{ result: "passed", evidence: "检查器独立测试夹具。" }],
  });
  return evidencePath;
}

const cases = [
  ["unfinished pack remains valid without claiming completion", null, 0],
  ["completed task with each required assertion passed is accepted", completeTask, 0],
  ["completed phase with verified task evidence is accepted", completePhase, 0],
  [
    "dependency cycle is rejected",
    (directory) => {
      const plan = read(directory, "execution/TASKS.json");
      plan.tasks[0].dependencies = [plan.tasks.at(-1).id];
      write(directory, "execution/TASKS.json", plan);
    },
    1,
  ],
  [
    "unknown coverage task is rejected",
    (directory) => {
      const matrix = read(directory, "fixtures/feature-matrix.json");
      matrix.features[0].taskIds = ["P99-T99"];
      write(directory, "fixtures/feature-matrix.json", matrix);
    },
    1,
  ],
  [
    "done without evidence is rejected",
    (directory) => {
      const relative = completeTask(directory);
      fs.unlinkSync(path.join(directory, relative));
    },
    1,
  ],
  [
    `done with a failed required assertion is rejected ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.manualChecks[0].result = "failed";
      });
    },
    1,
  ],
  [
    `done with an unexecuted required assertion is rejected ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.manualChecks[0].result = "not_run";
      });
    },
    1,
  ],
  [
    `done with a missing required assertion result is rejected ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.manualChecks.shift();
      });
    },
    1,
  ],
  [
    `required false cannot waive a task assertion ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.manualChecks[0].result = "not_run";
        evidence.manualChecks[0].required = false;
      });
    },
    1,
  ],
  [
    `a duplicate failing assertion cannot be hidden behind a passed one ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.manualChecks.push({ ...evidence.manualChecks[0], result: "failed" });
      });
    },
    1,
  ],
  [
    `an assertion without an explanation of its evidence is rejected ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.manualChecks[0].evidence = " ";
      });
    },
    1,
  ],
  [
    `a done task cannot conceal unexecuted work in notRun ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.notRun = ["原步骤的生产接线仍未验证"];
      });
    },
    1,
  ],
  [
    `a done task cannot conceal unexecuted work in not_run ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.not_run = [{ step: "运行原验收", result: "not_run" }];
      });
    },
    1,
  ],
  [
    `a done task cannot ignore an explicitly unverified original step ${issue}`,
    (directory) => {
      editTaskEvidence(directory, (evidence) => {
        evidence.revalidation = {
          requiredStepChecks: [{ step: "原定完整接线", result: "not_run", required: false }],
        };
      });
    },
    1,
  ],
  [
    `a passed gate cannot conceal unexecuted work in notRun ${issue}`,
    (directory) => {
      const relative = completePhase(directory);
      const evidence = read(directory, relative);
      evidence.notRun = ["必需的产品路径尚未执行"];
      write(directory, relative, evidence);
    },
    1,
  ],
  [
    `a passed gate cannot conceal failed work in not_run ${issue}`,
    (directory) => {
      const relative = completePhase(directory);
      const evidence = read(directory, relative);
      evidence.not_run = [{ required: false, result: "not_run", scenarioId: "SC-P01-T01-01" }];
      write(directory, relative, evidence);
    },
    1,
  ],
  [
    "missing card is rejected",
    (directory) => {
      fs.unlinkSync(path.join(directory, "execution/tasks/P01-T01.md"));
    },
    1,
  ],
  [
    "multiple in-progress tasks are rejected",
    (directory) => {
      const state = read(directory, "execution/STATE.json");
      state.tasks["P01-T01"].status = "in_progress";
      state.tasks["P01-T02"].status = "in_progress";
      write(directory, "execution/STATE.json", state);
    },
    1,
  ],
  [
    "passed gate without done tasks is rejected",
    (directory) => {
      completePhase(directory);
      const state = read(directory, "execution/STATE.json");
      state.tasks["P01-T01"].status = "todo";
      write(directory, "execution/STATE.json", state);
    },
    1,
  ],
  [
    "broken local link is rejected",
    (directory) => {
      fs.appendFileSync(path.join(directory, "README.md"), "\n[bad](not-present.md)\n");
    },
    1,
  ],
];

let count = 0;
for (const [name, mutate, expected] of cases) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "va-plan-check-"));
  try {
    fs.cpSync(root, temporary, { recursive: true });
    freshState(temporary);
    if (mutate) mutate(temporary);
    const output = spawnSync(process.execPath, [checker, "--root", temporary], {
      encoding: "utf8",
    });
    assert.equal(output.status, expected, `${name}\n${output.stdout}\n${output.stderr}`);
    process.stdout.write(`PASS ${name}\n`);
    count += 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
process.stdout.write(
  `${count}/${cases.length} document-checker tests passed. No plugin implementation tests were run.\n`
);
