import React from "react";
import { t } from "@/i18n";

export function CustomPromptSyntaxInstruction() {
  return (
    <ul className="tw-m-0 tw-px-4 tw-text-sm">
      <li>
        <span className="tw-font-medium tw-text-accent">{"{}"}</span>{" "}
        {t("ui.command.syntax.selection")}
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{[[Note Title]]}`}</span>{" "}
        {t("ui.command.syntax.note")}
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{activeNote}`}</span>{" "}
        {t("ui.command.syntax.activeNote")}
      </li>
      <li>
        <span className="tw-font-medium tw-text-accent">{`{#tag1, #tag2}`}</span>{" "}
        {t("ui.command.syntax.tags")}
      </li>
    </ul>
  );
}
