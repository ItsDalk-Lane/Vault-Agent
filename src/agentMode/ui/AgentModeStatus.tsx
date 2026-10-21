import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import {
  useBackendInstallState,
  useManagedInstallActionState,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { t } from "@/i18n";
import { logError } from "@/logger";
import type VaultAgentPlugin from "@/main";
import { Notice } from "obsidian";
import React from "react";

interface Props {
  manager?: AgentSessionManager;
  plugin: VaultAgentPlugin;
  onInstallClick: () => void;
}

export const AgentModeStatus: React.FC<Props> = ({ manager, plugin, onInstallClick }) => {
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor, plugin);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const auth = useBackendAuthState(descriptor);

  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  const heldConfigChange = manager?.hasHeldConfigChange(descriptor.id) ?? false;
  // A reload waits for a running turn to finish, so read the queued restart
  // rather than the click: the action then reports progress for exactly as
  // long as the restart is actually outstanding.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
  const reloading = manager?.isBackendRestartPending(descriptor.id) ?? false;

  const handleReload = React.useCallback(() => {
    manager?.applyHeldConfigChange(descriptor.id).catch((e) => {
      logError("[AgentMode] reload after config change failed", e);
    });
  }, [manager, descriptor.id]);

  const handleUpgrade = React.useCallback(() => {
    const action = descriptor.managedInstall;
    if (!action || managedInstall.kind === "running") return;
    new Notice(t("agentChat.modeStatus.upgradingNotice", { name: descriptor.displayName }));
    action
      .run(plugin)
      .then(
        () => new Notice(t("agentChat.modeStatus.upgradedNotice", { name: descriptor.displayName }))
      )
      .catch((e) => {
        logError("[AgentMode] upgrade failed", e);
        new Notice(t("agentChat.modeStatus.upgradeFailed", { name: descriptor.displayName }));
      });
  }, [descriptor, plugin, managedInstall.kind]);

  if (installState.kind === "absent") {
    return (
      <AgentStatusCard
        message={t("agentChat.modeStatus.notInstalled", { name: descriptor.displayName })}
        action={{
          label: t("agentChat.modeStatus.install", { name: descriptor.displayName }),
          onClick: onInstallClick,
        }}
      />
    );
  }

  if (installState.kind === "checking") {
    return (
      <AgentStatusCard
        message={t("agentChat.modeStatus.checkingVersion", { name: descriptor.displayName })}
      />
    );
  }

  if (installState.kind === "incompatible") {
    const canUpgrade = descriptor.managedInstall !== undefined;
    const upgrading = managedInstall.kind === "running";
    const failed = managedInstall.kind === "error";
    return (
      <AgentStatusCard
        tone={failed ? "error" : "warning"}
        // State supplies the summary; never infer a cause by parsing the backend's full error.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/410
        summary={
          upgrading
            ? t("agentChat.modeStatus.updating", { name: descriptor.displayName })
            : failed
              ? t("agentChat.modeStatus.updateFailed", { name: descriptor.displayName })
              : t("agentChat.modeStatus.updateRequired", { name: descriptor.displayName })
        }
        message={
          upgrading ? managedInstall.label : failed ? managedInstall.message : installState.message
        }
        action={{
          label: canUpgrade
            ? upgrading
              ? t("agentChat.modeStatus.upgrading")
              : failed
                ? t("agentChat.modeStatus.retry")
                : t("agentChat.modeStatus.upgrade")
            : t("agentChat.modeStatus.configure", { name: descriptor.displayName }),
          disabled: canUpgrade && upgrading,
          onClick: canUpgrade ? handleUpgrade : () => descriptor.openInstallUI(plugin),
        }}
      />
    );
  }

  if (installState.kind === "error") {
    return (
      <AgentStatusCard
        tone="error"
        summary={t("agentChat.modeStatus.setupError", { name: descriptor.displayName })}
        message={installState.message}
        action={{
          label: t("agentChat.modeStatus.configure", { name: descriptor.displayName }),
          onClick: () => descriptor.openInstallUI(plugin),
        }}
      />
    );
  }

  if (descriptor.auth && auth.status && !auth.status.signedIn) {
    return (
      <AgentStatusCard
        message={
          auth.signingIn
            ? t("agentChat.modeStatus.signingIn", { name: descriptor.displayName })
            : t("agentChat.modeStatus.notSignedIn", { name: descriptor.displayName })
        }
        action={
          auth.signingIn
            ? auth.url
              ? { label: t("agentChat.modeStatus.openSignInPage"), href: auth.url }
              : undefined
            : { label: t("agentChat.modeStatus.signIn"), onClick: auth.signIn }
        }
      />
    );
  }

  if (!manager) {
    return null;
  }

  const bootError = manager.getLastError();
  if (!bootError) {
    // Settings the running agent was spawned with have changed since. Applying
    // them restarts the backend and replaces this conversation, so the manager
    // holds the restart and the choice of when to take it belongs here. A boot
    // error keeps its recovery action, which also applies any held config.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
    if (!heldConfigChange) return null;
    return (
      <AgentStatusCard
        layout="row"
        message={t("agentChat.modeStatus.configChanged", { name: descriptor.displayName })}
        action={{
          label: reloading ? t("agentChat.modeStatus.reloading") : t("agentChat.modeStatus.reload"),
          disabled: reloading,
          onClick: handleReload,
        }}
      />
    );
  }

  const handleRetry = (): void => {
    // A failed session may remain active after startup rejects. Apply corrected
    // settings before retrying so that session cannot mask the new config.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
    const retry = heldConfigChange
      ? manager.applyHeldConfigChange(descriptor.id)
      : manager.getOrCreateActiveSession();
    retry.catch((e) => {
      logError("[AgentMode] retry failed", e);
    });
  };

  return (
    <AgentStatusCard
      tone="error"
      summary={t("agentChat.modeStatus.sessionError", { name: descriptor.displayName })}
      message={bootError}
      action={{ label: t("agentChat.modeStatus.retry"), onClick: handleRetry }}
    />
  );
};
