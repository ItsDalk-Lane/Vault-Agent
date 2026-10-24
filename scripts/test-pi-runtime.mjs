import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPiRuntimeFixture } from "./pi-runtime-fixture.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "vault-agent-runtime-"));
try {
  const bundle = path.join(directory, "production-runtime.cjs");
  await buildPiRuntimeFixture(bundle, process.argv[2] ?? "production");
  const stdout = execFileSync(process.execPath, [bundle, path.join(directory, "fixture")], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const report = JSON.parse(stdout.trim().split("\n").at(-1));
  if (report.status !== "passed") throw new Error("The actual production runtime scenario failed.");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
