import { formatChatDeleteNotice } from "@/lib/chatDeleteText";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { t, type MessageKey } from "@/i18n";
import { logError } from "@/logger";
import type VaultAgentPlugin from "@/main";
import { buildChatDeepLink } from "@/utils/chatDeepLink";

import { getUrlBookmarks, isBookmarksPluginDisabled } from "@/utils/obsidianBookmarks";
import { type App, Notice } from "obsidian";
import { useCallback, useEffect, useRef, useState } from "react";

const EMPTY_CHAT_HISTORY_ITEMS = Object.freeze([]) as unknown as ChatHistoryItem[];

const NOTICE_ACTION_KEYS: Record<string, MessageKey> = {
  "load chat history": "agentChat.history.action.loadChatHistory",
  "load chat": "agentChat.history.action.loadChat",
  "update chat title": "agentChat.history.action.updateChatTitle",
  "delete chat": "agentChat.history.action.deleteChat",
  "pin chat": "agentChat.history.action.pinChat",
  "unpin chat": "agentChat.history.action.unpinChat",
  "read bookmarks": "agentChat.history.action.readBookmarks",
  "bookmark chat": "agentChat.history.action.bookmarkChat",
  "remove bookmark": "agentChat.history.action.removeBookmark",
  "remove chat bookmark": "agentChat.history.action.removeChatBookmark",
};

export interface AgentHistoryControls {
  chatHistoryItems: ChatHistoryItem[];
  chatHistorySettled: boolean;
  loadChatHistory: () => Promise<void>;
  loadChat: (id: string) => Promise<void>;
  updateChatTitle: (id: string, newTitle: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  setChatPinned: (id: string, pinned: boolean) => Promise<void>;
  copyChatLink: (id: string) => Promise<void>;
  getChatBookmarkState: (id: string) => Promise<ChatBookmarkState>;
  setChatBookmarked: (id: string, title: string, bookmarked: boolean) => Promise<void>;
  setActiveChatBookmarked: (bookmarked: boolean) => Promise<void>;
}

export type ChatBookmarkState = "unavailable" | "off" | "bookmarked" | "not-bookmarked";
async function getChatLink(app: App, id: string): Promise<string> {
  return buildChatDeepLink(app.vault.getName(), id);
}

export function useAgentHistoryControls(
  manager: AgentSessionManager,
  plugin: VaultAgentPlugin,
  scope?: ProjectScopeId
): AgentHistoryControls {
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  const effectiveScope = scope ?? GLOBAL_SCOPE;
  const [loadedScope, setLoadedScope] = useState<ProjectScopeId>(effectiveScope);
  const visibleChatHistoryItems =
    loadedScope === effectiveScope ? chatHistoryItems : EMPTY_CHAT_HISTORY_ITEMS;
  const [settledScope, setSettledScope] = useState<ProjectScopeId | null>(null);
  const chatHistorySettled = settledScope === effectiveScope;

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const latestScopeRef = useRef(effectiveScope);
  useEffect(() => {
    latestScopeRef.current = effectiveScope;
  }, [effectiveScope]);

  const runWithNotice = useCallback(
    async <T>(label: string, action: () => Promise<T>, rethrow = false): Promise<T | void> => {
      try {
        return await action();
      } catch (error) {
        logError(`[AgentMode] ${label} failed`, error);
        const actionKey = NOTICE_ACTION_KEYS[label];
        new Notice(t("agentChat.history.failed", { action: actionKey ? t(actionKey) : label }));
        if (rethrow) throw error;
      }
    },
    []
  );

  // 置顶后不能再显示较早请求返回的旧排序。https://github.com/logancyang/obsidian-copilot/issues/3195
  const historyRequestRef = useRef(0);

  const loadChatHistory = useCallback(async () => {
    const requestScope = scope ?? GLOBAL_SCOPE;
    const request = ++historyRequestRef.current;
    const isCurrent = () =>
      isMountedRef.current &&
      latestScopeRef.current === requestScope &&
      historyRequestRef.current === request;
    await runWithNotice("load chat history", async () => {
      const items = await manager.getChatHistoryItems(scope);
      if (isCurrent()) {
        setLoadedScope(requestScope);
        setChatHistoryItems(items);
      }
    });
    if (isCurrent()) {
      setSettledScope(requestScope);
    }
  }, [manager, runWithNotice, scope]);

  useEffect(() => {
    return manager.subscribeStorageChanges(() => void loadChatHistory());
  }, [manager, loadChatHistory]);

  const loadChat = useCallback(
    async (id: string) => {
      await runWithNotice("load chat", () => plugin.loadChatById(id));
    },
    [plugin, runWithNotice]
  );

  const updateChatTitle = useCallback(
    async (id: string, newTitle: string) => {
      await runWithNotice(
        "update chat title",
        async () => {
          await manager.updateChatTitle(id, newTitle);
          await loadChatHistory();
        },
        true
      );
    },
    [manager, loadChatHistory, runWithNotice]
  );

  const deleteChat = useCallback(
    async (id: string) => {
      try {
        await runWithNotice(
          "delete chat",
          async () => {
            const link = await getChatLink(plugin.app, id);
            await manager.deleteChatHistory(id);
            new Notice(formatChatDeleteNotice());
            // Obsidian's Bookmarks internals have no public API, so a failure there must not undo or hide a completed delete.
            // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
            if (link) {
              await runWithNotice("remove chat bookmark", async () =>
                getUrlBookmarks(plugin.app)?.remove(link)
              );
            }
          },
          true
        );
      } finally {
        await loadChatHistory();
      }
    },
    [manager, loadChatHistory, plugin, runWithNotice]
  );

  const setChatPinned = useCallback(
    async (id: string, pinned: boolean) => {
      await runWithNotice(pinned ? "pin chat" : "unpin chat", async () => {
        const chat = await manager.setChatPinned(id, pinned);
        if (!isMountedRef.current) return;
        historyRequestRef.current++;
        // A reload right after the frontmatter write reads the metadata cache's previous pin state.
        // https://github.com/logancyang/obsidian-copilot/issues/3195
        setChatHistoryItems((items) =>
          items.map((item) =>
            item.id === id ? { ...item, id: chat.id, pinnedAt: chat.pinnedAt } : item
          )
        );
      });
    },
    [manager, runWithNotice]
  );

  const copyChatLink = useCallback((id: string) => plugin.copyChatLink(async () => id), [plugin]);

  const getChatBookmarkState = useCallback(
    async (id: string): Promise<ChatBookmarkState> => {
      const state = await runWithNotice("read bookmarks", async () => {
        const bookmarks = getUrlBookmarks(plugin.app);
        // A turned-off Bookmarks plugin still shows the item, so users can find the feature and how to enable it.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/694
        if (!bookmarks) return isBookmarksPluginDisabled(plugin.app) ? "off" : "unavailable";
        const link = await getChatLink(plugin.app, id);
        return link && bookmarks.has(link) ? "bookmarked" : "not-bookmarked";
      });
      return state ?? "unavailable";
    },
    [plugin, runWithNotice]
  );

  const setChatBookmarked = useCallback(
    async (id: string, title: string, bookmarked: boolean) => {
      await runWithNotice(bookmarked ? "bookmark chat" : "remove bookmark", async () => {
        const bookmarks = getUrlBookmarks(plugin.app);
        if (!bookmarks) throw new Error("The Bookmarks core plugin is not enabled.");
        const link = await getChatLink(plugin.app, id);
        if (bookmarked) {
          bookmarks.add(link, title);
          new Notice(t("agentChat.bookmarks.added"));
        } else {
          bookmarks.remove(link);
          new Notice(t("agentChat.bookmarks.removed"));
        }
      });
    },
    [plugin, runWithNotice]
  );

  const setActiveChatBookmarked = useCallback(
    async (bookmarked: boolean) => {
      await runWithNotice(bookmarked ? "bookmark chat" : "remove bookmark", async () => {
        const session = manager.getActiveSession();
        const id = session?.getBackendSessionId();
        if (!id) throw new Error(t("notice.linkNotFound"));
        await setChatBookmarked(
          id,
          session?.getLabel() ?? t("agentInfra.session.untitledChat"),
          bookmarked
        );
      });
    },
    [manager, runWithNotice, setChatBookmarked]
  );

  return {
    chatHistoryItems: visibleChatHistoryItems,
    chatHistorySettled,
    loadChatHistory,
    loadChat,
    updateChatTitle,
    deleteChat,
    setChatPinned,
    copyChatLink,
    getChatBookmarkState,
    setChatBookmarked,
    setActiveChatBookmarked,
  };
}
