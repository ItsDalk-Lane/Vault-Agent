import { AgentSessionStatsDock } from "@/agentMode/ui/AgentSessionStatsDock";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

// 输入框下方双胶囊的视觉状态：有统计/无统计、含上下文窗口。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/11
const backend = {
  subscribe: () => () => undefined,
  getSessionUsage: (): SessionUsage => ({
    usedTokens: 45_346,
    contextWindow: 1_000_000,
    inputTokens: 22_201,
    outputTokens: 1_001,
    cacheReadTokens: 22_144,
    updatedAt: 1,
  }),
} as unknown as AgentChatBackend;

const messages = [
  { id: "u1", sender: "user", timestamp: null, isVisible: true, message: "go" },
  { id: "u2", sender: "user", timestamp: null, isVisible: true, message: "again" },
  {
    id: "a1",
    sender: "ai",
    timestamp: null,
    isVisible: true,
    message: "answer",
    turnUsage: {
      inputTokens: 22_201,
      outputTokens: 1_001,
      cacheReadTokens: 22_144,
      cacheWriteTokens: 0,
      modelRequests: 2,
      modelDurationMs: 90_000,
      toolDurationMs: 40_000,
      ttftMs: 300,
      modelId: "deepseek-chat",
    },
  },
];

const meta = {
  title: "Agent Mode/Session Stats Dock",
  component: AgentSessionStatsDock,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof AgentSessionStatsDock>>;
export default meta;

export const WithSessionData: StoryObj<React.ComponentProps<typeof AgentSessionStatsDock>> = {
  args: { backend, messages },
};

export const EmptySession: StoryObj<React.ComponentProps<typeof AgentSessionStatsDock>> = {
  args: { backend, messages: [] },
};
