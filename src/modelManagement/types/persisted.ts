import type { ModelInfo, ProviderType } from "./catalog";

export type LegacyAgentType = "opencode" | "claude" | "codex";

export type BackendType = LegacyAgentType | "chat" | "pi";

export type ProviderOrigin =
  | {
      kind: "byok";
      catalogProviderId?: string;
    }
  | { kind: "agent"; agentType: LegacyAgentType };

export interface Provider {
  providerId: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl?: string;
  enableCors?: boolean;
  enabled?: boolean;
  apiKeyKeychainId?: string | null;
  requiresApiKey?: boolean;
  extras?: Record<string, unknown>;
  origin: ProviderOrigin;
  addedAt: number;
}

export interface ConfiguredModel {
  configuredModelId: string;
  providerId: string;
  info: ModelInfo;
  configuredAt: number;
}

export interface BackendConfig {
  enabledModels: string[];
}
