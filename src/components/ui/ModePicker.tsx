import React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { VaultAgentMode } from "@/agentMode";
import { cn } from "@/lib/utils";

export interface ModePickerOverride {
  options: { label: string; value: VaultAgentMode }[];
  value: VaultAgentMode | null;
  onChange: (value: VaultAgentMode) => void;
  disabled?: boolean;
}

interface ModePickerProps {
  override: ModePickerOverride;
  className?: string;
}

function getModeLabel(value: VaultAgentMode): string {
  if (value === "auto") return t("ui.model.mode.auto");
  if (value === "plan") return t("ui.model.mode.plan");
  if (value === "default") return t("ui.model.mode.safe");
  return value;
}

function getModeDescription(value: VaultAgentMode): string | undefined {
  if (value === "auto") return t("ui.model.mode.autoDesc");
  if (value === "plan") return t("ui.model.mode.planDesc");
  if (value === "default") return t("ui.model.mode.safeDesc");
  return undefined;
}

export function ModePicker({ override, className }: ModePickerProps) {
  const { options, value, onChange, disabled } = override;
  const triggerLabel = value ? getModeLabel(value) : t("ui.model.mode.trigger");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost2"
          size="sm"
          disabled={disabled}
          className={cn(
            "tw-shrink-0 tw-text-muted",
            value === "plan" &&
              "tw-text-blue/70 hover:tw-text-blue/100 focus-visible:tw-text-blue/100",
            value === "auto" &&
              "tw-text-red/70 hover:tw-text-red/100 focus-visible:tw-text-red/100",
            className
          )}
          title={t("ui.model.mode.title")}
        >
          <span className="tw-truncate">{triggerLabel}</span>
          {!disabled && <ChevronDown className="tw-mt-0.5 tw-size-4 tw-shrink-0" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="tw-w-[320px]">
        {options.map((opt) => {
          const displayLabel = getModeLabel(opt.value) || opt.label;
          const displayDescription = getModeDescription(opt.value);
          const isActive = value === opt.value;
          return (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => onChange(opt.value)}
              className="tw-items-start tw-gap-2 tw-py-2"
            >
              <div className="tw-mt-0.5 tw-w-3 tw-shrink-0">
                {isActive && <Check className="tw-size-3 tw-text-muted" />}
              </div>
              <div className="tw-flex tw-flex-col tw-gap-0.5">
                <span className="tw-text-sm tw-font-medium tw-text-normal">{displayLabel}</span>
                {displayDescription && (
                  <span className="tw-text-xs tw-leading-snug tw-text-muted">
                    {displayDescription}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
