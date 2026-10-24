import { TurnUsageCapsule } from "@/agentMode/ui/TurnUsageCapsule";
import type { TurnUsageSummary } from "@/agentMode/session/types";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { MessageActionButton } from "@/components/chat-components/MessageActionButton";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { insertAtCursor } from "@/utils";
import { GitBranch, TextCursorInput } from "lucide-react";
import { App, Platform } from "obsidian";
import React from "react";

interface AgentMessageActionsProps {
  text: string;
  app: App;
  timestamp?: string;
  /** 本轮用量胶囊，紧随时间戳右侧；完成态用时移入过程折叠块标题。https://github.com/ItsDalk-Lane/Vault-Agent/issues/14 */
  turnUsage?: TurnUsageSummary;
  /** 逐轮分支动作，存在即渲染分支按钮。https://github.com/ItsDalk-Lane/Vault-Agent/issues/12 */
  onForkTurn?: () => void;
  forkDisabled?: boolean;
}

export const AgentMessageActions: React.FC<AgentMessageActionsProps> = ({
  text,
  app,
  timestamp,
  turnUsage,
  onForkTurn,
  forkDisabled,
}) => (
  <AssistantResponseFooter
    afterTimestamp={turnUsage ? <TurnUsageCapsule usage={turnUsage} /> : undefined}
    timestamp={timestamp}
    actions={
      <div
        className={cn("tw-flex tw-items-center tw-gap-1", {
          "group-hover:opacity-100 opacity-0": !Platform.isMobile,
        })}
      >
        {onForkTurn ? (
          <MessageActionButton
            label={t("agentChat.messageActions.branch")}
            icon={GitBranch}
            disabled={forkDisabled}
            onClick={onForkTurn}
          />
        ) : null}
        <MessageActionButton
          label={t("agentChat.messageActions.insertAtCursor")}
          icon={TextCursorInput}
          onClick={() => void insertAtCursor(app, text)}
        />
        <CopyButton text={text} />
      </div>
    }
  />
);
