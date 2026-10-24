import * as fs from "node:fs";
import * as path from "node:path";

import { SkillsCatalog } from "@/agentMode/sdk/pi/features/SkillsCatalog";

// 唯一执行入口和标准技能目录不能重新依赖旧执行桥。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = path.resolve(__dirname, "../../../../..");
const SELF = __filename;
const DELETED_PATHS = [
  "src/agentMode/acp",
  "src/agentMode/skills/symlinks.ts",
  "src/agentMode/skills/reconcile.ts",
  "src/agentMode/skills/migrateProjectSkill.ts",
  "src/agentMode/skills/vaultEventExpectations.ts",
];
const REMOVED_BRIDGES = [
  "AcpBackendProcess",
  "AcpProcessManager",
  "ClaudeSdkBackendProcess",
  "permissionBridge",
];
const REMOVED_PACKAGES = ["@agentclientprotocol/sdk", "@anthropic-ai/claude-agent-sdk"];

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

describe("noLegacyExecution", () => {
  describe("source tree", () => {
    it("does not re-enroll configured Pi models as credentialless agent models https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const main = fs.readFileSync(path.join(projectRoot, "src/main.ts"), "utf8");

      expect(main).not.toContain("wireAgentModelDiscovery");
      expect(fs.existsSync(path.join(projectRoot, "src/agentMode/agentModelDiscovery.ts"))).toBe(
        false
      );
    });

    it("keeps the ACP runtime and the legacy skill distribution deleted", () => {
      const present = DELETED_PATHS.filter((candidate) =>
        fs.existsSync(path.join(projectRoot, candidate))
      );

      expect(present).toEqual([]);
    });

    it("never imports a removed execution bridge or its SDK package again", () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(path.join(projectRoot, "src"))) {
        if (file === SELF || /__tests__\/(no.*Execution|depscleanup)\.test\.ts$/.test(file))
          continue;
        const text = fs.readFileSync(file, "utf8");
        for (const bridge of REMOVED_BRIDGES) {
          if (text.includes(bridge)) offenders.push(`${file}: ${bridge}`);
        }
        for (const packageName of REMOVED_PACKAGES) {
          if (text.includes(packageName)) offenders.push(`${file}: ${packageName}`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it("has no skill distribution or backend restart listener left", () => {
      const manager = fs.readFileSync(
        path.join(projectRoot, "src/agentMode/skills/SkillManager.ts"),
        "utf8"
      );
      const index = fs.readFileSync(path.join(projectRoot, "src/agentMode/index.ts"), "utf8");

      expect(manager).not.toMatch(/createAgentLink|removeAgentLink|reconcile\(/);
      expect(manager).not.toMatch(/agentSkillsDirAbs/);
      expect(index).not.toContain('noteSpawnConfigChanged(backendId, "managed skills changed")');
    });

    it("fails the boundary scanner when a removed bridge is imported", async () => {
      const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import("node:fs");
      const { execFileSync } = await import("node:child_process");
      const temp = mkdtempSync(path.join(projectRoot, "src/.boundary-probe-"));
      try {
        mkdirSync(path.join(temp, "agentMode/sdk"), { recursive: true });
        writeFileSync(
          path.join(temp, "agentMode/sdk/probe.ts"),
          'import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";\nexport const x = AcpBackendProcess;\n'
        );
        const script = path.join(projectRoot, "scripts/check-pi-boundaries.mjs");
        const run = (): string =>
          execFileSync(process.execPath, [script, "--root", projectRoot], {
            encoding: "utf8",
            cwd: projectRoot,
          });
        expect(run).toThrow();
        rmSync(path.join(temp, "agentMode/sdk/probe.ts"));
        expect(run()).toContain("passed");
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  });

  describe("skills", () => {
    it("keeps canonical management usable without distributing to agent folders", async () => {
      const source = {
        skills: [
          {
            name: "Summarize",
            description: "Summarize a note",
            filePath: "skills/summarize/SKILL.md",
            dirPath: "skills/summarize",
            body: "Summarize the note.",
            enabledAgents: ["pi"],
            location: { kind: "canonical" as const },
          },
        ],
        listSkills: async () => source.skills,
        readBody: async () => "Summarize the note.",
      };
      const catalog = new SkillsCatalog({ source });

      const snapshot = await catalog.refresh();

      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0]).toMatchObject({ name: "Summarize", enabled: true });
      expect(catalog.enabledEntries().map((entry) => entry.name)).toEqual(["Summarize"]);
      expect(fs.existsSync(path.join(projectRoot, "src/agentMode/skills/symlinks.ts"))).toBe(false);
    });
  });
});
