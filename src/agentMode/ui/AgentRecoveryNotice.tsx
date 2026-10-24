import { canSendFollowUpDuringRecovery } from "@/agentMode/session/RecoveryPolicy";
import type { RecoveryStateUpdate } from "@/agentMode/session/types";
import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import React, { useState } from "react";

export interface AgentRecoveryNoticeProps {
  recovery: RecoveryStateUpdate;
  children?: React.ReactNode;
  onRollover?: () => void;
  onRecover: (action: "continue" | "abort" | "reconcile") => Promise<void>;
}

export const AgentRecoveryNotice: React.FC<AgentRecoveryNoticeProps> = ({
  recovery,
  onRecover,
  children,
}) => {
  const [operation, setOperation] = useState<"continue" | "abort" | "reconcile" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (recovery.status === "none") return null;
  const canRecover =
    recovery.status === "available" ||
    recovery.status === "interrupted" ||
    (recovery.status === "read_only" && recovery.crashLoopTripped);
  const canReconcile =
    recovery.status !== "storage_failed" && recovery.pendingMutationIds.length > 0;
  const canReload = recovery.status === "read_only" && recovery.reloadAvailable === true;
  const recover = async (action: "continue" | "abort" | "reconcile") => {
    if (operation) return;
    setOperation(action);
    setError(null);
    try {
      await onRecover(action);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setOperation(null);
    }
  };
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <AgentStatusCard tone="warning" message={recovery.message ?? t("controls.recoveryPending")} />
      {!canRecover && recovery.status !== "pausing" && (
        <p className="tw-m-0 tw-text-muted">{t("controls.recoveryReadOnly")}</p>
      )}
      {error && <AgentStatusCard tone="error" message={error} />}
      {canReload && (
        <Button
          variant="secondary"
          size="sm"
          disabled={operation !== null}
          onClick={() => void recover("reconcile")}
        >
          {t("controls.recoveryReload")}
        </Button>
      )}
      {canReconcile && (
        <Button
          variant="secondary"
          size="sm"
          disabled={operation !== null}
          onClick={() => void recover("reconcile")}
        >
          {t("controls.recoveryReconcile")}
        </Button>
      )}
      {(canRecover || canReconcile) && (
        <div className="tw-flex tw-flex-wrap tw-gap-2">
          {canRecover && !canReconcile && (
            <Button
              variant="secondary"
              size="sm"
              disabled={operation !== null}
              onClick={() => void recover("continue")}
            >
              {t("controls.recoveryContinue")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={operation !== null}
            onClick={() => void recover("abort")}
          >
            {t("controls.recoveryAbort")}
          </Button>
        </div>
      )}
      {canSendFollowUpDuringRecovery(recovery) && children}
    </div>
  );
};
