import { resolveEffort } from "@/lib/model-effort";
import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/i18n";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import React, { useSyncExternalStore } from "react";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor, EnabledModelEntry } from "@/agentMode/session/types";
import { AgentDefaultEffortSetting } from "@/agentMode/ui/AgentDefaultEffortSetting";
import {
  EMPTY_EFFORT_OPTIONS,
  missingKeyLabel,
  resolveEffortOptions,
} from "./agentModelPickerHelpers";
import { useManagerSubscribe } from "./useManagerSubscribe";

interface Props {
  descriptor: BackendDescriptor;
  manager: AgentSessionManager;
}

const AGENT_DEFAULT_VALUE = "__agent_default__";

export const AgentDefaultModelSetting: React.FC<Props> = ({ descriptor, manager }) => {
  const subscribe = useManagerSubscribe(manager);
  useSyncExternalStore(
    subscribe,
    () => manager.getModelCacheSignature(descriptor.id),
    () => manager.getModelCacheSignature(descriptor.id)
  );

  const settings = useSettingsValue();
  const enabled = descriptor.getEnabledModelEntries?.(settings) ?? null;

  const current = manager.getDefaultSelection(descriptor.id);
  const hasExplicitDefault = current !== null;

  if ((!enabled || enabled.length === 0) && !hasExplicitDefault) return null;

  const selectedBaseId = current?.baseModelId ?? AGENT_DEFAULT_VALUE;
  const rawEffortOptions = hasExplicitDefault
    ? resolveEffortOptions(manager, descriptor.id, selectedBaseId)
    : EMPTY_EFFORT_OPTIONS;
  const effortOptions = rawEffortOptions;
  const onModelChange = (baseModelId: string): void => {
    if (baseModelId === AGENT_DEFAULT_VALUE) {
      manager
        .persistDefaultSelection(descriptor.id, null)
        .catch((e) => logError(`[AgentMode] clear default model for ${descriptor.id} failed`, e));
      return;
    }
    const effort = resolveEffort(
      current?.effort,
      resolveEffortOptions(manager, descriptor.id, baseModelId)
    );
    manager
      .persistDefaultSelection(descriptor.id, { baseModelId, effort })
      .catch((e) => logError(`[AgentMode] persist default model for ${descriptor.id} failed`, e));
  };

  const onEffortChange = (effort: string | null): void => {
    if (!hasExplicitDefault) return;
    manager
      .persistDefaultSelection(descriptor.id, { baseModelId: selectedBaseId, effort })
      .catch((e) => logError(`[AgentMode] persist default effort for ${descriptor.id} failed`, e));
  };

  const enabledOptions = (enabled ?? []).map((e) => ({
    label: modelOptionLabel(e),
    value: e.baseModelId,
  }));
  const defaultMissingFromEnabled =
    hasExplicitDefault && !enabledOptions.some((o) => o.value === selectedBaseId);
  const agentDefaultLabel = t("agentChat.defaultModel.agentDefault");
  const modelOptions = defaultMissingFromEnabled
    ? [
        { label: agentDefaultLabel, value: AGENT_DEFAULT_VALUE },
        {
          label: t("agentChat.defaultModel.disabled", { model: current?.baseModelId ?? "" }),
          value: selectedBaseId,
        },
        ...enabledOptions,
      ]
    : [{ label: agentDefaultLabel, value: AGENT_DEFAULT_VALUE }, ...enabledOptions];

  return (
    <>
      <SettingItem
        type="select"
        title={t("agentChat.defaultModel.title")}
        description={t("agentChat.defaultModel.description")}
        value={selectedBaseId}
        onChange={onModelChange}
        options={modelOptions}
      />
      <AgentDefaultEffortSetting
        value={current?.effort ?? null}
        options={effortOptions}
        disabledLabel={
          hasExplicitDefault ? t("agentChat.defaultModel.notSupported") : agentDefaultLabel
        }
        onChange={onEffortChange}
      />
    </>
  );
};

function modelOptionLabel(entry: EnabledModelEntry): string {
  const base = entry.name || entry.baseModelId;
  return entry.credentialState === "missing_key"
    ? t("agentChat.defaultModel.missingKeyOption", { model: base, label: missingKeyLabel() })
    : base;
}
