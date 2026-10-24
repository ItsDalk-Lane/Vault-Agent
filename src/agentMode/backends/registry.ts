import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendDescriptor } from "./pi/descriptor";
import type { BackendDescriptor, BackendId } from "@/agentMode/session/types";

export const backendRegistry: Partial<Record<BackendId, BackendDescriptor>> = {
  pi: PiBackendDescriptor,
};

const ACTIVE_BACKENDS: readonly BackendDescriptor[] = Object.freeze([PiBackendDescriptor]);

export const CREATABLE_BACKEND_IDS: readonly BackendId[] = Object.freeze(["pi"]);

export const RECOMMENDED_BACKEND_ID: BackendId = "pi";

export interface HistoricalBackendDescription {
  readonly id: BackendId;
  readonly label: string;
  readonly displayName: string;
  readonly Icon: BackendDescriptor["Icon"];
  readonly agentProductName?: string;
}

export function backendDisplayOrder(): readonly BackendDescriptor[] {
  return ACTIVE_BACKENDS;
}

export function creatableBackendDescriptors(): readonly BackendDescriptor[] {
  return ACTIVE_BACKENDS;
}

export function describeBackendForHistory(backendId: string): HistoricalBackendDescription {
  return {
    id: backendId,
    label: PiBackendDescriptor.displayName,
    displayName: PiBackendDescriptor.displayName,
    Icon: PiBackendDescriptor.Icon,
  };
}

export function getActiveBackendDescriptor(settings: VaultAgentSettings): BackendDescriptor {
  const id = settings.agentMode?.activeBackend;
  const descriptor = id === undefined ? undefined : backendRegistry[id];
  return descriptor ?? PiBackendDescriptor;
}

export function listBackendDescriptors(): readonly BackendDescriptor[] {
  return ACTIVE_BACKENDS;
}
