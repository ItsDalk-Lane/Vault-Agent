import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { AlertTriangle } from "lucide-react";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import type { Skill } from "@/agentMode/skills/types";

const DeleteConfirmBody: React.FC<{
  skill: Skill;
  skillsFolderRel: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ skill, skillsFolderRel, onCancel, onConfirm }) => {
  const folder = skillsFolderRel.replace(/\/+$/, "");
  const path = `${folder}/${skill.name}/`;

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <div
        className={cn(
          "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-px-3.5 tw-py-2.5",
          "tw-border tw-border-solid tw-bg-modifier-error-rgb/15 tw-border-modifier-error/80"
        )}
      >
        <AlertTriangle
          className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-error"
          aria-hidden="true"
        />
        <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-normal">
          {t("agentInfra.skills.delete.canonicalWarning")}
        </p>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <div className="tw-text-ui-smaller tw-text-muted">
          {t("agentInfra.skills.delete.willRemove")}
        </div>
        <ul className="tw-m-0 tw-list-none tw-space-y-1 tw-p-0 tw-font-mono tw-text-ui-smaller tw-text-normal">
          <li className="tw-flex tw-items-baseline tw-gap-2">
            <span className="tw-text-faint">•</span>
            <span className="tw-flex-1 tw-break-all">{path}</span>
          </li>
        </ul>
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2 tw-pt-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          {t("agentInfra.skills.delete.confirm")}
        </Button>
      </div>
    </div>
  );
};

export class DeleteConfirmModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly skill: Skill,
    private readonly skillsFolderRel: string,
    private readonly onConfirm: () => void | Promise<void>
  ) {
    super(app);
    // @ts-ignore
    this.setTitle(t("agentInfra.skills.delete.title", { name: skill.name }));
  }

  onOpen() {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <DeleteConfirmBody
        skill={this.skill}
        skillsFolderRel={this.skillsFolderRel}
        onCancel={() => this.close()}
        onConfirm={() => {
          const result = this.onConfirm();
          if (result instanceof Promise) {
            result.catch((err) => logError("DeleteConfirmModal onConfirm failed", err));
          }
          this.close();
        }}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
  }
}
