import { compareSkills, formatSkillDisplayName } from "./mergeDiscovery";
import type { BackendId, Skill } from "./types";

function canonicalSkill(name: string, enabledAgents: BackendId[] = []): Skill {
  return {
    name,
    description: "A skill.",
    filePath: `/vault/vault-agent/skills/${name}/SKILL.md`,
    dirPath: `/vault/vault-agent/skills/${name}`,
    body: "body",
    enabledAgents,
    location: { kind: "canonical" },
  };
}

describe("mergeDiscovery", () => {
  describe("compareSkills()", () => {
    it("orders the configured skills alphabetically", () => {
      expect(
        [canonicalSkill("writer"), canonicalSkill("analyst")]
          .sort(compareSkills)
          .map((skill) => skill.name)
      ).toEqual(["analyst", "writer"]);
    });
  });
  describe("formatSkillDisplayName()", () => {
    it("returns the bare name when no suffix is present", () => {
      expect(formatSkillDisplayName(canonicalSkill("foo"))).toBe("foo");
    });

    it("appends the suffix when set", () => {
      const skill: Skill = {
        ...canonicalSkill("foo"),
        displayNameSuffix: " (claude)",
      };
      expect(formatSkillDisplayName(skill)).toBe("foo (claude)");
    });
  });
});
