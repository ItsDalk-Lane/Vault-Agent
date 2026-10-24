import {
  SkillsCatalog,
  SkillsCatalogError,
  type SkillCatalogSource,
  type SkillCatalogSourcePort,
} from "@/agentMode/sdk/pi/features/SkillsCatalog";
import { sha256 } from "@/utils/hash";

// The catalog indexes the existing canonical store: metadata only, stable ids with scope/trust/hash,
// the user's enable/disable choice is kept (disabled skills are listed but never injected), a changed
// skill takes effect on the next request, same-name skills carry an explicit source marker, and no
// agent install directory or symlink is ever created:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeSkillSource implements SkillCatalogSourcePort {
  skills: SkillCatalogSource[] = [];
  bodies = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly symlinks: string[] = [];

  listSkills = async (): Promise<readonly SkillCatalogSource[]> => [...this.skills];

  readBody = async (skillPath: string): Promise<string> => {
    this.reads.push(skillPath);
    return this.bodies.get(skillPath) ?? "";
  };

  writeFile = async (path: string): Promise<void> => {
    this.writes.push(path);
  };

  symlink = async (path: string): Promise<void> => {
    this.symlinks.push(path);
  };
}

function skill(overrides: Partial<SkillCatalogSource> = {}): SkillCatalogSource {
  return {
    name: "Summarize",
    description: "Summarize a note",
    filePath: "skills/summarize/SKILL.md",
    dirPath: "skills/summarize",
    body: "Summarize the selected note.",
    enabledAgents: ["pi"],
    location: { kind: "canonical" },
    ...overrides,
  };
}

describe("SkillsCatalog", () => {
  describe("SkillsCatalog", () => {
    describe("refresh()", () => {
      it("keeps a legacy skill visible with a derived hash and a stable id", async () => {
        const source = new FakeSkillSource();
        source.skills = [
          {
            name: "Legacy Skill",
            description: "Old skill without metadata",
            filePath: "skills/legacy/SKILL.md",
            dirPath: "skills/legacy",
            body: "legacy body",
            enabledAgents: [],
            location: { kind: "canonical" },
          },
        ];
        const catalog = new SkillsCatalog({ source });

        const snapshot = await catalog.refresh();

        expect(snapshot.entries).toHaveLength(1);
        expect(snapshot.entries[0]).toMatchObject({
          skillId: "canonical:legacy-skill",
          name: "Legacy Skill",
          scope: "canonical",
          contentHash: sha256("legacy body"),
          enabled: false,
          collision: false,
        });
        expect(snapshot.revision).toBe(1);
      });

      it("keeps disabled skills listed but out of the injected set", async () => {
        const source = new FakeSkillSource();
        source.skills = [
          skill({ name: "Enabled", filePath: "skills/enabled/SKILL.md" }),
          skill({ name: "Disabled", filePath: "skills/disabled/SKILL.md", enabledAgents: [] }),
          skill({
            name: "Other Engine",
            filePath: "skills/other/SKILL.md",
            enabledAgents: ["opencode"],
          }),
        ];
        const catalog = new SkillsCatalog({ source });

        const snapshot = await catalog.refresh();

        expect(snapshot.entries.map((entry) => entry.enabled)).toEqual([true, false, false]);
        expect(snapshot.conflicts).toEqual([]);
        expect(catalog.enabledEntries().map((entry) => entry.name)).toEqual(["Enabled"]);
      });

      it("marks a same-name conflict with an explicit source marker", async () => {
        const source = new FakeSkillSource();
        source.skills = [
          skill({ name: "Review", filePath: "skills/review/SKILL.md" }),
          skill({
            name: "Review",
            filePath: "projects/demo/.pi/skills/review/SKILL.md",
            dirPath: "projects/demo/.pi/skills/review",
            location: { kind: "project", agentDirs: ["pi"] },
          }),
        ];
        const catalog = new SkillsCatalog({ source });

        const snapshot = await catalog.refresh();

        expect(snapshot.conflicts).toEqual([
          {
            name: "Review",
            skillIds: ["canonical:review", "project:review"],
          },
        ]);
        expect(snapshot.entries.map((entry) => entry.displayName)).toEqual([
          "Review (canonical)",
          "Review (project)",
        ]);
        expect(snapshot.entries.map((entry) => entry.trust)).toEqual(["user", "project"]);
        expect(snapshot.entries.every((entry) => entry.collision)).toBe(true);
      });

      it("never creates an install directory or a symlink", async () => {
        const source = new FakeSkillSource();
        source.skills = [skill()];
        const catalog = new SkillsCatalog({ source });

        await catalog.refresh();
        await catalog.loadInstructions("canonical:summarize");

        expect(source.writes).toEqual([]);
        expect(source.symlinks).toEqual([]);
      });
    });

    describe("loadInstructions()", () => {
      it("loads the full instructions on demand and refuses a disabled skill", async () => {
        const source = new FakeSkillSource();
        source.skills = [
          skill(),
          skill({ name: "Off", filePath: "skills/off/SKILL.md", enabledAgents: [] }),
        ];
        source.bodies.set("skills/summarize/SKILL.md", "Full instructions here.");
        const catalog = new SkillsCatalog({ source });
        await catalog.refresh();

        const loaded = await catalog.loadInstructions("canonical:summarize");

        expect(loaded.text).toBe("Full instructions here.");
        expect(loaded.contentHash).toBe(sha256("Full instructions here."));
        expect(source.reads).toEqual(["skills/summarize/SKILL.md"]);
        await expect(catalog.loadInstructions("canonical:off")).rejects.toBeInstanceOf(
          SkillsCatalogError
        );
        await expect(catalog.loadInstructions("canonical:missing")).rejects.toMatchObject({
          code: "SKILL_UNKNOWN",
        });
      });

      it("reports a changed skill as stale so the new hash applies on the next request", async () => {
        const source = new FakeSkillSource();
        source.skills = [skill({ contentHash: sha256("v1") })];
        source.bodies.set("skills/summarize/SKILL.md", "v1");
        const catalog = new SkillsCatalog({ source });
        await catalog.refresh();
        const bound = await catalog.loadInstructions("canonical:summarize");

        expect(catalog.isStale("canonical:summarize", bound.contentHash)).toBe(false);

        source.skills = [skill({ contentHash: sha256("v2") })];
        source.bodies.set("skills/summarize/SKILL.md", "v2");
        const next = await catalog.refresh();

        expect(next.revision).toBe(2);
        expect(catalog.isStale("canonical:summarize", bound.contentHash)).toBe(true);
        expect(catalog.isStale("canonical:summarize", next.entries[0]?.contentHash ?? "")).toBe(
          false
        );
        const reloaded = await catalog.loadInstructions("canonical:summarize");
        expect(reloaded.text).toBe("v2");
      });
    });

    describe("entry()", () => {
      it("resolves an indexed skill by its stable id", async () => {
        const source = new FakeSkillSource();
        source.skills = [skill()];
        const catalog = new SkillsCatalog({ source });
        await catalog.refresh();

        expect(catalog.entry("canonical:summarize")).toMatchObject({
          name: "Summarize",
          sourcePath: "skills/summarize/SKILL.md",
          dirPath: "skills/summarize",
        });
        expect(catalog.entry("nope")).toBeUndefined();
      });
    });
  });
});
