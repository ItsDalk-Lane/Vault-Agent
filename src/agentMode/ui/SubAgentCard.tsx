import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { App } from "obsidian";
import type { RenderNode, ToolCallPart } from "@/agentMode/ui/agentTrail";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import {
  extractSubAgentInputPrompt,
  extractSubAgentReturnText,
  lookupToolSummary,
} from "@/agentMode/ui/toolSummaries";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";

export const SubagentHistoryOpenerContext = React.createContext<
  ((conversationId: string) => Promise<void>) | null
>(null);

interface SubAgentCardProps {
  parent: ToolCallPart;
  childNodes: RenderNode[];
  truncated?: boolean;
  app: App;
  renderNode: (node: RenderNode, key: string | number) => React.ReactNode;
}

export const SubAgentCard: React.FC<SubAgentCardProps> = ({
  parent,
  childNodes,
  truncated,
  app,
  renderNode,
}) => {
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const openHistory = React.useContext(SubagentHistoryOpenerContext);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const childConversationId = (parent.input as { childConversationId?: unknown } | undefined)
    ?.childConversationId;
  const summary = lookupToolSummary(parent);
  const Icon = summary.icon;
  const line = summary.collapsedLine(parent);
  const outcome = summary.outcome(parent);
  const childCounts = countChildren(childNodes);
  const inputPrompt = extractSubAgentInputPrompt(parent);
  const returnText = extractSubAgentReturnText(parent);

  return (
    <AgentActivityCard
      icon={Icon}
      label={line}
      trailing={<StatusBadge status={parent.status} />}
      secondary={outcome}
      expandable
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      {childCounts.tools > 0 || childCounts.reasoning > 0 || truncated ? (
        <div className="tw-text-xs tw-text-muted">{describeCounts(childCounts, truncated)}</div>
      ) : null}
      {inputPrompt ? (
        <div className="tw-my-1">
          <div
            className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-text-xs tw-text-muted"
            onClick={() => setPromptOpen((v) => !v)}
            role="button"
          >
            <span className="tw-flex-1 tw-truncate">{t("agentChat.subAgent.prompt")}</span>
            {promptOpen ? (
              <ChevronDown className="tw-size-3" />
            ) : (
              <ChevronRight className="tw-size-3" />
            )}
          </div>
          {promptOpen ? (
            <div className="tw-mt-1 tw-border-l-[2px] tw-border-border tw-pl-2">
              <AgentMarkdownText text={inputPrompt} app={app} />
            </div>
          ) : null}
        </div>
      ) : null}
      {truncated ? (
        <div className="tw-text-xs tw-text-muted">{t("agentChat.subAgent.nestedHint")}</div>
      ) : (
        childNodes.map((c, i) => renderNode(c, i))
      )}
      {returnText ? (
        <div className="tw-my-1 tw-border-l-[2px] tw-border-border tw-pl-2">
          <AgentMarkdownText text={returnText} app={app} />
        </div>
      ) : null}
      {openHistory && typeof childConversationId === "string" ? (
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={historyLoading}
              onClick={() => {
                setHistoryLoading(true);
                setHistoryError(null);
                void openHistory(childConversationId)
                  .catch((error: unknown) =>
                    setHistoryError(error instanceof Error ? error.message : String(error))
                  )
                  .finally(() => setHistoryLoading(false));
              }}
            >
              {historyLoading
                ? t("agentChat.subAgent.historyLoading")
                : t("agentChat.subAgent.viewHistory")}
            </Button>
          </div>
          {historyError ? (
            <p role="alert" className="tw-m-0 tw-text-ui-smaller tw-text-error">
              {historyError}
            </p>
          ) : null}
        </div>
      ) : null}
    </AgentActivityCard>
  );
};

interface ChildCounts {
  tools: number;
  reasoning: number;
}

function countChildren(nodes: RenderNode[]): ChildCounts {
  let tools = 0;
  let reasoning = 0;
  for (const n of nodes) {
    if (n.type === "action" || n.type === "subagent") tools += 1;
    else if (n.type === "reasoning") reasoning += 1;
  }
  return { tools, reasoning };
}

function describeCounts(c: ChildCounts, truncated?: boolean): string {
  if (truncated) return t("agentChat.subAgent.nested");
  const bits: string[] = [];
  if (c.tools > 0) {
    bits.push(
      c.tools === 1
        ? t("agentChat.subAgent.tools_one", { count: c.tools })
        : t("agentChat.subAgent.tools_many", { count: c.tools })
    );
  }
  if (c.reasoning > 0) {
    bits.push(
      c.reasoning === 1
        ? t("agentChat.subAgent.reasoning_one", { count: c.reasoning })
        : t("agentChat.subAgent.reasoning_many", { count: c.reasoning })
    );
  }
  return bits.length > 0 ? bits.join(" · ") : t("agentChat.subAgent.noActivity");
}
