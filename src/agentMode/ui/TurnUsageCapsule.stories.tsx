import { TurnUsageCapsule } from "@/agentMode/ui/TurnUsageCapsule";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

// 每轮用量胶囊的视觉状态：折叠胶囊与页脚同行的效果。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/11
const USAGE = {
  inputTokens: 22_201,
  outputTokens: 1_001,
  cacheReadTokens: 22_144,
  cacheWriteTokens: 0,
  modelRequests: 2,
  modelDurationMs: 90_000,
  toolDurationMs: 40_000,
  ttftMs: 300,
  modelId: "deepseek-chat",
};

const meta = {
  title: "Agent Mode/Turn Usage Capsule",
  component: TurnUsageCapsule,
  args: { usage: USAGE },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof TurnUsageCapsule>>;
export default meta;

export const CompletedTurn: StoryObj<React.ComponentProps<typeof TurnUsageCapsule>> = {
  render: () => (
    <TooltipProvider>
      <div className="tw-flex tw-items-center tw-gap-2">
        <TurnUsageCapsule usage={USAGE} />
        <span className="tw-text-muted">Worked for 2m 10s</span>
      </div>
    </TooltipProvider>
  ),
};

export const LegacyTurnWithoutTiming: StoryObj<React.ComponentProps<typeof TurnUsageCapsule>> = {
  args: {
    usage: {
      inputTokens: 812,
      outputTokens: 214,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      modelRequests: 1,
    },
  },
};
