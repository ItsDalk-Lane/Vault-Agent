import { cn } from "@/lib/utils";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AlertTriangle } from "lucide-react";
import React from "react";
import { t } from "@/i18n";

export function FreeModelWarningIcon({ className }: { className?: string }) {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-warning", className)}
    >
      <HelpTooltip content={t("ui.model.freeWarning")} side="top" delayDuration={0}>
        <AlertTriangle className="tw-size-3.5" />
      </HelpTooltip>
    </span>
  );
}
