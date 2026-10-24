import React, { useMemo } from "react";
import { Loader2, Check, X } from "lucide-react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { displayTargetFromPath, lookupToolSummary } from "@/agentMode/ui/toolSummaries";
import { formatAgentInput } from "@/agentMode/ui/diffRender";
import { DiffLines } from "@/agentMode/ui/DiffLines";
import { ExpandedBlockSection, prettyIfJson } from "@/agentMode/ui/ExpandedBlockSection";
import { t } from "@/i18n";
import { getVaultBase } from "@/utils/vaultPath";
import { openVaultPath } from "@/utils/openVaultPath";
import { useApp } from "@/context";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";

interface ActionCardProps {
  part: ToolCallPart;
  open: boolean;
  onToggle: () => void;
}

export const ActionCard: React.FC<ActionCardProps> = ({ part, open, onToggle }) => {
  const app = useApp();
  const summary = lookupToolSummary(part);
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const Icon = summary.icon;
  const line = summary.collapsedLine(part, summaryCtx);
  const outcome = summary.outcome(part);
  const outputs = part.output ?? [];
  const details = summary.expandedDetails?.(part) ?? null;
  const inputText = details !== null ? null : formatAgentInput(part.input);
  const expandable = outputs.length > 0 || details !== null || inputText !== null;
  const targetPath =
    part.status === "completed" ? (summary.targetPath?.(part, summaryCtx) ?? null) : null;
  const link = targetPath
    ? { path: targetPath, label: displayTargetFromPath(part, summaryCtx.vaultBase) ?? targetPath }
    : null;

  return (
    <AgentActivityCard
      icon={Icon}
      label={
        link ? (
          <>
            <span className="tw-shrink-0">
              {line.slice(0, line.lastIndexOf(link.label)).trimEnd()}
            </span>
            <a
              href="#"
              className="tw-min-w-0 tw-truncate tw-text-normal hover:tw-text-accent hover:tw-underline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openVaultPath(app, link.path, { newLeaf: true });
              }}
            >
              {link.label}
            </a>
          </>
        ) : (
          <span className="tw-truncate">{line}</span>
        )
      }
      trailing={<StatusBadge status={part.status} />}
      expandable={expandable}
      open={open}
      onToggle={onToggle}
    >
      {outcome ? <div className="tw-text-xs tw-text-muted">{outcome}</div> : null}
      {/* 展开体统一为分段面板：命令/输入 + 输出 + 差异，均带标签与复制。https://github.com/ItsDalk-Lane/Vault-Agent/issues/10 */}
      {details !== null ? (
        <ExpandedBlockSection label={t("agentChat.blockSections.command")} text={details} />
      ) : inputText !== null ? (
        <ExpandedBlockSection label={t("agentChat.blockSections.input")} text={inputText} />
      ) : null}
      {outputs.map((o, i) =>
        o.type === "text" ? (
          <ExpandedBlockSection
            // eslint-disable-next-line @eslint-react/no-array-index-key -- tool outputs are append-only; index is stable
            key={`text-${i}`}
            label={
              outputs.length > 1
                ? t("agentChat.blockSections.outputN", { n: i + 1 })
                : t("agentChat.blockSections.output")
            }
            text={prettyIfJson(o.text)}
            copyText={o.text}
          />
        ) : (
          <ExpandedBlockSection
            // eslint-disable-next-line @eslint-react/no-array-index-key -- tool outputs are append-only; index is stable
            key={`diff-${i}-${o.path}`}
            label={o.path}
            copyText={o.newText}
          >
            <DiffLines oldText={o.oldText} newText={o.newText} />
          </ExpandedBlockSection>
        )
      )}
    </AgentActivityCard>
  );
};

interface StatusBadgeProps {
  status: AgentToolStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  if (status === "in_progress" || status === "pending") {
    return <Loader2 className="tw-size-3 tw-shrink-0 tw-animate-spin tw-text-loading" />;
  }
  if (status === "failed") {
    return <X className="tw-size-3 tw-shrink-0 tw-text-error" />;
  }
  return <Check className="tw-size-3 tw-shrink-0 tw-text-success" />;
};
