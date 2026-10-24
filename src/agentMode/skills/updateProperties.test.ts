import { runRenameSkill, runUpdateProperties } from "./updateProperties";
import type { Skill } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

type Node = { kind: "dir" } | { kind: "file"; content: string };
type FakeFs = {
  exists(p: string): Promise<boolean>;
  readFile(p: string): Promise<string>;
  writeFile(p: string, content: string): Promise<void>;
  rmRecursive(p: string): Promise<void>;
};

// Editing a skill only touches the canonical store: properties are rewritten in SKILL.md and a rename
// moves the canonical folder, with no agent-directory symlink to retarget.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
let mockRenameHandler: ((from: string, to: string) => Promise<void>) | null = null;

jest.mock("./renameWithRetry", () => ({
  __esModule: true,
  renameWithRetry: jest.fn(async (from: string, to: string) => {
    if (mockRenameHandler === null) throw new Error("renameWithRetry was not configured");
    await mockRenameHandler(from, to);
  }),
}));

function mkFs(initial: Record<string, Node> = {}): FakeFs & {
  __dump(): Record<string, Node>;
  __move(from: string, to: string): void;
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
    __move(from, to) {
      for (const [key, node] of [...map.entries()]) {
        if (key !== from && !key.startsWith(`${from}/`)) continue;
        map.delete(key);
        map.set(`${to}${key.slice(from.length)}`, node);
      }
      map.set(to, { kind: "dir" });
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
    enabledAgents: ["pi"],
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

describe("updateProperties", () => {
  afterEach(() => {
    mockRenameHandler = null;
  });

  describe("runUpdateProperties()", () => {
    it("rewrites the requested frontmatter fields", async () => {
      const skill = makeSkill();
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: FRONTMATTER } });

      const result = await runUpdateProperties({
        skill,
        patch: { description: "New description" },
        fs,
      });

      expect(result).toEqual({ ok: true });
      expect((fs.__dump()[skill.filePath] as { content: string }).content).toContain(
        "New description"
      );
    });

    it("preserves legacy and unknown frontmatter plus the instruction body when supported properties change https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const skill = makeSkill();
      const original =
        "---\nname: summarize\ndescription: Summarize a note\nmodel: claude-opus-4-7\nallowed-tools: Read Grep\ndisable-model-invocation: true\ncustom-options:\n  unknown: keep-me\nmetadata:\n  vault-agent-enabled-agents: claude,pi\n---\nUser instructions stay exactly here.\n";
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: original } });
      const result = await runUpdateProperties({
        skill,
        patch: { description: "Updated", userInvocable: false },
        fs,
      });
      expect(result).toEqual({ ok: true });
      const saved = await fs.readFile(skill.filePath);
      expect(saved).toContain("model: claude-opus-4-7");
      expect(saved).toContain("allowed-tools: Read Grep");
      expect(saved).toContain("disable-model-invocation: true");
      expect(saved).toContain("unknown: keep-me");
      expect(saved).toContain("vault-agent-enabled-agents: claude,pi");
      expect(saved.split("\n---\n")[1]).toBe("User instructions stay exactly here.\n");
    });

    it("reports a rewrite failure instead of claiming success", async () => {
      const skill = makeSkill();
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: FRONTMATTER } });
      fs.writeFile = async () => {
        throw new Error("disk full");
      };

      const result = await runUpdateProperties({ skill, patch: { description: "x" }, fs });

      expect(result).toEqual({ ok: false, reason: "disk full" });
    });
  });

  describe("runRenameSkill()", () => {
    it("returns the current paths when the name did not change", async () => {
      const skill = makeSkill();
      const fs = mkFs();

      const result = await runRenameSkill({
        skill,
        newName: "summarize",
        canonicalAbsRoot: "/vault/vault-agent/skills",
        fs,
      });

      expect(result).toEqual({
        ok: true,
        newDirPath: skill.dirPath,
        newFilePath: skill.filePath,
      });
    });

    it("rejects an invalid name", async () => {
      const fs = mkFs();

      const result = await runRenameSkill({
        skill: makeSkill(),
        newName: "bad/name",
        canonicalAbsRoot: "/vault/vault-agent/skills",
        fs,
      });

      expect(result).toEqual({ ok: false, reason: "invalid" });
    });

    it("reports a collision when the target folder already exists", async () => {
      const fs = mkFs({ "/vault/vault-agent/skills/other": { kind: "dir" } });

      const result = await runRenameSkill({
        skill: makeSkill(),
        newName: "other",
        canonicalAbsRoot: "/vault/vault-agent/skills",
        fs,
      });

      expect(result).toEqual({ ok: false, reason: "collision" });
    });

    it("moves the canonical folder and rewrites the name", async () => {
      const skill = makeSkill();
      const target = "/vault/vault-agent/skills/summarize-v2";
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: FRONTMATTER } });
      mockRenameHandler = async (from, to) => {
        expect(from).toBe(skill.dirPath);
        expect(to).toBe(target);
        fs.__move(from, to);
      };

      const result = await runRenameSkill({
        skill,
        newName: "summarize-v2",
        canonicalAbsRoot: "/vault/vault-agent/skills",
        fs,
      });

      if (!result.ok) throw new Error(`rename failed: ${result.reason}`);
      expect(result).toMatchObject({ ok: true, newDirPath: target });
      expect((fs.__dump()[`${target}/SKILL.md`] as { content: string }).content).toContain(
        "name: summarize-v2"
      );
    });

    it("returns the mutated flag when the rename moved the folder but the rewrite failed", async () => {
      const skill = makeSkill();
      const fs = mkFs({ [skill.filePath]: { kind: "file", content: FRONTMATTER } });
      mockRenameHandler = async (from, to) => {
        fs.__move(from, to);
      };
      fs.writeFile = async () => {
        throw new Error("read-only");
      };

      const result = await runRenameSkill({
        skill,
        newName: "summarize-v2",
        canonicalAbsRoot: "/vault/vault-agent/skills",
        fs,
      });

      expect(result).toMatchObject({ ok: false, reason: "read-only", mutated: true });
    });

    it("reports a failed rename without mutating", async () => {
      const fs = mkFs();
      mockRenameHandler = async () => {
        throw new Error("locked");
      };

      const result = await runRenameSkill({
        skill: makeSkill(),
        newName: "summarize-v2",
        canonicalAbsRoot: "/vault/vault-agent/skills",
        fs,
      });

      expect(result).toMatchObject({ ok: false, reason: "locked" });
    });
  });
});
