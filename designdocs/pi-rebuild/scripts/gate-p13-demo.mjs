import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P13 gate demo: drives the real migration, legacy-reader, legacy-import, export and registry modules
// over fake hosts and inspects the shipped dependency manifest:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(projectRoot, ".gate-p13-"));

function fail(message) {
  console.error(`GATE P13 FAILED: ${message}`);
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
    "export class FileSystemAdapter {}",
    "export class WorkspaceLeaf {}",
    'export const moment = { locale: () => "en" };',
    "export const normalizePath = (value: string) => value;",
    'export const requestUrl = async () => ({ status: 0, text: "", json: {} });',
    "export const Platform = { isDesktopApp: true, isMobile: false };",
    "export const MarkdownRenderer = { render: async () => undefined };",
    "export default {};",
    "",
  ].join("\n")
);

const outfile = path.join(tempRoot, "gate-p13-demo.mjs");
const source = fs.readFileSync(path.join(import.meta.dirname, "gate-p13-demo-child.mjs"), "utf8");
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p13-demo.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  alias: { "@": srcDir, obsidian: obsidianStub },
  loader: { ".svg": "text" },
  external: [
    "@earendil-works/pi-mcp",
    "@earendil-works/pi-durable",
    "@earendil-works/chord",
    "@earendil-works/pi-ai",
  ],
  logLevel: "silent",
});

const stdout = execFileSync(process.execPath, [outfile, projectRoot], {
  cwd: projectRoot,
  encoding: "utf8",
  timeout: 120_000,
  env: { ...process.env, NODE_ENV: "test" },
});
const report = JSON.parse(stdout.trim().split("\n").pop());

requireOk(report.result === "passed", "the demo did not report a pass");
requireOk(report.migration, "the versioned migration lost data, secrets or idempotency");
requireOk(
  report.legacyRead,
  "the legacy reader dropped a chat, ignored a tombstone or exposed a process"
);
requireOk(report.legacyImport, "the legacy import duplicated a session or lost the material label");
requireOk(report.export, "the export leaked a credential or did not round-trip");
requireOk(report.registry, "the registry stopped being single-engine or lost a historical label");
requireOk(report.dependencies, "a removed execution SDK is still shipped");
requireOk(report.removedChains, "a removed execution or install module still exists");
requireOk(/^[0-9a-f]{64}$/.test(report.payloadHash), "the demo payload hash is malformed");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
