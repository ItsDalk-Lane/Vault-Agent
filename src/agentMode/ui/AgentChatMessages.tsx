import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { AskUserQuestionCard } from "@/agentMode/ui/AskUserQuestionCard";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { SubagentHistoryOpenerContext } from "@/agentMode/ui/SubAgentCard";
import { SubagentHistoryModal } from "@/agentMode/ui/SubagentHistoryModal";
import { PlanProposalCard } from "@/agentMode/ui/PlanProposalCard";
import { FeedbackCard, findFeedbackCardIndex } from "@/agentMode/ui/FeedbackCard";
import { openReportIssueModal } from "@/agentMode/ui/ReportIssueModal";
import { formatFeedbackNote, type FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import { setSettings } from "@/settings/model";
import { ToolPermissionCard } from "@/agentMode/ui/ToolPermissionCard";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import ChatSingleMessage from "@/components/chat-components/ChatSingleMessage";
import { ChatTranscriptViewport } from "@/components/chat-components/ui/ChatTranscriptViewport";
import { Button } from "@/components/ui/button";
import { USER_SENDER } from "@/constants";
import { useChatScrolling } from "@/hooks/useChatScrolling";
import { t } from "@/i18n";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
  TurnFileChange,
  FileChangeRevertResult,
  AgentMessagePart,
} from "@/agentMode/session/types";
import type { ChatMessage } from "@/types/message";
import { logError } from "@/logger";
import { App, Plugin } from "obsidian";
import React, { memo, useCallback, useMemo, useState } from "react";

const HISTORY_PAGE_SIZE = 50;
const EMPTY_MESSAGE_PARTS: AgentMessagePart[] = [];
Object.freeze(EMPTY_MESSAGE_PARTS);

interface HistoryWindow {
  backend: AgentChatBackend;
  firstMessageId?: string;
}

interface AgentChatMessagesProps {
  messages: AgentChatMessage[];
  plugin: Pick<Plugin, "app" | "manifest">;
  sourcePath?: string;
  currentPlan: CurrentPlan | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
  chatBackend: AgentChatBackend;
  isLoading: boolean;
  feedbackOffer: FeedbackOffer | null;
}

function toChatMessageView(m: AgentChatMessage): ChatMessage {
  return {
    id: m.id,
    sender: m.sender,
    message: m.message,
    timestamp: m.timestamp,
    isVisible: m.isVisible,
    isErrorMessage: m.isErrorMessage,
    content: m.content,
    context: m.context,
  };
}

// A permission card names the tool its request omits from the chat's own tool call.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/599
function findToolCallTitle(messages: AgentChatMessage[], toolCallId: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const part = messages[i].parts?.find((p) => p.kind === "tool_call" && p.id === toolCallId);
    if (part?.kind === "tool_call") return part.title;
  }
  return undefined;
}

function lastAssistant(visible: AgentChatMessage[]): AgentChatMessage | undefined {
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].sender !== USER_SENDER && !visible[i].isAuxiliary) return visible[i];
  }
  return undefined;
}

interface AgentMessageRowProps {
  message: AgentChatMessage;
  messageKey: string;
  app: App;
  sourcePath: string;
  isLatestAssistant: boolean;
  isStreaming: boolean;
  minHeight?: number;
  trailingCard?: React.ReactNode;
  onResumeFanout?: (messageId: string) => void;
  isBusy?: boolean;
  onRevertFileChange?: (change: TurnFileChange) => Promise<FileChangeRevertResult>;
}

// Completed messages retain their object identity across streaming updates, so
// stable row props keep their Markdown and trail renderers out of the live path.
// https://github.com/logancyang/obsidian-copilot/issues/3343
const AgentMessageRow = memo(function AgentMessageRow({
  message,
  messageKey,
  app,
  sourcePath,
  isLatestAssistant,
  isStreaming,
  minHeight,
  trailingCard,
  onResumeFanout,
  isBusy,
  onRevertFileChange,
}: AgentMessageRowProps) {
  const adaptedMessage = toChatMessageView(message);
  const isAssistant = message.sender !== USER_SENDER;
  const hasParts = (message.parts?.length ?? 0) > 0;
  const renderTrail = isAssistant && (hasParts || (message.fileChanges?.length ?? 0) > 0);
  // 每条已完成消息都显示自己的时长，不再只有最新一条。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
  const completedTurnDurationMs = message.turnDurationMs;
  const runningTurnStartedAtMs =
    isLatestAssistant && isStreaming ? message.timestamp?.epoch : undefined;
  const completedTurnDuration =
    completedTurnDurationMs !== undefined ? (
      <AgentTurnDurationIndicator status="complete" durationMs={completedTurnDurationMs} inline />
    ) : null;
  const runningTurnDuration =
    runningTurnStartedAtMs !== undefined ? (
      <AgentTurnDurationIndicator status="running" startedAtMs={runningTurnStartedAtMs} />
    ) : null;
  const isStreamingPlaceholder = isAssistant && isStreaming && !hasParts && !message.message;
  const fanoutTurn = isAssistant ? message.fanout : undefined;

  return (
    <div
      data-message-key={messageKey}
      className="tw-w-full"
      style={{ minHeight: minHeight !== undefined ? `${minHeight}px` : "auto" }}
    >
      {fanoutTurn ? (
        <div className="tw-px-3 tw-pt-2">
          <FanoutMessageCard
            message={message}
            turn={fanoutTurn}
            app={app}
            footerStart={completedTurnDuration}
            onResume={onResumeFanout ? () => onResumeFanout(message.id) : undefined}
            isRunning={isBusy}
          />
          {runningTurnDuration}
        </div>
      ) : isStreamingPlaceholder ? (
        <div className="tw-px-3 tw-pt-2">{runningTurnDuration}</div>
      ) : renderTrail ? (
        <div className="tw-px-3 tw-pt-2">
          <AgentTrail
            parts={message.parts ?? EMPTY_MESSAGE_PARTS}
            isStreaming={isStreaming}
            turnStartedAtMs={runningTurnStartedAtMs}
            turnDurationMs={completedTurnDurationMs}
            timestamp={message.timestamp?.display}
            app={app}
            turnStopReason={message.turnStopReason}
            errorText={message.isErrorMessage ? message.message : undefined}
            fileChanges={message.fileChanges}
            onRevertFileChange={onRevertFileChange}
            isBusy={isBusy}
            onOpenFileChange={(change) =>
              void openTurnDiff(app, change, message.id).catch((error: unknown) =>
                logError("[AgentChatMessages] failed to open the turn diff", error)
              )
            }
          />
        </div>
      ) : (
        <>
          <ChatSingleMessage
            sourcePath={sourcePath}
            message={adaptedMessage}
            app={app}
            isStreaming={false}
            footerStart={completedTurnDuration}
          />
          {runningTurnDuration ? <div className="tw-px-3">{runningTurnDuration}</div> : null}
        </>
      )}
      {trailingCard}
    </div>
  );
});

const AgentChatMessages = memo(
  ({
    messages,
    plugin,
    sourcePath = "",
    currentPlan,
    pendingToolPermissions,
    pendingAskUserQuestions,
    chatBackend,
    isLoading,
    feedbackOffer,
  }: AgentChatMessagesProps) => {
    const { app } = plugin;
    const handleOpenSubagentHistory = useCallback(
      async function openHistory(conversationId: string): Promise<void> {
        if (!chatBackend.readSubagentHistory)
          throw new Error(t("agentChat.subAgent.historyUnavailable"));
        const saved = await chatBackend.readSubagentHistory(conversationId);
        new SubagentHistoryModal(app, saved, openHistory).open();
      },
      [app, chatBackend]
    );
    const handleRevertFileChange = useCallback(
      (change: TurnFileChange) => {
        if (!chatBackend.revertFileChange) throw new Error("此历史不能回退文件。");
        return chatBackend.revertFileChange(change);
      },
      [chatBackend]
    );
    const handleResumeFanout = useCallback(
      (messageId: string) => {
        void chatBackend
          .resumeFanout?.(messageId)
          .catch((error: unknown) => logError("[AgentChatMessages] fan-out resume failed", error));
      },
      [chatBackend]
    );
    const visible = useMemo(() => messages.filter((m) => m.isVisible), [messages]);
    // 千条历史一次挂载会阻塞真实 Obsidian 主线程，先显示最近一页，原始消息与同轮工具卡仍可逐页展开。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const [historyWindow, setHistoryWindow] = useState<HistoryWindow>({ backend: chatBackend });
    const anchoredStart = useMemo(
      () =>
        historyWindow.backend === chatBackend && historyWindow.firstMessageId
          ? visible.findIndex((message) => message.id === historyWindow.firstMessageId)
          : -1,
      [historyWindow, chatBackend, visible]
    );
    const firstVisibleIndex =
      anchoredStart >= 0 ? anchoredStart : Math.max(0, visible.length - HISTORY_PAGE_SIZE);
    const displayed = useMemo(() => visible.slice(firstVisibleIndex), [visible, firstVisibleIndex]);
    const adapted = useMemo(() => displayed.map(toChatMessageView), [displayed]);
    const {
      containerMinHeight,
      scrollContainerCallbackRef,
      contentCallbackRef,
      onScroll,
      isScrollPaused,
      scrollToEnd,
      getMessageKey,
    } = useChatScrolling({ chatHistory: adapted });

    const showPlanCard = currentPlan != null && currentPlan.decision === "pending";
    const inlinePlanCard = showPlanCard ? (
      <PlanProposalCard plan={currentPlan} app={app} chatBackend={chatBackend} />
    ) : null;
    const pendingQuestion = pendingAskUserQuestions[0];
    const pendingPermission = pendingQuestion ? undefined : pendingToolPermissions[0];
    const pendingToolName = useMemo(
      () =>
        pendingPermission
          ? findToolCallTitle(messages, pendingPermission.toolCall.toolCallId)
          : undefined,
      [messages, pendingPermission]
    );
    // Questions take priority so the separate resolver queues have a stable
    // presentation policy without carrying cross-type sequencing state.
    // https://github.com/logancyang/obsidian-copilot/issues/2948
    const pendingActionId = pendingQuestion
      ? `question:${pendingQuestion.requestId}`
      : pendingPermission
        ? `permission:${pendingPermission.toolCall.toolCallId}`
        : null;

    const feedbackCardIndex = useMemo(
      () => findFeedbackCardIndex(visible, feedbackOffer),
      [visible, feedbackOffer]
    );
    const feedbackCard = useMemo(
      () =>
        feedbackOffer ? (
          <FeedbackCard
            offer={feedbackOffer}
            onReview={() =>
              openReportIssueModal(plugin, {
                activeBackend: feedbackOffer.evidence.backendId,
                initialNote: formatFeedbackNote(feedbackOffer),
                onReported: (report) => chatBackend.markFeedbackReported(report),
              })
            }
            onDismiss={() => chatBackend.dismissFeedbackOffer()}
            onTurnOff={() => {
              setSettings((cur) => ({
                agentMode: { ...cur.agentMode, offerFeedbackCards: false },
              }));
              chatBackend.dismissFeedbackOffer();
            }}
          />
        ) : null,
      [feedbackOffer, plugin, chatBackend]
    );

    const latestAssistant = useMemo(() => lastAssistant(visible), [visible]);
    const streamingMessageId = isLoading ? latestAssistant?.id : undefined;

    return (
      <SubagentHistoryOpenerContext.Provider
        value={chatBackend.readSubagentHistory ? handleOpenSubagentHistory : null}
      >
        <div className="tw-flex tw-h-full tw-flex-1 tw-flex-col tw-overflow-hidden">
          <ChatTranscriptViewport
            scrollContainerRef={scrollContainerCallbackRef}
            contentRef={contentCallbackRef}
            onScroll={onScroll}
            isScrollPaused={isScrollPaused}
            scrollToEnd={scrollToEnd}
          >
            {firstVisibleIndex > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="tw-mx-3 tw-my-2"
                onClick={() =>
                  setHistoryWindow({
                    backend: chatBackend,
                    firstMessageId: visible[Math.max(0, firstVisibleIndex - HISTORY_PAGE_SIZE)]?.id,
                  })
                }
              >
                {t("controls.loadEarlierMessages", { count: firstVisibleIndex })}
              </Button>
            )}
            {displayed.map((message, index) => {
              const shouldApplyMinHeight =
                index === displayed.length - 1 && message.sender !== USER_SENDER && !showPlanCard;
              const messageKey = getMessageKey(adapted[index], index);

              return (
                <AgentMessageRow
                  key={messageKey}
                  messageKey={messageKey}
                  message={message}
                  app={app}
                  sourcePath={sourcePath}
                  isLatestAssistant={
                    message.sender !== USER_SENDER && message.id === latestAssistant?.id
                  }
                  isStreaming={message.id === streamingMessageId}
                  minHeight={shouldApplyMinHeight ? containerMinHeight : undefined}
                  trailingCard={
                    index + firstVisibleIndex === feedbackCardIndex ? feedbackCard : undefined
                  }
                  onResumeFanout={
                    // 只读快照仅供核对，不能用比较卡重新排入执行名额。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
                    chatBackend.resumeFanout && !chatBackend.getBackendState()?.readOnly
                      ? handleResumeFanout
                      : undefined
                  }
                  isBusy={isLoading}
                  onRevertFileChange={
                    chatBackend.revertFileChange && !chatBackend.getBackendState()?.readOnly
                      ? handleRevertFileChange
                      : undefined
                  }
                />
              );
            })}
            {inlinePlanCard}
          </ChatTranscriptViewport>
          {pendingActionId ? (
            <div
              role="region"
              aria-label={t("agentChat.chatMessages.pendingActions")}
              data-testid="agent-action-rail"
              // A verbose question can exceed a short chat pane. Bound and scroll
              // the rail so its resolution controls remain reachable.
              // https://github.com/logancyang/obsidian-copilot/issues/2948
              className="tw-max-h-full tw-w-full tw-overflow-y-auto tw-bg-primary"
            >
              <div key={pendingActionId} data-action-id={pendingActionId}>
                {pendingQuestion ? (
                  <AskUserQuestionCard
                    request={pendingQuestion}
                    onResolve={chatBackend.resolveAskUserQuestion.bind(chatBackend)}
                  />
                ) : pendingPermission ? (
                  <ToolPermissionCard
                    request={pendingPermission}
                    toolName={pendingToolName}
                    onResolve={chatBackend.resolveToolPermission.bind(chatBackend)}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </SubagentHistoryOpenerContext.Provider>
    );
  }
);

AgentChatMessages.displayName = "AgentChatMessages";

export default AgentChatMessages;
