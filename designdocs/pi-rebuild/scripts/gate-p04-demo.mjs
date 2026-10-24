import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P04 gate demo: drives the real projection modules over a conversation recorded from a real
// Durable Harness + faux provider, proving resync dedupe, compacted-history retention, tool
// terminal evidence rules, run duration/loading semantics and copy/Markdown regression:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-p04-"));

function fail(message) {
  console.error(`GATE P04 FAILED: ${message}`);
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

const outfile = path.join(tempRoot, "gate-p04.cjs");
const source = fs.readFileSync(path.join(import.meta.dirname, "gate-p04-demo-child.mjs"), "utf8");
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p04.ts",
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
requireOk(report.resync.uniqueIds, "resync produced duplicated entry ids");
requireOk(report.resync.compactedKept, "resync dropped compacted history");
requireOk(report.resync.newEntryOnce, "an entry appended during initialization appeared more than once");
requireOk(report.snapshot.oldKept, "a snapshot removed already compacted messages");
requireOk(report.toolTerminal.interrupted, "a tool end without result evidence was not interrupted");
requireOk(report.toolTerminal.failedOnError, "a rejected tool did not stay failed");
requireOk(report.toolTerminal.completedWithResult, "a tool with a clean result did not complete");
requireOk(report.toolTerminal.lateUpdateIgnored, "a late update overrode the tool's terminal state");
requireOk(report.run.loadingThroughTurns, "intermediate turn ends closed loading early");
requireOk(report.run.durationMs === 3_000, `run duration was ${report.run.durationMs}, expected 3000`);
requireOk(report.run.unknownUsageNull, "unknown usage was reported as a value instead of null");
requireOk(report.run.retryDeduped, "a retry created a second user submission");
requireOk(report.run.terminalStatus === "completed", "an end_turn run did not settle as completed");
requireOk(report.rendering.copyTextMatches, "copy text did not match the final answer");
requireOk(report.rendering.codeBlock, "the replayed Markdown lost its code block");
requireOk(report.rendering.link, "the replayed Markdown lost its link");
requireOk(report.rendering.durationMs === 3_000, "rendered duration did not use persisted run timing");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
