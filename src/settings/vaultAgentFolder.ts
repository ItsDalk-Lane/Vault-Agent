import { DEFAULT_VAULT_AGENT_FOLDER } from "@/constants";
import { logWarn } from "@/logger";
import { getSettings, type VaultAgentSettings } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import { normalizePath, type Vault } from "obsidian";

export const VAULT_AGENT_SUBFOLDER = Object.freeze({
  conversations: "conversations",
  customPrompts: "custom-prompts",
  systemPrompts: "system-prompts",
  skills: "skills",
  memory: "memory",
  projects: "projects",
} as const);

type FolderSettings = Pick<VaultAgentSettings, "vaultAgentFolder">;

function copilotRoot(settings: FolderSettings): string {
  return (settings.vaultAgentFolder || "").trim() || DEFAULT_VAULT_AGENT_FOLDER;
}

function deriveSubfolder(settings: FolderSettings, subfolder: string): string {
  return normalizePath(`${copilotRoot(settings)}/${subfolder}`);
}

export function deriveConversationsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, VAULT_AGENT_SUBFOLDER.conversations);
}

export function deriveConversationAttachmentsFolder(conversationsFolder: string): string {
  return normalizePath(`${conversationsFolder}/attachments`);
}

export function deriveCustomPromptsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, VAULT_AGENT_SUBFOLDER.customPrompts);
}

export function deriveSystemPromptsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, VAULT_AGENT_SUBFOLDER.systemPrompts);
}

export function deriveSkillsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, VAULT_AGENT_SUBFOLDER.skills);
}

export function deriveMemoryFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, VAULT_AGENT_SUBFOLDER.memory);
}

export function deriveProjectsFolder(settings: FolderSettings): string {
  return deriveSubfolder(settings, VAULT_AGENT_SUBFOLDER.projects);
}

export function getEffectiveVaultAgentFolder(): string {
  return normalizePath(copilotRoot(getSettings()));
}

export function getEffectiveConversationsFolder(): string {
  return deriveConversationsFolder(getSettings());
}

export function getEffectiveCustomPromptsFolder(): string {
  return deriveCustomPromptsFolder(getSettings());
}

export function getEffectiveSystemPromptsFolder(): string {
  return deriveSystemPromptsFolder(getSettings());
}

export function getEffectiveSkillsFolder(): string {
  return deriveSkillsFolder(getSettings());
}

export function getEffectiveMemoryFolder(): string {
  return deriveMemoryFolder(getSettings());
}

export function getEffectiveProjectsFolder(): string {
  return deriveProjectsFolder(getSettings());
}

export async function ensureVaultAgentSubfolders(
  vault: Vault,
  settings: FolderSettings
): Promise<void> {
  const derivers = [
    deriveConversationsFolder,
    deriveCustomPromptsFolder,
    deriveSystemPromptsFolder,
    deriveSkillsFolder,
    deriveMemoryFolder,
    deriveProjectsFolder,
  ];
  for (const derive of derivers) {
    const folder = derive(settings);
    try {
      await ensureFolderExists(vault, folder);
    } catch (error) {
      logWarn(`Could not pre-create Vault Agent sub-folder "${folder}".`, error);
    }
  }
}
