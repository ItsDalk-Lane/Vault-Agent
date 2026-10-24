import type { BackendId } from "@/agentMode";
import type { VaultAgentSettings } from "@/settings/model";
import { OBSIDIAN_SKILLS } from "./obsidianSkills";

export interface BuiltinSkill {
  readonly name: string;
  readonly version: number;
  readonly enabledAgents: readonly BackendId[];
  readonly defaultDisabled?: boolean;
  readonly skillMd: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
}

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [...OBSIDIAN_SKILLS];

export const ALL_MANAGED_SKILLS: readonly BuiltinSkill[] = [...BUILTIN_SKILLS];

// Default-off is stored as an opt-out because older releases drop every other record,
// which would erase opt-ins synced from newer devices:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/629
export const DEFAULT_BUILTIN_PREFERENCES: NonNullable<
  VaultAgentSettings["agentMode"]["skills"]["builtinPreferences"]
> = Object.freeze(
  Object.fromEntries(
    ALL_MANAGED_SKILLS.filter((skill) => skill.defaultDisabled).map((skill) => [
      skill.name,
      Object.freeze({ disabled: true }),
    ])
  )
);

export function isBuiltinSkillEnabledFor(
  settings: VaultAgentSettings,
  skillName: string,
  agentId: string
): boolean {
  const pref = settings.agentMode.skills.builtinPreferences?.[skillName];
  if (pref?.disabled || pref?.disabledAgents?.includes(agentId)) return false;
  return ALL_MANAGED_SKILLS.some((skill) => skill.name === skillName);
}
