import { AgentModeChat } from "@/agentMode/ui/AgentModeChat";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import type VaultAgentPlugin from "@/main";
import React, { useMemo } from "react";

interface LandingStoryProps {
  hasHistory?: boolean;
}

const EMPTY_HISTORY: readonly ChatHistoryItem[] = Object.freeze([]);
const HISTORY: readonly ChatHistoryItem[] = Object.freeze([
  {
    id: "root-gallery",
    backendId: "pi",
    title: "整理项目笔记",
    createdAt: new Date("2026-10-24T08:00:00Z"),
    lastAccessedAt: new Date("2026-10-24T08:00:00Z"),
  },
]);

function LandingStory({ hasHistory = false }: LandingStoryProps) {
  const app = useApp();
  const plugin = useMemo(
    () =>
      ({
        app,
        loadChatById: async () => undefined,
        agentSessionManager: {
          subscribe: () => () => undefined,
          isPreloadReady: () => true,
          getActiveSession: () => null,
          getActiveChatUIState: () => null,
          getActiveProjectId: () => "__global__",
          getIsStarting: () => false,
          getLastError: () => null,
          hasHeldConfigChange: () => false,
          isBackendRestartPending: () => false,
          getChatHistoryItems: async () => (hasHistory ? HISTORY : EMPTY_HISTORY),
          getLocalDataBackend: async () => ({ subscribeStorageChanges: () => () => undefined }),
          subscribeStorageChanges: () => () => undefined,
          getOrCreateActiveSession: async () => undefined,
        } as unknown as AgentSessionManager,
      }) as unknown as VaultAgentPlugin,
    [app, hasHistory]
  );
  return <AgentModeChat plugin={plugin} updateUserMessageHistory={() => undefined} />;
}

export default {
  title: "Agent Mode/Chat Landing",
  component: LandingStory,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<LandingStoryProps>;

export const Empty: StoryObj<LandingStoryProps> = {};
export const ExistingChats: StoryObj<LandingStoryProps> = { args: { hasHistory: true } };
