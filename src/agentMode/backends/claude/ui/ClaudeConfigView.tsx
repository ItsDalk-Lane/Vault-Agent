import { CLAUDE_INSTALL_COMMAND } from "@/agentMode/backends/claude/cliSetup";
import { claudeUpdateDetail } from "@/agentMode/backends/claude/claudeUpdateDetail";
import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import {
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock } from "@/agentMode/backends/shared/ui/SetupSteps";
import { t } from "@/i18n";
import type { InstallState } from "@/agentMode/session/types";
import {
  AuthenticationSection,
  type AuthenticationState,
} from "@/agentMode/backends/shared/ui/AuthenticationSection";
import React from "react";

export type ClaudeAuthProps = AuthenticationState;

export interface ClaudeConfigViewProps {
  state: InstallState;
  binaryPath: string;
  hasBinaryPathOverride: boolean;
  onSavePath: (path: string) => Promise<string | null>;
  onClearPath: () => void;
  detect: () => Promise<string | null>;
  searchedDirs: () => string[];
  auth: ClaudeAuthProps;
  onClose: () => void;
}

const PATH_PLACEHOLDER =
  process.platform === "win32" ? "/absolute/path/to/claude.exe" : "/absolute/path/to/claude";

export const ClaudeConfigView: React.FC<ClaudeConfigViewProps> = ({
  state,
  binaryPath,
  hasBinaryPathOverride,
  onSavePath,
  onClearPath,
  detect,
  searchedDirs,
  auth,
  onClose,
}) => (
  <ConfigDialogShell
    authStatus={auth.status}
    title={t("agentInfra.backend.claude.configureTitle")}
    state={state}
    warning={<ConfigWarningStrip state={state} detail={claudeUpdateDetail(state)} />}
    onClose={onClose}
  >
    <ConfigSection title={t("agentInfra.backend.claude.binarySection")}>
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        {t("agentInfra.backend.claude.binaryBodyPrefix")} <code>claude</code>{" "}
        {t("agentInfra.backend.claude.binaryBodySuffix")}
      </p>
      <BinaryPathSetting
        binaryName="claude"
        placeholder={PATH_PLACEHOLDER}
        initialPath={binaryPath}
        hasPersistedPath={hasBinaryPathOverride}
        notFoundHint={t("agentInfra.backend.claude.notFoundHint")}
        onSave={onSavePath}
        onClear={onClearPath}
        persistOnAutoDetect
        detect={detect}
        searchedDirs={searchedDirs}
      />
    </ConfigSection>

    <ConfigSection title={t("agentInfra.backend.claude.installSection")}>
      <CommandBlock command={CLAUDE_INSTALL_COMMAND} />
    </ConfigSection>
    <AuthenticationSection
      ready={state.kind === "ready"}
      unavailableMessage={t("agentInfra.backend.claude.unavailable")}
      auth={auth}
    />
  </ConfigDialogShell>
);
