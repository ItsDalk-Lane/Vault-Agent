export const VAULT_AGENT_SETTINGS_TAB_IDS = [
  "basic",
  "byok",
  "skills",
  "command",
  "selfhost",
  "advanced",
] as const;

export type VaultAgentSettingsTabId = (typeof VAULT_AGENT_SETTINGS_TAB_IDS)[number];
