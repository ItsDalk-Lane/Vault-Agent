import { t } from "@/i18n";
import type { VaultAgentSettings } from "@/settings/model";
import { joinPosix } from "@/utils/pathUtils";
import {
  ALL_MANAGED_SKILLS,
  RETIRED_BUILTIN_SKILLS,
  isBuiltinSkillEnabledFor,
} from "@/builtinSkills/builtinSkills";
import {
  inspectBuiltinSkill,
  removeSeededBuiltin,
  seedBuiltinSkills,
  type BuiltinSeedFs,
} from "./seedBuiltinSkills";

export type { BuiltinPreferences } from "@/settings/builtinSkillPreferences";

export interface ReconcileBuiltinOptions {
  folder: string;
  fs: BuiltinSeedFs;
  settings: VaultAgentSettings;
  availableAgents: readonly string[];
  registeredAgents: readonly string[];
}

export async function reconcileBuiltinSkills(options: ReconcileBuiltinOptions): Promise<void> {
  const { folder, fs, settings, availableAgents, registeredAgents } = options;
  const errors: string[] = [];
  // Retired skills are removed regardless of user overrides so cleanup can retry. https://github.com/logancyang/obsidian-copilot/issues/3022
  for (const skill of RETIRED_BUILTIN_SKILLS) {
    const result = await removeSeededBuiltin(folder, skill.name, fs);
    if (result === "failed")
      errors.push(t("agentInfra.skills.builtin.removeRetiredFailed", { name: skill.name }));
  }
  const enabledAgents: Record<string, string[]> = {};
  for (const skill of ALL_MANAGED_SKILLS) {
    enabledAgents[skill.name] = registeredAgents.filter((agent) =>
      isBuiltinSkillEnabledFor(settings, skill.name, agent)
    );
  }
  // Canonical files sync between devices, so an unavailable device keeps them rather than
  // deleting another device's tools. https://github.com/logancyang/obsidian-copilot/issues/3022
  const seed = ALL_MANAGED_SKILLS.filter((skill) =>
    enabledAgents[skill.name].some((agent) => availableAgents.includes(agent))
  );
  await seedBuiltinSkills({ skillsFolderRelPath: folder, fs, skills: seed, enabledAgents });
  for (const skill of seed) {
    const state = await inspectBuiltinSkill(folder, skill.name, fs, skill.version);
    const supportFilesPresent =
      state === "seeded" &&
      (
        await Promise.all(
          skill.files.map((file) => fs.exists(joinPosix(joinPosix(folder, skill.name), file.path)))
        )
      ).every(Boolean);
    if (!supportFilesPresent)
      errors.push(
        state === "collision"
          ? t("agentInfra.skills.builtin.occupies", { name: skill.name })
          : t("agentInfra.skills.builtin.installFailed", { name: skill.name })
      );
  }
  for (const skill of ALL_MANAGED_SKILLS) {
    if (enabledAgents[skill.name].length > 0) continue;
    const result = await removeSeededBuiltin(folder, skill.name, fs);
    if (result === "failed")
      errors.push(t("agentInfra.skills.builtin.removeDisabledFailed", { name: skill.name }));
  }
  if (errors.length > 0) throw new Error(errors.join(" "));
}
