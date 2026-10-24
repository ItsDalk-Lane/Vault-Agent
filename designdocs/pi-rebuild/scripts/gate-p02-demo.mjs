import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildSync } from "esbuild";

// P02 gate demo: proves real JSONL reopen across processes and real-fs lease exclusion
// with second-writer rejection: https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(import.meta.dirname, "../../..");
const srcDir = path.join(projectRoot, "src");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-p02-"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireOk(condition, message) {
  if (!condition) fail(message);
}

function buildBundle(name, source, resolveDir) {
  const obsidianStub = path.join(tempRoot, "obsidian-stub.ts");
  fs.writeFileSync(
    obsidianStub,
    'export const Platform = { isDesktopApp: true, isMobile: false };\n'
  );
  const outfile = path.join(tempRoot, `${name}.cjs`);
  buildSync({
    stdin: { contents: source, resolveDir, sourcefile: `${name}.ts`, loader: "ts" },
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

function runNode(args, extraEnv = {}) {
  return execFileSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, NODE_ENV: "test", ...extraEnv },
  });
}

const jsonlSource = `
import { mkdir } from "node:fs/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";

const mode = process.argv[2];
const directory = process.argv[3];

function requireOk(condition, message) {
  if (!condition) throw new Error(message);
}

function assistantTexts(entries) {
  const texts = [];
  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      if (message.role !== "assistant") continue;
      for (const content of message.content) {
        if (content.type === "text") texts.push(content.text);
      }
    }
  }
  return texts;
}

async function openHarness() {
  await mkdir(directory, { recursive: true });
  const storage = await openNodeJsonlStorage(directory, BACKGROUND_CONTEXT, { fsync: true });
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const harness = await Harness.open(storage, { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
  const root = await harness.root(BACKGROUND_CONTEXT, {
    agent: { model: { provider: "faux", modelId: "faux-1" } },
  });
  return { harness, root, faux };
}

async function main() {
  if (mode === "write") {
    const { harness, root, faux } = await openHarness();
    faux.setResponses([fauxAssistantMessage("durable answer")]);
    const submission = await root.submit(
      { type: "input", content: "durable question" },
      BACKGROUND_CONTEXT
    );
    const settled = await submission.wait(BACKGROUND_CONTEXT);
    const page = await root.entries({ order: "ascending" }, 100, undefined, BACKGROUND_CONTEXT);
    await harness.close(BACKGROUND_CONTEXT);
    requireOk(settled.status === "done", "the faux turn did not finish");
    process.stdout.write(
      JSON.stringify({
        status: settled.status,
        entryIds: page.items.map((entry) => entry.id),
        assistantTexts: assistantTexts(page.items),
      })
    );
    return;
  }
  const expectedIds = JSON.parse(process.env.EXPECTED_ENTRY_IDS ?? "[]");
  const { harness, root } = await openHarness();
  const page = await root.entries({ order: "ascending" }, 100, undefined, BACKGROUND_CONTEXT);
  await harness.close(BACKGROUND_CONTEXT);
  const entryIds = page.items.map((entry) => entry.id);
  requireOk(JSON.stringify(entryIds) === JSON.stringify(expectedIds));
  requireOk(assistantTexts(page.items).includes("durable answer"));
  process.stdout.write(
    JSON.stringify({ entryIds, assistantTexts: assistantTexts(page.items), matchesWriteProcess: true })
  );
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
`;

const leaseSource = `
import { StoreLease } from "@/agentMode/sdk/pi/storage/StoreLease";

const mode = process.argv[2];
const leaseDir = process.argv[3];
const storePath = process.argv[4] ?? leaseDir + "-store";

async function main() {
  const lease = new StoreLease({ leaseDir, storePath });
  if (mode === "hold") {
    const acquired = await lease.acquire();
    process.stdout.write(JSON.stringify(acquired) + "\\n");
    if (acquired.kind !== "acquired") process.exit(2);
    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.on("end", resolve);
      process.stdin.on("close", resolve);
    });
    const released = await lease.release(acquired.token);
    process.stdout.write(JSON.stringify({ released }) + "\\n");
    process.exit(0);
  }
  const result = await lease.acquire();
  process.stdout.write(JSON.stringify(result) + "\\n");
  if (result.kind === "acquired") await lease.release(result.token);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
`;

function readJsonLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      stream.off("data", onData);
      resolve(JSON.parse(buffer.slice(0, newline)));
    };
    stream.on("data", onData);
    stream.on("error", reject);
  });
}

async function demoJsonlReopen() {
  const bundle = buildBundle("jsonl", jsonlSource, projectRoot);
  const directory = path.join(tempRoot, "jsonl-store");
  const phase1 = JSON.parse(runNode([bundle, "write", directory]));
  requireOk(phase1.status === "done", "the write process did not finish its turn");
  requireOk(phase1.assistantTexts.includes("durable answer"), "the write process lost its answer");
  const phase2 = JSON.parse(
    runNode([bundle, "verify", directory], {
      EXPECTED_ENTRY_IDS: JSON.stringify(phase1.entryIds),
    })
  );
  requireOk(phase2.matchesWriteProcess === true, "reopen process did not match entry ids");
  return {
    writeProcessEntries: phase1.entryIds.length,
    reopenProcessEntries: phase2.entryIds.length,
    assistantTexts: phase2.assistantTexts,
    entryIdsStable: true,
  };
}

async function demoLeaseExclusion() {
  const bundle = buildBundle("lease", leaseSource, srcDir);
  const leaseDir = path.join(tempRoot, "lease", "sessions", "root-abc", "lease");
  fs.mkdirSync(path.dirname(leaseDir), { recursive: true });

  const holder = spawn(process.execPath, [bundle, "hold", leaseDir], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, NODE_ENV: "test" },
  });
  const first = await readJsonLine(holder.stdout);
  requireOk(first.kind === "acquired", "the first writer could not acquire the lease");

  const second = JSON.parse(runNode([bundle, "attempt", leaseDir]));
  requireOk(
    second.kind === "busy" && second.reason === "active_remote_owner",
    `the second writer was not rejected: ${JSON.stringify(second)}`
  );
  requireOk(fs.existsSync(path.join(leaseDir, "owner.json")), "the second writer removed the owner file");

  const holderExited = new Promise((resolve) => holder.on("exit", resolve));
  holder.stdin.end();
  await holderExited;

  const third = JSON.parse(runNode([bundle, "attempt", leaseDir]));
  requireOk(third.kind === "acquired", `a dead owner was not reclaimed: ${JSON.stringify(third)}`);
  return { first: first.kind, second: second.kind, secondReason: second.reason, reclaim: third.kind };
}

async function main() {
  const jsonlReopen = await demoJsonlReopen();
  const lease = await demoLeaseExclusion();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ jsonlReopen, lease, result: "passed" }));
}

main().catch((error) => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fail(String(error && error.stack ? error.stack : error));
});
