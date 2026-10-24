import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P09-T10 demo: drives a real local Streamable-HTTP MCP endpoint with the real McpClient and
// StreamableHttpTransport through the P09 stack, and proves the bounded test path never called a tool:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(projectRoot, ".p09-http-"));

function fail(message) {
  console.error(`P09 HTTP DEMO FAILED: ${message}`);
  process.exit(1);
}

function requireOk(condition, message) {
  if (!condition) fail(message);
}

const outfile = path.join(tempRoot, "p09-http-demo.mjs");
const source = fs.readFileSync(path.join(import.meta.dirname, "p09-http-demo-child.mjs"), "utf8");
buildSync({
  stdin: {
    contents: source,
    resolveDir: import.meta.dirname,
    sourcefile: "p09-http-demo.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  alias: { "@": srcDir },
  external: ["@earendil-works/pi-mcp"],
  logLevel: "silent",
});

const stdout = execFileSync(process.execPath, [outfile], {
  cwd: projectRoot,
  encoding: "utf8",
  timeout: 120_000,
  env: { ...process.env, NODE_ENV: "test" },
});
const report = JSON.parse(stdout.trim().split("\n").pop());

requireOk(report.result === "passed", "the demo child did not pass");
requireOk(report.managerState === "connected", "the real HTTP connection did not connect");
requireOk(report.toolCount === 1, "the catalog did not list the endpoint tool");
requireOk(report.catalogComplete, "the catalog was not complete");
requireOk(
  report.internalName.startsWith("mcp_demo-server_demo-echo_"),
  "the internal name was wrong"
);
requireOk(report.exposureDirect === 1, "the exposure planner did not expose the tool");
requireOk(report.testStatus === "connected", "the bounded test did not connect");
requireOk(report.testToolCount === 1, "the bounded test did not list tools");
requireOk(report.toolListCalls >= 2, "the endpoint did not answer tools/list");
requireOk(report.toolCallCalls === 0, "the test path executed a tool (side effect)");
requireOk(report.closedAfterDispose, "dispose did not close the real HTTP connection");

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
