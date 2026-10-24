import React from "react";
import { useApp } from "@/context";
import { SubagentHistory, type SubagentHistoryProps } from "@/agentMode/ui/SubagentHistoryModal";
import type { AgentChatMessage } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";

const saved: readonly AgentChatMessage[] = [
  {
    id: "request",
    sender: "user",
    isVisible: true,
    timestamp: null,
    message: "请查看这份笔记中尚未解决的问题。",
  },
  {
    id: "answer",
    sender: "ai",
    isVisible: true,
    timestamp: null,
    message: "找到了两项待确认的内容。",
    turnStopReason: "end_turn",
    turnDurationMs: 4300,
    parts: [
      {
        kind: "thought",
        text: "先读取当前资料，再列出有明确依据的问题。",
        startedAtMs: 1,
        durationMs: 1200,
      },
      {
        kind: "tool_call",
        id: "read",
        title: "Read",
        vendorToolName: "Read",
        status: "completed",
        input: { path: "notes/项目计划.md" },
        output: [{ type: "text", text: "尚未决定最终日期和负责人。" }],
      },
      { kind: "text", text: "找到了两项待确认的内容：最终日期和负责人。" },
    ],
  },
];

const meta = {
  title: "Agent Mode/Subtask History",
  component: SubagentHistory,
  args: { messages: saved },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<SubagentHistoryProps>;
export default meta;

export const SavedHistory: StoryObj<SubagentHistoryProps> = {
  render: function SavedHistory(args) {
    return <SubagentHistory app={useApp()} messages={args.messages ?? saved} />;
  },
};
export const Empty: StoryObj<SubagentHistoryProps> = {
  args: { messages: [] },
  render: function EmptyHistory(args) {
    return <SubagentHistory app={useApp()} messages={args.messages ?? saved} />;
  },
};
