import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import { creatableBackendDescriptors } from "@/agentMode/backends/registry";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { t } from "@/i18n";
import { logError } from "@/logger";
import type VaultAgentPlugin from "@/main";
import React from "react";

interface Props {
  manager?: AgentSessionManager;
  plugin: VaultAgentPlugin;
}

export const AgentModeStatus: React.FC<Props> = ({ manager }) => {
  const descriptor = creatableBackendDescriptors()[0];

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
