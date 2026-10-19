import { type CopilotSettings, getSettings } from "@/settings/model";
import {
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
} from "@/builtinSkills/builtinSkills";
import {
  COPILOT_OBSIDIAN_CLI_ENV,
  resolveObsidianCliPath,
} from "@/agentMode/backends/shared/obsidianCliPath";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { BackendId } from "@/agentMode/session/types";

const PROTECTED_BUILTIN_ENV_KEYS = [
  SELF_HOST_WEB_SEARCH_ENV,
  SELF_HOST_WEB_SEARCH_URL_ENV,
  SELF_HOST_WEB_SEARCH_TOKEN_ENV,
] as const;

const EMPTY_MANAGED_ENV: Readonly<Record<string, string>> = Object.freeze({});

export async function buildBuiltinSkillEnv(
  selfHostSearchChannel?: Readonly<{ url: string; token: string }>
): Promise<Readonly<Record<string, string>>> {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const settings = getSettings();
  const env: Record<string, string> = {};

  const obsidianCliPath = resolveObsidianCliPath({
    platform: process.platform,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    homeDir: os.homedir(),
  });
  if (obsidianCliPath) env[COPILOT_OBSIDIAN_CLI_ENV] = obsidianCliPath;

  // The channel values are protected from backend overrides so Self-Host mode
  // cannot silently fall back to a hosted or agent-native search path.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/165
  if (settings.enableSelfHostMode === true && selfHostSearchChannel) {
    env[SELF_HOST_WEB_SEARCH_ENV] = "1";
    env[SELF_HOST_WEB_SEARCH_URL_ENV] = selfHostSearchChannel.url;
    env[SELF_HOST_WEB_SEARCH_TOKEN_ENV] = selfHostSearchChannel.token;
  }

  return Object.keys(env).length === 0 ? EMPTY_MANAGED_ENV : env;
}

// An override replacing `current` with `unrestricted` would silently widen the user's search boundary.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/121
export function sanitizeBuiltinSkillEnvOverrides(
  envOverrides?: Readonly<Record<string, string>>
): Record<string, string> {
  const sanitized = { ...(envOverrides ?? {}) };
  for (const key of PROTECTED_BUILTIN_ENV_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

export function getBuiltinSkillEnvRestartPolicy(
  prev: CopilotSettings,
  next: CopilotSettings,
  backendId: BackendId
): "none" | "deferred" | "immediate" {
  const selfHostRoutingChanged =
    backendId === "opencode" && prev.enableSelfHostMode !== next.enableSelfHostMode;
  if (!selfHostRoutingChanged) {
    return "none";
  }
  if (prev.enableSelfHostMode !== true && next.enableSelfHostMode === true) {
    return "immediate";
  }
  return "deferred";
}
