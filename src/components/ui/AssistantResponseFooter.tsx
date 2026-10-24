import React from "react";

export interface AssistantResponseFooterProps {
  leading?: React.ReactNode;
  timestamp?: React.ReactNode;
  /** 紧随时间戳右侧的元素（如每轮用量胶囊）。https://github.com/ItsDalk-Lane/Vault-Agent/issues/14 */
  afterTimestamp?: React.ReactNode;
  actions?: React.ReactNode;
}

export const AssistantResponseFooter: React.FC<AssistantResponseFooterProps> = ({
  leading,
  timestamp,
  afterTimestamp,
  actions,
}) => {
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  // 时长与时间戳同排展示，不再互斥。https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
  const hasTimestamp = timestamp !== undefined && timestamp !== null && timestamp !== false;
  const hasAfterTimestamp =
    afterTimestamp !== undefined && afterTimestamp !== null && afterTimestamp !== false;
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  const hasMetadata = hasLeading || hasTimestamp || hasAfterTimestamp;

  return (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-2">
      {hasMetadata ? (
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-overflow-hidden">
          {hasLeading ? (
            <div data-response-footer-leading className="tw-shrink-0">
              {leading}
            </div>
          ) : null}
          {hasTimestamp ? (
            <div className="tw-truncate tw-text-xs tw-text-faint">{timestamp}</div>
          ) : null}
          {hasAfterTimestamp ? (
            <div data-response-footer-after-timestamp className="tw-shrink-0">
              {afterTimestamp}
            </div>
          ) : null}
        </div>
      ) : null}
      {hasActions ? (
        <div data-response-footer-actions className="tw-ml-auto tw-shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
};
