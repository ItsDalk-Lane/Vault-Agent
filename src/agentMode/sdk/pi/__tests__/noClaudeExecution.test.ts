import * as fs from "node:fs";
import * as path from "node:path";

import {
  backendDisplayOrder,
  backendRegistry,
  describeBackendForHistory,
} from "@/agentMode/backends/registry";
import { LegacyHistoryReader } from "@/agentMode/session/legacy/LegacyHistoryReader";

// 旧 Claude 执行链不得重新进入运行入口，历史名称与聊天仍可只读查看。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
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

  describe("historical backend identity", () => {
    it("keeps the old identity outside every runtime and model-discovery registration https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(backendRegistry.claude).toBeUndefined();
      expect(Object.keys(backendRegistry)).toEqual(["pi"]);
      expect(backendDisplayOrder().map((descriptor) => descriptor.id)).toEqual(["pi"]);
      const history = describeBackendForHistory("claude");
      expect(history).toMatchObject({
        id: "claude",
        label: "Claude",
      });
      expect(
        Object.values(history).some(
          (value) => typeof value === "function" && value !== history.Icon
        )
      ).toBe(false);
      expect(history).not.toHaveProperty("createBackendProcess");
      expect(history).not.toHaveProperty("getEnabledModelEntries");
      expect(history).not.toHaveProperty("getInstallState");
    });
  });

  describe("legacy Claude history", () => {
    it("opens an old Claude chat with its original backendId and messages", async () => {
      const markdown = [
        "---",
        "backendId: claude",
        "sessionId: old-claude-1",
        "title: Old Claude chat",
        "createdAtMs: 1700000000000",
        "---",
        "",
        "**user**: summarize my note",
        "",
        "**ai**: here is the summary",
        "",
      ].join("\n");
      const reader = new LegacyHistoryReader({
        ports: {
          listFiles: async () => [{ path: "chats/old-claude-1.md", content: markdown }],
          isTombstoned: async () => false,
        },
      });

      const result = await reader.readAll();

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        backendId: "claude",
        sessionId: "old-claude-1",
        title: "Old Claude chat",
        importMode: "text_only",
      });
      expect(result.entries[0]?.messages.map((message) => message.text)).toEqual([
        "summarize my note",
        "here is the summary",
      ]);
    });
  });
});
