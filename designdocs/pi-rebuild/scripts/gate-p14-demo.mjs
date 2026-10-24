import { spawnSync, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPiRuntimeFixture } from "../../../scripts/pi-runtime-fixture.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packRoot = path.join(projectRoot, "designdocs/pi-rebuild");
const read = async (relative) => JSON.parse(await readFile(path.join(packRoot, relative), "utf8"));
const consistency = spawnSync(process.execPath, [path.join(packRoot, "scripts/check-plan.mjs")], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (consistency.status !== 0)
  throw new Error(`验收记录不一致：\n${consistency.stdout}\n${consistency.stderr}`);
const state = await read("execution/STATE.json");
const plan = await read("execution/TASKS.json");
const incomplete = plan.tasks
  .filter((task) => state.tasks[task.id]?.status !== "done")
  .map((task) => task.id);
const priorGates = plan.phases
  .filter((phase) => phase.id !== "P14" && state.phaseGates[phase.id]?.status !== "passed")
  .map((phase) => phase.id);
const platforms = await read("execution/evidence/GATE-platforms.json");
if (
  incomplete.length ||
  priorGates.length ||
  platforms.platforms.some((platform) => platform.status !== "passed")
) {
  process.stdout.write(
    `${JSON.stringify({ result: "not_run", reason: "必需任务、阶段或真实平台验收尚未完成；不把缺少实证当作通过。", incompleteTasks: incomplete, incompleteGates: priorGates, platforms: platforms.platforms.map(({ platform, status }) => ({ platform, status })) }, null, 2)}\n`
  );
  process.exitCode = 1;
} else {
  const directory = await mkdtemp(path.join(tmpdir(), "vault-agent-p14-runtime-"));
  try {
    const bundle = path.join(directory, "production-runtime.cjs");
    const home = path.join(directory, "home");
    await mkdir(home);
    await buildPiRuntimeFixture(bundle);
    const stdout = execFileSync(process.execPath, [bundle, path.join(directory, "fixture")], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, PATH: "", HOME: home, USERPROFILE: home, NODE_ENV: "test" },
    });
    const runtime = JSON.parse(stdout.trim().split("\n").at(-1));
    if (runtime.status !== "passed") throw new Error("真实生产入口的隔离宿主演示失败。");
    process.stdout.write(
      `${JSON.stringify({ result: "passed", scope: "phase_demo_after_required_acceptance", runtime }, null, 2)}\n`
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
