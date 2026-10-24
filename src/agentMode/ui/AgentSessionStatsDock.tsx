import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { computeSessionStats } from "@/agentMode/ui/sessionStats";
import { useSessionUsage } from "@/agentMode/ui/hooks/useSessionUsage";
import { ContextRing } from "@/agentMode/ui/AgentContextMeter";
import {
  UsageStatPanel,
  UsageStatRow,
  NO_VALUE,
  usageTokensLabel,
} from "@/agentMode/ui/UsageStatPanel";
import { formatSecondsFromMs, formatTokenCount } from "@/agentMode/ui/usageFormat";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";
import { Activity, Coins } from "lucide-react";
import React, { useMemo } from "react";

const capsuleClass =
  "tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-2.5 tw-py-0.5 tw-text-ui-smaller tw-text-muted hover:tw-text-normal focus-visible:tw-text-normal";

// 输入框下方的两个居中用量胶囊：左「轮数/步数/输出速度」，右「token 总量/缓存命中」，点击在上方弹出明细。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/11
export const AgentSessionStatsDock: React.FC<{
  backend: AgentChatBackend;
  messages: readonly AgentChatMessage[];
}> = ({ backend, messages }) => {
  const stats = useMemo(() => computeSessionStats(messages), [messages]);
  const usage = useSessionUsage(backend);
  if (!stats) return null;

  const contextWindow =
    typeof usage?.contextWindow === "number" && usage.contextWindow > 0
      ? usage.contextWindow
      : null;
  const usedTokens = usage?.usedTokens ?? 0;
  const contextFraction =
    contextWindow !== null ? Math.min(1, Math.max(0, usedTokens / contextWindow)) : 0;

  return (
    <div
      className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-px-3 tw-py-1"
      data-agent-session-stats
    >
      <Popover>
        <PopoverTrigger
          className={capsuleClass}
          aria-label={t("agentChat.usage.sessionPopupTitle")}
          data-session-stats-activity
        >
          <Activity className="tw-size-3" />
          <span className="tw-tabular-nums">
            {t("agentChat.usage.rounds", { n: stats.rounds })} ·{" "}
            {t("agentChat.usage.steps", { n: stats.steps })} ·{" "}
            {stats.tokensPerSecond !== null
              ? t("agentChat.usage.tokPerSec", {
                  n: Math.round(stats.tokensPerSecond).toLocaleString(),
                })
              : NO_VALUE}
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" className="tw-w-72">
          <UsageStatPanel title={t("agentChat.usage.sessionPopupTitle")}>
            <UsageStatRow
              label={t("agentChat.usage.modelTime")}
              value={
                stats.modelDurationMs !== null
                  ? formatSecondsFromMs(stats.modelDurationMs)
                  : NO_VALUE
              }
            />
            <UsageStatRow
              label={t("agentChat.usage.toolTime")}
              value={
                stats.toolDurationMs !== null ? formatSecondsFromMs(stats.toolDurationMs) : NO_VALUE
              }
            />
            <UsageStatRow
              label={t("agentChat.usage.ttftAvg")}
              value={stats.ttftMs !== null ? formatSecondsFromMs(stats.ttftMs) : NO_VALUE}
            />
            <UsageStatRow
              label={t("agentChat.usage.outputSpeed")}
              value={
                stats.tokensPerSecond !== null
                  ? t("agentChat.usage.tokPerSec", {
                      n: Math.round(stats.tokensPerSecond).toLocaleString(),
                    })
                  : NO_VALUE
              }
            />
          </UsageStatPanel>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger
          className={capsuleClass}
          aria-label={t("agentChat.usage.tokenPopupTitle")}
          data-session-stats-usage
        >
          <Coins className="tw-size-3" />
          <span className="tw-tabular-nums">
            {formatTokenCount(stats.totalTokens)} tok
            {stats.cacheHit !== null
              ? ` · ${t("agentChat.usage.cacheHitShort", { pct: stats.cacheHit })}`
              : ""}
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" className="tw-w-72">
          <UsageStatPanel
            title={t("agentChat.usage.tokenPopupTitle")}
            totalLabel={usageTokensLabel(stats.totalTokens)}
          >
            <UsageStatRow
              label={t("agentChat.usage.cacheHit")}
              value={stats.cacheHit !== null ? `${stats.cacheHit}%` : NO_VALUE}
            />
            <UsageStatRow
              label={t("agentChat.usage.uncachedInput")}
              value={usageTokensLabel(stats.inputTokens)}
            />
            <UsageStatRow
              label={t("agentChat.usage.cacheRead")}
              value={usageTokensLabel(stats.cacheReadTokens)}
            />
            <UsageStatRow
              label={t("agentChat.usage.output")}
              value={usageTokensLabel(stats.outputTokens)}
            />
            {usage !== null ? (
              <UsageStatRow
                label={t("agentChat.contextMeter.contextWindow")}
                value={
                  <span className="tw-inline-flex tw-items-center tw-gap-1.5">
                    {contextWindow !== null ? <ContextRing fraction={contextFraction} /> : null}
                    {contextWindow !== null
                      ? `${formatTokenCount(usedTokens)} / ${formatTokenCount(contextWindow)} (${Math.round(contextFraction * 100)}%)`
                      : formatTokenCount(usedTokens)}
                  </span>
                }
              />
            ) : null}
          </UsageStatPanel>
        </PopoverContent>
      </Popover>
    </div>
  );
};
