import * as fs from "node:fs";
import * as path from "node:path";

import {
  backendRegistry,
  creatableBackendDescriptors,
  describeBackendForHistory,
} from "@/agentMode/backends/registry";
import { KeychainCredentialStore } from "@/agentMode/sdk/pi/models/KeychainCredentialStore";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { sha256 } from "@/utils/hash";

// Installing the plugin is the whole setup: the engine is ready without probing a CLI, the model is
// configured through plugin settings into the OS keychain, no login command or runtime package
// download exists, and the required capabilities ship as host modules rather than optional binaries:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(__dirname, "../../../../..");
const sourceRoot = path.join(projectRoot, "src");

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

const productionFiles = sourceFiles(sourceRoot).filter(
  (file) =>
    !/\.(test|stories)\.(ts|tsx)$/.test(file) &&
    !file.includes(`${path.sep}testing${path.sep}`) &&
    !file.includes(`${path.sep}__fixtures__${path.sep}`)
);

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

const ENGINE_CLI_PATTERNS = [
  /\bnpm\s+install\b/,
  /\bnpx\s+/,
  /registry\.npmjs\.org/,
  /\bnpm\s+run\b/,
  /\bopencode\s+serve\b/,
  /\bclaude\s+auth\b/,
  /\bcodex\s+login\b/,
  /auth\s+login/,
  /extractArchive/,
];
const SOURCE_INSTALLER_PATTERN = /downloadFile/;

const CAPABILITY_MODULES = [
  "tools/NativeTools.ts",
  "tools/VaultWriteTools.ts",
  "events/MutationProjection.ts",
  "features/Todos.ts",
  "features/Plans.ts",
  "features/PlanDecision.ts",
  "features/Questions.ts",
  "features/QuestionBridge.ts",
  "runtime/PiRuntime.ts",
  "features/subagents/SubagentScheduler.ts",
  "features/subagents/DelegateTool.ts",
  "mcp/HttpTransport.ts",
  "mcp/McpManager.ts",
  "tools/WebFetch.ts",
];

describe("installationContract", () => {
  describe("installationContract", () => {
    describe("engine readiness", () => {
      it("registers the bundled engine without installation, authentication or binary-path APIs https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(creatableBackendDescriptors().map((descriptor) => descriptor.id)).toEqual(["pi"]);
        expect(Object.keys(backendRegistry)).toEqual(["pi"]);
        const pi = backendRegistry.pi;
        expect(pi?.createBackendProcess).toEqual(expect.any(Function));
        for (const field of [
          "getInstallState",
          "getResolvedBinaryPath",
          "openInstallUI",
          "subscribeInstallState",
          "auth",
        ])
          expect(pi).not.toHaveProperty(field);
      });

      it("keeps legacy identities readable without runtime or setup methods https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        for (const backendId of ["claude", "codex", "opencode"]) {
          expect(backendRegistry[backendId]).toBeUndefined();
          const history = describeBackendForHistory(backendId);
          expect(history.id).toBe(backendId);
          expect(history.displayName).toBeTruthy();
          for (const field of [
            "getInstallState",
            "getEnabledModelEntries",
            "createBackendProcess",
            "openInstallUI",
            "auth",
          ])
            expect(history).not.toHaveProperty(field);
        }
      });
    });

    describe("model configuration", () => {
      it("configures a model through plugin settings into the keychain only", async () => {
        const keychain = new Map<string, string>();
        const store = new KeychainCredentialStore({
          keychain: {
            getVaultId: () => "vault-1",
            isAvailable: () => true,
            getSecretById: (id) => keychain.get(id) ?? null,
            setSecretById: (id, value) => {
              keychain.set(id, value);
            },
            deleteSecretById: (id) => {
              keychain.delete(id);
            },
          },
        });
        const syncedSettings: Record<string, unknown> = {};

        await store.modify("byok-openai", async () => ({
          type: "api_key",
          key: "sk-clean-install",
        }));

        expect([...keychain.values()].join("")).toContain("sk-clean-install");
        expect(JSON.stringify(syncedSettings)).not.toContain("sk-clean-install");
        expect(await store.read("byok-openai")).toMatchObject({ type: "api_key" });
      });
    });

    describe("no external tooling", () => {
      it("ships no runtime package download or agent daemon command", () => {
        const offenders: string[] = [];
        for (const file of productionFiles) {
          const text = read(file);
          for (const pattern of [...ENGINE_CLI_PATTERNS, SOURCE_INSTALLER_PATTERN]) {
            if (pattern.test(text))
              offenders.push(`${path.relative(projectRoot, file)}: ${pattern}`);
          }
        }

        expect(offenders).toEqual([]);
        const bundle = read(path.join(projectRoot, "main.js"));
        for (const pattern of ENGINE_CLI_PATTERNS) expect(pattern.test(bundle)).toBe(false);
      });

      it("never spawns a process from the engine modules", () => {
        const engineFiles = productionFiles.filter((file) =>
          file.startsWith(path.join(sourceRoot, "agentMode/sdk/pi"))
        );

        const offenders = engineFiles.filter((file) =>
          /from\s+["'](node:)?child_process["']/.test(read(file))
        );

        expect(offenders).toEqual([]);
      });

      it("keeps login/authentication out of the plugin settings payload", () => {
        const settingsText = read(path.join(sourceRoot, "settings/model.ts"));

        expect(settingsText).not.toMatch(/claudeCli|claudeLogin|codexLogin|opencodeAuth/i);
        expect(settingsText).not.toMatch(/cliPath|binaryPath/i);
      });
    });

    describe("capability host modules", () => {
      it("ships every required core capability as a host module", () => {
        for (const relative of CAPABILITY_MODULES) {
          const file = path.join(sourceRoot, "agentMode/sdk/pi", relative);
          expect(fs.existsSync(file)).toBe(true);
        }
      });

      it("registers host manifests through the guarded registry", () => {
        const registry = new ToolRegistry();
        const manifest = {
          toolId: "vault_read",
          description: "Read authorized vault notes.",
          family: "vault" as const,
          effects: ["read" as const],
          parameters: {},
          extractTargets: () => [],
          implementationVersion: 1,
          schemaVersion: 1,
          replayPolicy: "read_only" as const,
          allowedCallers: ["root" as const],
          maxOutputBytes: 1024,
          schemaHash: sha256("vault_read"),
        };

        registry.register(manifest, "host");

        expect(registry.listDescriptions().map((description) => description.toolId)).toEqual([
          "vault_read",
        ]);
        expect(() => registry.register(manifest, "extension")).toThrow();
      });
    });
  });
});
