import { Button } from "@/components/ui/button";
import { AgentHome } from "@/agentMode/ui/AgentHome";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { creatableBackendDescriptors } from "@/agentMode/backends/registry";
import { t } from "@/i18n";
import { useLanguage } from "@/i18n/useLanguage";
import type VaultAgentPlugin from "@/main";
import { logError } from "@/logger";
import React from "react";

interface Props {
  plugin: VaultAgentPlugin;
  updateUserMessageHistory: (newMessage: string) => void;
}

interface AgentChatLandingProps {
  manager: AgentSessionManager;
  plugin: VaultAgentPlugin;
}

function AgentChatLanding({ manager, plugin }: AgentChatLandingProps) {
  const history = useAgentHistoryControls(manager, plugin, manager.getActiveProjectId());
  const { loadChatHistory } = history;
  const loadHistory = React.useCallback(() => void loadChatHistory(), [loadChatHistory]);
  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-4 tw-overflow-y-auto tw-p-4">
        <p className="tw-text-muted">{t("localData.emptyChat")}</p>
        <Button
          disabled={manager.getIsStarting()}
          onClick={() => {
            // 恢复空标签或删完最后一段聊天时不能隐式创建记录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            manager
              .getOrCreateActiveSession()
              .catch((error) => logError("[AgentMode] start failed", error));
          }}
        >
          {t("controls.newChat")}
        </Button>
        <GlobalRecentChatsSection
          items={history.chatHistoryItems}
          onLoadHistory={loadHistory}
          onLoadChat={history.loadChat}
          onUpdateTitle={history.updateChatTitle}
          onDeleteChat={history.deleteChat}
          onCopyChatLink={history.copyChatLink}
          onSetChatPinned={history.setChatPinned}
          getChatBookmarkState={history.getChatBookmarkState}
          onSetChatBookmarked={history.setChatBookmarked}
        />
      </div>
      <AgentModeStatus manager={manager} plugin={plugin} />
    </div>
  );
}

export const AgentModeChat: React.FC<Props> = ({ plugin, updateUserMessageHistory }) => {
  useLanguage();
  const manager = plugin.agentSessionManager;
  const descriptor = creatableBackendDescriptors()[0];
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  const preloadReady = manager?.isPreloadReady(descriptor.id) ?? true;

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

  return <AgentChatLanding manager={manager} plugin={plugin} />;
};
