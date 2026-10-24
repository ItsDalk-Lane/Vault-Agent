import React, { useState } from "react";
import { FileDiff, FileText } from "lucide-react";
import { t } from "@/i18n";
import type { TurnFileChange, FileChangeRevertResult } from "@/agentMode/session/types";
import { FileChangeCounts, FileChangeStatusBadge } from "@/agentMode/ui/FileChangeSummary";
import { Button } from "@/components/ui/button";

export interface FilesChangedCardProps {
  changes: TurnFileChange[];
  onOpen: (change: TurnFileChange) => void;
  onRevert?: (change: TurnFileChange) => Promise<FileChangeRevertResult>;
  isBusy?: boolean;
}

export const FilesChangedCard: React.FC<FilesChangedCardProps> = ({
  changes,
  onOpen,
  onRevert,
  isBusy,
}) => {
  const rows = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  const additions = rows.reduce((sum, row) => sum + row.additions, 0);
  const deletions = rows.reduce((sum, row) => sum + row.deletions, 0);

  return (
    <div className="tw-my-1 tw-w-full tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary">
      {/* A one-file turn needs no count header above its single row: https://github.com/Brevilabs/obsidian-copilot-private/issues/348 */}
      {rows.length > 1 ? (
        <div className="vault-agent-divider-b tw-flex tw-items-center tw-gap-1.5 tw-px-3 tw-py-2">
          <FileDiff className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-medium">
            {t("agentChat.fileChange.filesChanged", { count: rows.length })}
          </span>
          <FileChangeCounts additions={additions} deletions={deletions} />
        </div>
      ) : null}
      <ul className="tw-m-0 tw-max-h-64 tw-list-none tw-overflow-y-auto tw-p-0">
        {rows.map((row) => (
          <li key={row.path}>
            <FileRow change={row} onOpen={onOpen} onRevert={onRevert} isBusy={isBusy} />
          </li>
        ))}
      </ul>
    </div>
  );
};

interface FileRowProps {
  change: TurnFileChange;
  onOpen: (change: TurnFileChange) => void;
  onRevert?: FilesChangedCardProps["onRevert"];
  isBusy?: boolean;
}

const FileRow: React.FC<FileRowProps> = ({ change, onOpen, onRevert, isBusy }) => {
  const [reverting, setReverting] = useState(false);
  const [result, setResult] = useState<FileChangeRevertResult | null>(null);
  const handleRevert = async () => {
    if (!onRevert || reverting || isBusy || result?.ok) return;
    setReverting(true);
    setResult(null);
    try {
      setResult(await onRevert(change));
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : t("agentChat.fileChange.revertFailed"),
      });
    } finally {
      setReverting(false);
    }
  };
  const separator = change.path.lastIndexOf("/");
  const basename = separator === -1 ? change.path : change.path.slice(separator + 1);
  const folder = separator === -1 ? null : change.path.slice(0, separator);

  return (
    <div>
      <div className="tw-flex tw-items-center tw-gap-1 tw-pr-2">
        <button
          type="button"
          title={change.path}
          onClick={() => onOpen(change)}
          className="tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-cursor-pointer tw-flex-col tw-gap-0.5 !tw-rounded-none tw-border-none !tw-bg-transparent tw-px-3 tw-py-1.5 tw-text-left tw-text-normal !tw-shadow-none hover:!tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
        >
          <span className="tw-flex tw-w-full tw-items-center tw-gap-1.5">
            <FileText className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
            <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm">{basename}</span>
            <FileChangeStatusBadge status={change.status} />
            <FileChangeCounts additions={change.additions} deletions={change.deletions} />
          </span>
          {folder ? (
            <span className="tw-w-full tw-truncate tw-pl-5 tw-text-xs tw-text-muted">{folder}</span>
          ) : null}
        </button>
        {onRevert && change.mutationOperationIds?.length ? (
          <Button
            variant="ghost2"
            size="sm"
            className="tw-shrink-0"
            disabled={isBusy || reverting || result?.ok === true}
            onClick={() => void handleRevert()}
          >
            {reverting
              ? t("agentChat.fileChange.reverting")
              : result?.ok
                ? t("agentChat.fileChange.reverted")
                : t("agentChat.fileChange.revert")}
          </Button>
        ) : null}
      </div>
      {result && !result.ok ? (
        <p role="alert" className="tw-m-0 tw-break-words tw-px-3 tw-pb-2 tw-text-xs tw-text-error">
          {result.code === "CONFLICT"
            ? t("agentChat.fileChange.revertConflict")
            : result.code === "PARTIAL"
              ? t("agentChat.fileChange.revertPartial")
              : result.code === "EFFECT_UNKNOWN"
                ? t("agentChat.fileChange.revertUnknown")
                : result.code === "CANCELLED" || result.code === "PERMISSION_DENIED"
                  ? t("agentChat.fileChange.revertCancelled")
                  : result.message || t("agentChat.fileChange.revertFailed")}
        </p>
      ) : null}
    </div>
  );
};
