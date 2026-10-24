import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPiRuntimeFixture } from "./pi-runtime-fixture.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "vault-agent-clean-runtime-"));
try {
  const bundle = path.join(directory, "production-runtime.cjs");
  const home = path.join(directory, "home");
  await mkdir(home);
  await buildPiRuntimeFixture(bundle);
  const stdout = execFileSync(process.execPath, [bundle, path.join(directory, "fixture")], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, PATH: "", HOME: home, USERPROFILE: home, NODE_ENV: "test" },
  });
  const runtime = JSON.parse(stdout.trim().split("\n").at(-1));
  if (runtime.status !== "passed")
    throw new Error("The actual production runtime did not pass with an empty PATH.");
  if (runtime.environment?.pathEntries !== 0)
    throw new Error("The production runtime fixture did not actually receive an empty PATH.");
  process.stdout.write(
    `${JSON.stringify({ result: "passed", scope: "production_runtime_with_host_io_fixtures", pathClean: true, runtime, notRun: ["真实 Obsidian、真实 Keychain、真实供应商与跨平台验收"] }, null, 2)}\n`
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
