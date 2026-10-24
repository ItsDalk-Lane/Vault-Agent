import type { QueuedAgentMessage } from "@/agentMode/session/AgentInputDraftStore";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { Clock, CornerDownLeft, Pencil, Trash2 } from "lucide-react";
import React from "react";

interface QueuedMessageListProps {
  messages: QueuedAgentMessage[];
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onInsert: (id: string) => void;
  canInsert: (message: QueuedAgentMessage) => boolean;
  pendingInsertId?: string | null;
}

export const QueuedMessageList: React.FC<QueuedMessageListProps> = ({
  messages,
  onRemove,
  onEdit,
  onInsert,
  canInsert,
  pendingInsertId,
}) => {
  // Image-only turns need a visible queue label after the composer clears.
  // https://github.com/logancyang/obsidian-copilot/issues/2850
  return (
    <div className="tw-flex tw-max-h-32 tw-flex-col tw-gap-1 tw-overflow-y-auto tw-px-2 tw-pb-1">
      {messages.map((m) => {
        const label =
          m.text ||
          (m.promptContent?.some((block) => block.type === "image")
            ? t("agentChat.queuedMessage.imageAttachment")
            : t("agentChat.queuedMessage.emptyMessage"));
        const insertable = canInsert(m);
        const busy = pendingInsertId != null;
        return (
          <div
            key={m.id}
            className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-rounded-md tw-bg-secondary-alt tw-px-2 tw-py-1 tw-text-ui-smaller"
            title={label}
          >
            <Clock className="tw-size-3 tw-shrink-0 tw-text-muted" />
            <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-whitespace-nowrap tw-text-normal">
              {label}
            </span>
            <Button
              variant="ghost2"
              size="fit"
              className="tw-shrink-0 tw-text-muted"
              disabled={busy}
              onClick={() => onEdit(m.id)}
              aria-label={t("agentChat.queuedMessage.edit")}
            >
              <Pencil className="tw-size-3" />
            </Button>
            <Button
              variant="ghost2"
              size="fit"
              className="tw-shrink-0 tw-text-muted hover:tw-text-error"
              disabled={busy}
              onClick={() => onRemove(m.id)}
              aria-label={t("agentChat.queuedMessage.remove")}
            >
              <Trash2 className="tw-size-3" />
            </Button>
            <Button
              variant="ghost2"
              size="fit"
              className="tw-shrink-0 tw-text-muted"
              // 队列的即时插入只对能进当前轮次的消息开放，其余保持自动发送。
              // https://github.com/ItsDalk-Lane/Vault-Agent/issues/16
              disabled={busy || !insertable}
              onClick={() => onInsert(m.id)}
              aria-label={t("agentChat.queuedMessage.insert")}
              title={insertable ? undefined : t("agentChat.queuedMessage.insertUnavailable")}
            >
              <CornerDownLeft className="tw-size-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
};
