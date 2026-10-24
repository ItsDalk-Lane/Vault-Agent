import * as fs from "node:fs";
import * as path from "node:path";

import type { Context, JsonValue } from "@earendil-works/chord";
import type {
  Harness,
  Registry,
  ToolExecutionApi,
  ToolRegistration,
  createRegistry,
  defineTool,
  watchEvents,
} from "@earendil-works/pi-durable";
import type {
  JsonlStorage,
  openNodeJsonlStorage,
} from "@earendil-works/pi-durable/storage/jsonl/node";
import type { Models, createModels } from "@earendil-works/pi-ai/models";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { McpClient } from "@earendil-works/pi-mcp";

// The Pi runtime is a fixed 1.3.0 dependency for the whole migration, and this contract
// test is the single place that proves the exporter names and signatures still match:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const PI_PACKAGES = [
  "@earendil-works/pi-durable",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-mcp",
  "@earendil-works/chord",
] as const;

const PI_AGENT_LOOP_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
] as const;

const NATIVE_BUILD_DEPENDENCIES = new Set([
  "@mapbox/node-pre-gyp",
  "bindings",
  "nan",
  "node-addon-api",
  "node-gyp",
  "node-pre-gyp",
  "prebuild-install",
  "prebuildify",
]);
const INSTALL_HOOKS = ["preinstall", "install", "postinstall"] as const;
const NATIVE_HOOK_MARKERS = /(node-gyp|prebuild|binding\.gyp|\.node\b)/i;

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const SOURCE_ROOT = path.join(PROJECT_ROOT, "src");
const PI_SDK_ROOT = path.join(PROJECT_ROOT, "src", "agentMode", "sdk", "pi");
const NODE_MODULES = path.join(PROJECT_ROOT, "node_modules");

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'`;\n]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_CALL = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type ToolExecuteParameterCount = Assert<
  Equal<Parameters<ToolRegistration["execute"]>["length"], 3>
>;
type ToolExecuteTakesContext = Assert<
  Parameters<ToolRegistration["execute"]>[2] extends Context ? true : false
>;
type ToolExecuteTakesApi = Assert<
  Parameters<ToolRegistration["execute"]>[1] extends ToolExecutionApi<JsonValue> ? true : false
>;
type ToolExecuteTakesParameters = Assert<
  Parameters<ToolRegistration["execute"]>[0] extends Static<TSchema> ? true : false
>;
type DefineToolTakesOneArgument = Assert<Equal<Parameters<typeof defineTool>["length"], 1>>;
type HarnessOpenTakesThreeArguments = Assert<Equal<Parameters<typeof Harness.open>["length"], 3>>;
type WatchEventsTakesThreeArguments = Assert<Equal<Parameters<typeof watchEvents>["length"], 3>>;
type WatchEventsTakesContext = Assert<
  Parameters<typeof watchEvents>[2] extends Context ? true : false
>;
type OpenJsonlStorageTakesContext = Assert<
  Parameters<typeof openNodeJsonlStorage>[1] extends Context ? true : false
>;
type OpenJsonlStorageReturnsStorage = Assert<
  ReturnType<typeof openNodeJsonlStorage> extends Promise<JsonlStorage> ? true : false
>;
type CreateRegistryReturnsRegistry = Assert<
  ReturnType<typeof createRegistry> extends Registry ? true : false
>;
type CreateModelsReturnsModels = Assert<
  "stream" extends keyof ReturnType<typeof createModels> ? true : false
>;
type PiAiModelsType = Assert<Models extends object ? true : false>;
type McpClientHasListTools = Assert<"listTools" extends keyof McpClient ? true : false>;

type TypeContractChecks = [
  ToolExecuteParameterCount,
  ToolExecuteTakesContext,
  ToolExecuteTakesApi,
  ToolExecuteTakesParameters,
  DefineToolTakesOneArgument,
  HarnessOpenTakesThreeArguments,
  WatchEventsTakesThreeArguments,
  WatchEventsTakesContext,
  OpenJsonlStorageTakesContext,
  OpenJsonlStorageReturnsStorage,
  CreateRegistryReturnsRegistry,
  CreateModelsReturnsModels,
  PiAiModelsType,
  McpClientHasListTools,
];

interface LockfilePackage {
  version?: string;
  dependencies?: Record<string, string>;
  hasInstallScript?: boolean;
  gypfile?: boolean;
}

interface Lockfile {
  packages?: Record<string, LockfilePackage>;
}

function readJsonFile(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8")) as unknown;
}

function readJsonObject(relativePath: string): Record<string, unknown> {
  const parsed = readJsonFile(relativePath);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${relativePath} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function readStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function packageDependencies(packageJson: Record<string, unknown>): Record<string, string> {
  return readStringRecord(packageJson.dependencies);
}

function lockfile(): Lockfile {
  return readJsonFile("package-lock.json") as Lockfile;
}

function lockedPackages(): Record<string, LockfilePackage> {
  return lockfile().packages ?? {};
}

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
      out.push(...sourceFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    out.push(fullPath);
  }
  return out;
}

function importedSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT, REQUIRE_CALL]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function piImportsInSource(): Array<{ file: string; specifier: string }> {
  const imports: Array<{ file: string; specifier: string }> = [];
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const text = fs.readFileSync(file, "utf8");
    for (const specifier of importedSpecifiers(text)) {
      if (specifier.startsWith("@earendil-works/")) imports.push({ file, specifier });
    }
  }
  return imports;
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function subpathOf(specifier: string): string {
  const packageName = packageNameOf(specifier);
  const rest = specifier.slice(packageName.length);
  return rest.length === 0 ? "." : `.${rest}`;
}

// Node resolves export wildcards such as "./api/*"; the locked packages publish their lazy API
// entry points through that pattern, so a literal key lookup alone would reject a public import:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function subpathIsExported(exportsMap: Record<string, unknown>, subpath: string): boolean {
  if (Object.prototype.hasOwnProperty.call(exportsMap, subpath)) return true;
  return Object.keys(exportsMap).some((pattern) => {
    if (!pattern.includes("*")) return false;
    const [prefix = "", suffix = ""] = pattern.split("*");
    return (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix)
    );
  });
}

function installedPackageJson(packageName: string): Record<string, unknown> {
  return readJsonObject(
    path.relative(PROJECT_ROOT, path.join(NODE_MODULES, packageName, "package.json"))
  );
}

function resolveLockedDependency(
  packages: Record<string, LockfilePackage>,
  fromPath: string,
  dependencyName: string
): string | undefined {
  let base = fromPath;
  for (;;) {
    const candidatePath = `${base ? `${base}/` : ""}node_modules/${dependencyName}`;
    if (packages[candidatePath]) return candidatePath;
    if (!base) return undefined;
    const nestedIndex = base.lastIndexOf("/node_modules/");
    base = nestedIndex === -1 ? "" : base.slice(0, nestedIndex);
  }
}

function reachableLockPaths(
  packages: Record<string, LockfilePackage>,
  roots: readonly string[]
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const root of roots) {
    const rootPath = `node_modules/${root}`;
    if (packages[rootPath]) queue.push(rootPath);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const entry = packages[current] ?? {};
    for (const dependencyName of Object.keys(readStringRecord(entry.dependencies))) {
      const resolved = resolveLockedDependency(packages, current, dependencyName);
      if (resolved) queue.push(resolved);
    }
  }
  return reachable;
}

function nativeAddonFiles(): string[] {
  const found: string[] = [];
  const visit = (directory: string, depth: number): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) visit(fullPath, depth - 1);
        continue;
      }
      if (entry.name.endsWith(".node")) found.push(fullPath);
    }
  };
  for (const lockPath of reachableLockPaths(lockedPackages(), PI_PACKAGES)) {
    const directory = path.join(PROJECT_ROOT, lockPath);
    if (fs.existsSync(directory)) visit(directory, 3);
  }
  return found;
}

function nativeAddonMarkers(packages: Record<string, LockfilePackage>): string[] {
  const markers: string[] = [];
  for (const lockPath of reachableLockPaths(packages, PI_PACKAGES)) {
    const entry = packages[lockPath] ?? {};
    if (entry.gypfile === true) markers.push(`${lockPath}:gypfile`);
    for (const dependencyName of Object.keys(readStringRecord(entry.dependencies))) {
      if (NATIVE_BUILD_DEPENDENCIES.has(dependencyName)) {
        markers.push(`${lockPath}:depends-on-${dependencyName}`);
      }
    }
    const directory = path.join(PROJECT_ROOT, lockPath);
    if (fs.existsSync(path.join(directory, "binding.gyp"))) {
      markers.push(`${lockPath}:binding.gyp`);
    }
    if (entry.hasInstallScript !== true) continue;
    const packageJsonPath = path.join(directory, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;
    const scripts = readStringRecord(
      (JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>).scripts
    );
    for (const hook of INSTALL_HOOKS) {
      const script = scripts[hook];
      if (script && NATIVE_HOOK_MARKERS.test(script)) markers.push(`${lockPath}:${hook}`);
    }
  }
  return markers;
}

function assertTypeContract(): TypeContractChecks {
  return [true, true, true, true, true, true, true, true, true, true, true, true, true, true];
}

describe("sdkContract", () => {
  describe("assertTypeContract()", () => {
    it("keeps the Durable tool execute signature at (args, api, context)", () => {
      const checks = assertTypeContract();
      expect(checks).toHaveLength(14);
      expect(checks.every((check) => check === true)).toBe(true);
    });
  });

  describe("packageDependencies()", () => {
    it("pins every Pi package to the exact 1.3.0 release", () => {
      const dependencies = packageDependencies(readJsonObject("package.json"));
      for (const packageName of PI_PACKAGES) {
        expect({ packageName, version: dependencies[packageName] }).toEqual({
          packageName,
          version: "1.3.0",
        });
      }
    });

    it("keeps Pi packages out of devDependencies so the plugin bundle owns them", () => {
      const devDependencies = readStringRecord(readJsonObject("package.json").devDependencies);
      for (const packageName of PI_PACKAGES) {
        expect(devDependencies[packageName]).toBeUndefined();
      }
    });

    it("does not depend on a second agent loop", () => {
      const packageJson = readJsonObject("package.json");
      const declared = {
        ...readStringRecord(packageJson.dependencies),
        ...readStringRecord(packageJson.devDependencies),
      };
      for (const packageName of PI_AGENT_LOOP_PACKAGES) {
        expect(declared[packageName]).toBeUndefined();
      }
    });
  });

  describe("lockfile()", () => {
    it("records the same exact Pi versions and the installed trees agree", () => {
      const rootDependencies = readStringRecord(lockedPackages()[""]?.dependencies);
      for (const packageName of PI_PACKAGES) {
        expect(rootDependencies[packageName]).toBe("1.3.0");
        expect(installedPackageJson(packageName).version).toBe("1.3.0");
      }
    });
  });

  describe("piImportsInSource()", () => {
    it("imports only public subpaths, never dist internals or relative node_modules paths", () => {
      const imports = piImportsInSource();
      expect(imports.length).toBeGreaterThan(0);
      for (const { file, specifier } of imports) {
        expect({
          file,
          specifier,
          privateImport: /(\/dist\/|node_modules)/.test(specifier),
        }).toEqual({ file, specifier, privateImport: false });
      }
    });

    it("keeps every Pi import inside src/agentMode/sdk/pi", () => {
      for (const { file, specifier } of piImportsInSource()) {
        const relative = path.relative(PI_SDK_ROOT, path.dirname(file));
        expect({ specifier, insideSdkPi: !relative.startsWith("..") }).toEqual({
          specifier,
          insideSdkPi: true,
        });
      }
    });

    it("resolves each imported subpath from the installed package exports map", () => {
      for (const { specifier } of piImportsInSource()) {
        const packageName = packageNameOf(specifier);
        const exportsMap = installedPackageJson(packageName).exports;
        const exported =
          typeof exportsMap === "object" &&
          exportsMap !== null &&
          subpathIsExported(exportsMap as Record<string, unknown>, subpathOf(specifier));
        expect({ specifier, exported }).toEqual({ specifier, exported: true });
      }
    });

    it("does not import the pi-agent-core or pi-coding-agent loops", () => {
      for (const { specifier } of piImportsInSource()) {
        expect(PI_AGENT_LOOP_PACKAGES as readonly string[]).not.toContain(packageNameOf(specifier));
      }
    });
  });

  describe("nativeAddonFiles()", () => {
    it("keeps the Pi dependency trees free of compiled .node binaries", () => {
      expect(nativeAddonFiles()).toEqual([]);
    });
  });

  describe("nativeAddonMarkers()", () => {
    it("keeps the Pi dependency trees free of native build tooling and build hooks", () => {
      // A bundled Obsidian plugin cannot load an addon compiled for another Node ABI:
      // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      expect(nativeAddonMarkers(lockedPackages())).toEqual([]);
    });
  });
});
