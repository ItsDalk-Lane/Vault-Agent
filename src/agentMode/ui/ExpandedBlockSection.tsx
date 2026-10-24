import { CopyButton } from "@/components/chat-components/CopyButton";
import { cn } from "@/lib/utils";
import React from "react";

/** 完整 JSON 文本美化展示，普通文本与残缺 JSON 原样返回。https://github.com/ItsDalk-Lane/Vault-Agent/issues/10 */
export function prettyIfJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

interface ExpandedBlockSectionProps {
  label: string;
  text?: string;
  copyText?: string;
  panelClassName?: string;
  children?: React.ReactNode;
}

// 块展开体的统一分段面板：标签头 + 复制按钮 + 等宽内容面板，子节点可替换面板体（如差异行）。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/10
export const ExpandedBlockSection: React.FC<ExpandedBlockSectionProps> = ({
  label,
  text,
  copyText,
  panelClassName,
  children,
}) => {
  const copyValue = copyText ?? text;
  return (
    <section
      className="tw-flex tw-min-w-0 tw-flex-col tw-gap-0.5"
      data-expanded-block-section={label}
    >
      <header className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <span className="tw-min-w-0 tw-truncate tw-font-mono tw-text-xs tw-text-muted">
          {label}
        </span>
        {copyValue !== undefined ? <CopyButton text={copyValue} /> : null}
      </header>
      {children ?? (
        <pre
          className={cn(
            "tw-max-h-60 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary-alt tw-p-2 tw-font-mono tw-text-xs",
            panelClassName
          )}
        >
          {text}
        </pre>
      )}
    </section>
  );
};
