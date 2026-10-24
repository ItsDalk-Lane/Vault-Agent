#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Pi SDK is only allowed inside src/agentMode/sdk/pi, legacy history readers may not spawn
// processes, the removed ACP/legacy execution bridges may not be imported again, and private package
// paths are never importable:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");

const PI_PACKAGE_SCOPE = "@earendil-works/";
const SDK_PI_SEGMENTS = ["src", "agentMode", "sdk", "pi"];
const LEGACY_SEGMENTS = ["src", "agentMode", "session", "legacy"];
const PROCESS_MODULE_SPECIFIERS = new Set(["child_process", "node:child_process"]);
// 删除后的旧后端目录不能被其他入口重新引用，历史身份统一从只读层读取。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const REMOVED_EXECUTION_MODULE =
  /(^|\/)acp(\/|$)|(^|\/)backends\/(claude|codex|opencode)(\/|$)|AcpBackendProcess|AcpProcessManager|ClaudeSdkBackendProcess|permissionBridge/;
const REMOVED_EXECUTION_PACKAGES = ["@agentclientprotocol/sdk", "@anthropic-ai/claude-agent-sdk"];
const SOURCE_FILE = /\.(ts|tsx)$/;
const PRIVATE_DIST_SEGMENT = /(^|\/)dist(\/|$)/;

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'`;\n]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_CALL = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const USAGE = `Usage: node scripts/check-pi-boundaries.mjs [--root <path>] [--json]

Fails when:
- a module outside src/agentMode/sdk/pi imports the locked @earendil-works SDK,
- any module imports a private package path (dist/ or node_modules/),
- a src/agentMode/session/legacy module imports child_process,
- any module imports the removed ACP/Claude execution bridge or its SDK package.
`;

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

// Comment stripping must keep import strings but drop commented-out imports:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export function stripComments(text) {
  let result = "";
  let index = 0;
  let quote = null;
  while (index < text.length) {
    const character = text[index];
    if (quote !== null) {
      result += character;
      if (character === "\\") {
        result += text[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (character === quote) quote = null;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      index += 1;
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
}

export function parseImportedSpecifiers(text) {
  const stripped = stripComments(text);
  const specifiers = new Set();
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT, REQUIRE_CALL]) {
    pattern.lastIndex = 0;
    for (const match of stripped.matchAll(pattern)) {
      if (typeof match[1] === "string" && match[1].length > 0) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

export function listSourceFiles(root) {
  const sourceRoot = path.join(root, "src");
  if (!fs.existsSync(sourceRoot)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        visit(fullPath);
        continue;
      }
      if (!SOURCE_FILE.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
      files.push(fullPath);
    }
  };
  visit(sourceRoot);
  return files.sort();
}

export function isInsideDirectory(relativePath, segments) {
  const parts = toPosix(relativePath).split("/");
  return segments.every((segment, index) => parts[index] === segment);
}

export function isPrivatePiSdkImport(specifier) {
  if (!specifier.startsWith(PI_PACKAGE_SCOPE)) return false;
  const packageRelative = specifier.slice(PI_PACKAGE_SCOPE.length);
  return PRIVATE_DIST_SEGMENT.test(packageRelative);
}

export function findPiBoundaryViolations(root) {
  const files = listSourceFiles(root);
  const violations = [];
  for (const absolutePath of files) {
    const relativePath = toPosix(path.relative(root, absolutePath));
    const text = fs.readFileSync(absolutePath, "utf8");
    for (const specifier of parseImportedSpecifiers(text)) {
      const file = relativePath;
      if (specifier.includes("node_modules")) {
        violations.push({ file, specifier, reason: "private-node-modules-import" });
        continue;
      }
      const isPiSdk = specifier.startsWith(PI_PACKAGE_SCOPE);
      if (isPiSdk && isPrivatePiSdkImport(specifier)) {
        violations.push({ file, specifier, reason: "pi-sdk-private-import" });
        continue;
      }
      if (isPiSdk && !isInsideDirectory(relativePath, SDK_PI_SEGMENTS)) {
        violations.push({ file, specifier, reason: "pi-sdk-import-outside-sdk-pi" });
        continue;
      }
      if (
        isInsideDirectory(relativePath, LEGACY_SEGMENTS) &&
        PROCESS_MODULE_SPECIFIERS.has(specifier)
      ) {
        violations.push({ file, specifier, reason: "legacy-process-import" });
        continue;
      }
      if (REMOVED_EXECUTION_MODULE.test(specifier)) {
        violations.push({ file, specifier, reason: "removed-execution-import" });
        continue;
      }
      if (
        REMOVED_EXECUTION_PACKAGES.some(
          (name) => specifier === name || specifier.startsWith(`${name}/`)
        )
      ) {
        violations.push({ file, specifier, reason: "removed-execution-sdk-import" });
      }
    }
  }
  return { scannedFiles: files.length, violations };
}

export function runChecker(argv) {
  let root = DEFAULT_ROOT;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      index += 1;
      if (index >= argv.length) {
        process.stderr.write(`--root requires a path\n${USAGE}`);
        return 2;
      }
      root = path.resolve(argv[index]);
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(USAGE);
      return 0;
    }
    process.stderr.write(`Unknown argument: ${argument}\n${USAGE}`);
    return 2;
  }
  if (!fs.existsSync(path.join(root, "src"))) {
    process.stderr.write(`${root} has no src directory\n`);
    return 2;
  }
  const { scannedFiles, violations } = findPiBoundaryViolations(root);
  const result = violations.length === 0 ? "passed" : "failed";
  const report = { result, root, scannedFiles, violations };
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const violation of violations) {
      process.stdout.write(`${violation.file}: ${violation.reason} (${violation.specifier})\n`);
    }
    process.stdout.write(
      `${result}: ${violations.length} violation(s) across ${scannedFiles} file(s)\n`
    );
  }
  return violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runChecker(process.argv.slice(2));
}
