import { Button } from "@/components/ui/button";
import { ClampedContent } from "@/components/ui/clamped-content";
import { ReactModal } from "@/components/modals/ReactModal";
import { t } from "@/i18n";
import { App } from "obsidian";
import React from "react";

export interface SkillLoadIssue {
  location: string;
  reason: string;
  offendingText?: string;
  revealLabel: string;
  onFixWithAgent: () => void;
  onOpen: () => void;
  onReveal: () => void;
}

export interface SkillLoadIssuesProps {
  issues: readonly SkillLoadIssue[];
  onViewDetails: () => void;
}

function loadIssuesTitle(count: number): string {
  return count === 1
    ? t("agentInfra.skills.issues.titleOne")
    : t("agentInfra.skills.issues.titleMany", { count });
}

export const SkillLoadIssues: React.FC<SkillLoadIssuesProps> = ({ issues, onViewDetails }) => {
  const title = loadIssuesTitle(issues.length);

  return (
    <section
      className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-rounded-sm tw-border tw-border-solid tw-p-3 tw-text-left tw-text-ui-smaller tw-bg-warning/10 tw-border-warning/40"
      role="alert"
      aria-label={title}
    >
      <div className="tw-min-w-0">
        <strong className="tw-block tw-text-ui-small tw-text-warning">{title}</strong>
        <p className="tw-mx-0 tw-mb-0 tw-mt-0.5 tw-text-normal">
          {t("agentInfra.skills.issues.formatErrors")}
        </p>
      </div>
      <div className="tw-flex tw-shrink-0 tw-gap-1">
        <Button variant="secondary" size="sm" onClick={onViewDetails}>
          {t("agentInfra.skills.issues.viewDetails")}
        </Button>
      </div>
    </section>
  );
};

export interface SkillLoadIssuesModalContentProps {
  issues: readonly SkillLoadIssue[];
  onFixAll: () => void;
  onClose: () => void;
}

export const SkillLoadIssuesModalContent: React.FC<SkillLoadIssuesModalContentProps> = ({
  issues,
  onFixAll,
  onClose,
}) => {
  // Close first so Obsidian does not open an indexed file behind this modal. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  const runAction = (action: () => void): void => {
    onClose();
    action();
  };

  return (
    <>
      {issues.length > 1 && (
        <div className="tw-flex tw-justify-end">
          <Button size="sm" onClick={() => runAction(onFixAll)}>
            {t("agentInfra.skills.issues.fixAll")}
          </Button>
        </div>
      )}
      <div className="tw-mt-3 tw-max-h-96 tw-overflow-y-auto tw-pr-1">
        {issues.map((issue) => (
          <article
            className="tw-border-x-0 tw-border-b-0 tw-border-t tw-border-solid tw-py-3 tw-border-warning/30"
            key={issue.location}
          >
            <div className="tw-break-words tw-font-mono tw-text-ui-small tw-font-semibold tw-text-normal">
              {issue.location}
            </div>
            <p className="tw-mx-0 tw-mb-0 tw-mt-1 tw-text-ui-smaller tw-text-muted">
              {issue.reason}
            </p>
            {issue.offendingText !== undefined && (
              <ClampedContent collapsedClassName="tw-max-h-28">
                <code className="tw-mt-1 tw-block tw-whitespace-pre-wrap tw-rounded-sm tw-bg-primary-alt tw-p-1 tw-text-smallest">
                  {issue.offendingText}
                </code>
              </ClampedContent>
            )}
            <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-1">
              <Button variant="secondary" size="sm" onClick={() => runAction(issue.onFixWithAgent)}>
                {t("agentInfra.skills.issues.fixWithAgent")}
              </Button>
              <Button variant="ghost2" size="sm" onClick={() => runAction(issue.onOpen)}>
                {t("agentInfra.skills.issues.openSkillMd")}
              </Button>
              <Button variant="ghost2" size="sm" onClick={() => runAction(issue.onReveal)}>
                {issue.revealLabel}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
};

export class SkillLoadIssuesModal extends ReactModal {
  constructor(
    app: App,
    private readonly issues: readonly SkillLoadIssue[],
    private readonly onFixAll: () => void
  ) {
    super(app, loadIssuesTitle(issues.length));
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <SkillLoadIssuesModalContent issues={this.issues} onFixAll={this.onFixAll} onClose={close} />
    );
  }
}

export const AllSkillsNotLoaded: React.FC = () => (
  <div className="tw-rounded-sm tw-border tw-border-dashed tw-border-border tw-bg-primary tw-px-3 tw-py-6 tw-text-left tw-text-ui-smaller tw-text-muted">
    {t("agentInfra.skills.issues.allNotLoaded")}
  </div>
);
