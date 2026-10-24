import { sortEffortOptions } from "@/lib/model-effort";
import { t, type MessageKey } from "@/i18n";
import { Notice } from "obsidian";
import { logError } from "@/logger";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { getModelKeyFromModel, type VaultAgentSettings } from "@/settings/model";
import type {
  BackendDescriptor,
  BackendId,
  EffortOption,
  EnabledModelEntry,
} from "@/agentMode/session/types";
import type { AgentModelPickerOverride } from "./useAgentModelPicker";

export const EMPTY_EFFORT_OPTIONS = Object.freeze([]) as unknown as EffortOption[];
const EMPTY_CONFIGURED_MODELS: readonly EnabledModelEntry[] = Object.freeze([]);
const PICKER_ACTION_KEYS: Record<"model" | "effort" | "mode", MessageKey> = {
  model: "agentChat.picker.action.model",
  effort: "agentChat.picker.action.effort",
  mode: "agentChat.picker.action.mode",
};

export function handlePickerSwitchError(err: unknown, action: "model" | "effort" | "mode"): void {
  if (err instanceof MethodUnsupportedError) {
    new Notice(t("agentChat.picker.unsupportedRuntime", { action: t(PICKER_ACTION_KEYS[action]) }));
    return;
  }
  logError(`[AgentMode] ${action} apply failed`, err);
  new Notice(t("agentChat.picker.switchFailed", { action: t(PICKER_ACTION_KEYS[action]) }));
}

function modelEntry(descriptor: BackendDescriptor, id: string, label: string): ModelSelectorEntry {
  return {
    name: id,
    provider: "agent",
    enabled: true,
    isBuiltIn: false,
    displayName: label || id,
    _group: descriptor.displayName,
    _backendId: descriptor.id,
  };
}

function preloadEntry(descriptor: BackendDescriptor, pending: boolean): ModelSelectorEntry {
  return {
    ...modelEntry(
      descriptor,
      pending ? "__preload_pending__" : "__preload_error__",
      t(pending ? "agentChat.picker.loadingModels" : "agentChat.picker.failedToLoad")
    ),
    _disabledReason: t(pending ? "agentChat.picker.loading" : "agentChat.picker.unavailable"),
  };
}

export function resolveEffortOptions(
  manager: AgentSessionManager,
  backendId: BackendId,
  baseModelId: string,
  configuredEntries?: readonly EnabledModelEntry[] | null
): EffortOption[] {
  const declared = configuredEntries?.find(
    (entry) => entry.baseModelId === baseModelId
  )?.effortOptions;
  // 明确保存或撤回的能力声明优先于旧缓存，不能继续显示过期强度。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  if (declared !== undefined)
    return declared.length ? sortEffortOptions(declared) : EMPTY_EFFORT_OPTIONS;
  const found = manager
    .getCachedModelCatalog(backendId)
    ?.availableModels?.find((model) => model.baseModelId === baseModelId);
  if (found?.effortOptions.length) return sortEffortOptions(found.effortOptions);
  return EMPTY_EFFORT_OPTIONS;
}

export function buildAgentModelPicker(args: {
  manager: AgentSessionManager | null;
  descriptor: BackendDescriptor;
  settings: VaultAgentSettings;
}): AgentModelPickerOverride | null {
  const { manager, descriptor, settings } = args;
  if (!manager) return null;
  const session = manager.getActiveSession();
  // 只读查看时切换模型不能替换原会话或启动执行。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  if (session && (session.backendId !== descriptor.id || session.isHistoricalOnly?.())) return null;
  const ui = manager.getActiveChatUIState();
  const enabled = descriptor.getEnabledModelEntries?.(settings) ?? EMPTY_CONFIGURED_MODELS;
  const catalog = manager.getCachedModelCatalog(descriptor.id);
  const preload = manager.getPreloadStatus(descriptor.id);
  const reported = catalog?.availableModels;
  const canUseConfigured = reported || (!catalog && (preload === "ready" || preload === "error"));
  const entries: ModelSelectorEntry[] = canUseConfigured
    ? enabled.map((model) => {
        const offered = reported?.find((entry) => entry.baseModelId === model.baseModelId);
        const entry = modelEntry(
          descriptor,
          model.baseModelId,
          model.label || offered?.name || model.name
        );
        entry.capabilities = model.capabilities;
        entry._subtitle = offered?.description ?? model.description;
        if (model.credentialState === "missing_key")
          entry._disabledReason = t("agentChat.defaultModel.missingKey");
        else if (reported && !offered) entry._disabledReason = t("agentChat.picker.notOffered");
        return entry;
      })
    : [];
  if (!catalog && entries.length === 0 && preload !== "absent")
    entries.push(preloadEntry(descriptor, preload === "pending"));

  const state = session?.getState()?.model;
  let selected = entries.find((entry) => entry.name === state?.current.baseModelId);
  if (session?.getStatus() === "starting") {
    const loading = preloadEntry(descriptor, true);
    selected = entries.find((entry) => entry.name === loading.name);
    if (!selected) {
      entries.unshift(loading);
      selected = loading;
    }
  }
  const effortOptionsByModelKey: Record<string, EffortOption[]> = {};
  for (const entry of entries) {
    if (!entry._disabledReason)
      effortOptionsByModelKey[getModelKeyFromModel(entry)] = resolveEffortOptions(
        manager,
        descriptor.id,
        entry.name,
        enabled
      );
  }

  const apply = (modelKey: string, effort?: string | null): void => {
    const entry = entries.find((candidate) => getModelKeyFromModel(candidate) === modelKey);
    if (!entry || entry._disabledReason) return;
    const current = manager.getActiveSession();
    if (!current) {
      manager
        .createSession(descriptor.id, undefined, {
          baseModelId: entry.name,
          effort:
            effort === undefined
              ? (manager.getDefaultSelection(descriptor.id)?.effort ?? null)
              : effort,
        })
        .catch((error) => handlePickerSwitchError(error, "model"));
      return;
    }
    // 点击时重新核对当前聊天，迟到的菜单回调不能改变历史聊天或另一聊天。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (current !== session || current.backendId !== descriptor.id || current.isHistoricalOnly?.())
      return;
    if (ui?.canSwitchModel() === false) {
      handlePickerSwitchError(new MethodUnsupportedError("setModel"), "model");
      return;
    }
    manager
      .applySelection(
        { baseModelId: entry.name, ...(effort === undefined ? {} : { effort }) },
        { expectBackendId: descriptor.id }
      )
      .catch((error) => handlePickerSwitchError(error, "model"));
  };
  const currentEffort = state
    ? (effortOptionsByModelKey[
        getModelKeyFromModel(modelEntry(descriptor, state.current.baseModelId, ""))
      ] ?? EMPTY_EFFORT_OPTIONS)
    : EMPTY_EFFORT_OPTIONS;
  return {
    models: entries,
    value: selected ? getModelKeyFromModel(selected) : "",
    disabled: ui?.canSwitchModel() === false,
    effort:
      state && currentEffort.length
        ? {
            options: currentEffort,
            value: state.current.effort,
            disabled: ui?.canSwitchEffort() === false,
            onChange: (effort) => {
              if (manager.getActiveSession() !== session || ui?.canSwitchEffort() === false) return;
              manager
                .applySelection({ effort }, { expectBackendId: descriptor.id })
                .catch((error) => handlePickerSwitchError(error, "effort"));
            },
          }
        : undefined,
    effortOptionsByModelKey,
    onChange: (key) => apply(key),
    commitSelection: apply,
  };
}
