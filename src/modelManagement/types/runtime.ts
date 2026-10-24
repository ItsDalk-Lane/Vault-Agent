import type { ProviderType } from "./catalog";
import type { ConfiguredModel, Provider } from "./persisted";

export type EnabledBackendEntry =
  | {
      configuredModelId: string;
      state: "ok";
      configuredModel: ConfiguredModel;
      provider: Provider;
    }
  | {
      configuredModelId: string;
      state: "broken";
    };

export interface ProviderDefinition {
  id: string;
  displayName: string;
  providerType: ProviderType;
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  modelInputHint: string;
  useResponsesApi?: boolean;
  catalogProviderId?: string;
}
