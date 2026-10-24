import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle } from "lucide-react";
import React from "react";

type AgentStatusTone = "neutral" | "warning" | "error";

interface AgentStatusButtonAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  href?: never;
}

interface AgentStatusCardProps {
  message: string;
  summary?: string;
  tone?: AgentStatusTone;
  action?: AgentStatusButtonAction;
  layout?: "stack" | "row";
}

export const AgentStatusCard: React.FC<AgentStatusCardProps> = ({
  message,
  summary,
  tone = "neutral",
  action,
  layout = "stack",
}) => (
  <Card
    className={cn(
      "tw-flex tw-w-full tw-gap-2 tw-rounded-md tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs tw-shadow-none",
      layout === "row"
        ? "tw-flex-row tw-items-center tw-justify-between"
        : "tw-flex-col tw-items-start",
      tone === "warning" && "tw-bg-callout-warning/20 tw-border-warning/40",
      tone === "error" && "tw-border-error/50"
    )}
    role={tone === "neutral" ? undefined : "alert"}
  >
    <span
      className={cn(
        "tw-flex tw-min-w-0 tw-gap-2",
        layout === "row" ? "tw-flex-1 tw-items-center" : "tw-w-full tw-items-start"
      )}
    >
      {tone === "warning" && (
        <AlertTriangle aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-warning" />
      )}
      {tone === "error" && (
        <AlertCircle aria-hidden="true" className="tw-size-4 tw-shrink-0 tw-text-error" />
      )}
      <span
        className={cn(
          "tw-min-w-0 tw-select-text tw-break-words tw-text-normal [overflow-wrap:anywhere]",
          summary && "tw-font-medium"
        )}
      >
        {summary ?? message}
      </span>
    </span>
    {summary && (
      <p className="tw-m-0 tw-w-full tw-select-text tw-whitespace-pre-wrap tw-text-normal [overflow-wrap:anywhere]">
        {message}
      </p>
    )}
    {action && (
      <Button
        className={cn(
          "tw-h-auto tw-min-h-6 tw-max-w-full tw-whitespace-normal tw-break-words tw-border tw-border-solid tw-border-border tw-py-1 disabled:tw-opacity-100",
          layout === "row" && "tw-shrink-0"
        )}
        variant={tone === "error" ? "ghost" : "secondary"}
        size="sm"
        disabled={action.disabled}
        onClick={action.onClick}
      >
        {action.label}
      </Button>
    )}
  </Card>
);
