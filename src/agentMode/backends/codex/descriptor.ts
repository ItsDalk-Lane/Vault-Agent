import { prefetchConfigEfforts } from "@/agentMode/backends/shared/prefetchConfigEfforts";
import { Notice } from "obsidian";
import { resolveEffort } from "@/lib/model-effort";
import { t } from "@/i18n";
import { codexAuth } from "./codexAuth";
import type VaultAgentPlugin from "@/main";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary } from "@/utils/detectBinary";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type CodexBackendSettings,
  type VaultAgentSettings,
} from "@/settings/model";
import { CodexBackend } from "./CodexBackend";
import { CodexInstallModal } from "./CodexInstallModal";
import CodexLogo from "./logo.svg";
import { CodexSettingsPanel } from "./CodexSettingsPanel";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  EnabledModelEntry,
  ModelSelection,
  ModelWireCodec,
  PermissionOption,
} from "@/agentMode/session/types";
import type {
  BackendDescriptor,
  BackendProcess,
  InstallState,
  ModelSelectionSession,
} from "@/agentMode/session/types";
import { formatCodexModelId, parseCodexModelId } from "@/utils/codexModelId";
import { codexAcpSearchDirs, resolveCodexAcpBinary } from "./codexBinaryResolver";
import { CodexBinaryManager } from "./CodexBinaryManager";
import { CODEX_PINNED_VERSION } from "./codexArchive";
import { CODEX_BINARY_NAME } from "./cliSetup";
import { buildCodexModeMapping, buildCodexModeState } from "./codexModeMapping";
import { isSupportedCodexAcpPath, inspectCodexAcpPackage, CODEX_MIN_VERSION } from "./codexVersion";
import { classifyBinaryInstall } from "@/agentMode/backends/shared/binaryCompatibility";
import { urlDestination } from "@/modelManagement";
import type { Destination } from "@/types/destination";

const codexBinaryManager = new CodexBinaryManager();

export function getCodexBinaryManager(): CodexBinaryManager {
  return codexBinaryManager;
}

export function updateCodexFields(partial: Partial<CodexBackendSettings>): void {
  updateAgentModeBackendFields("codex", partial);
}

function codexAcpResolverEnv(): Parameters<typeof resolveCodexAcpBinary>[0] {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  };
}

export async function detectCodexAcpPath(): Promise<string | null> {
  const fromKnownLocations = resolveCodexAcpBinary(codexAcpResolverEnv(), isSupportedCodexAcpPath);
  if (fromKnownLocations) return fromKnownLocations;

  // npm can install into a user-selected prefix outside the known directories;
  // retain PATH discovery while enforcing the same supported-package contract.
  // https://github.com/logancyang/obsidian-copilot/issues/2916
  const fromPath = await detectBinary(CODEX_BINARY_NAME);
  return isSupportedCodexAcpPath(fromPath ?? undefined) ? fromPath : null;
}

export function codexAcpDetectionSearchDirs(): string[] {
  return codexAcpSearchDirs(codexAcpResolverEnv());
}

const codexWire: ModelWireCodec = {
  encode: (selection: ModelSelection) =>
    formatCodexModelId(selection.baseModelId, selection.effort),
  decode: (wireId: string) => ({ selection: parseCodexModelId(wireId), provider: null }),
};

export const CodexBackendDescriptor: BackendDescriptor = {
  id: "codex",
  auth: codexAuth,
  displayName: "Codex",
  Icon: CodexLogo,
  selfHostable: false,
  routesVaultAgentModels: false,
  setupDescription: "agentInfra.setup.codex",
  skillsProjectDir: ".agents/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: true,
  summarizesSessionTitle: false,
  // Codex ends its turn on revise_plan without acting on the deny message.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/41
  planFeedbackDelivery: "next_turn",
  wire: codexWire,
  showModelDescriptions: true,

  getEnabledModelEntries(settings: VaultAgentSettings): EnabledModelEntry[] {
    return [
      ...agentOriginEnabledModelEntries(settings, "codex", (wireId) => codexWire.decode(wireId)),
    ];
  },

  normalizeModelName(name: string): string {
    return name.replace(/^gpt/i, "GPT");
  },

  dataDestination(settings: VaultAgentSettings): Destination {
    const overrides = settings.agentMode?.backends?.codex?.envOverrides;
    const baseUrl = overrides?.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL;
    if (baseUrl) return urlDestination(baseUrl, t("agentInfra.backend.destination.openaiBaseUrl"));
    return { kind: "cloud", label: "OpenAI" };
  },

  presentPermissionOption(option: PermissionOption, metadata: unknown): PermissionOption {
    const decision = codexPermissionDecision(metadata);
    if (decision === "acceptForSession" || CODEX_SESSION_OPTION_IDS.has(option.optionId)) {
      return { ...option, description: codexSessionScope() };
    }
    const isExecpolicyAmendment =
      decision === "acceptWithExecpolicyAmendment" && option.kind === "allow_always";
    const isNetworkPolicyAmendment =
      decision === "applyNetworkPolicyAmendment" &&
      (option.kind === "allow_always" || option.kind === "reject_always");
    if (!isExecpolicyAmendment && !isNetworkPolicyAmendment) {
      return isCodexRulesOptionId(option.optionId)
        ? { ...option, description: codexRulesScope() }
        : option;
    }

    return {
      ...option,
      name: t(
        option.kind === "reject_always"
          ? "agentInfra.backend.permission.codex.blockAlways"
          : "agentInfra.backend.permission.codex.allowAlways"
      ),
      description: `${option.name}\n${codexRulesScope()}`,
    };
  },

  getInstallState(settings: VaultAgentSettings): InstallState {
    const configured = settings.agentMode?.backends?.codex;
    if (!configured?.binaryPath) return { kind: "absent" };
    try {
      const installed = inspectCodexAcpPackage(configured.binaryPath);
      return classifyBinaryInstall(
        {
          kind: "installed",
          version: installed.runtimeVersion,
          source: configured.binarySource ?? "custom",
        },
        CODEX_MIN_VERSION,
        "Codex"
      );
    } catch (error) {
      return classifyBinaryInstall(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? { kind: "absent" }
          : { kind: "error", message: error instanceof Error ? error.message : String(error) },
        CODEX_MIN_VERSION,
        "Codex"
      );
    }
  },

  getResolvedBinaryPath(settings: VaultAgentSettings): string | null {
    return settings.agentMode?.backends?.codex?.binaryPath ?? null;
  },

  subscribeInstallState(_plugin: VaultAgentPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      if (
        prev.agentMode?.backends?.codex?.binaryPath !==
          next.agentMode?.backends?.codex?.binaryPath ||
        prev.agentMode?.backends?.codex?.binaryVersion !==
          next.agentMode?.backends?.codex?.binaryVersion ||
        prev.agentMode?.backends?.codex?.binarySource !==
          next.agentMode?.backends?.codex?.binarySource
      ) {
        cb();
      }
    });
  },

  openInstallUI(plugin: VaultAgentPlugin): void {
    new CodexInstallModal(plugin.app).open();
  },

  async onPluginLoad(): Promise<void> {
    codexBinaryManager.forgetSettledError();
    await codexBinaryManager.autoUpgrade(CODEX_PINNED_VERSION, CODEX_MIN_VERSION, (message) => {
      new Notice(message);
    });
  },

  managedInstall: {
    getState: () => codexBinaryManager.getActionState(),
    subscribe: (_plugin, onChange) => codexBinaryManager.subscribeRuntimeState(onChange),
    run: async () => {
      await codexBinaryManager.install();
    },
  },

  async applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void> {
    const currentBase = session.getState()?.model?.current.baseModelId;
    // Model options accept bare ids; effort belongs to the selected model's refreshed
    // config catalog. https://github.com/Brevilabs/obsidian-copilot-private/issues/550
    if (currentBase !== selection.baseModelId) {
      await session.applyModelWireId(selection.baseModelId);
    }
    const model = session.getState()?.model;
    const apply = model?.apply;
    const effort = resolveEffort(
      selection.effort,
      model?.availableModels.find((entry) => entry.baseModelId === selection.baseModelId)
        ?.effortOptions
    );
    if (apply?.kind === "setConfigOption" && apply.effortConfigId && effort !== null) {
      await session.setConfigOption(apply.effortConfigId, effort);
    }
  },

  prefetchEffortCatalog: prefetchConfigEfforts,

  createBackendProcess(args): BackendProcess {
    return simpleBinaryBackendProcess(args, new CodexBackend(args.clientVersion));
  },

  SettingsPanel: CodexSettingsPanel,

  getModeMapping() {
    return buildCodexModeMapping();
  },

  getModeState(modeState, configOptions) {
    return buildCodexModeState(modeState, configOptions);
  },
};

// Codex keeps session approvals in memory and appends policy amendments to its rules file.
// https://github.com/logancyang/obsidian-copilot/issues/2889
function codexSessionScope(): string {
  return t("agentInfra.backend.permission.codex.sessionScope");
}

function codexRulesScope(): string {
  return t("agentInfra.backend.permission.codex.rulesScope");
}

// codex-acp 2.x sends fixed option ids and no decision metadata.
// https://github.com/logancyang/obsidian-copilot/issues/2889
const CODEX_SESSION_OPTION_IDS = new Set([
  "allow_for_session",
  "allow_permissions_session",
  "allow_session",
]);

function isCodexRulesOptionId(optionId: string): boolean {
  return (
    optionId === "accept_execpolicy_amendment" ||
    optionId.startsWith("apply_network_policy_amendment:")
  );
}

function codexPermissionDecision(metadata: unknown): unknown {
  if (metadata === null || typeof metadata !== "object") return undefined;
  const codex = (metadata as Record<string, unknown>).codex;
  if (codex === null || typeof codex !== "object") return undefined;
  return (codex as Record<string, unknown>).decision;
}
