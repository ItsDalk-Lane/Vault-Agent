import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { formatWorkedDuration } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { t } from "@/i18n";
import { Workflow } from "lucide-react";
import React, { useState } from "react";

interface TurnActivityFoldProps {
  durationMs?: number;
  toolCount: number;
  /** 组件库展示用默认展开；产品内保持默认折叠。https://github.com/ItsDalk-Lane/Vault-Agent/issues/14 */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

// 完成轮的过程块（思考/工具/子代理）折叠为一块，标题显示本轮用时与工具调用总次数，
// 位于回复正文之前；展开按时间序显示原过程块。https://github.com/ItsDalk-Lane/Vault-Agent/issues/14
export const TurnActivityFold: React.FC<TurnActivityFoldProps> = ({
  durationMs,
  toolCount,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <AgentActivityCard
      icon={Workflow}
      label={
        <span className="tw-truncate">
          {durationMs !== undefined ? (
            <>
              {t("agentChat.turnDuration.workedFor")}{" "}
              <span className="tw-tabular-nums">{formatWorkedDuration(durationMs)}</span>
              {" · "}
            </>
          ) : null}
          {t("agentChat.turnSummary.toolCalls", { n: toolCount })}
        </span>
      }
      expandable
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      {children}
    </AgentActivityCard>
  );
};
