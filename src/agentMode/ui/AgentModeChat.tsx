import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentHome } from "@/agentMode/ui/AgentHome";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { creatableBackendDescriptors } from "@/agentMode/backends/registry";
import { t } from "@/i18n";
import { useLanguage } from "@/i18n/useLanguage";
import type VaultAgentPlugin from "@/main";
import { logError } from "@/logger";
import React from "react";

interface Props {
  plugin: VaultAgentPlugin;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
}

export const AgentModeChat: React.FC<Props> = ({
  plugin,
  onSaveChat,
  updateUserMessageHistory,
}) => {
  useLanguage();
  const manager = plugin.agentSessionManager;
  const descriptor = creatableBackendDescriptors()[0];
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  const preloadReady = manager?.isPreloadReady(descriptor.id) ?? true;

  React.useEffect(() => {
    if (!manager) return;
    if (!preloadReady) return;
    if (manager.getSessionsForScope(manager.getActiveProjectId()).length > 0) return;
    if (manager.getIsStarting()) return;
    if (manager.getLastError()) return;
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] auto-start failed", e);
    });
  }, [manager, preloadReady, tick]);

  if (!manager) return null;

  const activeSession = manager.getActiveSession();
  const backend = manager.getActiveChatUIState();
  if (activeSession && backend) {
    return (
      <AgentHome
        backend={backend}
        sessionId={activeSession.internalId}
        chatInputId={activeSession.chatInputId}
        manager={manager}
        plugin={plugin}
        onSaveChat={onSaveChat}
        updateUserMessageHistory={updateUserMessageHistory}
      />
    );
  }

  // 模型加载失败仍须显示真实重试入口，不能一直停留在加载提示。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  if (!preloadReady && !manager.getLastError()) {
    return (
      <div className="tw-flex tw-size-full tw-items-center tw-justify-center tw-text-muted">
        {t("agentChat.loadingModels")}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="tw-flex-1" />
      <AgentModeStatus manager={manager} plugin={plugin} />
      <AgentChatControls />
    </div>
  );
};
