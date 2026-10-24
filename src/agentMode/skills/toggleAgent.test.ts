import { runDeleteSkill, runToggleAgent, type DeleteSkillFs } from "./toggleAgent";
import type { Skill } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

type Node = { kind: "dir" } | { kind: "file"; content: string };

// Toggling a skill only rewrites the canonical frontmatter; Pi reads the canonical store directly, so
// no agent-directory symlink is created or removed any more.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function mkFs(initial: Record<string, Node> = {}): DeleteSkillFs & {
  __dump(): Record<string, Node>;
} {
  const map = new Map<string, Node>(Object.entries(initial));
  return {
    async exists(p) {
      return map.has(p);
    },
    async readFile(p) {
      const node = map.get(p);
      if (node === undefined || node.kind !== "file") throw new Error(`missing file: ${p}`);
      return node.content;
    },
    async writeFile(p, content) {
      map.set(p, { kind: "file", content });
    },
    async rmRecursive(p) {
      for (const key of [...map.keys()]) {
        if (key === p || key.startsWith(`${p}/`)) map.delete(key);
      }
    },
    __dump() {
      return Object.fromEntries(map);
    },
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "summarize",
    description: "Summarize a note",
    filePath: "/vault/vault-agent/skills/summarize/SKILL.md",
    dirPath: "/vault/vault-agent/skills/summarize",
    body: "Summarize the note.",
    enabledAgents: [],
    location: { kind: "canonical" },
    ...overrides,
  };
}

const FRONTMATTER = [
  "---",
  "name: summarize",
  "description: Summarize a note",
  "---",
  "",
  "Body",
].join("\n");

describe("toggleAgent", () => {
  describe("runToggleAgent()", () => {
    it("stamps the enabled agent into the canonical frontmatter", async () => {
      const skill = makeSkill();
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: FRONTMATTER } });

      const result = await runToggleAgent({ skill, agent: "pi", enabled: true, fs });

      expect(result).toEqual({ ok: true });
      expect((fs.__dump()[skill.filePath] as { content: string }).content).toContain(
        "vault-agent-enabled-agents: pi"
      );
    });

    it("removes the agent again when it is toggled off", async () => {
      const skill = makeSkill({ enabledAgents: ["pi"] });
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: FRONTMATTER } });

      const result = await runToggleAgent({ skill, agent: "pi", enabled: false, fs });

      expect(result).toEqual({ ok: true });
      expect((fs.__dump()[skill.filePath] as { content: string }).content).toContain(
        'vault-agent-enabled-agents: ""'
      );
    });

    it("changes only the built-in agent membership while retaining old agents and unrelated skill metadata https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const skill = makeSkill({ enabledAgents: ["claude", "codex"] });
      const original =
        "---\nname: summarize\ndescription: Summarize a note\nmodel: claude-opus-4-7\ncustom: preserved\nmetadata:\n  vault-agent-enabled-agents: claude,codex\n---\nOriginal user instructions.\n";
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: original } });
      expect(await runToggleAgent({ skill, agent: "pi", enabled: true, fs })).toEqual({ ok: true });
      const saved = await fs.readFile(skill.filePath);
      expect(saved).toContain("vault-agent-enabled-agents: claude,codex,pi");
      expect(saved).toContain("model: claude-opus-4-7");
      expect(saved).toContain("custom: preserved");
      expect(saved.split("\n---\n")[1]).toBe("Original user instructions.\n");
    });

    it("reports a rewrite failure instead of claiming the toggle worked", async () => {
      const skill = makeSkill();
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: FRONTMATTER } });
      fs.writeFile = async () => {
        throw new Error("disk full");
      };

      const result = await runToggleAgent({ skill, agent: "pi", enabled: true, fs });

      expect(result).toEqual({ ok: false, reason: "disk full" });
    });
  });

  describe("runDeleteSkill()", () => {
    it("removes the canonical skill folder without touching any agent directory", async () => {
      const skill = makeSkill();
      const fs = mkFs({
        [skill.dirPath]: { kind: "dir" },
        [skill.filePath]: { kind: "file", content: FRONTMATTER },
      });

      const result = await runDeleteSkill({ skill, fs });

      expect(result).toEqual({ ok: true });
      expect(fs.__dump()[skill.filePath]).toBeUndefined();
      expect(fs.__dump()[skill.dirPath]).toBeUndefined();
    });

    it("reports a removal failure with its reason", async () => {
      const skill = makeSkill();
      const fs = mkFs({ [skill.dirPath]: { kind: "dir" } });
      fs.rmRecursive = async () => {
        throw new Error("locked");
      };

      const result = await runDeleteSkill({ skill, fs });

      expect(result).toEqual({ ok: false, reason: "locked" });
    });
  });
});
