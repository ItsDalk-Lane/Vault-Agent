import * as fs from "node:fs";
import * as path from "node:path";

import { sanitizeSettings } from "@/settings/model";
import type { VaultAgentSettings } from "@/settings/model";

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
