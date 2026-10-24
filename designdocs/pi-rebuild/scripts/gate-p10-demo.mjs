import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P10 gate demo: drives the real subagent modules (profiles, input budget, delegate recovery, card
// projection, background checkpoints, control tools, scheduler/budget, report race) over fake hosts:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(projectRoot, ".gate-p10-"));

function fail(message) {
  console.error(`GATE P10 FAILED: ${message}`);
  process.exit(1);
}

function requireOk(condition, message) {
  if (!condition) fail(message);
}

const outfile = path.join(tempRoot, "gate-p10-demo.mjs");
const source = fs.readFileSync(path.join(import.meta.dirname, "gate-p10-demo-child.mjs"), "utf8");
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p10-demo.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  alias: { "@": srcDir },
  external: [
    "@earendil-works/pi-mcp",
    "@earendil-works/pi-durable",
    "@earendil-works/chord",
    "@earendil-works/pi-ai",
  ],
  logLevel: "silent",
});

const stdout = execFileSync(process.execPath, [outfile], {
  cwd: projectRoot,
  encoding: "utf8",
  timeout: 120_000,
  env: { ...process.env, NODE_ENV: "test" },
});
const report = JSON.parse(stdout.trim().split("\n").pop());

requireOk(report.result === "passed", "the demo did not report a pass");
requireOk(
  report.profiles.join(",") === "researcher,reviewer,writer",
  "the built-in profiles are wrong"
);
requireOk(
  report.defaultProfiles.join(",") === "researcher,reviewer",
  "writer must not be enabled by default"
);
requireOk(report.writerNeedsEnable, "writer ran without an explicit user enable");
requireOk(report.parentBounded, "the child scope exceeded the parent capability");
requireOk(report.inputBudget, "the input budget/controlled read contract failed");
requireOk(report.delegateRecoverable, "the delegate child was duplicated or lost its answer");
requireOk(report.delegateUnanswered, "an unanswered child was reported as success");
requireOk(report.cardProjection, "the subagent card hierarchy or child isolation was wrong");
requireOk(report.backgroundRegistered, "the background task definitions were not registered");
requireOk(report.backgroundCheckpoints, "the anchor/reporter checkpoints were wrong");
requireOk(report.controlTools, "the control tools lost ownership/dedupe/replay semantics");
requireOk(
  report.schedulerConcurrency,
  "the concurrency queue did not run three and queue the fourth"
);
requireOk(
  report.schedulerBudget,
  "the root budget did not block the child or writers did not serialize"
);
requireOk(report.reportRace, "the report source/duplicate/Stop/reopen race was wrong");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
