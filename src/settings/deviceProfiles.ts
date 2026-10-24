// Device-specific fields live in per-device segments because `data.json` syncs across devices:
// https://github.com/logancyang/obsidian-copilot/issues/2539

import type { VaultAgentSettings, DeviceAgentProfile } from "@/settings/model";

type AgentMode = VaultAgentSettings["agentMode"];
type Backends = AgentMode["backends"];

function hasOwnKeys(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

function omitKeys<T extends object>(obj: T, keys: readonly string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const key of keys) delete out[key];
  return out as T;
}

const CODEX_DEVICE_KEYS = ["envOverrides"] as const;
const CLAUDE_DEVICE_KEYS = ["envOverrides"] as const;
const OPENCODE_DEVICE_KEYS = ["envOverrides"] as const;

function buildProfileFromFlat(agentMode: AgentMode): DeviceAgentProfile {
  const profile: DeviceAgentProfile = {};

  const codexSrc = agentMode.backends?.codex;
  if (codexSrc?.envOverrides) {
    profile.codex = { envOverrides: codexSrc.envOverrides };
  }

  const opencodeSrc = agentMode.backends?.opencode;
  if (opencodeSrc?.envOverrides) {
    profile.opencode = { envOverrides: opencodeSrc.envOverrides };
  }

  const claudeSrc = agentMode.backends?.claude;
  if (claudeSrc?.envOverrides) {
    profile.claude = { envOverrides: claudeSrc.envOverrides };
  }

  return profile;
}

function stripDeviceFieldsFromBackends(backends: Backends | undefined): Backends {
  const out: Backends = {};
  if (!backends) return out;
  if (backends.pi) out.pi = backends.pi;

  if (backends.codex) {
    const synced = omitKeys(backends.codex, CODEX_DEVICE_KEYS);
    if (hasOwnKeys(synced)) out.codex = synced;
  }
  if (backends.claude) {
    const synced = omitKeys(backends.claude, CLAUDE_DEVICE_KEYS);
    if (hasOwnKeys(synced)) out.claude = synced;
  }
  if (backends.opencode) {
    const synced = omitKeys(backends.opencode, OPENCODE_DEVICE_KEYS);
    if (hasOwnKeys(synced)) out.opencode = synced;
  }
  return out;
}

export function dehydrateDeviceProfile(
  settings: VaultAgentSettings,
  deviceId: string
): VaultAgentSettings {
  const agentMode = settings?.agentMode;
  if (!agentMode) return settings;

  const profile = buildProfileFromFlat(agentMode);
  const deviceProfiles = { ...(agentMode.deviceProfiles ?? {}) };
  if (hasOwnKeys(profile)) deviceProfiles[deviceId] = profile;
  else delete deviceProfiles[deviceId];

  const nextAgentMode: AgentMode = {
    ...agentMode,
    backends: stripDeviceFieldsFromBackends(agentMode.backends),
    deviceProfiles: hasOwnKeys(deviceProfiles) ? deviceProfiles : undefined,
  };
  return { ...settings, agentMode: nextAgentMode };
}

export function hydrateDeviceProfile(
  settings: VaultAgentSettings,
  deviceId: string
): VaultAgentSettings {
  const agentMode = settings.agentMode;
  if (!agentMode) return settings;
  const profile = agentMode.deviceProfiles?.[deviceId];

  const nextBackends = stripDeviceFieldsFromBackends(agentMode.backends);
  if (profile?.codex) nextBackends.codex = { ...nextBackends.codex, ...profile.codex };
  if (profile?.opencode) nextBackends.opencode = { ...nextBackends.opencode, ...profile.opencode };
  if (profile?.claude) nextBackends.claude = { ...nextBackends.claude, ...profile.claude };

  const nextAgentMode: AgentMode = {
    ...agentMode,
    backends: nextBackends,
  };
  return { ...settings, agentMode: nextAgentMode };
}
