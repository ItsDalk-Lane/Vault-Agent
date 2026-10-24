import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P06 gate demo: drives the real read/write/frontmatter/move/revert/recovery/projection modules over
// a fake host, proving user edits are never overwritten, crash recovery only fills the receipt
// once, every Vault operation uses the injected Obsidian-style API, real receipts drive the turn
// file changes/Diff, and a conflicting revert is shown instead of overwritten:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-p06-"));

function fail(message) {
  console.error(`GATE P06 FAILED: ${message}`);
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

const outfile = path.join(tempRoot, "gate-p06.cjs");
const source = fs.readFileSync(
  path.join(import.meta.dirname, "gate-p06-demo-child.mjs"),
  "utf8"
);
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p06.ts",
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
requireOk(report.userEdit.writeStale, "a user edit did not make the edit stale");
requireOk(report.userEdit.frontmatterStale, "a user edit did not make the frontmatter write stale");
requireOk(report.userEdit.contentPreserved, "the user edit was overwritten");
requireOk(report.crash.receiptCompletedOnce, "crash recovery did not complete the missing receipt");
requireOk(report.crash.secondPassNoWrite, "a second reconciliation wrote again");
requireOk(report.crash.saves === 1, `crash recovery saved ${report.crash.saves} receipts, expected 1`);
requireOk(report.obsidianApi.writes >= 2, "write/recycle calls did not go through the injected API");
requireOk(report.obsidianApi.moves >= 1, "rename did not go through the injected FileManager API");
requireOk(report.obsidianApi.noNodeFs, "a Vault operation failed");
requireOk(report.receiptUi.beforeMatches, "projected before content did not match the ledger blob");
requireOk(report.receiptUi.afterMatches, "projected after content did not match the ledger blob");
requireOk(report.receiptUi.diffMatches, "the projected Diff did not match the receipt");
requireOk(report.receiptUi.changes === 1, "the receipt did not project to exactly one change");
requireOk(report.revert.conflictBlocked, "a conflicting revert was not blocked");
requireOk(report.revert.userContentPreserved, "a conflicting revert overwrote the user content");
requireOk(report.revert.replayIdempotent, "a repeated revert was not idempotent");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
