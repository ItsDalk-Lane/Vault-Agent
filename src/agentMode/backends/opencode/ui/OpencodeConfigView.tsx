import {
  ManagedBinaryConfigView,
  type ManagedBinaryConfigProps,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";
import { t } from "@/i18n";
import React from "react";

export type {
  ManagedBinarySource as OpencodeBinarySource,
  ManagedBinaryRunState as OpencodeRunState,
  ManagedBinaryInfo as OpencodeManagedInfo,
  ManagedBinaryConfigActions as OpencodeConfigActions,
} from "@/agentMode/backends/shared/ui/ManagedBinaryConfigView";

export type OpencodeConfigViewProps = ManagedBinaryConfigProps;

export const OpencodeConfigView: React.FC<OpencodeConfigViewProps> = (props) => (
  <ManagedBinaryConfigView
    {...props}
    title={t("agentInfra.backend.opencode.configureTitle")}
    binaryName="opencode"
    managedDescription={t("agentInfra.backend.opencode.managedDescription")}
    customDescription={t("agentInfra.backend.opencode.customDescription")}
    customPathPlaceholder="/absolute/path/to/opencode"
    customPathNotFoundHint={t("agentInfra.backend.opencode.customPathNotFound")}
    upgradeLabel={
      props.activeSource === "custom"
        ? t("agentInfra.backend.opencode.upgradeRun")
        : t("agentInfra.backend.opencode.upgradeTo", { version: props.managed.version })
    }
  />
);
