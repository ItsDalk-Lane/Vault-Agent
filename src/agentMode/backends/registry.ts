import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendDescriptor } from "./pi/descriptor";
import type { BackendDescriptor, BackendId } from "@/agentMode/session/types";

import { Archive } from "lucide-react";
import {
  HISTORICAL_BACKEND_IDENTITIES,
  isHistoricalBackendId,
} from "@/agentMode/session/legacy/historicalBackends";

export { isHistoricalBackendId };

// 活动入口仅注册内置引擎，旧身份只供历史记录显示。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
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

export function historicalBackendDescriptors(): readonly HistoricalBackendDescription[] {
  return HISTORICAL_DESCRIPTIONS;
}

export function describeBackendForHistory(backendId: string): HistoricalBackendDescription {
  const identity = HISTORICAL_BACKEND_IDENTITIES.find((entry) => entry.id === backendId);
  const descriptor = backendRegistry[backendId];
  const displayName = identity?.displayName ?? descriptor?.displayName ?? backendId;
  return Object.freeze({
    id: backendId,
    label: displayName,
    displayName,
    Icon: identity?.Icon ?? descriptor?.Icon ?? Archive,
    ...(identity?.agentProductName ? { agentProductName: identity.agentProductName } : {}),
  });
}

const HISTORICAL_DESCRIPTIONS: readonly HistoricalBackendDescription[] = Object.freeze(
  HISTORICAL_BACKEND_IDENTITIES.map((identity) => describeBackendForHistory(identity.id))
);

export function getActiveBackendDescriptor(settings: VaultAgentSettings): BackendDescriptor {
  const id = settings.agentMode?.activeBackend;
  const descriptor = id === undefined ? undefined : backendRegistry[id];
  return descriptor ?? PiBackendDescriptor;
}

export function listBackendDescriptors(): readonly BackendDescriptor[] {
  return ACTIVE_BACKENDS;
}
