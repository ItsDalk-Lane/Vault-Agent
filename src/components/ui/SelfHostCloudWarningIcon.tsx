import { cn } from "@/lib/utils";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AlertTriangle } from "lucide-react";
import React from "react";
import { t } from "@/i18n";

export function SelfHostCloudWarningIcon({
  className,
  stopPropagation = true,
}: {
  className?: string;
  stopPropagation?: boolean;
}) {
  return (
    <span
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-warning", className)}
    >
      <HelpTooltip content={t("ui.model.selfHostWarning")} side="top" delayDuration={0}>
        <AlertTriangle className="tw-size-3.5" />
      </HelpTooltip>
    </span>
  );
}
