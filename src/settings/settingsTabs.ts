export const VAULT_AGENT_SETTINGS_TAB_IDS = [
  "basic",
  "byok",
  "skills",
  "mcp",
  "command",
  "search",
  "advanced",
  "localData",
] as const;

export type VaultAgentSettingsTabId = (typeof VAULT_AGENT_SETTINGS_TAB_IDS)[number];
