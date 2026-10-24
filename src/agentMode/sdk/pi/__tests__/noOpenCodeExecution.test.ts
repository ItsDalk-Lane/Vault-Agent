import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeSettings } from "@/settings/model";
import type { VaultAgentSettings } from "@/settings/model";

// 旧 OpenCode 不再参与运行与模型发现，自定义 API 模型及旧聊天继续保留。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(__dirname, "../../../../..");
const DELETED_MODULES = [
  "OpencodeBackend",
  "OpencodeBinaryManager",
  "OpencodeInstallModal",
  "OpencodeSettingsPanel",
  "npmPackage",
  "opencodeBinaryResolver",
  "opencodeCliDetector",
  "platformResolver",
  "opencodeVaultAgentPlugin",
  "opencodeVersion",
  "opencodeModelResolve",
  "opencodeProbePartition",
  "ManagedBinaryManager",
  "simpleBinaryBackend",
  "binaryCompatibility",
  "prefetchConfigEfforts",
  "BinaryPathSetting",
  "EnvOverridesSetting",
  "cliSignIn",
  "terminalSignInCommand",
  "downloadFile",
  "extractArchive",
  "ManagedBinaryConfigView",
  "AuthenticationSection",
  "SetupSteps",
  "SignInAction",
  "ConfigDialogShell",
];
const REMOVED_IDENTIFIERS = [
  "OpencodeBinaryManager",
  "getOpencodeBinaryManager",
  "detectOpencodeCliPath",
  "opencodeVaultAgentPluginDir",
  "computeInstallState",
  "toOpencodeInstallState",
  "managedBinary",
];
const OPENCODE_BINARY_LITERAL = "opencode-";
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

describe("noOpenCodeExecution", () => {
  describe("source tree", () => {
    it("keeps every removed opencode execution and install module deleted", () => {
      const present = DELETED_MODULES.filter(
        (module) =>
          fs.existsSync(
            path.join(projectRoot, "src/agentMode/backends/opencode", `${module}.ts`)
          ) ||
          fs.existsSync(
            path.join(projectRoot, "src/agentMode/backends/opencode", `${module}.tsx`)
          ) ||
          fs.existsSync(path.join(projectRoot, "src/agentMode/backends/shared", `${module}.ts`)) ||
          fs.existsSync(path.join(projectRoot, "src/agentMode/backends/shared", `${module}.tsx`)) ||
          fs.existsSync(
            path.join(projectRoot, "src/agentMode/backends/shared/ui", `${module}.ts`)
          ) ||
          fs.existsSync(path.join(projectRoot, "src/agentMode/backends/shared/ui", `${module}.tsx`))
      );

      expect(present).toEqual([]);
    });

    it("never imports a deleted module or a removed opencode process contract again", () => {
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
        const isOpencodeBackendDir = /\/backends\/opencode\//.test(file);
        if (text.includes(OPENCODE_BINARY_LITERAL) && isOpencodeBackendDir && !isTestFile) {
          offenders.push(`${file}: ${OPENCODE_BINARY_LITERAL}`);
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

  describe("model catalog", () => {
    it("keeps a BYOK OpenAI-compatible provider and its model after settings sanitization", () => {
      const settings = {
        providers: {
          "custom-llm": {
            providerId: "custom-llm",
            providerType: "openai-compatible",
            displayName: "My LLM",
            baseUrl: "https://llm.test/v1",
            apiKeyKeychainId: "keychain-custom",
            origin: { kind: "byok" },
            addedAt: 1,
          },
        },
        configuredModels: [
          {
            configuredModelId: "custom-llm:my-model",
            providerId: "custom-llm",
            info: { displayName: "My Model", id: "my-model" },
            configuredAt: 1,
          },
        ],
        agentMode: { activeBackend: "pi", byok: {}, backends: {} },
      } as unknown as VaultAgentSettings;

      const sanitized = sanitizeSettings(settings);

      expect(Object.keys(sanitized.providers)).toEqual(["custom-llm"]);
      expect(sanitized.providers["custom-llm"]?.baseUrl).toBe("https://llm.test/v1");
      expect(sanitized.configuredModels.map((model) => model.configuredModelId)).toEqual([
        "custom-llm:my-model",
      ]);
    });
  });
});
