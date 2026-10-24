import type { App } from "obsidian";
import type React from "react";
import type VaultAgentPlugin from "@/main";
import type { VaultAgentSettings } from "@/settings/model";
import type {
  BackendConfigOption,
  BackendId,
  BackendProcess,
  BackendState,
  EnabledModelEntry,
  ModelSelection,
  ModelWireCodec,
  ModeMapping,
  RawModeState,
} from "./types";

export interface ModelSelectionSession {
  getState(): BackendState | null;
  applyModelWireId(wireId: string): Promise<void>;
  setConfigOption(configId: string, value: string): Promise<void>;
}

export interface BackendDescriptor {
  readonly id: BackendId;
  readonly displayName: string;

  readonly Icon: React.ComponentType<{ className?: string }>;

  readonly routesVaultAgentModels: boolean;

  readonly restartOnProviderConfigChange: boolean;

  readonly summarizesSessionTitle: boolean;

  readonly planLifecycle?: "mode" | "independent";

  createBackendProcess(args: {
    plugin: VaultAgentPlugin;
    app: App;
    clientVersion: string;
    descriptor: BackendDescriptor;
  }): BackendProcess;

  readonly wire: ModelWireCodec;

  applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void>;

  getModeMapping?(
    modeState: RawModeState | null,
    configOptions: BackendConfigOption[] | null
  ): ModeMapping | null;

  getEnabledModelEntries?(settings: VaultAgentSettings): EnabledModelEntry[] | null;

  getWireBaseId?(configuredModelId: string, settings: VaultAgentSettings): string | null;
}
