import type { App } from "obsidian";
import { KeychainService } from "@/services/keychainService";
import type { ModelConnectionTestInput } from "@/types/modelConnectionTest";
import type { ModelInfo } from "@/modelManagement/types/catalog";

import { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import { BuiltinModelCatalog } from "@/modelManagement/catalog/BuiltinModelCatalog";
import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { ByokSetupApi } from "@/modelManagement/setup/ByokSetupApi";

export interface CreateModelManagementInput {
  app: App;
  testModelConnection?: (input: ModelConnectionTestInput) => Promise<void>;
  resolveDeclaredModelCapabilities?: (
    providerId: string,
    modelId: string
  ) => Partial<ModelInfo> | undefined;
}

export interface ModelManagementApi {
  testModelConnection?: (input: ModelConnectionTestInput) => Promise<void>;
  resolveDeclaredModelCapabilities?: (
    providerId: string,
    modelId: string
  ) => Partial<ModelInfo> | undefined;
  catalogService: BuiltinModelCatalog;
  providerRegistry: ProviderRegistry;
  configuredModelRegistry: ConfiguredModelRegistry;
  backendConfigRegistry: BackendConfigRegistry;
  setup: {
    byok: ByokSetupApi;
  };
  coordinator: ModelManagementCoordinator;
  dispose(): void;
}

export class ModelManagementCoordinator {
  readonly #providers: ProviderRegistry;
  readonly #models: ConfiguredModelRegistry;
  readonly #backends: BackendConfigRegistry;

  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry,
    backendConfigRegistry: BackendConfigRegistry
  ) {
    this.#providers = providerRegistry;
    this.#models = configuredModelRegistry;
    this.#backends = backendConfigRegistry;
  }

  async removeProvider(providerId: string): Promise<void> {
    const configuredModelIds = this.#models
      .listByProvider(providerId)
      .map((m) => m.configuredModelId);
    await this.#backends.removeRefs(configuredModelIds);
    await this.#models.removeByProvider(providerId);
    await this.#providers.remove(providerId);
  }

  async removeConfiguredModel(configuredModelId: string): Promise<void> {
    await this.#backends.removeRefs([configuredModelId]);
    await this.#models.remove(configuredModelId);
  }
}

export function createModelManagement(input: CreateModelManagementInput): ModelManagementApi {
  const { app } = input;

  const catalogService = new BuiltinModelCatalog();
  const providerRegistry = new ProviderRegistry(app);
  const configuredModelRegistry = new ConfiguredModelRegistry();
  const backendConfigRegistry = new BackendConfigRegistry(
    providerRegistry,
    configuredModelRegistry
  );
  const coordinator = new ModelManagementCoordinator(
    providerRegistry,
    configuredModelRegistry,
    backendConfigRegistry
  );
  const setup = {
    byok: new ByokSetupApi(
      providerRegistry,
      configuredModelRegistry,
      backendConfigRegistry,
      KeychainService.getInstance(app)
    ),
  };

  return {
    resolveDeclaredModelCapabilities: input.resolveDeclaredModelCapabilities,
    testModelConnection: input.testModelConnection,
    catalogService,
    providerRegistry,
    configuredModelRegistry,
    backendConfigRegistry,
    setup,
    coordinator,
    dispose: () => {},
  };
}
