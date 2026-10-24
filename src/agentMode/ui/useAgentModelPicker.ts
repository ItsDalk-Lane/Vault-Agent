import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { useSettingsValue } from "@/settings/model";
import { creatableBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { modelStateSignature } from "@/agentMode/session/translateBackendState";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { buildAgentModelPicker } from "./agentModelPickerHelpers";
import { useManagerSubscribe } from "./useManagerSubscribe";

export interface AgentModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
  disabled?: boolean;
  effort?: {
    options: { label: string; value: string | null }[];
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  };
  effortOptionsByModelKey?: Record<string, { label: string; value: string | null }[]>;
  commitSelection?: (modelKey: string, effort: string | null) => void;
}

function useAgentModelSignal(
  manager: AgentSessionManager | null,
  descriptors: readonly BackendDescriptor[]
): string {
  const subscribe = useManagerSubscribe(manager);

  const getSnapshot = useCallback((): string => {
    if (!manager) return "";
    const session = manager.getActiveSession();
    const parts: string[] = [
      session?.internalId ?? "",
      session?.backendId ?? "",
      session?.getStatus() ?? "",
      session?.hasUserVisibleMessages() ? "1" : "0",
      modelStateSignature(session?.getState() ?? null),
    ];
    for (const d of descriptors) {
      parts.push(`${d.id}:${manager.getModelCacheSignature(d.id)}`);
    }
    return parts.join("|");
  }, [manager, descriptors]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAgentModelPicker(
  manager: AgentSessionManager | null
): AgentModelPickerOverride | null {
  const settings = useSettingsValue();
  const descriptors = useMemo(() => creatableBackendDescriptors(), []);
  const signal = useAgentModelSignal(manager, descriptors);
  return useMemo(() => {
    void signal;
    return buildAgentModelPicker({ manager, descriptor: descriptors[0], settings });
  }, [manager, descriptors, settings, signal]);
}
