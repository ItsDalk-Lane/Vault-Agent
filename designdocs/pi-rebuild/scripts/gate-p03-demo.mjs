import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P03 gate demo: real Durable JSONL chat through a faux provider, real cross-process reopen,
// real strict-auth model runtime, real SessionDirectory read-only load/resume semantics,
// cancellation of an in-flight provider call, and no secret on disk:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-p03-"));
const storeDir = path.join(tempRoot, "root-store");
const SECRET = "sk-gate-secret-123";

function fail(message) {
  console.error(`GATE P03 FAILED: ${message}`);
  process.exit(1);
}

function requireOk(condition, message) {
  if (!condition) fail(message);
}

function buildBundle() {
  const obsidianStub = path.join(tempRoot, "obsidian-stub.ts");
  fs.writeFileSync(
    obsidianStub,
    'export const Platform = { isDesktopApp: true, isMobile: false };\n'
  );
  const outfile = path.join(tempRoot, "gate-p03.cjs");
  const source = fs.readFileSync(path.join(import.meta.dirname, "gate-p03-demo-child.mjs"), "utf8");
  buildSync({
    stdin: { contents: source, resolveDir: import.meta.dirname, sourcefile: "gate-p03.ts", loader: "ts" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile,
    alias: { "@": srcDir, obsidian: obsidianStub },
    logLevel: "silent",
  });
  return outfile;
}

function runNode(outfile, args, env = {}) {
  return execFileSync(process.execPath, [outfile, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 180_000,
    env: { ...process.env, NODE_ENV: "test", GATE_P03_SECRET: SECRET, ...env },
  });
}

function parseLastJson(stdout) {
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

const outfile = buildBundle();

const write = parseLastJson(runNode(outfile, ["write", storeDir]));
requireOk(write.status === "done", `chat did not finish: ${write.status}`);
requireOk(write.assistantTexts.includes("gate answer"), "chat did not commit the faux answer");
requireOk(write.entryIds.length >= 2, "chat did not commit user and assistant entries");

const read = parseLastJson(runNode(outfile, ["read", storeDir, JSON.stringify(write.entryIds)]));
requireOk(read.reopened === true, "chat store did not reopen across processes");
requireOk(
  JSON.stringify(read.entryIds) === JSON.stringify(write.entryIds),
  "reopened entry ids differ from the committed ids"
);
requireOk(read.assistantTexts.includes("gate answer"), "reopened history lost the answer");

const control = parseLastJson(runNode(outfile, ["control", storeDir, SECRET]));
requireOk(control.connection.kind === "connected", "real model runtime connection failed");
requireOk(control.connection.answer === "pong", "real model runtime returned no answer");
requireOk(control.envBlocked.code === "CREDENTIAL_REQUIRED", "ambient env key was accepted");
requireOk(control.cancellation.promptOutput === "cancelled", "Stop did not cancel the in-flight run");
requireOk(control.cancellation.abortCalls === 1, "Stop did not call conversation abort once");
requireOk(control.cancellation.cancelEpoch === 1, "Stop did not advance the cancel epoch");
requireOk(control.cancellation.textPreserved === true, "Stop lost already-emitted text");
requireOk(control.cancellation.secondStopIdempotent === true, "repeated Stop was not idempotent");
requireOk(control.directory.listCount === 1, "session directory did not list the committed session");
requireOk(control.directory.loadReadOnly === true, "load was not read-only");
requireOk(control.directory.resumeReadOnly === true, "resume was not read-only");
requireOk(control.directory.requiresContinue === false, "load invented pending work");
requireOk(control.directory.modelCallsDuringLoad === 0, "load/resume called the model");
requireOk(control.directory.existsWithoutStoreOpen === true, "sessionExists opened stores");
requireOk(control.stopAfterAbort.harnessSettledUnanswered === true, "real Durable abort did not settle");
requireOk(control.stopAfterAbort.furtherCalls === false, "provider was called again after Stop");
requireOk(control.keychain.credentialRead === true, "real keychain store read failed");

const secretFiles = [];
function scanSecret(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scanSecret(target);
      continue;
    }
    if (fs.readFileSync(target, "latin1").includes(SECRET)) secretFiles.push(target);
  }
}
scanSecret(tempRoot);
requireOk(secretFiles.length === 0, `secret leaked to disk: ${secretFiles.join(", ")}`);

process.stdout.write(
  JSON.stringify({
    result: "passed",
    jsonlChat: { status: write.status, entryCount: write.entryIds.length },
    reopen: { reopened: read.reopened, sameIds: true },
    modelRuntime: { connection: control.connection.kind, envBlocked: control.envBlocked.code },
    cancellation: control.cancellation,
    directory: control.directory,
    stopAfterAbort: control.stopAfterAbort,
    keychain: control.keychain,
    secretOnDisk: false,
  })
);
