import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { LayoutGrid } from "lucide-react";
import React from "react";

interface EmptyPlaceholderProps {
  folder: string;
}

export const EmptyPlaceholder: React.FC<EmptyPlaceholderProps> = ({ folder }) => {
  return (
    <div
      className={cn(
        "tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-2",
        "tw-min-h-[320px] tw-rounded-md tw-border tw-border-dashed tw-border-border",
        "tw-p-12 tw-text-faint"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-items-center tw-justify-center",
          "tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-3"
        )}
      >
        <LayoutGrid className="tw-size-6 tw-text-faint" aria-hidden="true" />
      </div>
      <div className="tw-text-smaller tw-font-medium tw-text-muted">
        {t("agentInfra.skills.empty.title")}
      </div>
      <div className="tw-max-w-[420px] tw-text-center tw-text-ui-smaller tw-text-faint">
        {t("agentInfra.skills.empty.bodyPrefix")}
        <code>.claude/skills/</code>
        {t("agentInfra.skills.empty.middle")}
        <code>.agents/skills/</code>
        {t("agentInfra.skills.empty.or")}
        <code>.opencode/skills/</code>
        {t("agentInfra.skills.empty.suffix")}
      </div>
      <div className="tw-mt-3.5 tw-font-mono tw-text-smallest tw-text-faint">
        {t("agentInfra.skills.empty.footer")} <code>&lt;vault&gt;/{folder}/</code>
      </div>
    </div>
  );
};
