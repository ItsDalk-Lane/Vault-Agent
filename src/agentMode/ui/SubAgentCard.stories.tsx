import React from "react";
import { useApp } from "@/context";
import { SubAgentCard, SubagentHistoryOpenerContext } from "@/agentMode/ui/SubAgentCard";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { Meta, StoryObj } from "@/lib/story";

type Props = React.ComponentProps<typeof SubAgentCard>;
const parent: ToolCallPart = {
  kind: "tool_call",
  id: "child-task",
  title: "Agent",
  vendorToolName: "Agent",
  status: "completed",
  input: {
    subagent_type: "researcher",
    description: "检查笔记中的待确认内容",
    childConversationId: "saved-child-1",
  },
  output: [{ type: "text", text: "找到了两项待确认的内容。" }],
};
const meta = {
  title: "Agent Mode/Subtask Card",
  component: SubAgentCard,
  args: { parent, childNodes: [], renderNode: () => null },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

const openSavedHistory = async () => undefined;
const failSavedHistory = async () => {
  throw new Error("暂时无法读取已保存的子任务，请稍后重试。");
};

export const SavedChild: StoryObj<Props> = {
  render: function SavedChild() {
    return (
      <SubagentHistoryOpenerContext.Provider value={openSavedHistory}>
        <SubAgentCard parent={parent} childNodes={[]} app={useApp()} renderNode={() => null} />
      </SubagentHistoryOpenerContext.Provider>
    );
  },
};
export const HistoryLoadFailure: StoryObj<Props> = {
  render: function HistoryFailure() {
    return (
      <SubagentHistoryOpenerContext.Provider value={failSavedHistory}>
        <SubAgentCard parent={parent} childNodes={[]} app={useApp()} renderNode={() => null} />
      </SubagentHistoryOpenerContext.Provider>
    );
  },
};
