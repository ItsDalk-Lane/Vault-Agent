import { findModelEntry } from "@/agentMode/session/translateBackendState";
import type { BackendState, EnabledModelEntry, ModelSelection } from "@/agentMode/session/types";

export const ENABLED_MODEL_WAIT_MS = 10_000;
export const EMPTY_ENABLED_MODELS: readonly EnabledModelEntry[] = Object.freeze([]);

export interface EnabledModelPick {
  target: ModelSelection | null;
  settled: boolean;
}

// 模型目录尚未包含可用选择时，保留待定状态，避免提前使用失效模型。
// https://github.com/Brevilabs/obsidian-copilot-private/issues/625
export function pickEnabledModel(
  enabled: readonly EnabledModelEntry[],
  model: BackendState["model"] | undefined,
  seed: ModelSelection | null
): EnabledModelPick {
  const usable = enabled.filter((entry) => entry.credentialState === "ok");
  const offers = (baseModelId: string): boolean => findModelEntry(model, baseModelId) !== undefined;
  const seedUsable =
    seed !== null && usable.some((entry) => entry.baseModelId === seed.baseModelId);
  if (seedUsable && offers(seed.baseModelId)) return { target: seed, settled: true };
  const fallback = usable.find((entry) => offers(entry.baseModelId));
  const target = fallback ? { baseModelId: fallback.baseModelId, effort: null } : null;
  return { target, settled: !seedUsable && (target !== null || usable.length === 0) };
}

export function noEnabledModelError(displayName: string): Error {
  return new Error(
    `None of the models enabled for ${displayName} are available. Check them in Vault Agent's model settings.`
  );
}
