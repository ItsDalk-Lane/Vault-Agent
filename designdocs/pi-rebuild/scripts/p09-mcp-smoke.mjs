import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P09-T02 smoke: the jest runtime cannot load the ESM-only Pi MCP package, so this bundled child
// exercises the real McpClient + in-memory transport through McpManager and the real
// StreamableHttpTransport through the production dynamic-import loader:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(projectRoot, ".p09-mcp-"));

function fail(message) {
  console.error(`P09 MCP SMOKE FAILED: ${message}`);
  process.exit(1);
}

function requireOk(condition, message) {
  if (!condition) fail(message);
}

const outfile = path.join(tempRoot, "p09-mcp-smoke.mjs");
const source = fs.readFileSync(path.join(import.meta.dirname, "p09-mcp-smoke-child.mjs"), "utf8");
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "p09-mcp-smoke.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  alias: { "@": srcDir },
  external: ["@earendil-works/pi-mcp", "@earendil-works/pi-mcp/testing"],
  logLevel: "silent",
});

const stdout = execFileSync(process.execPath, [outfile], {
  cwd: projectRoot,
  encoding: "utf8",
  timeout: 120_000,
  env: { ...process.env, NODE_ENV: "test" },
});
const report = JSON.parse(stdout.trim().split("\n").pop());

requireOk(report.result === "passed", "the smoke child did not pass");
requireOk(report.sameConnection, "concurrent acquires did not share one connection");
requireOk(report.initializeCount === 1, "the real McpClient handshook more than once");
requireOk(report.connectedState === "connected", "the real handshake did not reach connected");
requireOk(report.refCount === 2, "the shared connection was not referenced twice");
requireOk(report.closedAfterDispose, "dispose did not close the real in-memory transport");
requireOk(
  report.realTransportName === "StreamableHttpTransport",
  "the production loader did not create the real StreamableHttpTransport"
);
requireOk(
  report.crossOriginDenied === "MCP_CREDENTIAL_ORIGIN_DENIED",
  "the guarded fetch did not deny the cross-origin request"
);

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
