import React, { useMemo } from "react";
import { agentResponseText, buildAgentTrail, type RenderNode } from "@/agentMode/ui/agentTrail";
import type {
  AgentMessagePart,
  StopReason,
  TurnFileChange,
  TurnUsageSummary,
  FileChangeRevertResult,
} from "@/agentMode/session/types";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import { CompactionRow } from "@/agentMode/ui/CompactionRow";
import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { TurnActivityFold } from "@/agentMode/ui/TurnActivityFold";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { planEntryClass, planEntryIcon } from "@/agentMode/ui/planEntryStyles";
import { type ToolSummaryContext } from "@/agentMode/ui/toolSummaries";
import { useTrailExpansion, type TrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { t } from "@/i18n";
import { getVaultBase } from "@/utils/vaultPath";
import { App } from "obsidian";

interface AgentTrailProps {
  parts: AgentMessagePart[];
  isStreaming: boolean;
  turnStartedAtMs?: number;
  turnDurationMs?: number;
  timestamp?: string;
  app: App;
  turnStopReason?: StopReason;
  errorText?: string;
  fileChanges?: TurnFileChange[];
  onOpenFileChange?: (change: TurnFileChange) => void;
  onRevertFileChange?: (change: TurnFileChange) => Promise<FileChangeRevertResult>;
  isBusy?: boolean;
  showMessageActions?: boolean;
  /** 本轮用量，驱动页脚的用量胶囊。https://github.com/ItsDalk-Lane/Vault-Agent/issues/11 */
  turnUsage?: TurnUsageSummary;
  /** 逐轮分支动作，仅在带 runId 的完成轮提供。https://github.com/ItsDalk-Lane/Vault-Agent/issues/12 */
  onForkTurn?: () => void;
  forkDisabled?: boolean;
  /** 组件库展示用默认展开过程折叠块；产品内默认折叠。https://github.com/ItsDalk-Lane/Vault-Agent/issues/14 */
  defaultFoldOpen?: boolean;
}

const noopOpenFileChange = () => {};

export const AgentTrail: React.FC<AgentTrailProps> = ({
  parts,
  isStreaming,
  turnStartedAtMs,
  turnDurationMs,
  timestamp,
  app,
  turnStopReason,
  errorText,
  fileChanges,
  onOpenFileChange = noopOpenFileChange,
  onRevertFileChange,
  isBusy,
  showMessageActions = true,
  turnUsage,
  onForkTurn,
  forkDisabled,
  defaultFoldOpen,
}) => {
  const answer = agentResponseText(parts);
  const hasRunningDuration = isStreaming && turnStartedAtMs !== undefined;
  // A compaction row reports its own progress and is not a reply to time or copy.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/633
  const trailNodes = buildAgentTrail(parts);
  const compactionOnly =
    trailNodes.length > 0 && trailNodes.every((node) => node.type === "compaction");
  // 子任务历史只供查看，不能在历史窗口中提供写入编辑器的动作。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  // 完成态用时移入过程折叠块标题，页脚不再显示时长。https://github.com/ItsDalk-Lane/Vault-Agent/issues/14
  const footer =
    showMessageActions && !isStreaming && turnStopReason !== "cancelled" && answer.length > 0 ? (
      <AgentMessageActions
        text={answer}
        app={app}
        timestamp={timestamp}
        turnUsage={turnUsage}
        onForkTurn={onForkTurn}
        forkDisabled={forkDisabled}
      />
    ) : !hasRunningDuration && timestamp ? (
      <AssistantResponseFooter timestamp={timestamp} />
    ) : null;

  return (
    <div className="tw-group tw-flex tw-flex-col tw-gap-1">
      {isStreaming ? (
        <LinearTrail nodes={trailNodes} parts={parts} isStreaming app={app} />
      ) : (
        <FoldedTrail
          nodes={trailNodes}
          parts={parts}
          app={app}
          durationMs={turnDurationMs}
          defaultFoldOpen={defaultFoldOpen}
        />
      )}
      {errorText && answer.length === 0 ? (
        // A failed turn's error is stored as message text, which a reply with parts never shows.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/633
        <div className="tw-text-error">
          <AgentMarkdownText text={errorText} app={app} />
        </div>
      ) : null}
      {!isStreaming && fileChanges && fileChanges.length > 0 ? (
        <FilesChangedCard
          changes={fileChanges}
          onOpen={onOpenFileChange}
          onRevert={onRevertFileChange}
          isBusy={isBusy}
        />
      ) : null}
      {hasRunningDuration && !compactionOnly ? (
        <AgentTurnDurationIndicator status="running" startedAtMs={turnStartedAtMs} />
      ) : null}
      {compactionOnly ? null : footer}
    </div>
  );
};

interface TrailContext {
  app: App;
  lastPart: AgentMessagePart | undefined;
  expansion: TrailExpansion;
  summaryCtx: ToolSummaryContext;
}

// 流式期间过程块逐块独立渲染，保持可见。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
const LinearTrail: React.FC<{
  nodes: RenderNode[];
  parts: AgentMessagePart[];
  isStreaming: boolean;
  app: App;
}> = ({ nodes, parts, isStreaming, app }) => {
  const expansion = useTrailExpansion();
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const ctx: TrailContext = {
    app,
    lastPart: parts.length > 0 ? parts[parts.length - 1] : undefined,
    expansion,
    summaryCtx,
  };
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      {nodes.map((node, i) =>
        renderNode(node, i, ctx, isStreaming && i === nodes.length - 1, "root")
      )}
    </div>
  );
};

function isActivityNode(node: RenderNode): boolean {
  return node.type === "reasoning" || node.type === "action" || node.type === "subagent";
}

// 完成轮把过程块（思考/工具/子代理）收进一个折叠块置于正文之前；首个过程块到最后一个过程块之间的
// 中间正文与计划/压缩行一并按时间序折叠，不能抽出去破坏顺序；范围外的开头前言与最终回复保持可见。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/14
const FoldedTrail: React.FC<{
  nodes: RenderNode[];
  parts: AgentMessagePart[];
  app: App;
  durationMs?: number;
  defaultFoldOpen?: boolean;
}> = ({ nodes, parts, app, durationMs, defaultFoldOpen }) => {
  const expansion = useTrailExpansion();
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const first = nodes.findIndex(isActivityNode);
  const last = nodes.findLastIndex(isActivityNode);
  const ctx: TrailContext = {
    app,
    lastPart: parts.length > 0 ? parts[parts.length - 1] : undefined,
    expansion,
    summaryCtx,
  };
  const toolCount = parts.filter(
    (part) => part.kind === "tool_call" && part.vendorToolName !== "ToolSearch"
  ).length;
  if (first === -1) {
    return (
      <div className="tw-flex tw-flex-col tw-gap-1">
        {nodes.map((node, i) => renderNode(node, i, ctx, false, "root"))}
      </div>
    );
  }
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      {nodes.slice(0, first).map((node, i) => renderNode(node, i, ctx, false, "root"))}
      <TurnActivityFold durationMs={durationMs} toolCount={toolCount} defaultOpen={defaultFoldOpen}>
        {nodes.slice(first, last + 1).map((node, i) => renderNode(node, i, ctx, false, "root"))}
      </TurnActivityFold>
      {nodes.slice(last + 1).map((node, i) => renderNode(node, i, ctx, false, "root"))}
    </div>
  );
};

function renderNode(
  node: RenderNode,
  key: string | number,
  ctx: TrailContext,
  atLiveEdge: boolean,
  trailId: string
): React.ReactNode {
  switch (node.type) {
    case "action": {
      const expansionId = actionExpansionId(trailId, node.part.id);
      return (
        <ActionCard
          key={key}
          part={node.part}
          open={ctx.expansion.isOpen(expansionId)}
          onToggle={() => ctx.expansion.toggle(expansionId)}
        />
      );
    }
    case "subagent": {
      const children = node.children;
      const lastChild = children[children.length - 1];
      const childTrailId = `${trailId}/subagent:${node.parent.id}`;
      return (
        <SubAgentCard
          key={key}
          parent={node.parent}
          childNodes={children}
          truncated={node.truncated}
          app={ctx.app}
          renderNode={(n, k) => renderNode(n, k, ctx, atLiveEdge && n === lastChild, childTrailId)}
        />
      );
    }
    case "reasoning": {
      // Replacing an earlier singleton plan can freeze the final thought
      // without appending another raw part, so duration also ends live state.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/336
      const isActive =
        atLiveEdge && node.part === ctx.lastPart && node.part.durationMs === undefined;
      return <ReasoningBlock key={key} part={node.part} isStreaming={isActive} />;
    }
    case "text":
      return <AgentMarkdownText key={key} text={node.part.text} app={ctx.app} />;
    case "plan":
      return <PlanPill key={key} entries={node.part.entries} />;
    case "compaction":
      return <CompactionRow key={key} part={node.part} />;
  }
}

function actionExpansionId(trailId: string, toolCallId: string): string {
  return `${trailId}/action:${toolCallId}`;
}

interface PlanPillProps {
  entries: { content: string; status: "pending" | "in_progress" | "completed" }[];
}

const PlanPill: React.FC<PlanPillProps> = ({ entries }) =>
  entries.length === 0 ? null : (
    <div className="tw-my-1 tw-rounded tw-border tw-border-border tw-bg-secondary tw-px-2 tw-py-1">
      <p className="tw-mb-1 tw-text-xs tw-text-muted">{t("agentChat.trail.plan")}</p>
      <ul className="tw-flex tw-flex-col tw-gap-0.5 tw-text-sm">
        {entries.map((e, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- plan entries are positional and may share content
          <li key={`plan-${i}`} className="tw-flex tw-items-start tw-gap-2">
            <span aria-hidden="true">{planEntryIcon(e.status)}</span>
            <span className={planEntryClass(e.status)}>{e.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
