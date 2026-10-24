import React from "react";
import { Sparkles } from "lucide-react";
import { configuredFanoutModels, enabledFanoutModels } from "@/agentMode/session/fanout/answerers";
import type { AgentBrand } from "@/agentMode/session/types";
import { useSettingsValue, type VaultAgentSettings } from "@/settings/model";

export const EMPTY_AGENT_BRANDS: ReadonlyArray<AgentBrand> = Object.freeze([]);

export function listFanoutModelBrands(settings: VaultAgentSettings): ReadonlyArray<AgentBrand> {
  const brands = enabledFanoutModels(configuredFanoutModels(settings)).map((model) => ({
    id: model.modelKey,
    displayName: model.label ?? model.modelKey,
    Icon: Sparkles,
  }));
  return brands.length > 0 ? Object.freeze(brands) : EMPTY_AGENT_BRANDS;
}

export function useFanoutModelBrands(): ReadonlyArray<AgentBrand> {
  const settings = useSettingsValue();
  return React.useMemo(() => listFanoutModelBrands(settings), [settings]);
}
