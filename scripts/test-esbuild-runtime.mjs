import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import ts from "typescript";
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runtimeBuildOptions() {
  const filename = path.join(__dirname, "../esbuild.config.mjs");
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  let options;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "esbuild.context") {
      options = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(options && ts.isObjectLiteralExpression(options));
  const flags = options.properties
    .filter((property) =>
      ["format", "target", "supported"].includes(property.name?.getText(source))
    )
    .map((property) => property.getText(source))
    .join(",");
  return vm.runInNewContext(`({${flags}})`);
}

async function buildFixture(contents, { resolveDir = __dirname, ...options } = {}) {
  const result = await esbuild.build({
    ...runtimeBuildOptions(),
    bundle: true,
    write: false,
    logLevel: "silent",
    external: ["node:*"],
    stdin: { contents, resolveDir, sourcefile: "runtime-fixture.js" },
    ...options,
  });
  const loaded = [];
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    process: { versions: { node: "fixture" } },
    require: (specifier) => {
      loaded.push(specifier);
      return require(specifier);
    },
  });
  return { exports: module.exports, loaded };
}

const scenarios = {
  computed: async () => {
    const sdkDirectory = path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai")));
    const source = fs.readFileSync(path.join(sdkDirectory, "env-api-keys.js"), "utf8");
    const fixture = await buildFixture(
      `${source}\nexport const ready = Promise.all([
          dynamicImport(NODE_FS_SPECIFIER), dynamicImport(NODE_OS_SPECIFIER), dynamicImport(NODE_PATH_SPECIFIER)
        ]).then(([fs, os, path]) => ({
          existsSync: typeof fs.existsSync,
          homedir: typeof os.homedir,
          joined: path.join("fixture", "note.md"),
          eagerReady: [_existsSync, _homedir, _join].every(value => typeof value === "function")
        }));`,
      { resolveDir: sdkDirectory }
    );
    assert.deepEqual(JSON.parse(JSON.stringify(await fixture.exports.ready)), {
      existsSync: "function",
      homedir: "function",
      joined: path.join("fixture", "note.md"),
      eagerReady: true,
    });
    assert.deepEqual(fixture.loaded, [
      "node:fs",
      "node:os",
      "node:path",
      "node:fs",
      "node:os",
      "node:path",
    ]);
  },
  lazy: async () => {
    const fixture = await buildFixture(
      `export const count = () => globalThis.fixtureLoadCount ?? 0;
         export const load = () => import("./fixture-lazy");`,
      {
        plugins: [
          {
            name: "fixture-lazy-module",
            setup(build) {
              build.onResolve({ filter: /^\.\/fixture-lazy$/ }, () => ({
                path: "fixture",
                namespace: "fixture",
              }));
              build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
                contents:
                  "globalThis.fixtureLoadCount = (globalThis.fixtureLoadCount ?? 0) + 1; export const value = 42;",
              }));
            },
          },
        ],
      }
    );
    assert.deepEqual(fixture.loaded, []);
    assert.equal(fixture.exports.count(), 0);
    const pending = fixture.exports.load();
    assert.equal(typeof pending.then, "function");
    assert.equal((await pending).value, 42);
    assert.equal(fixture.exports.count(), 1);
    await fixture.exports.load();
    assert.equal(fixture.exports.count(), 1);
    assert.deepEqual(fixture.loaded, []);
  },
  external: async () => {
    const fixture = await buildFixture(
      `export const load = () => import("node:util");
         export const missing = () => { const name = "node:" + "missing-fixture-module"; return import(name); };`
    );
    const util = await fixture.exports.load();
    assert.equal(util.format("%s %d", "fixture", 2), "fixture 2");
    let rejected;
    assert.doesNotThrow(() => {
      rejected = fixture.exports.missing();
    });
    await assert.rejects(rejected, /No such built-in module|Unknown builtin module/);
    assert.deepEqual(fixture.loaded, ["node:util", "node:missing-fixture-module"]);
  },
};

scenarios[process.argv[2]]()
  .then(() => process.stdout.write(JSON.stringify({ status: "passed" })))
  .catch((error) => {
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
  });
