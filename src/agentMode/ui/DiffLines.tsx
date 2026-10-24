import { diffLines } from "@/agentMode/ui/diffRender";
import { cn } from "@/lib/utils";
import React from "react";

interface DiffLinesProps {
  oldText: string | null;
  newText: string;
}

// 展开体里的差异用行级染色呈现（旧红新绿），与 RenderedDiff 的代码差异视图同一视觉语言。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/10
export const DiffLines: React.FC<DiffLinesProps> = ({ oldText, newText }) => (
  <pre className="tw-max-h-60 tw-overflow-auto tw-whitespace-pre-wrap tw-rounded tw-bg-secondary-alt tw-p-2 tw-font-mono tw-text-xs">
    {diffLines(oldText, newText).map((line, index) => (
      <div
        // eslint-disable-next-line @eslint-react/no-array-index-key -- 行序是逐行差异唯一的身份标识
        key={index}
        data-change={line.change}
        className={cn(
          line.change === "deleted" && "tw-bg-error",
          line.change === "inserted" && "tw-bg-success"
        )}
      >
        {line.text}
      </div>
    ))}
  </pre>
);
