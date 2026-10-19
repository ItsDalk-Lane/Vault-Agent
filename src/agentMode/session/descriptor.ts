import type { App } from "obsidian";
import type React from "react";
import type VaultAgentPlugin from "@/main";
import type { VaultAgentSettings } from "@/settings/model";
import type { Destination } from "@/types/destination";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  BackendConfigOption,
  BackendId,
  BackendProcess,
  BackendState,
  EffortOption,
  EnabledModelEntry,
  ModelSelection,
  ModelState,
  ModelWireCodec,
  ModeMapping,
  PermissionOption,
  RawModeState,
  SessionId,
} from "./types";

export interface ModelSelectionSession {
  getState(): BackendState | null;
  applyModelWireId(wireId: string): Promise<void>;
  setConfigOption(configId: string, value: string): Promise<void>;
}

export type InstallState =
  | { kind: "absent" }
  | { kind: "checking"; source: "managed" | "custom" }
  | { kind: "ready"; source: "managed" | "custom" }
  | {
      kind: "incompatible";
      source: "managed" | "custom";
      currentVersion: string;
      minVersion: string;
      message: string;
    }
  | { kind: "error"; message: string };

export type ManagedInstallActionState =
  | { kind: "idle" }
  | { kind: "running"; label: string; percent?: number }
  | { kind: "error"; message: string };

export interface ManagedInstallAction {
  getState(plugin: VaultAgentPlugin): ManagedInstallActionState;
  subscribe(plugin: VaultAgentPlugin, onChange: () => void): () => void;
  run(plugin: VaultAgentPlugin): Promise<void>;
}

export interface BackendAuthStatus {
  signedIn: boolean;
  label?: string;
}

export interface BackendSignInHandlers {
  signal?: AbortSignal;
  onUrl?: (url: string) => void;
  onLine?: (line: string) => void;
}

export interface BackendAuth {
  getProbeKey?(settings: VaultAgentSettings): string;
  getStatus(settings: VaultAgentSettings): Promise<BackendAuthStatus>;
  signIn(
    settings: VaultAgentSettings,
    handlers?: BackendSignInHandlers
  ): Promise<BackendAuthStatus>;
  signOut?(
    settings: VaultAgentSettings,
    options?: { signal?: AbortSignal }
  ): Promise<BackendAuthStatus>;
}

export interface BackendDescriptor {
  readonly id: BackendId;
  readonly displayName: string;

  readonly Icon: React.ComponentType<{ className?: string }>;

  readonly selfHostable: boolean;

  readonly routesVaultAgentModels: boolean;

  readonly setupDescription: string;

  readonly skillsProjectDir: string;

  readonly crossDiscoveredAgents: ReadonlyArray<BackendId>;

  readonly restartOnManagedSkillsChange: boolean;

  readonly restartOnProviderConfigChange: boolean;

  readonly restartOnSystemPromptChange: boolean;

  readonly summarizesSessionTitle: boolean;

  // OpenCode registers a session's MCP servers on the instance for its folder, so every chat there shares one connection per server name.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/672
  readonly sharesMcpServersAcrossSessions?: boolean;

  readonly agentProductName?: string;

  readonly planFeedbackDelivery?: "permission" | "next_turn";

  getInstallState(settings: VaultAgentSettings): InstallState;

  getResolvedBinaryPath?(settings: VaultAgentSettings): string | null;

  subscribeInstallState(plugin: VaultAgentPlugin, cb: () => void): () => void;

  openInstallUI(plugin: VaultAgentPlugin): void;

  managedInstall?: ManagedInstallAction;

  auth?: BackendAuth;

  createBackendProcess(args: {
    plugin: VaultAgentPlugin;
    app: App;
    clientVersion: string;
    descriptor: BackendDescriptor;
  }): BackendProcess;

  SettingsPanel?: React.FC<{ plugin: VaultAgentPlugin; app: App }>;

  onPluginLoad?(plugin: VaultAgentPlugin): Promise<void>;

  readonly wire: ModelWireCodec;

  normalizeModelName?(name: string): string;

  presentPermissionOption?(option: PermissionOption, metadata: unknown): PermissionOption;

  // Agents whose own CLI picks the server name it in their settings tab.
  // https://github.com/logancyang/obsidian-copilot/issues/2889
  dataDestination?(settings: VaultAgentSettings, vaultBase: string | null): Destination;

  readonly showModelDescriptions?: boolean;

  applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void>;

  getModeMapping?(
    modeState: RawModeState | null,
    configOptions: BackendConfigOption[] | null
  ): ModeMapping | null;

  getModeState?(
    modeState: RawModeState | null,
    configOptions: BackendConfigOption[] | null
  ): BackendState["mode"];

  applyInitialSessionConfig?(
    session: AgentSession,
    settings: VaultAgentSettings,
    seededSelection?: ModelSelection
  ): Promise<void>;

  isPlanModePlanFilePath?(absolutePath: string, cwd: string | null | undefined): boolean;

  getProbeSessionId?(settings: VaultAgentSettings): string | undefined;

  getEnabledModelEntries?(settings: VaultAgentSettings): EnabledModelEntry[] | null;

  getWireBaseId?(configuredModelId: string, settings: VaultAgentSettings): string | null;

  persistProbeSessionId?(sessionId: string, plugin: VaultAgentPlugin): Promise<void>;

  prefetchEffortCatalog?(args: {
    proc: BackendProcess;
    sessionId: SessionId;
    modelState: ModelState;
    enabledModels: ReadonlyArray<EnabledModelEntry>;
    isAborted: () => boolean;
  }): Promise<Record<string, EffortOption[]>>;
}
