import * as React from "react";
import { Platform } from "obsidian";
import { ArrowBigUp, Command, CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

type ActionState = "idle" | "loading" | "result";

const ICON_CLS = "tw-size-3";

const ReplaceShortcutHint = () =>
  Platform.isMacOS ? (
    <span className="tw-ml-1 tw-inline-flex tw-items-center tw-gap-0.5 tw-opacity-80">
      <Command className={ICON_CLS} />
      <CornerDownLeft className={ICON_CLS} />
    </span>
  ) : (
    <span className="tw-ml-1 tw-inline-flex tw-items-center tw-gap-0.5 tw-text-xs tw-opacity-80">
      Ctrl
      <CornerDownLeft className={ICON_CLS} />
    </span>
  );

const InsertShortcutHint = () =>
  Platform.isMacOS ? (
    <span className="tw-ml-1 tw-inline-flex tw-items-center tw-gap-0.5 tw-opacity-80">
      <Command className={ICON_CLS} />
      <ArrowBigUp className={ICON_CLS} />
      <CornerDownLeft className={ICON_CLS} />
    </span>
  ) : (
    <span className="tw-ml-1 tw-inline-flex tw-items-center tw-gap-0.5 tw-text-xs tw-opacity-80">
      Ctrl
      <ArrowBigUp className={ICON_CLS} />
      <CornerDownLeft className={ICON_CLS} />
    </span>
  );

interface ActionButtonsProps {
  state: ActionState;
  onStop?: () => void;
  onRunAgain?: () => void;
  onInsert?: () => void;
  onReplace?: () => void;
}

export function ActionButtons({
  state,
  onStop,
  onRunAgain,
  onInsert,
  onReplace,
}: ActionButtonsProps) {
  return (
    <div className="tw-flex tw-items-center tw-gap-2">
      {state === "loading" && (
        <Button variant="secondary" size="sm" onClick={onStop}>
          {t("ui.command.stop")}
        </Button>
      )}

      {state !== "loading" && onRunAgain && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onRunAgain}
          title={t("ui.command.runAgainTitle")}
        >
          {t("ui.command.runAgain")}
        </Button>
      )}

      {state === "result" && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={onInsert}
            title={t("ui.command.insertTitle", { shortcut: Platform.isMacOS ? "⌘" : "Ctrl" })}
          >
            {t("ui.command.insert")}
            <InsertShortcutHint />
          </Button>
          <Button
            size="sm"
            onClick={onReplace}
            title={t("ui.command.replaceTitle", { shortcut: Platform.isMacOS ? "⌘" : "Ctrl" })}
          >
            {t("ui.command.replace")}
            <ReplaceShortcutHint />
          </Button>
        </>
      )}
    </div>
  );
}
