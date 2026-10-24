import * as fs from "node:fs";
import * as path from "node:path";

// 插件必须包含完整引擎，移除的执行依赖和运行时下载安装入口不得重新出现。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(__dirname, "../../../../..");
const REMOVED_DEPENDENCIES = ["@agentclientprotocol/sdk", "@anthropic-ai/claude-agent-sdk"];
const REMOVED_INSTALL_MODULES = [
  "managedInstall",
  "installStatus",
  "installProgress",
  "downloadFile",
  "extractArchive",
];
const RUNTIME_DOWNLOAD_PATTERNS = [
  /npm\s+install/i,
  /npm\s+i\s/,
  /npx\s+/,
  /node\s+download/i,
  /downloadAndInstall/i,
];

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

describe("depscleanup", () => {
  describe("package metadata", () => {
    it("keeps the removed execution SDKs out of every dependency block", () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const all = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.optionalDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
      };

      for (const dependency of REMOVED_DEPENDENCIES) {
        expect(all).not.toHaveProperty(dependency);
      }
    });

    it("locks no removed execution SDK in package-lock.json", () => {
      const lock = fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8");

      for (const dependency of REMOVED_DEPENDENCIES) {
        expect(lock).not.toContain(`${dependency}`);
      }
    });
  });

  describe("source tree", () => {
    it("has no runtime download/install path left", () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(path.join(projectRoot, "src"))) {
        if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const module of REMOVED_INSTALL_MODULES) {
          if (new RegExp(`from\\s+["'][^"']*${module}["']`).test(text)) {
            offenders.push(`${path.relative(projectRoot, file)}: ${module}`);
          }
        }
        for (const pattern of RUNTIME_DOWNLOAD_PATTERNS) {
          if (pattern.test(text)) offenders.push(`${path.relative(projectRoot, file)}: ${pattern}`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it("keeps the managed-install modules deleted", () => {
      const present = REMOVED_INSTALL_MODULES.filter((module) =>
        fs.existsSync(path.join(projectRoot, "src/agentMode/backends/shared", `${module}.ts`))
      );

      expect(present).toEqual([]);
    });
  });

  describe("README", () => {
    it("describes installing the plugin as the only setup step", () => {
      const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");

      expect(readme).toMatch(/bundles its engine/i);
      expect(readme).toMatch(/no Node\/npm install, agent CLI, or login is required/i);
      expect(readme).not.toMatch(/installed and updated from inside the plugin/i);
      expect(readme).not.toMatch(/via the Claude Agent SDK/i);
    });
  });
});
