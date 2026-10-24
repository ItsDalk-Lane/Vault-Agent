import * as fs from "node:fs";
import * as path from "node:path";

// 已移除的执行链不能重新进入运行入口。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(__dirname, "../../../../..");
const DELETED_MODULES = [
  "ClaudeSdkBackendProcess",
  "permissionBridge",
  "claudeBinaryResolver",
  "claudeAuth",
  "claudeVersion",
  "claudeCompatibilityStore",
  "cliSetup",
];
const REMOVED_SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

const SELF = __filename;

function sourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe("noClaudeExecution", () => {
  describe("source tree", () => {
    it("keeps every removed Claude execution module deleted", () => {
      const missing = DELETED_MODULES.filter(
        (module) =>
          fs.existsSync(path.join(projectRoot, "src/agentMode/sdk", `${module}.ts`)) ||
          fs.existsSync(path.join(projectRoot, "src/agentMode/backends/claude", `${module}.ts`))
      );

      expect(missing).toEqual([]);
    });

    it("never imports the removed SDK package or a dangling Claude module again", () => {
      const offenders: string[] = [];
      const importSpecifier = /from\s+["']([^"']+)["']/g;
      for (const file of sourceFiles(path.join(projectRoot, "src"))) {
        if (file === SELF || /__tests__\/(no.*Execution|depscleanup)\.test\.ts$/.test(file))
          continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes(REMOVED_SDK_PACKAGE)) offenders.push(`${file}: ${REMOVED_SDK_PACKAGE}`);
        for (const match of text.matchAll(importSpecifier)) {
          const specifier = match[1] ?? "";
          if (!DELETED_MODULES.some((module) => specifier.endsWith(`/${module}`))) continue;
          const base = specifier.startsWith("@/")
            ? path.join(projectRoot, "src", specifier.slice(2))
            : specifier.startsWith(".")
              ? path.resolve(path.dirname(file), specifier)
              : undefined;
          if (base === undefined) continue;
          const resolved = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].some(
            (candidate) => fs.existsSync(candidate)
          );
          if (!resolved) offenders.push(`${file}: ${specifier}`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it("keeps the Pi runtime free of Claude execution or permission types", () => {
      const piFiles = sourceFiles(path.join(projectRoot, "src/agentMode/sdk/pi"));
      const offenders = piFiles.filter((file) => {
        if (file === SELF || /__tests__\/(no.*Execution|depscleanup)\.test\.ts$/.test(file))
          return false;
        const text = fs.readFileSync(file, "utf8");
        return (
          text.includes("ClaudeSdkBackendProcess") ||
          text.includes("permissionBridge") ||
          text.includes("@anthropic-ai")
        );
      });

      expect(offenders).toEqual([]);
    });
  });
});
