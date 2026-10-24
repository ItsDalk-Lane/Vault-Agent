import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P05 gate demo: drives the real ToolManifest/ToolRegistry/PathResolver/PlatformPathPolicy/
// PolicyEngine/ApprovalStore/PermissionBridge/ToolGateway/Redactor/AuditLog modules over a fake
// host, proving the policy matrix, one-time binding, fail-closed recovery, path/mode bypass
// rejection, nested execution gate and redacted audit:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-p05-"));

function fail(message) {
  console.error(`GATE P05 FAILED: ${message}`);
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

const outfile = path.join(tempRoot, "gate-p05.cjs");
const source = fs.readFileSync(
  path.join(import.meta.dirname, "gate-p05-demo-child.mjs"),
  "utf8"
);
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p05.ts",
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
requireOk(report.policy.fixtures >= 8, "the policy matrix lost fixtures");
requireOk(report.policy.matched, "the policy matrix did not match");
requireOk(report.policy.denyBeatsAllow, "an allow rule overrode a deny rule");
requireOk(report.path.vaultEscapeRejected, "a .. escape was accepted");
requireOk(report.path.lookalikeRejected, "a lookalike sibling was treated as the Vault root");
requireOk(report.path.symlinkBackRejected, "a symlink back into the Vault was accepted");
requireOk(report.path.windowsAdsRejected, "a Windows ADS alias was accepted");
requireOk(report.path.linuxCaseSensitive, "differently-cased files were merged on a sensitive volume");
requireOk(report.binding.staleOnArgumentChange, "changing arguments kept the old approval valid");
requireOk(report.binding.consumedOnce, "the once approval was not consumed exactly once");
requireOk(report.binding.secondConsumeRejected, "the once approval was consumed twice");
requireOk(report.approval.noPrompterUnavailable, "a missing prompter did not fail closed");
requireOk(report.approval.restartPendingNotAllowed, "restart treated a pending request as allowed");
requireOk(report.approval.expiredRejected, "an expired approval was not rejected");
requireOk(report.approval.rejectNoEffect, "a rejection produced an executable decision");
requireOk(report.gateway.nestedDenied, "a nested tool bypassed the gateway");
requireOk(report.gateway.hiddenDenied, "a hidden tool stayed callable");
requireOk(report.gateway.unwrappedDenied, "an unwrapped tool was callable");
requireOk(report.gateway.wrapperNotReplaceable, "the security wrapper was replaceable");
requireOk(report.audit.secretRedacted, "the audit record leaked the secret value");
requireOk(report.audit.headerNotPersisted, "the audit record persisted headers/env");
requireOk(report.audit.denialNotSuccess, "a denial was recorded as a successful execution");
requireOk(report.audit.safeErrorCode === "USE_VAULT_TOOL", "the safe error lost its code");
requireOk(report.audit.safeErrorSuggestedTool === "vault_read", "the safe error lost its suggested tool");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
