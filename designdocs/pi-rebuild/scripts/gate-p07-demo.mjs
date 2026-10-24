import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P07 gate demo: drives the real external-root scope, guarded environment, official Pi read/write/edit
// factories, host execution policy, native command wrapper and process supervisor over a fake host,
// proving native tools run, externalRoot authorization is enforced, strict never spawns, and trusted
// execution exposes timeout/cancel/env cleanup:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-p07-"));

function fail(message) {
  console.error(`GATE P07 FAILED: ${message}`);
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

const outfile = path.join(tempRoot, "gate-p07.cjs");
const source = fs.readFileSync(
  path.join(import.meta.dirname, "gate-p07-demo-child.mjs"),
  "utf8"
);
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p07.ts",
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
requireOk(report.nativeTools.read, "official read did not return the file text");
requireOk(report.nativeTools.write, "official write did not commit through the approval");
requireOk(report.nativeTools.edit, "official edit did not commit through the approval");
requireOk(report.nativeTools.approvalPlans >= 2, "writes were not preceded by concrete approvals");
requireOk(report.nativeTools.receipts >= 2, "native mutations did not record receipts");
requireOk(report.nativeTools.vaultRefused, "a vault target was not refused with USE_VAULT_TOOL");
requireOk(report.externalRoot.authorizedRead, "the authorized external root was not readable");
requireOk(report.externalRoot.unauthorizedReadDenied, "the vault target was readable through the external env");
requireOk(
  report.externalRoot.unauthorizedMessage.includes("EXTERNAL_PATH_DENIED"),
  "the denied external read did not report EXTERNAL_PATH_DENIED"
);
requireOk(report.strict.opaque, "strict did not deny the opaque command");
requireOk(report.strict.bashCalls === 0, "strict spawned the native command");
requireOk(report.trusted.approvedRun, "the approved trusted command did not run");
requireOk(report.trusted.replayDenied, "a replayed command approval was not denied");
requireOk(report.trusted.vaultCommandDenied, "a vault command was not denied before spawning");
requireOk(report.trusted.timeoutStatus === "timed_out", "the timeout did not stop the command");
requireOk(
  report.trusted.timeoutCleanup === "cleanup_incomplete",
  "the unproven process-tree cleanup was not marked cleanup_incomplete"
);
requireOk(report.trusted.cancelStatus === "cancelled", "cancellation did not reach the process");
requireOk(
  report.trusted.killerReasons.includes("timeout") &&
    report.trusted.killerReasons.includes("cancelled"),
  "the process-tree killer did not observe the timeout and cancellation"
);
requireOk(report.trusted.apiKeyInChildEnv === false, "an API key reached the child environment");
requireOk(report.trusted.inheritEnv === false, "the child environment was inherited");
requireOk(report.trusted.secretRedacted, "known secrets were not redacted");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
