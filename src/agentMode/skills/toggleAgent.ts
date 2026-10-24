import { logError } from "@/logger";
import { parseSkillFile, serializeSkillFile } from "./skillFormat";
import type { BackendId, Skill } from "./types";

// Toggling a skill on or off only rewrites the canonical frontmatter; Pi reads the canonical store
// directly, so no agent-directory symlink is created or removed any more.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ToggleAgentFs {
  readFile(absPath: string): Promise<string>;
  writeFile(absPath: string, content: string): Promise<void>;
  exists(absPath: string): Promise<boolean>;
  rmRecursive(absPath: string): Promise<void>;
}

export type DeleteSkillFs = ToggleAgentFs;

export type ToggleAgentResult = { ok: true } | { ok: false; reason: string };

export interface ToggleAgentOptions {
  skill: Skill;
  agent: BackendId;
  enabled: boolean;
  fs: ToggleAgentFs;
}

export async function runToggleAgent(options: ToggleAgentOptions): Promise<ToggleAgentResult> {
  const { skill, agent, enabled, fs } = options;

  const nextAgents = computeNextAgents(skill.enabledAgents, agent, enabled);

  try {
    const raw = await fs.readFile(skill.filePath);
    const parsed = parseSkillFile(raw, skill.name);
    const stamped = serializeSkillFile(parsed, { enabledAgents: nextAgents });
    await fs.writeFile(skill.filePath, stamped);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] toggleAgent: failed to rewrite ${skill.filePath}`, err);
    return { ok: false, reason };
  }

  return { ok: true };
}

export interface DeleteSkillOptions {
  skill: Skill;
  fs: DeleteSkillFs;
}

export async function runDeleteSkill(
  options: DeleteSkillOptions
): Promise<{ ok: boolean; reason?: string }> {
  const { skill, fs } = options;

  try {
    await fs.rmRecursive(skill.dirPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logError(`[skills] deleteSkill: failed to remove ${skill.dirPath}`, err);
    return { ok: false, reason };
  }
  return { ok: true };
}

function computeNextAgents(current: BackendId[], agent: BackendId, enabled: boolean): BackendId[] {
  const has = current.includes(agent);
  if (enabled && !has) return [...current, agent];
  if (!enabled && has) return current.filter((a) => a !== agent);
  return current;
}
