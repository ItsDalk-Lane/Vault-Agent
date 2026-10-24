import type { App } from "obsidian";
import type VaultAgentPlugin from "@/main";
import { logError } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { t } from "@/i18n";
import { getSettings, subscribeToSettingsChange, type VaultAgentSettings } from "@/settings/model";
import { deriveSkillsFolder } from "@/settings/vaultAgentFolder";

import {
  backendRegistry,
  CREATABLE_BACKEND_IDS,
  listBackendDescriptors,
} from "./backends/registry";
import type { BackendId } from "./session/types";
import { AgentModelPreloader } from "./session/AgentModelPreloader";

import { AgentSessionManager } from "./session/AgentSessionManager";
import { createFeedbackMcpServer } from "@/agentMode/session/feedback/feedbackMcpServer";
import { seedVaultAgentDefaultModel } from "./session/vaultAgentDefaultModel";
import { SkillManager } from "./skills";
import { reconcileBuiltinSkills } from "./skills/builtin/reconcileBuiltinSkills";
import {
  saveBuiltinPreferences,
  type BuiltinPreferencesUpdate,
} from "@/settings/builtinSkillPreferences";
import { buildBuiltinSeedFs } from "./skills/builtin/vaultSeedFs";
import {
  createDefaultAskUserQuestionPrompter,
  createDefaultPermissionPrompter,
} from "./ui/permissionPrompter";

export { default as VaultAgentView } from "./ui/VaultAgentView";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export type { BackendDescriptor, BackendId } from "./session/types";
export type { VaultAgentMode, ModelSelection } from "./session/types";
export { ModelEnableList } from "@/components/ui/ModelEnableList";
export type { ModelEnableGroup } from "@/components/ui/ModelEnableList";
export { PlanPreviewView } from "./ui/PlanPreviewView";
export { openReportIssueModal } from "./ui/ReportIssueModal";
export { closeRestoredTurnDiffs, registerTurnDiffCommands, TurnDiffView } from "./ui/TurnDiffView";
export {
  backendDisplayOrder,
  getActiveBackendDescriptor,
  creatableBackendDescriptors,
  describeBackendForHistory,
  listBackendDescriptors,
} from "./backends/registry";
export { frameSink as acpFrameSink } from "./session/debugSink";
import { setFrameSinkLogsRoot } from "./session/debugSink";
export { getManagedSkills, SkillManager, SkillsSettings } from "./skills";
export type { Skill } from "./skills";
export function applyVaultAgentDefaultModel(configuredModelId: string): BackendId[] {
  return seedVaultAgentDefaultModel(listBackendDescriptors(), configuredModelId);
}

function spawnModelConfigKey(
  settings: VaultAgentSettings,
  backendId: keyof VaultAgentSettings["backends"]
): string {
  const enabled = new Set(settings.backends[backendId]?.enabledModels);
  return settings.configuredModels
    .filter((model) => {
      const provider = settings.providers[model.providerId];
      return enabled.has(model.configuredModelId) && provider && provider.origin.kind === "byok";
    })
    .map((model) =>
      JSON.stringify([
        model.configuredModelId,
        model.providerId,
        model.info.id,
        model.info.reasoning,
        model.info.reasoningEfforts,
        model.info.modalities,
        model.info.toolCall,
      ])
    )
    .sort()
    .join("\n");
}

export function createAgentSessionManager(app: App, plugin: VaultAgentPlugin): AgentSessionManager {
  const availableSkillAgents = (): readonly string[] => CREATABLE_BACKEND_IDS;
  const saveSkillPreferences = (update: BuiltinPreferencesUpdate) =>
    saveBuiltinPreferences(update, (data) => plugin.saveData(data));
  const skillManager = SkillManager.initialize(app, {
    availableAgents: availableSkillAgents,
    savePreferences: saveSkillPreferences,
    prepare: async (folder) => {
      await reconcileBuiltinSkills({
        folder,
        fs: buildBuiltinSeedFs(app),
        settings: getSettings(),
        availableAgents: availableSkillAgents(),
        registeredAgents: CREATABLE_BACKEND_IDS,
      });
    },
  });
  const initialSkillsReady = skillManager.refresh(true).then(
    () => undefined,
    (error) => logError("[Skills] Initial discovery pass failed", error)
  );
  const beforeBackendStart = (): Promise<void> => initialSkillsReady;
  const preloader = new AgentModelPreloader(
    app,
    plugin,
    (id) => backendRegistry[id],
    beforeBackendStart
  );
  let managerRef: AgentSessionManager | null = null;
  const prompter = createDefaultPermissionPrompter(
    (id) => managerRef?.getSessionByBackendId(id) ?? null,
    (id) => managerRef?.isReadOnlyFanoutSession(id) ?? false
  );
  const askUserQuestionPrompter = createDefaultAskUserQuestionPrompter(
    (id) => managerRef?.getSessionByBackendId(id) ?? null
  );
  const manager = new AgentSessionManager(app, plugin, {
    permissionPrompter: prompter,
    askUserQuestionPrompter,
    resolveDescriptor: (id) => backendRegistry[id],
    modelPreloader: preloader,
    beforeBackendStart,
    feedbackServer: createFeedbackMcpServer(),
  });
  managerRef = manager;
  // 日志和报告复用后端给出的目录，避免与状态页形成两套存储位置。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const resolveLocalPaths = async () => {
    const backend = await manager.getLocalDataBackend();
    const paths = backend.getLocalStoragePaths?.();
    if (!paths) throw new Error(t("localData.storageUnavailable"));
    setFrameSinkLogsRoot(paths.logsRoot);
    return paths;
  };
  logFileManager.setStoragePaths(resolveLocalPaths);
  for (const descriptor of listBackendDescriptors()) {
    if (!descriptor.restartOnProviderConfigChange) continue;
    const backendId = descriptor.id as keyof VaultAgentSettings["backends"];
    const refresh = (reason: string): void => {
      void manager
        .noteSpawnConfigChanged(descriptor.id, reason)
        .catch((error) =>
          logError(`[AgentMode] restart after ${reason} failed: ${descriptor.id}`, error)
        );
    };
    plugin.modelManagement.providerRegistry.subscribe((providerId) => {
      const settings = getSettings();
      const provider = settings.providers[providerId];
      const enabled = new Set(settings.backends[backendId]?.enabledModels);
      // 未启用的提供商不会改变当前会话，已启用提供商的密钥更新仍需生效。https://github.com/Brevilabs/obsidian-copilot-private/issues/475
      if (
        provider &&
        provider.origin.kind === "byok" &&
        settings.configuredModels.some(
          (model) => model.providerId === providerId && enabled.has(model.configuredModelId)
        )
      ) {
        refresh("provider config changed");
      }
    });
    subscribeToSettingsChange((prev, next) => {
      if (spawnModelConfigKey(prev, backendId) !== spawnModelConfigKey(next, backendId)) {
        // 模型能力更新可能收回推理强度，不能只比较启用列表。https://github.com/Brevilabs/obsidian-copilot-private/issues/319
        refresh("model config changed");
      }
    });
  }
  subscribeToSettingsChange((prev, next) => {
    if (
      deriveSkillsFolder(prev) !== deriveSkillsFolder(next) ||
      prev.agentMode.skills.builtinPreferences !== next.agentMode.skills.builtinPreferences
    ) {
      void skillManager
        .refresh(true)
        .catch((error) => logError("[Skills] builtin skill re-seeding failed", error));
    }
  });
  for (const descriptor of listBackendDescriptors()) {
    const preload = initialSkillsReady.then(() => manager.preloadModels(descriptor.id));
    manager.registerPreload(descriptor.id, preload);
    void preload
      .then(resolveLocalPaths)
      .catch((error) => logError("[LocalData] Could not initialize log paths", error));
  }

  return manager;
}

export { PiMcpSettingsPanel as AgentMcpSettings } from "./backends/pi/PiMcpSettingsPanel";

export { lookupDeclaredModelCapabilities } from "./sdk/pi/models/DeclaredModelCapabilities";

export { testModelConnection } from "./sdk/pi/models/TestModelConnection";
