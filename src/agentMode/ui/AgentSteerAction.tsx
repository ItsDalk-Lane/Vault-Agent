import React from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export interface AgentSteerActionProps {
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly onSubmit: () => void;
}

export function AgentSteerAction({ disabled, pending, onSubmit }: AgentSteerActionProps) {
  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-px-2 tw-pb-2">
      <span className="tw-text-xs tw-text-muted">{t("agentChat.steer.textOnly")}</span>
      <Button variant="ghost" size="sm" disabled={disabled || pending} onClick={onSubmit}>
        {t(pending ? "agentChat.steer.pending" : "agentChat.steer.submit")}
      </Button>
    </div>
  );
}
