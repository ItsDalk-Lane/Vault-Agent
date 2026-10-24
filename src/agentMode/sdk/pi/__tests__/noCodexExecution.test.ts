import * as fs from "node:fs";
import * as path from "node:path";

import {
  backendDisplayOrder,
  backendRegistry,
  describeBackendForHistory,
} from "@/agentMode/backends/registry";
import { AgentSessionIndex } from "@/agentMode/session/AgentSessionIndex";
import { sanitizeSettings } from "@/settings/model";
import type { VaultAgentSettings } from "@/settings/model";

// The removed Codex execution chain must stay unreachable: no module may detect, download, install or
// start the ACP binary, an old Codex id must still be indexable and labelled, and deleting it must not
// touch ordinary OpenAI API models:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(__dirname, "../../../../..");
const DELETED_MODULES = [
  "CodexBackend",
  "CodexBinaryManager",
  "CodexInstallModal",
  "CodexSettingsPanel",
  "cliSetup",
  "codexArchive",
  "codexAuth",
  "codexBinaryResolver",
  "codexConfigEnv",
  "codexModeMapping",
  "codexPlanUsage",
  "codexVersion",
];
const REMOVED_IDENTIFIERS = [
  "CODEX_PINNED_VERSION",
  "CODEX_BINARY_NAME",
  "resolveCodexAcpBinary",
  "codexAcpSearchDirs",
  "CodexBinaryManager",
  "detectCodexAcpPath",
];
const CODEX_BINARY_LITERAL = "codex-acp";

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

class FakeIndexStorage {
  readonly files = new Map<string, string>();
  exists = async (path: string): Promise<boolean> => this.files.has(path);
  read = async (path: string): Promise<string> => this.files.get(path) ?? "";
  write = async (path: string, content: string): Promise<void> => {
    this.files.set(path, content);
  };
}

describe("noCodexExecution", () => {
  describe("source tree", () => {
    it("keeps every removed Codex execution module deleted", () => {
      const missing = DELETED_MODULES.filter((module) =>
        fs.existsSync(path.join(projectRoot, "src/agentMode/backends/codex", `${module}.ts`))
      );

      expect(missing).toEqual([]);
      expect(fs.existsSync(path.join(projectRoot, "src/utils/codexModelId.ts"))).toBe(false);
    });

    it("never imports a deleted Codex module or references its binary contract again", () => {
      const offenders: string[] = [];
      const importSpecifier = /from\s+["']([^"']+)["']/g;
      for (const file of sourceFiles(path.join(projectRoot, "src"))) {
        if (file === SELF || /__tests__\/(no.*Execution|depscleanup)\.test\.ts$/.test(file))
          continue;
        const text = fs.readFileSync(file, "utf8");
        for (const marker of REMOVED_IDENTIFIERS) {
          if (text.includes(marker)) offenders.push(`${file}: ${marker}`);
        }
        const isTestFile = file.endsWith(".test.ts") || file.endsWith(".test.tsx");
        if (
          text.includes(CODEX_BINARY_LITERAL) &&
          /\/backends\/codex\/|\/utils\//.test(file) &&
          !isTestFile
        ) {
          offenders.push(`${file}: ${CODEX_BINARY_LITERAL}`);
        }
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
  });

  describe("historical backend identity", () => {
    it("keeps the old identity outside every runtime and model-discovery registration https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(backendRegistry.codex).toBeUndefined();
      expect(Object.keys(backendRegistry)).toEqual(["pi"]);
      expect(backendDisplayOrder().map((descriptor) => descriptor.id)).toEqual(["pi"]);
      const history = describeBackendForHistory("codex");
      expect(history).toMatchObject({
        id: "codex",
        label: "Codex",
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

  describe("AgentSessionIndex", () => {
    it("keeps an old Codex id indexable while honouring its tombstone", async () => {
      const storage = new FakeIndexStorage();
      const index = new AgentSessionIndex(storage, "agent-chat-index.json");
      await index.mergeDiscoveredSessions([
        {
          backendId: "codex",
          sessionId: "old-codex-1",
          title: "Old Codex chat",
          createdAtMs: 1_700_000_000_000,
          lastAccessedAtMs: 1_700_000_100_000,
          projectId: "project-a",
        },
      ]);

      const entries = await index.getEntries();

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        backendId: "codex",
        sessionId: "old-codex-1",
        title: "Old Codex chat",
        projectId: "project-a",
      });
      await index.deleteSession("codex", "old-codex-1");
      expect(await index.isTombstoned("codex", "old-codex-1")).toBe(true);
      await index.mergeDiscoveredSessions([
        {
          backendId: "codex",
          sessionId: "old-codex-1",
          title: "Old Codex chat",
          createdAtMs: 1_700_000_000_000,
          lastAccessedAtMs: 1_700_000_200_000,
        },
      ]);
      expect(await index.getEntries()).toEqual([]);
    });
  });

  describe("OpenAI API models", () => {
    it("keeps BYOK OpenAI providers and their configured models usable", () => {
      const settings = {
        providers: {
          "byok-openai": {
            providerId: "byok-openai",
            providerType: "openai",
            displayName: "OpenAI",
            apiKeyKeychainId: "keychain-openai",
            origin: { kind: "byok", catalogProviderId: "openai" },
            addedAt: 1,
          },
        },
        configuredModels: [
          {
            configuredModelId: "byok-openai:gpt-4o",
            providerId: "byok-openai",
            info: { displayName: "GPT-4o", id: "gpt-4o" },
            configuredAt: 1,
          },
        ],
        agentMode: { activeBackend: "pi", byok: { openai: "byok-openai" }, backends: {} },
      } as unknown as VaultAgentSettings;

      const sanitized = sanitizeSettings(settings);

      expect(Object.keys(sanitized.providers)).toEqual(["byok-openai"]);
      expect(sanitized.providers["byok-openai"]?.apiKeyKeychainId).toBe("keychain-openai");
      expect(sanitized.configuredModels.map((model) => model.configuredModelId)).toEqual([
        "byok-openai:gpt-4o",
      ]);
    });
  });
});
