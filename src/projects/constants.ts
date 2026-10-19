import { ProjectConfig } from "@/aiParams";

export const EMPTY_PROJECT_CONFIG: ProjectConfig = {
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  contextSource: {},
  created: 0,
  UsageTimestamps: 0,
};

export const VAULT_AGENT_PROJECT_ID = "vault-agent-project-id";
export const VAULT_AGENT_PROJECT_NAME = "vault-agent-project-name";
export const COPILOT_PROJECT_DESCRIPTION = "copilot-project-description";
export const COPILOT_PROJECT_CREATED = "copilot-project-created";
export const VAULT_AGENT_PROJECT_LAST_USED = "vault-agent-project-last-used";
export const COPILOT_PROJECT_INCLUSIONS = "copilot-project-inclusions";
export const COPILOT_PROJECT_EXCLUSIONS = "copilot-project-exclusions";
export const COPILOT_PROJECT_WEB_URLS = "copilot-project-web-urls";
export const COPILOT_PROJECT_YOUTUBE_URLS = "copilot-project-youtube-urls";

export const PROJECT_CONFIG_FILE_NAME = "project.md";

export const PROJECTS_UNSUPPORTED_FOLDER_NAME = "unsupported";
