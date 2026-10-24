import { logError } from "@/logger";
import { renameWithRetry } from "./renameWithRetry";
import {
  NAME_MAX,
  NAME_RE,
  parseSkillFile,
  serializeSkillFile,
  validateName,
  type SkillFrontmatterPatch,
} from "./skillFormat";
import type { ToggleAgentFs } from "./toggleAgent";
import type { Skill } from "./types";

// Editing a skill only touches the canonical store: properties are rewritten in SKILL.md and a rename
// moves the canonical folder, with no agent-directory symlink to retarget.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type PropertiesFs = ToggleAgentFs;

export type PropertiesFailReason = "invalid" | "collision";

export type PropertiesResult =
  | { ok: true }
  | { ok: false; reason: PropertiesFailReason }
  | { ok: false; reason: string };

function isValidName(name: string): boolean {
  return (
    typeof name === "string" && name.length > 0 && name.length <= NAME_MAX && NAME_RE.test(name)
  );
}

export interface UpdatePropertiesOptions {
  skill: Skill;
  patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">;
  fs: PropertiesFs;
}

export async function runUpdateProperties(
  options: UpdatePropertiesOptions
): Promise<PropertiesResult> {
  const { skill, patch, fs } = options;
  try {
    const raw = await fs.readFile(skill.filePath);
    const parsed = parseSkillFile(raw, skill.name);
    const next = serializeSkillFile(parsed, patch);
    await fs.writeFile(skill.filePath, next);
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] updateProperties: failed to rewrite ${skill.filePath}`, err);
    return { ok: false, reason };
  }
}

export interface RenameSkillOptions {
  skill: Skill;
  newName: string;
  canonicalAbsRoot: string;
  fs: PropertiesFs;
}

export interface RenameSkillSuccess {
  ok: true;
  newDirPath: string;
  newFilePath: string;
}

export interface RenameSkillFailure {
  ok: false;
  reason: string;
  mutated?: boolean;
}

export async function runRenameSkill(
  options: RenameSkillOptions
): Promise<RenameSkillSuccess | RenameSkillFailure> {
  const { skill, newName, canonicalAbsRoot, fs } = options;

  if (newName === skill.name) {
    return { ok: true, newDirPath: skill.dirPath, newFilePath: skill.filePath };
  }

  if (!isValidName(newName)) {
    return { ok: false, reason: "invalid" };
  }

  const destRoot = canonicalAbsRoot.replace(/[/\\]+$/, "");
  const newDirPath = `${destRoot}/${newName}`;
  const newFilePath = `${newDirPath}/SKILL.md`;

  if (await fs.exists(newDirPath)) {
    return { ok: false, reason: "collision" };
  }

  try {
    await renameWithRetry(skill.dirPath, newDirPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] renameSkill: failed to rename ${skill.dirPath} → ${newDirPath}`, err);
    return { ok: false, reason };
  }

  try {
    const raw = await fs.readFile(newFilePath);
    const parsed = parseSkillFile(raw, skill.name);
    validateName(newName, newName);
    const next = serializeSkillFile(parsed, { name: newName });
    await fs.writeFile(newFilePath, next);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] renameSkill: failed to rewrite name in ${newFilePath}`, err);
    return { ok: false, reason, mutated: true };
  }

  return { ok: true, newDirPath, newFilePath };
}
