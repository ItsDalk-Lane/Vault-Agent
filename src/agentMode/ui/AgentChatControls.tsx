import { describeBackendForHistory } from "@/agentMode/backends/registry";
import { ChatBookmarkMenuItem } from "@/agentMode/ui/ChatBookmarkMenuItem";
import type { ChatBookmarkState } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import {
  ChatHistoryItem,
  ChatHistoryPopover,
} from "@/components/chat-components/ChatHistoryPopover";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";

import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import {
  Bookmark,
  Bug,
  Download,
  History,
  Link,
  MessageCirclePlus,
  MoreHorizontal,
  Pause,
} from "lucide-react";
import React, { useCallback, useState } from "react";

const resolveHistoryIcon = (item: ChatHistoryItem) =>
  item.backendId ? describeBackendForHistory(item.backendId).Icon : undefined;

// 尚未取得会话标识时仍显示链接和书签入口，并说明它们暂不可用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const NeedsMessageMenuItem: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div>
        <DropdownMenuItem disabled>{children}</DropdownMenuItem>
      </div>
    </TooltipTrigger>
    <TooltipContent side="left">{t("localData.sessionStarting")}</TooltipContent>
  </Tooltip>
);

interface AgentChatControlsProps {
  onNewChat?: () => void;
  onForkChat?: () => void | Promise<void>;
  forkDisabled?: boolean;
  onExportMarkdown?: () => void | Promise<void>;
  onExportArchive?: () => void | Promise<void>;
  onRolloverSession?: () => void;
  onPause?: () => Promise<void>;
  rolloverDisabled?: boolean;
  chatHistoryItems?: ChatHistoryItem[];
  onLoadHistory?: () => void | Promise<void>;
  onLoadChat?: (id: string) => Promise<void>;
  onUpdateChatTitle?: (id: string, newTitle: string) => Promise<void>;
  onDeleteChat?: (id: string) => Promise<void>;
  onCloseSession?: (id: string) => Promise<void>;
  openChatIds?: ReadonlySet<string>;
  runningChatIds?: ReadonlySet<string>;
  onCopyChatLink?: () => void | Promise<void>;
  getChatBookmarkState?: () => Promise<ChatBookmarkState>;
  onSetChatBookmarked?: (bookmarked: boolean) => Promise<void>;
  onReportError?: () => void;
  usageMeter?: React.ReactNode;
  showMultiAgentUpsell?: boolean;
}

export const AgentChatControls: React.FC<AgentChatControlsProps> = ({
  onNewChat,
  onExportArchive,
  onExportMarkdown,
  onForkChat,
  forkDisabled,
  onRolloverSession,
  onPause,
  rolloverDisabled = false,
  chatHistoryItems,
  onLoadHistory,
  onLoadChat,
  onUpdateChatTitle,
  onDeleteChat,
  onCloseSession,
  openChatIds,
  runningChatIds,
  onCopyChatLink,
  getChatBookmarkState,
  onSetChatBookmarked,
  onReportError,
  usageMeter,
}) => {
  const historyAvailable = Boolean(
    chatHistoryItems && onLoadChat && onUpdateChatTitle && onDeleteChat
  );
  const [moreActionsBody, setMoreActionsBody] = useState<HTMLElement | null>(null);
  const trackMoreActionsBody = useCallback(
    (node: HTMLButtonElement | null) => setMoreActionsBody(node?.ownerDocument.body ?? null),
    []
  );

  return (
    <div className="tw-flex tw-w-full tw-items-center tw-justify-between tw-p-1">
      <div className="tw-ml-1 tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1"></div>
      <div className="tw-flex tw-items-center tw-gap-1">
        {usageMeter}
        {onNewChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                title={t("controls.newChat")}
                onClick={onNewChat}
              >
                <MessageCirclePlus className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("controls.newChat")}</TooltipContent>
          </Tooltip>
        )}
        {historyAvailable && (
          <Tooltip>
            <ChatHistoryPopover
              chatHistory={chatHistoryItems!}
              onUpdateTitle={onUpdateChatTitle!}
              onDeleteChat={onDeleteChat!}
              onCloseSession={onCloseSession}
              openChatIds={openChatIds}
              runningChatIds={runningChatIds}
              onLoadChat={onLoadChat}
              getIcon={resolveHistoryIcon}
            >
              <TooltipTrigger asChild>
                <Button
                  variant="ghost2"
                  size="icon"
                  title={t("controls.history")}
                  onClick={() => {
                    void onLoadHistory?.();
                  }}
                >
                  <History className="tw-size-4" />
                </Button>
              </TooltipTrigger>
            </ChatHistoryPopover>
            <TooltipContent>{t("controls.history")}</TooltipContent>
          </Tooltip>
        )}
        {onNewChat && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                title={t("controls.moreActions")}
                ref={trackMoreActionsBody}
              >
                <MoreHorizontal className="tw-size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" container={moreActionsBody}>
              {onCopyChatLink ? (
                <DropdownMenuItem onSelect={() => void onCopyChatLink()}>
                  <Link />
                  {t("controls.copyChatLink")}
                </DropdownMenuItem>
              ) : (
                <NeedsMessageMenuItem>
                  <Link />
                  {t("controls.copyChatLink")}
                </NeedsMessageMenuItem>
              )}
              {onSetChatBookmarked &&
                (getChatBookmarkState ? (
                  <ChatBookmarkMenuItem
                    getBookmarkState={getChatBookmarkState}
                    onSetBookmarked={safeAsyncHandler(onSetChatBookmarked)}
                  />
                ) : (
                  <NeedsMessageMenuItem>
                    <Bookmark />
                    {t("controls.addBookmark")}
                  </NeedsMessageMenuItem>
                ))}
              {onPause && (
                <DropdownMenuItem onSelect={safeAsyncHandler(onPause)}>
                  <Pause />
                  {t("controls.pauseWork")}
                </DropdownMenuItem>
              )}
              {onRolloverSession && (
                <DropdownMenuItem disabled={rolloverDisabled} onSelect={onRolloverSession}>
                  <MessageCirclePlus />
                  {t("controls.rolloverSession")}
                </DropdownMenuItem>
              )}
              {onForkChat && (
                <DropdownMenuItem disabled={forkDisabled} onSelect={() => void onForkChat()}>
                  <MessageCirclePlus />
                  {t("localData.fork")}
                </DropdownMenuItem>
              )}
              {onExportMarkdown && (
                <DropdownMenuItem onSelect={() => void onExportMarkdown()}>
                  <Download />
                  {t("localData.export")} (Markdown)
                </DropdownMenuItem>
              )}
              {onExportArchive && (
                <DropdownMenuItem onSelect={() => void onExportArchive()}>
                  <Download />
                  {t("controls.exportArchive")}
                </DropdownMenuItem>
              )}
              {/* A report from here names the chat's agent, model and session, so only a host with a chat offers it.
                  https://github.com/Brevilabs/obsidian-copilot-private/issues/672 */}
              {onReportError && (
                <DropdownMenuItem onSelect={onReportError}>
                  <Bug />
                  {t("controls.reportError")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};
