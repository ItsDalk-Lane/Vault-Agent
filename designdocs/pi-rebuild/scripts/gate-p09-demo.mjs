import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P09 gate demo: drives the real MCP config/secret-ref, pool, catalog, Durable bridge, progress,
// bounded test, OAuth credential, stdio policy and exposure modules over fake hosts; the real
// pi-mcp client/transport against a live local endpoint is covered by p09-http-demo.mjs:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(projectRoot, ".gate-p09-"));

function fail(message) {
  console.error(`GATE P09 FAILED: ${message}`);
  process.exit(1);
}

function requireOk(condition, message) {
  if (!condition) fail(message);
}

const outfile = path.join(tempRoot, "gate-p09-demo.mjs");
const source = fs.readFileSync(path.join(import.meta.dirname, "gate-p09-demo-child.mjs"), "utf8");
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "gate-p09-demo.ts",
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
requireOk(report.secretRefOnly, "the exported config leaked a plaintext secret");
requireOk(report.npxRejected, "an npx command was not rejected");
requireOk(report.poolMerged, "concurrent acquires did not share one handshake");
requireOk(report.poolClosed, "dispose did not close the pooled connection");
requireOk(report.catalogBounded, "the catalog was not bounded to 500 tools with incomplete=true");
requireOk(report.schemaDisabled, "a malicious schema was registered");
requireOk(report.unknownEffectsDenied, "an unknown-effects MCP tool was auto-allowed");
requireOk(report.isErrorKept, "a server isError was reported as success");
requireOk(report.progressMapped, "MCP progress did not map to the host toolCallId");
requireOk(report.progressTerminal, "the MCP terminal progress facts were wrong");
requireOk(report.lateProgressDropped, "a late progress event revived a finished call");
requireOk(report.testTimeout, "the bounded test did not stop on the total timeout");
requireOk(report.testRedacted, "the bounded test leaked a secret or exceeded the error limit");
requireOk(report.oauthAuthorized, "the browser OAuth flow did not authorize");
requireOk(report.oauthCredentialRef, "the OAuth token was not stored behind its ref");
requireOk(report.oauthSignOut, "signOut did not invalidate the stored token");
requireOk(report.stdioEnvIsolated, "the stdio child inherited a model API key");
requireOk(report.stdioStrictDenied, "strict mode started a stdio server");
requireOk(report.stdioClosed, "the stdio close did not prove process cleanup");
requireOk(report.exposureSelection, "hidden/deferred exposure selection was wrong");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
