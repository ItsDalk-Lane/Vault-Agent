import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P11 gate demo: drives the real fan-out modules (modelKey selection, read-only concurrent
// candidates, synthesis with real sources, card projection, crash recovery and history export) over
// fake hosts:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(projectRoot, ".gate-p11-"));

function fail(message) {
  console.error(`GATE P11 FAILED: ${message}`);
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
    "export class Notice {}",
    "export class Modal { open() {} close() {} }",
    "export class Vault {}",
    'export const moment = { locale: () => "en" };',
    "export const normalizePath = (value: string) => value;",
    'export const requestUrl = async () => ({ status: 0, text: "", json: {} });',
    "export const Platform = { isDesktopApp: true, isMobile: false };",
    "export const MarkdownRenderer = { render: async () => undefined };",
    "export default {};",
    "",
  ].join("\n")
);

const outfile = path.join(tempRoot, "gate-p11-demo.mjs");
const source = fs.readFileSync(path.join(import.meta.dirname, "gate-p11-demo-child.mjs"), "utf8");
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p11-demo.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  alias: { "@": srcDir, obsidian: obsidianStub },
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
requireOk(report.selection, "the modelKey selection or dedupe policy was wrong");
requireOk(report.selectionGuards, "a foreign engine or a keyless model was not refused");
requireOk(
  report.candidates,
  "the read-only candidate run lost its slots, usage or read-only tools"
);
requireOk(
  report.synthesis,
  "the synthesis ran twice, all-failed synthesis ran, or sources were wrong"
);
requireOk(report.card, "the card projection showed a wrong candidate state, label or copy text");
requireOk(
  report.recovery,
  "recovery re-ran a finished candidate, repeated synthesis or wrote the vault"
);
requireOk(report.history, "the historical composite did not round-trip");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
