import type {
  EffortOption,
  ModelEntry,
  ModelSelection,
  VaultAgentMode,
} from "@/agentMode/session/types";

import type { CatalogModelEntry, ModelCatalogSnapshot } from "./ModelCatalog";
import { createConfiguredModelId, parseConfiguredModelId } from "./ModelIdentity";

// The existing model picker, wire ids, Durable selection and stored selectedModelKey all use
// one configuredModelKey; switching is idle-only so a busy run never half-switches; an effort
// the selected model does not offer is rejected instead of silently dropped; and a mode can
// only tighten or keep the already granted scope, never widen it:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type ModelSelectionErrorCode =
  | "MODEL_NOT_FOUND"
  | "MODEL_SWITCH_BUSY"
  | "EFFORT_UNSUPPORTED";

export class ModelSelectionError extends Error {
  readonly code: ModelSelectionErrorCode;

  constructor(code: ModelSelectionErrorCode, message: string) {
    super(message);
    this.name = "ModelSelectionError";
    this.code = code;
  }
}

const EMPTY_SCOPE: readonly string[] = Object.freeze([]);

export function configuredModelKeyFromWireId(wireId: string): string {
  const trimmed = wireId.trim();
  if (trimmed.length === 0) {
    throw new ModelSelectionError("MODEL_NOT_FOUND", "The model wire id is empty.");
  }
  const parts = parseConfiguredModelId(trimmed);
  if (!parts) return trimmed;
  return createConfiguredModelId(parts.providerInstanceId, parts.upstreamModelId);
}

export function effortOptionsForCatalogEntry(entry: CatalogModelEntry): EffortOption[] {
  if (!entry.capabilities.supportsThinking) return [];
  return entry.capabilities.thinkingEfforts.map((level) => ({
    value: level,
    label: level.toLowerCase(),
  }));
}

export function modelEntriesFromCatalog(snapshot: ModelCatalogSnapshot): ModelEntry[] {
  return snapshot.readyModels.map((entry) => ({
    baseModelId: entry.configuredModelId,
    name: entry.upstreamModelId,
    provider: entry.providerInstanceId,
    effortOptions: effortOptionsForCatalogEntry(entry),
  }));
}

export function resolveModelEntry(
  availableModels: readonly ModelEntry[],
  requestedBaseModelId: string
): ModelEntry {
  const configuredModelKey = configuredModelKeyFromWireId(requestedBaseModelId);
  const entry = availableModels.find((model) => model.baseModelId === configuredModelKey);
  if (!entry) {
    throw new ModelSelectionError(
      "MODEL_NOT_FOUND",
      `The configured model is not available for this engine: ${configuredModelKey}`
    );
  }
  return entry;
}

export function validateEffort(
  requestedEffort: string | null,
  effortOptions: readonly EffortOption[]
): string | null {
  if (requestedEffort === null) return null;
  if (effortOptions.some((option) => option.value === requestedEffort)) {
    return requestedEffort;
  }
  throw new ModelSelectionError(
    "EFFORT_UNSUPPORTED",
    `The selected model does not offer the thinking effort: ${requestedEffort}`
  );
}

export interface ModelSwitchRequest {
  readonly current: ModelSelection;
  readonly requested: ModelSelection;
  readonly busy: boolean;
  readonly availableModels: readonly ModelEntry[];
  readonly applyModel: (baseModelId: string) => Promise<void>;
  readonly applyEffort: ((effort: string) => Promise<void>) | null;
  readonly persist: (selection: ModelSelection) => Promise<void>;
}

export async function applyModelSwitch(request: ModelSwitchRequest): Promise<ModelSelection> {
  const target = resolveModelEntry(request.availableModels, request.requested.baseModelId);
  const effort = validateEffort(request.requested.effort, target.effortOptions);
  const next: ModelSelection = { baseModelId: target.baseModelId, effort };
  const changedModel = request.current.baseModelId !== next.baseModelId;
  const changedEffort = request.current.effort !== next.effort;
  if (!changedModel && !changedEffort) return next;
  if (request.busy) {
    throw new ModelSelectionError(
      "MODEL_SWITCH_BUSY",
      "The model cannot switch while the run is busy; the current selection is unchanged."
    );
  }
  if (changedModel) {
    await request.applyModel(next.baseModelId);
  }
  if (next.effort !== null && (changedEffort || changedModel)) {
    if (!request.applyEffort) {
      throw new ModelSelectionError(
        "EFFORT_UNSUPPORTED",
        "This backend exposes no thinking effort control for the selected model."
      );
    }
    await request.applyEffort(next.effort);
  }
  await request.persist(next);
  return next;
}

export type ScopeCapabilityMode = "never" | "confirm" | "allow_within_scope";

export interface ModePolicy {
  readonly readOnly: boolean;
  readonly writes: ScopeCapabilityMode;
  readonly deletes: ScopeCapabilityMode;
  readonly shell: ScopeCapabilityMode;
}

export const MODE_POLICIES: Readonly<Record<VaultAgentMode, ModePolicy>> = Object.freeze({
  plan: Object.freeze({
    readOnly: true,
    writes: "never",
    deletes: "never",
    shell: "never",
  }),
  default: Object.freeze({
    readOnly: false,
    writes: "confirm",
    deletes: "confirm",
    shell: "confirm",
  }),
  auto: Object.freeze({
    readOnly: false,
    writes: "allow_within_scope",
    deletes: "confirm",
    shell: "confirm",
  }),
});

const MODE_STRICTNESS: Readonly<Record<VaultAgentMode, number>> = Object.freeze({
  plan: 0,
  default: 1,
  auto: 2,
});

export type ModeTransition =
  | { readonly kind: "applied"; readonly mode: VaultAgentMode }
  | {
      readonly kind: "deferred";
      readonly mode: VaultAgentMode;
      readonly reason: "WAIT_SAFE_BOUNDARY";
    };

export function transitionMode(
  current: VaultAgentMode,
  next: VaultAgentMode,
  options: { readonly busy: boolean }
): ModeTransition {
  if (next === current) return { kind: "applied", mode: next };
  const tightening = MODE_STRICTNESS[next] < MODE_STRICTNESS[current];
  if (tightening || !options.busy) return { kind: "applied", mode: next };
  return { kind: "deferred", mode: next, reason: "WAIT_SAFE_BOUNDARY" };
}

export function effectiveScopeForMode(
  grantedScope: readonly string[],
  mode: VaultAgentMode
): readonly string[] {
  return mode === "plan" ? EMPTY_SCOPE : grantedScope;
}
