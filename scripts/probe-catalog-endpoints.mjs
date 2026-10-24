// 用锁定规则跑目录探针：esbuild 把插件真实的能力解析打包到临时文件，避免在脚本里复制一份支持清单。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = await mkdtemp(join(tmpdir(), "vault-agent-catalog-probe-"));
const outfile = join(outdir, "probe.mjs");
const sourceRoot = new URL("../src", import.meta.url).pathname;

await build({
  entryPoints: [new URL("./catalogEndpointProbe.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  alias: { "@": sourceRoot },
  logLevel: "silent",
});

// eslint-disable-next-line no-unsanitized/method -- outfile is a controlled path under os.tmpdir(), produced by the esbuild step above.
const { probeCatalogEndpoints } = await import(pathToFileURL(outfile).href);
const report = await probeCatalogEndpoints();

process.stdout.write(
  `providers=${report.providers} public=${report.publicLists.length} auth-gated=${report.authGated.length} drift=${report.drift.length} model-list-unavailable=${report.modelListUnavailable.length} unknown=${report.unknown.length}\n`
);
const describe = (attempt) => `${attempt.id} ${attempt.url} -> ${attempt.status ?? "unreachable"}`;
for (const attempt of report.drift) process.stdout.write(`DRIFT   ${describe(attempt)}\n`);
for (const attempt of report.unknown) process.stdout.write(`UNKNOWN ${describe(attempt)}\n`);
if (report.drift.length > 0 && process.argv.includes("--fail")) process.exitCode = 1;
