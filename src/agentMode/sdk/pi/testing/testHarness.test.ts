import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { FakeVault } from "./fakeVault";
import { FaultInjector } from "./faultInjector";

// The test harness drives the real Durable Harness with the official faux provider and an
// injected fake Vault, so production behavior is never mocked away:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const PROJECT_ROOT = path.resolve(__dirname, "../../../../..");
const TESTING_DIR = path.join(PROJECT_ROOT, "src", "agentMode", "sdk", "pi", "testing");
const SOURCE_ROOT = path.join(PROJECT_ROOT, "src");

const SMOKE_SOURCE = [
  'import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";',
  'import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";',
  'import { Type } from "@earendil-works/pi-ai";',
  'import { createFauxRuntime } from "./fauxRuntime";',
  'import { FakeVault } from "./fakeVault";',
  'import { FaultInjector } from "./faultInjector";',
  "",
  "async function main() {",
  "  const report = {",
  "    providerIds: [],",
  "    fetchCalls: 0,",
  "    toolExecutions: 0,",
  "    toolResultEntries: 0,",
  "    assistantEntries: 0,",
  "    submissionStatus: null,",
  '    vaultRoot: "",',
  "    vaultFilesAfter: null,",
  "    pausedBeforeWrite: false,",
  "    writesDuringPause: -1,",
  "    breakpoints: [],",
  "    writesAfterRelease: -1,",
  "    receiptStatus: null,",
  "    receiptAfter: null,",
  "  };",
  "  globalThis.fetch = async () => {",
  "    report.fetchCalls += 1;",
  '    throw new Error("network disabled in tests");',
  "  };",
  "  const runtime = createFauxRuntime();",
  "  report.providerIds = runtime.models.getProviders().map((provider) => provider.id);",
  '  const vault = new FakeVault({ vaultRoot: "/fixture/vault", files: { "Notes/Agent.md": "old" } });',
  "  report.vaultRoot = vault.vaultRoot;",
  "  const injector = new FaultInjector();",
  "  let receipt = null;",
  "  const tool = defineTool({",
  '    name: "apply_note_change",',
  '    description: "Apply a fixture note change",',
  "    parameters: Type.Object({ path: Type.String(), text: Type.String() }),",
  "    execute: async (args) => {",
  "      report.toolExecutions += 1;",
  '      await injector.pause("before_write");',
  "      receipt = vault.writeNote(args.path, args.text);",
  '      return { output: [{ type: "text", text: "applied" }], details: { status: "applied" } };',
  "    },",
  "  });",
  "  const registry = createRegistry();",
  '  registry.install(defineExtension({ name: "fixture", tools: [tool] }));',
  "  const harness = await Harness.open(",
  "    new MemoryStorage(),",
  "    { models: runtime.models, registry },",
  "    BACKGROUND_CONTEXT",
  "  );",
  "  const root = await harness.root(BACKGROUND_CONTEXT, {",
  '    agent: { model: { provider: "faux", modelId: "faux-1" } },',
  "  });",
  '  runtime.queueToolCall("apply_note_change", { path: "Notes/Agent.md", text: "updated" });',
  '  runtime.queueAnswer("fixture answer");',
  '  const submission = await root.submit({ type: "input", content: "apply the fixture change" }, BACKGROUND_CONTEXT);',
  '  await injector.reached("before_write");',
  "  report.pausedBeforeWrite = vault.writes.length === 0;",
  "  report.writesDuringPause = vault.writes.length;",
  "  report.breakpoints = injector.reachedLabels.slice();",
  '  injector.release("before_write");',
  "  const settled = await submission.wait(BACKGROUND_CONTEXT);",
  "  report.submissionStatus = settled.status;",
  "  report.writesAfterRelease = vault.writes.length;",
  "  report.receiptStatus = receipt ? receipt.status : null;",
  "  report.receiptAfter = receipt ? receipt.after : null;",
  '  const page = await root.entries({ order: "ascending" }, 100, undefined, BACKGROUND_CONTEXT);',
  '  report.toolResultEntries = page.items.filter((entry) => entry.kind === "pi.tool-result").length;',
  '  report.assistantEntries = page.items.filter((entry) => entry.kind === "pi.assistant").length;',
  "  report.vaultFilesAfter = vault.snapshot();",
  "  await harness.close(BACKGROUND_CONTEXT);",
  "  process.stdout.write(JSON.stringify(report));",
  "}",
  "",
  "main().catch((error) => {",
  "  process.stderr.write(String(error && error.stack ? error.stack : error));",
  "  process.exitCode = 1;",
  "});",
  "",
].join("\n");

interface HarnessSmokeReport {
  providerIds: string[];
  fetchCalls: number;
  toolExecutions: number;
  toolResultEntries: number;
  assistantEntries: number;
  submissionStatus: string | null;
  vaultRoot: string;
  vaultFilesAfter: Record<string, string> | null;
  pausedBeforeWrite: boolean;
  writesDuringPause: number;
  breakpoints: string[];
  writesAfterRelease: number;
  receiptStatus: string | null;
  receiptAfter: string | null;
}

const tempDirectories: string[] = [];

function runHarnessSmoke(): HarnessSmokeReport {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-harness-"));
  tempDirectories.push(outputDirectory);
  const bundlePath = path.join(outputDirectory, "harnessSmoke.cjs");
  const buildScript = [
    'const { buildSync } = require("esbuild");',
    "buildSync({",
    "  stdin: {",
    "    contents: process.env.SMOKE_SOURCE,",
    "    resolveDir: process.env.SMOKE_RESOLVE_DIR,",
    '    sourcefile: "harnessSmoke.ts",',
    '    loader: "ts",',
    "  },",
    "  bundle: true,",
    '  platform: "node",',
    '  format: "cjs",',
    '  target: "node22",',
    "  outfile: process.env.SMOKE_OUTFILE,",
    "  alias: { '@': process.env.SRC_DIR },",
    '  logLevel: "silent",',
    "});",
    'process.stdout.write("built");',
  ].join("\n");
  execFileSync(process.execPath, ["-e", buildScript], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      SMOKE_SOURCE,
      SMOKE_RESOLVE_DIR: TESTING_DIR,
      SMOKE_OUTFILE: bundlePath,
      SRC_DIR: SOURCE_ROOT,
    },
  });
  const stdout = execFileSync(process.execPath, [bundlePath], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NODE_ENV: "test" },
  });
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]) as HarnessSmokeReport;
}

function nonTestSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...nonTestSourceFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

afterAll(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("testHarness", () => {
  describe("FaultInjector", () => {
    it("pauses exactly at the requested breakpoint until the test releases it", async () => {
      const injector = new FaultInjector();
      let released = false;
      const gate = injector.pause("before_write").then(() => {
        released = true;
      });

      await injector.reached("before_write");
      expect(released).toBe(false);
      expect(injector.reachedLabels).toEqual(["before_write"]);

      injector.release("before_write");
      await gate;
      expect(released).toBe(true);
    });

    it("fails exactly at an armed breakpoint", async () => {
      const injector = new FaultInjector();
      const expected = new Error("injected failure");
      injector.failAt("after_write_before_receipt", expected);

      await expect(injector.pause("after_write_before_receipt")).rejects.toBe(expected);
      expect(injector.reachedLabels).toEqual(["after_write_before_receipt"]);
    });
  });

  describe("FakeVault", () => {
    it("keeps reads and writes in memory under the fixture root", () => {
      const vault = new FakeVault({
        vaultRoot: "/fixture/vault",
        files: { "Notes/User.md": "user content" },
      });

      expect(vault.vaultRoot).toBe("/fixture/vault");
      expect(vault.readNote("Notes/User.md")).toBe("user content");
      const receipt = vault.writeNote("Notes/User.md", "changed");

      expect(receipt).toEqual({
        path: "Notes/User.md",
        before: "user content",
        after: "changed",
        status: "modified",
      });
      expect(vault.reads).toEqual(["Notes/User.md"]);
      expect(vault.writes).toEqual([receipt]);
      expect(vault.snapshot()).toEqual({ "Notes/User.md": "changed" });
    });

    it("rejects paths that escape the fixture root", () => {
      const vault = new FakeVault({ vaultRoot: "/fixture/vault" });
      expect(() => vault.readNote("../outside.md")).toThrow(/outside the fixture vault/);
      expect(() => vault.writeNote("/absolute.md", "x")).toThrow(/outside the fixture vault/);
    });
  });

  describe("Durable harness smoke", () => {
    let report: HarnessSmokeReport;

    beforeAll(() => {
      report = runHarnessSmoke();
    });

    it("runs the tool script through the real Harness and faux provider", () => {
      expect(report.providerIds).toEqual(["faux"]);
      expect(report.submissionStatus).toBe("done");
      expect(report.toolExecutions).toBe(1);
      expect(report.toolResultEntries).toBeGreaterThanOrEqual(1);
      expect(report.assistantEntries).toBeGreaterThanOrEqual(1);
    });

    it("stops precisely at the write breakpoint and only resumes on release", () => {
      expect(report.pausedBeforeWrite).toBe(true);
      expect(report.writesDuringPause).toBe(0);
      expect(report.breakpoints).toEqual(["before_write"]);
      expect(report.writesAfterRelease).toBe(1);
      expect(report.receiptStatus).toBe("modified");
      expect(report.receiptAfter).toBe("updated");
    });

    it("never reaches the network or a real user vault", () => {
      expect(report.fetchCalls).toBe(0);
      expect(report.vaultRoot).toBe("/fixture/vault");
      expect(report.vaultFilesAfter).toEqual({ "Notes/Agent.md": "updated" });
    });
  });

  describe("production isolation", () => {
    it("keeps the harness and fault injection out of non-test production sources", () => {
      const offenders = nonTestSourceFiles(SOURCE_ROOT)
        .filter((file) => !file.startsWith(TESTING_DIR + path.sep))
        .filter((file) =>
          /(?:from\s+|import\s*\(\s*|require\(\s*)["'][^"']*(?:sdk\/pi\/testing|(?:^|\/)\.\.?\/testing)\//.test(
            fs.readFileSync(file, "utf8")
          )
        )
        .map((file) => path.relative(PROJECT_ROOT, file));

      expect(offenders).toEqual([]);
    });
  });
});
