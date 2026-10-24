import React from "react";
import type { App } from "obsidian";
import type { AgentChatMessage, AgentMessagePart } from "@/agentMode/session/types";
import { ReactModal } from "@/components/modals/ReactModal";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { SubagentHistoryOpenerContext } from "@/agentMode/ui/SubAgentCard";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import { TooltipProvider } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { logError } from "@/logger";

export interface SubagentHistoryProps {
  readonly messages: readonly AgentChatMessage[];
  readonly app: App;
}

const EMPTY_MESSAGE_PARTS: AgentMessagePart[] = [];
Object.freeze(EMPTY_MESSAGE_PARTS);

export function SubagentHistory({ messages, app }: SubagentHistoryProps) {
  const visible = messages.filter((message) => message.isVisible);
  return (
    <TooltipProvider>
      <div className="tw-flex tw-max-h-96 tw-flex-col tw-gap-3 tw-overflow-y-auto">
        <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
          {t("agentChat.subAgent.historyReadonly")}
        </p>
        {visible.length ? (
          visible.map((message) => (
            <div key={message.id} className="tw-flex tw-flex-col tw-gap-1">
              <div className="tw-text-sm tw-font-medium">
                {message.sender === "user"
                  ? t("agentChat.subAgent.historyRequest")
                  : t("agentChat.subAgent.historyResponse")}
              </div>
              {message.sender !== "user" &&
              (message.parts?.length || message.fileChanges?.length) ? (
                <AgentTrail
                  app={app}
                  parts={message.parts ?? EMPTY_MESSAGE_PARTS}
                  isStreaming={false}
                  showMessageActions={false}
                  turnStopReason={message.turnStopReason}
                  turnDurationMs={message.turnDurationMs}
                  fileChanges={message.fileChanges}
                  onOpenFileChange={(change) => {
                    void openTurnDiff(app, change, message.id).catch((error: unknown) =>
                      logError("[SubagentHistory] failed to open saved diff", error)
                    );
                  }}
                />
              ) : (
                <AgentMarkdownText app={app} text={message.message} />
              )}
            </div>
          ))
        ) : (
          <p className="tw-m-0 tw-text-sm tw-text-muted">{t("agentChat.subAgent.historyEmpty")}</p>
        )}
      </div>
    </TooltipProvider>
  );
}

export class SubagentHistoryModal extends ReactModal {
  constructor(
    app: App,
    private readonly messages: readonly AgentChatMessage[],
    private readonly openHistory?: (conversationId: string) => Promise<void>
  ) {
    super(app, t("agentChat.subAgent.historyTitle"));
  }

  protected renderContent(): React.ReactElement {
    return (
      <SubagentHistoryOpenerContext.Provider value={this.openHistory ?? null}>
        <SubagentHistory app={this.app} messages={this.messages} />
      </SubagentHistoryOpenerContext.Provider>
    );
  }
}
