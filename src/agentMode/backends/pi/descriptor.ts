import { buildProjectContext } from "@/context/manifestBuilder";
import { Sparkles } from "lucide-react";
import { Notice } from "obsidian";

import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { selfHostWebSearch } from "@/LLMProviders/selfHostServices";
import { desktopProviderFetch } from "@/utils/desktopProviderFetch";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { KeychainService } from "@/services/keychainService";
import { createCopilotPatternFilter } from "@/search/searchUtils";
import { getManagedSkills } from "@/agentMode/skills/SkillManager";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { capabilitiesFromConfiguredInfo } from "@/modelManagement";
import { configuredPiCatalog } from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";
import {
  VAULT_AGENT_PROMPT_BASE,
  VAULT_AGENT_WEB_RESEARCH_STEERING,
  VAULT_AGENT_PROJECT_WORKSPACE_POLICY,
  VAULT_AGENT_INSTRUCTION_PRECEDENCE,
  VAULT_AGENT_EXECUTION_POLICY,
} from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  ModelSelectionError,
  configuredModelKeyFromWireId,
  resolveModelEntry,
  validateEffort,
  effortOptionsForCatalogEntry,
} from "@/agentMode/sdk/pi/models/ModelSelection";
import type { BackendDescriptor, ModelSelection, ModelWireCodec } from "@/agentMode/session/types";
import type { ContextBuilderInput } from "@/agentMode/sdk/pi/features/ContextBuilder";

const EMPTY_USER_INSTRUCTIONS: readonly string[] = Object.freeze([]);

export function getPiInstructionSections(): Pick<
  ContextBuilderInput,
  "base" | "toolGuidance" | "userSystem"
> {
  return {
    base: [VAULT_AGENT_PROMPT_BASE, VAULT_AGENT_WEB_RESEARCH_STEERING].join("\n\n"),
    toolGuidance: [
      VAULT_AGENT_EXECUTION_POLICY,
      VAULT_AGENT_PROJECT_WORKSPACE_POLICY,
      VAULT_AGENT_INSTRUCTION_PRECEDENCE,
    ].join("\n\n"),
    userSystem: EMPTY_USER_INSTRUCTIONS,
  };
}

const PI_MODE_MAPPING = Object.freeze({
  kind: "setMode" as const,
  canonical: Object.freeze({ plan: "plan", default: "default", auto: "auto" }),
  readOnlyModeId: "plan",
});

const piWire: ModelWireCodec = {
  encode: (selection: ModelSelection) => configuredModelKeyFromWireId(selection.baseModelId),
  decode: (wireId: string) => ({
    selection: { baseModelId: configuredModelKeyFromWireId(wireId), effort: null },
    provider: null,
  }),
};

export const PiBackendDescriptor: BackendDescriptor = {
  id: "pi",
  planLifecycle: "independent",
  displayName: "Vault Agent",
  Icon: Sparkles,
  routesVaultAgentModels: true,
  restartOnProviderConfigChange: true,
  summarizesSessionTitle: false,
  getModeMapping: () => PI_MODE_MAPPING,
  createBackendProcess: ({ app }) =>
    new PiBackendProcess({
      host: {
        app,
        fetch: desktopProviderFetch,
        webSearch: selfHostWebSearch,
        keychain: {
          isAvailable: () => KeychainService.getInstance(app).isAvailable(),
          getVaultId: () => KeychainService.getInstance(app).getVaultId(),
          getSecretById: (id) => KeychainService.getInstance(app).getSecretById(id),
          setSecretById: (id, value) => KeychainService.getInstance(app).setSecretById(id, value),
          deleteSecretById: (id) => KeychainService.getInstance(app).deleteSecretById(id),
        },
        getSettings,
        isVaultPathAllowed: (path) => createCopilotPatternFilter(app)(path),
        notify: (message) => {
          new Notice(message);
        },
        getInstructions: () =>
          Object.values(getPiInstructionSections()).flat().filter(Boolean).join("\n\n"),
        getInstructionSections: getPiInstructionSections,
        getProjectContext: (projectId) => ({ text: buildProjectContext(app, projectId) }),
        subscribeSettings: (listener) => subscribeToSettingsChange(listener),
        skillsSource: {
          listSkills: async () => getManagedSkills(),
          // 技能发现提供绝对路径，交给现有文件适配器读取，避免库适配器重复添加根目录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          readBody: (path) =>
            requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises").readFile(
              path,
              "utf8"
            ),
        },
      },
    }),
  getEnabledModelEntries: (settings) => {
    const enabled = new Set(settings.backends.pi?.enabledModels ?? []);
    const catalog = configuredPiCatalog(settings);
    return catalog.readyModels
      .filter((entry) => enabled.has(entry.configuredModelId))
      .map((entry) => {
        const configured = settings.configuredModels.find(
          (model) => model.configuredModelId === entry.configuredModelId
        );
        const provider = settings.providers[entry.providerInstanceId];
        return {
          baseModelId: entry.configuredModelId,
          name: configured?.info.displayName || entry.upstreamModelId,
          credentialState:
            provider.requiresApiKey === false || provider.apiKeyKeychainId ? "ok" : "missing_key",
          capabilities: configured ? capabilitiesFromConfiguredInfo(configured.info) : undefined,
          effortOptions: effortOptionsForCatalogEntry(entry),
        };
      });
  },
  getWireBaseId: (id, settings) =>
    configuredPiCatalog(settings).readyModels.some((entry) => entry.configuredModelId === id)
      ? id
      : null,
  wire: piWire,
  applySelection: async (session, selection) => {
    const modelState = session.getState()?.model;
    if (!modelState) {
      throw new ModelSelectionError(
        "MODEL_NOT_FOUND",
        "The Pi backend has no model state to select from yet."
      );
    }
    const target = resolveModelEntry(modelState.availableModels, selection.baseModelId);
    const effort = validateEffort(selection.effort, target.effortOptions);
    if (modelState.current.baseModelId !== target.baseModelId) {
      await session.applyModelWireId(
        piWire.encode({ baseModelId: target.baseModelId, effort: null })
      );
    }
    if (effort === null) return;
    const apply = session.getState()?.model?.apply;
    const effortConfigId = apply?.kind === "setConfigOption" ? apply.effortConfigId : undefined;
    if (!effortConfigId) {
      throw new ModelSelectionError(
        "EFFORT_UNSUPPORTED",
        "This backend exposes no thinking effort control for the selected model."
      );
    }
    await session.setConfigOption(effortConfigId, effort);
  },
};
