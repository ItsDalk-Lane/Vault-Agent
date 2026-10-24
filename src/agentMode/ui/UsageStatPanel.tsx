import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import React from "react";

// 用量弹窗的共享面板与行样式：标题行（左标题右总量）+ 标签/数值行。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/11
export const UsageStatRow: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-smaller">
    <span className="tw-whitespace-nowrap tw-text-muted">{label}</span>
    <span className="tw-whitespace-nowrap tw-tabular-nums">{value}</span>
  </div>
);

interface UsageStatPanelProps {
  title: string;
  totalLabel?: string;
  children: React.ReactNode;
  className?: string;
}

export const UsageStatPanel: React.FC<UsageStatPanelProps> = ({
  title,
  totalLabel,
  children,
  className,
}) => (
  <div className={cn("tw-flex tw-flex-col tw-gap-2", className)}>
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
      <span className="tw-text-sm tw-font-medium">{title}</span>
      {totalLabel ? (
        <span className="tw-whitespace-nowrap tw-text-sm tw-font-medium tw-tabular-nums">
          {totalLabel}
        </span>
      ) : null}
    </div>
    <div className="tw-flex tw-flex-col tw-gap-1.5">{children}</div>
  </div>
);

export const NO_VALUE = "—";

export function usageTokensLabel(count: number): string {
  return t("agentChat.usage.tokensUnit", { n: count.toLocaleString() });
}
