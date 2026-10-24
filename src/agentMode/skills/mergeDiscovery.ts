import type { Skill } from "./types";

export function compareSkills(a: Skill, b: Skill): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  const bySuffix = (a.displayNameSuffix ?? "").localeCompare(b.displayNameSuffix ?? "");
  if (bySuffix !== 0) return bySuffix;
  return a.dirPath.localeCompare(b.dirPath);
}

export function formatSkillDisplayName(skill: Skill): string {
  return skill.displayNameSuffix !== undefined
    ? `${skill.name}${skill.displayNameSuffix}`
    : skill.name;
}
