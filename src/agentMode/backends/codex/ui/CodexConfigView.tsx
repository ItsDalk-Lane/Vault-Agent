import { CODEX_BINARY_NAME, codexBinaryPathPlaceholder } from "@/agentMode/backends/codex/cliSetup";
import { CODEX_MIN_VERSION } from "@/agentMode/backends/codex/codexVersion";
import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigProps,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import {
  AuthenticationSection,
  type AuthenticationState,
} from "@/agentMode/backends/shared/ui/AuthenticationSection";
import { t } from "@/i18n";
import React from "react";

export type {
  ManagedBinarySource as CodexBinarySource,
  ManagedBinaryInfo as CodexManagedInfo,
  ManagedBinaryConfigActions as CodexConfigActions,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";

export interface CodexConfigViewProps extends ManagedBinaryConfigProps {
  auth: AuthenticationState;
}

export const CodexConfigView: React.FC<CodexConfigViewProps> = (props) => (
  <ManagedBinaryConfigView
    authStatus={props.auth.status}
    {...props}
    title={t("agentInfra.backend.codex.configureTitle")}
    binaryName={CODEX_BINARY_NAME}
    managedDescription={t("agentInfra.backend.codex.managedDescription")}
    customDescription={
      <>
        {t("agentInfra.backend.codex.customDescriptionPrefix")}{" "}
        <code>@agentclientprotocol/codex-acp</code>{" "}
        {t("agentInfra.backend.codex.customDescriptionSuffix", { minimum: CODEX_MIN_VERSION })}
      </>
    }
    customPathPlaceholder={codexBinaryPathPlaceholder(process.platform)}
    customPathNotFoundHint={t("agentInfra.backend.codex.customPathNotFound", {
      binary: CODEX_BINARY_NAME,
    })}
    upgradeLabel={t("agentInfra.backend.codex.upgradeLabel")}
  >
    <AuthenticationSection
      ready={props.state.kind === "ready"}
      unavailableMessage={t("agentInfra.backend.codex.unavailable")}
      auth={props.auth}
    />
  </ManagedBinaryConfigView>
);

export { CODEX_PINNED_VERSION } from "@/agentMode/backends/codex/cliSetup";
