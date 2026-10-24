import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { formatDuration } from "@/lib/duration";
import { ReasoningStatus } from "@/LLMProviders/chainRunner/utils/AgentReasoningState";
import { Brain } from "lucide-react";
import React, { useState } from "react";
import { t } from "@/i18n";

interface AgentReasoningBlockProps {
  status: ReasoningStatus;
  elapsedSeconds: number;
  steps: string[];
  /** text 渲染为连续紧凑文本面板（deepseek-harness 风格），steps 保持分步列表。https://github.com/ItsDalk-Lane/Vault-Agent/issues/10 */
  layout?: "steps" | "text";
}

export const AgentReasoningBlock: React.FC<AgentReasoningBlockProps> = ({
  status,
  elapsedSeconds,
  steps,
  layout = "steps",
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [prevStatus, setPrevStatus] = useState(status);

  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "collapsed" || status === "complete") {
      setIsExpanded(false);
    }
  }

  if (status === "idle") {
    return null;
  }

  const isActive = status === "reasoning";
  const canExpand = steps.length > 0;

  return (
    <AgentActivityCard
      icon={Brain}
      label={
        <>
          <span>
            {isActive ? (
              <>
                {t("ui.chat.reasoning")}
                <span className="vault-agent-shimmer-text" aria-hidden="true">
                  ...
                </span>
              </>
            ) : (
              t("ui.chat.thoughtFor")
            )}
          </span>
          {!isActive ? (
            <span className="tw-font-normal">{formatDuration(elapsedSeconds * 1000)}</span>
          ) : null}
        </>
      }
      expandable={canExpand}
      open={isExpanded}
      onToggle={() => setIsExpanded((expanded) => !expanded)}
    >
      {layout === "text" ? (
        <pre className="tw-max-h-96 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary-alt tw-p-2 tw-text-xs tw-leading-normal tw-text-muted">
          {steps.join("\n\n")}
        </pre>
      ) : (
        <ul className="tw-list-outside tw-list-disc tw-space-y-1.5 tw-pl-4 max-md:tw-space-y-1">
          {steps.map((step, i) => (
            // eslint-disable-next-line @eslint-react/no-array-index-key -- steps are append-only with no stable id; text may repeat
            <li key={i} className="tw-text-xs tw-leading-[1.4] tw-text-muted">
              {step}
            </li>
          ))}
        </ul>
      )}
    </AgentActivityCard>
  );
};
