import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TurnUsageSummary } from "@/agentMode/session/types";
import {
  UsageStatPanel,
  UsageStatRow,
  NO_VALUE,
  usageTokensLabel,
} from "@/agentMode/ui/UsageStatPanel";
import { cacheHitPercent, formatTokenCount, turnDisplayTokens } from "@/agentMode/ui/usageFormat";
import { t } from "@/i18n";
import { Coins } from "lucide-react";
import React from "react";

// 每轮底部的用量胶囊：平时只显示本轮 token 总量，点击在上方弹出明细。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/11
export const TurnUsageCapsule: React.FC<{ usage: TurnUsageSummary }> = ({ usage }) => {
  const total = turnDisplayTokens(usage);
  const hit = cacheHitPercent(usage.inputTokens, usage.cacheReadTokens);
  return (
    <Popover>
      <PopoverTrigger
        className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-2 tw-py-0.5 tw-text-ui-smaller tw-text-muted hover:tw-text-normal focus-visible:tw-text-normal"
        aria-label={t("agentChat.usage.turnCapsuleLabel")}
        data-turn-usage-capsule={total}
      >
        <Coins className="tw-size-3" />
        <span className="tw-tabular-nums">{formatTokenCount(total)} tok</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="tw-w-72">
        <UsageStatPanel
          title={t("agentChat.usage.turnPopupTitle")}
          totalLabel={usageTokensLabel(total)}
        >
          <UsageStatRow label={t("agentChat.usage.model")} value={usage.modelId ?? NO_VALUE} />
          <UsageStatRow
            label={t("agentChat.usage.cacheHit")}
            value={hit === null ? NO_VALUE : `${hit}%`}
          />
          <UsageStatRow
            label={t("agentChat.usage.uncachedInput")}
            value={usageTokensLabel(usage.inputTokens)}
          />
          <UsageStatRow
            label={t("agentChat.usage.cacheRead")}
            value={usageTokensLabel(usage.cacheReadTokens)}
          />
          <UsageStatRow
            label={t("agentChat.usage.output")}
            value={usageTokensLabel(usage.outputTokens)}
          />
        </UsageStatPanel>
      </PopoverContent>
    </Popover>
  );
};
