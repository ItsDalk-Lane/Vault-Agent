import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P08 gate demo: drives the real control-feature modules (todos, plans, plan decisions, durable
// ask_user, compaction, feedback and budget projection) over fake stores/prompter/uploader, proving
// every control tool runs, an approved plan still requires write approval, compaction keeps the
// original entries, and feedback never uploads before the user confirms:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-p08-"));

function fail(message) {
  console.error(`GATE P08 FAILED: ${message}`);
  process.exit(1);
}

function requireOk(condition, message) {
  if (!condition) fail(message);
}

const obsidianStub = path.join(tempRoot, "obsidian-stub.ts");
fs.writeFileSync(
  obsidianStub,
  [
    "export class Component { load() {} unload() {} register() {} }",
    "export class MarkdownView {}",
    "export class TFile {}",
    "export class App {}",
    "export class ItemView { containerEl = {}; }",
    "export class WorkspaceLeaf {}",
    "export class FileSystemAdapter {}",
    "export class Notice {}",
    "export class Modal { open() {} close() {} }",
    "export class Vault {}",
    "export const moment = { locale: () => \"en\" };",
    "export const normalizePath = (value: string) => value;",
    "export const requestUrl = async () => ({ status: 0, text: \"\", json: {} });",
    "export const Platform = { isDesktopApp: true, isMobile: false };",
    "export const MarkdownRenderer = { render: async () => undefined };",
    "export default {};",
    "",
  ].join("\n")
);

const outfile = path.join(tempRoot, "gate-p08.cjs");
const source = fs.readFileSync(
  path.join(import.meta.dirname, "gate-p08-demo-child.mjs"),
  "utf8"
);
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p08.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile,
  alias: { "@": srcDir, obsidian: obsidianStub },
  logLevel: "silent",
});

const stdout = execFileSync(process.execPath, [outfile], {
  cwd: projectRoot,
  encoding: "utf8",
  timeout: 180_000,
  env: { ...process.env, NODE_ENV: "test" },
});
const lines = stdout.trim().split("\n");
const report = JSON.parse(lines[lines.length - 1]);

requireOk(report.result === "passed", "the demo did not report a pass");
requireOk(report.todos.revision === 1, "the first todo commit did not produce revision 1");
requireOk(report.todos.duplicateReplay, "replaying the same todo call was not a duplicate");
requireOk(report.todos.revisionAfterReplay === 1, "replaying a todo call advanced the revision");
requireOk(
  report.todos.conflictCode === "TODO_REVISION_CONFLICT",
  "a stale todo revision was not rejected"
);
requireOk(report.todos.planEntries === 2, "todos were not projected into plan entries");
requireOk(report.todos.sessionItems === 2, "todos were not projected into the session update");
requireOk(report.plans.planIdStable, "a revised plan did not keep its stable planId");
requireOk(report.plans.revision === 2, "the plan revision did not advance");
requireOk(report.plans.bodyReplaced, "the revised plan body did not replace the previous one");
requireOk(
  report.plans.staleApprovalCode === "PLAN_REVISION_CONFLICT",
  "approving a stale plan revision was not rejected"
);
requireOk(
  report.plans.projectedBody.includes("write the code"),
  "the projected plan body did not match the pending revision"
);
requireOk(report.planDecision.mode === "default", "approving a plan did not converge to default mode");
requireOk(report.planDecision.resumedRun, "approving a plan did not resume the pending run");
requireOk(
  report.planDecision.writeStillApprovalRequired,
  "an approved plan bypassed the write approval requirement"
);
requireOk(report.planDecision.writeGateCalls >= 1, "the write gate was never consulted");
requireOk(report.planDecision.duplicateReplay, "replaying a plan decision was not idempotent");
requireOk(report.questions.status === "answered", "ask_user did not answer");
requireOk(
  report.questions.answers.files === "A, B" && report.questions.answers.other === "my own answer",
  "multi-select/other answers were not delivered intact"
);
requireOk(report.questions.replay, "re-asking the same question was not replayed");
requireOk(report.questions.prompts === 1, "the existing prompter was called more than once");
requireOk(report.compaction.handled, "the /compact dispatch was not handled");
requireOk(report.compaction.status === "completed", "the compaction did not complete");
requireOk(report.compaction.entriesPreserved, "compaction removed the original entries");
requireOk(
  report.compaction.retained.join(",") === "entry-1,entry-2",
  "the compaction did not retain the original entry ids"
);
requireOk(report.compaction.staleStatus === "skipped", "a stale compaction was reported as success");
requireOk(report.compaction.partKind === "compaction", "the compaction was not projected as a row");
requireOk(report.feedback.shown, "repeated errors did not raise a feedback offer");
requireOk(report.feedback.sanitized, "the feedback draft leaked a secret");
requireOk(
  report.feedback.beforeConfirm.status === "not_uploaded",
  "an unconfirmed report was accepted"
);
requireOk(report.feedback.uploadsBeforeConfirm === 0, "feedback uploaded before user confirmation");
requireOk(report.feedback.afterConfirmStatus === "reported", "the confirmed report was not sent");
requireOk(report.feedback.uploadsAfterConfirm === 1, "the confirmed report was uploaded more than once");
requireOk(!report.feedback.noteHasEvidence, "unchecked evidence was attached to the report");
requireOk(report.budget.byokWindows === 0, "BYOK showed fabricated subscription windows");
requireOk(!report.budget.byokHasBudget, "BYOK claimed a budget it does not have");
requireOk(
  report.budget.localLabels.every((label) => label.startsWith("Local budget")),
  "local budget windows were not labeled as local"
);
requireOk(report.budget.localPercent === 25, "the local budget percentage was wrong");
requireOk(
  report.budget.cumulativeAfterReplay === 120,
  "a replayed usage snapshot was added twice"
);
requireOk(report.budget.contextAfterReplay === 1_000, "the context usage was not replaced");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
