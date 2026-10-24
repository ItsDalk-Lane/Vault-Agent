import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P12 gate demo: drives the real skills, context, attachment, web-fetch, project and command modules
// over fake hosts:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(projectRoot, ".gate-p12-"));

function fail(message) {
  console.error(`GATE P12 FAILED: ${message}`);
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

const outfile = path.join(tempRoot, "gate-p12-demo.mjs");
const source = fs.readFileSync(path.join(import.meta.dirname, "gate-p12-demo-child.mjs"), "utf8");
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p12-demo.ts",
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
requireOk(
  report.skills,
  "the skill index lost a legacy skill, injected a disabled one or hid a conflict"
);
requireOk(
  report.skillTools,
  "load_skill accepted a hostile skill, an escaping resource or a script"
);
requireOk(
  report.context,
  "context assembly lost its order, history dedupe, untrusted note or budget"
);
requireOk(
  report.attachments,
  "attachments ignored model capability, scope or the receipt round-trip"
);
requireOk(report.webFetch, "web fetch allowed a private target, skipped a hop or lost its limits");
requireOk(report.project, "project switching retargeted a session or moved an approval");
requireOk(report.commands, "command dispatch missed the real API or accepted an unknown command");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
