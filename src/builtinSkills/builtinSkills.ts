import type { BackendId } from "@/agentMode";
import type { CopilotSettings } from "@/settings/model";
import { OBSIDIAN_SKILLS } from "./obsidianSkills";

export interface BuiltinSkill {
  readonly name: string;
  readonly version: number;
  readonly enabledAgents: readonly BackendId[];
  readonly defaultDisabled?: boolean;
  readonly skillMd: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
}

/**
 * Retain retired names so Copilot can remove their managed folders and preferences.
 * https://github.com/logancyang/obsidian-copilot/issues/3022
 */
export const RETIRED_BUILTIN_SKILLS: readonly Pick<BuiltinSkill, "name">[] = [
  { name: "symposium-publish" },
  { name: "copilot-read-pdf" },
  { name: "copilot-web-search" },
  { name: "copilot-web-fetch" },
  { name: "copilot-youtube-transcript" },
  { name: "copilot-fetch-x" },
  { name: "openartifacts-publish" },
  { name: "miyo-search" },
  { name: "miyo-parse" },
];

export const SELF_HOST_WEB_SEARCH_ENV = "COPILOT_SELF_HOST_WEB_SEARCH";
export const SELF_HOST_WEB_SEARCH_URL_ENV = "COPILOT_SELF_HOST_WEB_SEARCH_URL";
export const SELF_HOST_WEB_SEARCH_TOKEN_ENV = "COPILOT_SELF_HOST_WEB_SEARCH_TOKEN";

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [...OBSIDIAN_SKILLS];

export const ALL_MANAGED_SKILLS: readonly BuiltinSkill[] = [...BUILTIN_SKILLS];

// Default-off is stored as an opt-out because older releases drop every other record,
// which would erase opt-ins synced from newer devices:
// https://github.com/Brevilabs/obsidian-copilot-private/issues/629
export const DEFAULT_BUILTIN_PREFERENCES: NonNullable<
  CopilotSettings["agentMode"]["skills"]["builtinPreferences"]
> = Object.freeze(
  Object.fromEntries(
    ALL_MANAGED_SKILLS.filter((skill) => skill.defaultDisabled).map((skill) => [
      skill.name,
      Object.freeze({ disabled: true }),
    ])
  )
);

export function isBuiltinSkillEnabledFor(
  settings: CopilotSettings,
  skillName: string,
  agentId: string
): boolean {
  const pref = settings.agentMode.skills.builtinPreferences?.[skillName];
  if (pref?.disabled || pref?.disabledAgents?.includes(agentId)) return false;
  return ALL_MANAGED_SKILLS.some((skill) => skill.name === skillName);
}
