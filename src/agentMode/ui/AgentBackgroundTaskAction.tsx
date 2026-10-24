import React from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export interface AgentBackgroundTaskActionProps {
  readonly count: number;
  readonly pending?: boolean;
  readonly onStop: () => void;
}

export function AgentBackgroundTaskAction({
  count,
  pending,
  onStop,
}: AgentBackgroundTaskActionProps) {
  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-px-2 tw-pb-2">
      <span role="status" className="tw-text-xs tw-text-muted">
        {t("agentChat.background.running", { count })}
      </span>
      <Button variant="ghost" size="sm" disabled={pending} onClick={onStop}>
        {t(pending ? "agentChat.background.stopping" : "agentChat.background.stop")}
      </Button>
    </div>
  );
}
