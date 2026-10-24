export { BuiltinModelCatalog } from "./catalog/BuiltinModelCatalog";
export type { CatalogProvider, ModelInfo, ProviderType } from "./types/catalog";
export type {
  BackendConfig,
  BackendType,
  ConfiguredModel,
  Provider,
  ProviderOrigin,
} from "./types/persisted";
export type { EnabledBackendEntry } from "./types/runtime";

export { isProviderEnabled } from "./providers/providerAvailability";
export { ProviderRegistry } from "./providers/ProviderRegistry";
export { providerDestination, urlDestination } from "./providers/providerDestination";
export {
  providerNeedsResolvedApiKey,
  providerRequiresApiKey,
} from "./providers/providerRequiresApiKey";
export { BackendConfigRegistry } from "./backends/BackendConfigRegistry";
export {
  configuredModelToCustomModel,
  mapProviderTypeToChatModelProvider,
} from "./chatModel/configuredModelToCustomModel";
export { findChatBackendEntry, resolveChatModelSelectionId } from "./chatModel/chatModelSelection";
export { resolveChatBackendModel } from "./chatModel/resolveChatBackendModel";
export { capabilitiesFromConfiguredInfo } from "./chatModel/modelCapabilityFlags";

export type { SetupProviderInput } from "./setup/ByokSetupApi";

export { createModelManagement } from "./createModelManagement";
export type { ModelManagementApi } from "./createModelManagement";

export {
  chatBackendPickerAtom,
  agentBackendPickerAtom,
  backendsAtom,
  configuredModelsAtom,
  providersAtom,
} from "./state/atoms";

export { ModelManagementProvider, useModelManagement } from "./ui/ModelManagementContext";

export { ByokPanel } from "./ui/tabs/ByokPanel";

export {
  DEFAULT_PROTOCOL_BASE_URLS,
  getProviderCapability,
  normalizeBaseUrlForProtocol,
  resolveProviderBaseUrl,
} from "./catalog/providerCapability";
export type { ProviderCapability } from "./catalog/providerCapability";
