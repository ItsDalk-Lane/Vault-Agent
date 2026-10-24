import type { VaultAgentSettings } from "@/settings/model";
import { isProviderEnabled } from "@/utils/providerAvailability";
import type { BackendId } from "@/agentMode/session/types";
import { FANOUT_ENGINE_ID, type FanoutEngineId } from "@/agentMode/session/fanout/fanoutTypes";

export const EMPTY_ANSWERERS: ReadonlyArray<BackendId> = Object.freeze([]);

export function resolveAnswerers(args: {
  mentionedAgentIds: ReadonlyArray<BackendId>;
  installedAgentIds: ReadonlySet<BackendId>;
}): ReadonlyArray<BackendId> {
  const { mentionedAgentIds, installedAgentIds } = args;
  const answerers: BackendId[] = [];
  const seen = new Set<BackendId>();
  for (const id of mentionedAgentIds) {
    if (seen.has(id)) continue;
    if (!installedAgentIds.has(id)) continue;
    seen.add(id);
    answerers.push(id);
  }
  return answerers.length > 0 ? answerers : EMPTY_ANSWERERS;
}

export function isFanout(answerers: ReadonlyArray<BackendId>, mainAgentId: BackendId): boolean {
  if (answerers.length === 0) return false;
  if (answerers.length === 1 && answerers[0] === mainAgentId) return false;
  return true;
}

// Fan-out selects stable model keys on the single Pi engine: two answers may not pretend to be
// different providers by reusing one configuration, a model without a usable key is disabled, and the
// same model selected twice is deduped by an explicit policy instead of starting two identical runs:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const FANOUT_MIN_ANSWERERS = 2;
export const FANOUT_MAX_ANSWERERS = 4;
export const FANOUT_DUPLICATE_MODEL_POLICY = "dedupe";

export interface FanoutModelOption {
  readonly modelKey: string;
  readonly engineId: FanoutEngineId;
  readonly hasKey: boolean;
  readonly label?: string;
  readonly configFingerprint?: string;
}

export type FanoutSelectionErrorCode =
  | "FANOUT_ENGINE_MISMATCH"
  | "FANOUT_MODEL_UNAVAILABLE"
  | "FANOUT_MODEL_NO_KEY"
  | "FANOUT_DUPLICATE_CONFIG"
  | "FANOUT_MODEL_COUNT";

export class FanoutSelectionError extends Error {
  readonly code: FanoutSelectionErrorCode;

  constructor(code: FanoutSelectionErrorCode, message: string) {
    super(message);
    this.name = "FanoutSelectionError";
    this.code = code;
  }
}

export function enabledFanoutModels(
  availableModels: readonly FanoutModelOption[]
): readonly FanoutModelOption[] {
  const enabled = availableModels.filter(
    (model) => model.engineId === FANOUT_ENGINE_ID && model.hasKey
  );
  return enabled.length > 0 ? Object.freeze(enabled) : EMPTY_FANOUT_MODELS;
}

export function resolveAnswererModels(args: {
  readonly mentionedModelKeys: readonly string[];
  readonly availableModels: readonly FanoutModelOption[];
  readonly mainModelKey?: string;
}): readonly string[] {
  const byKey = new Map<string, FanoutModelOption>();
  for (const model of args.availableModels) {
    const engineId: string = model.engineId;
    if (engineId !== FANOUT_ENGINE_ID) {
      throw new FanoutSelectionError(
        "FANOUT_ENGINE_MISMATCH",
        `Fan-out runs on the ${FANOUT_ENGINE_ID} engine only; "${model.modelKey}" requested ${engineId}.`
      );
    }
    byKey.set(model.modelKey, model);
  }
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const modelKey of args.mentionedModelKeys) {
    if (seen.has(modelKey)) continue;
    seen.add(modelKey);
    const model = byKey.get(modelKey);
    if (model === undefined) {
      throw new FanoutSelectionError(
        "FANOUT_MODEL_UNAVAILABLE",
        `The model "${modelKey}" is not configured.`
      );
    }
    if (!model.hasKey) {
      throw new FanoutSelectionError(
        "FANOUT_MODEL_NO_KEY",
        `The model "${modelKey}" has no usable key and stays disabled.`
      );
    }
    selected.push(modelKey);
  }
  if (selected.length === 0) return EMPTY_ANSWERER_MODELS;
  if (selected.length < FANOUT_MIN_ANSWERERS) {
    throw new FanoutSelectionError(
      "FANOUT_MODEL_COUNT",
      `Fan-out needs ${FANOUT_MIN_ANSWERERS} to ${FANOUT_MAX_ANSWERERS} models; ${selected.length} were selected.`
    );
  }
  if (selected.length > FANOUT_MAX_ANSWERERS) {
    throw new FanoutSelectionError(
      "FANOUT_MODEL_COUNT",
      `Fan-out accepts at most ${FANOUT_MAX_ANSWERERS} models; ${selected.length} were selected.`
    );
  }
  const fingerprints = new Set<string>();
  for (const modelKey of selected) {
    const fingerprint = byKey.get(modelKey)?.configFingerprint;
    if (fingerprint === undefined) continue;
    if (fingerprints.has(fingerprint)) {
      throw new FanoutSelectionError(
        "FANOUT_DUPLICATE_CONFIG",
        `Two fan-out answerers share one configuration; the same setup cannot stand in for several providers.`
      );
    }
    fingerprints.add(fingerprint);
  }
  return Object.freeze(selected);
}

export const EMPTY_ANSWERER_MODELS: ReadonlyArray<string> = Object.freeze([]);

export function isFanoutModels(modelKeys: ReadonlyArray<string>, mainModelKey: string): boolean {
  if (modelKeys.length === 0) return false;
  if (modelKeys.length === 1 && modelKeys[0] === mainModelKey) return false;
  return true;
}

export function answererBackendLabel(modelKey: string): BackendId {
  return modelKey;
}

const EMPTY_FANOUT_MODELS: readonly FanoutModelOption[] = Object.freeze([]);

export function configuredFanoutModels(
  settings: Pick<VaultAgentSettings, "configuredModels" | "providers" | "backends">
): readonly FanoutModelOption[] {
  const options: FanoutModelOption[] = [];
  const enabled = new Set(settings.backends?.pi?.enabledModels);
  // 停用供应商与旧执行器、嵌入模型都不能列为可调用的回答器。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1 https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  for (const model of settings.configuredModels ?? []) {
    const provider = settings.providers?.[model.providerId];
    if (
      !enabled.has(model.configuredModelId) ||
      !provider ||
      !isProviderEnabled(provider) ||
      provider.origin.kind !== "byok" ||
      model.info.isEmbedding ||
      model.info.toolCall === false
    )
      continue;
    options.push(
      Object.freeze({
        modelKey: model.configuredModelId,
        engineId: FANOUT_ENGINE_ID,
        label: `${model.info.displayName} · ${provider.displayName}`,
        hasKey: provider.requiresApiKey === false || Boolean(provider.apiKeyKeychainId),
        configFingerprint: JSON.stringify([
          model.providerId,
          provider.baseUrl ?? "",
          model.info.id,
        ]),
      })
    );
  }
  return options.length > 0 ? Object.freeze(options) : EMPTY_FANOUT_MODELS;
}
