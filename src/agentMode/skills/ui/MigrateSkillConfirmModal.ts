import { t } from "@/i18n";
import { logError } from "@/logger";
import { App, Modal } from "obsidian";
import type { BackendId, Skill } from "@/agentMode/skills/types";

export type MigrateConfirmVariant =
  | "project-single"
  | "project-mirrored"
  | "disable-last-agent"
  | "proactive-consolidate";

export interface MigrateActionLine {
  verb: string;
  detail: string;
  note?: string;
}

export interface MigrateSkillConfirmModalArgs {
  variant: MigrateConfirmVariant;
  skill: Skill;
  targetAgent: BackendId | null;
  targetAgentDisplayName?: string;
  resolvedCanonicalName: string;
  sourceDuplicatePaths: ReadonlyArray<string>;
  actionLines: ReadonlyArray<MigrateActionLine>;
  onConfirm: (suppressFuture: boolean) => void | Promise<void>;
  onCancel?: () => void;
}

export class MigrateSkillConfirmModal extends Modal {
  private readonly args: MigrateSkillConfirmModalArgs;
  private confirmed = false;
  private suppressFuture = false;

  constructor(app: App, args: MigrateSkillConfirmModalArgs) {
    super(app);
    this.args = args;
    // @ts-ignore - setTitle is documented but missing from the typings.
    this.setTitle(buildTitle(args));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tw-flex", "tw-flex-col", "tw-gap-3");

    const bodyEl = contentEl.createEl("p", {
      cls: "tw-m-0 tw-text-ui-smaller tw-text-normal tw-whitespace-pre-line",
      text: buildBody(this.args),
    });
    bodyEl.setAttr("data-test-id", "migrate-confirm-body");

    if (this.args.sourceDuplicatePaths.length > 0) {
      const list = contentEl.createEl("ul", {
        cls: "tw-m-0 tw-list-none tw-space-y-1 tw-pl-0 tw-font-mono tw-text-ui-smaller tw-text-normal",
      });
      for (const path of this.args.sourceDuplicatePaths) {
        const li = list.createEl("li", {
          cls: "tw-flex tw-items-baseline tw-gap-2",
        });
        li.createSpan({ cls: "tw-text-faint", text: "•" });
        li.createSpan({ cls: "tw-flex-1", text: path });
      }
    }

    if (this.args.resolvedCanonicalName !== this.args.skill.name) {
      contentEl.createEl("p", {
        cls: "tw-m-0 tw-text-ui-smaller tw-text-warning",
        text: t("agentInfra.skills.migrate.nameTaken", {
          name: this.args.skill.name,
          resolved: this.args.resolvedCanonicalName,
        }),
      });
    }

    const willHeader = contentEl.createDiv({
      cls: "tw-text-ui-smaller tw-text-muted",
      text: t("agentInfra.skills.migrate.willDo"),
    });
    willHeader.setAttr("data-test-id", "migrate-confirm-will-header");
    const actionList = contentEl.createEl("ul", {
      cls: "tw-m-0 tw-list-none tw-space-y-1 tw-pl-0 tw-font-mono tw-text-ui-smaller tw-text-normal",
    });
    for (const line of this.args.actionLines) {
      const li = actionList.createEl("li", {
        cls: "tw-flex tw-items-baseline tw-gap-2",
      });
      li.createSpan({ cls: "tw-text-faint", text: "•" });
      const body = li.createSpan({ cls: "tw-flex-1" });
      body.createSpan({
        cls: "tw-inline-block tw-min-w-[64px] tw-text-muted",
        text: verbLabel(line.verb),
      });
      body.createSpan({ text: ` ${line.detail}` });
      if (line.note !== undefined && line.note.length > 0) {
        body.createSpan({
          cls: "tw-ml-1.5 tw-font-sans tw-text-smallest tw-text-faint",
          text: line.note,
        });
      }
    }

    const outro = buildOutro(this.args);
    if (outro !== null) {
      contentEl.createEl("p", {
        cls: "tw-m-0 tw-text-ui-smaller tw-text-muted tw-whitespace-pre-line",
        text: outro,
      });
    }

    const checkboxRow = contentEl.createEl("label", {
      cls: "tw-flex tw-items-center tw-gap-2 tw-text-ui-smaller tw-text-normal tw-cursor-pointer",
    });
    const checkbox = checkboxRow.createEl("input", {
      cls: "tw-size-checkbox",
      attr: { type: "checkbox" },
    });
    checkbox.addEventListener("change", () => {
      this.suppressFuture = checkbox.checked;
    });
    checkboxRow.createSpan({ text: t("agentInfra.skills.migrate.dontAsk") });

    const buttonRow = contentEl.createDiv({
      cls: "tw-flex tw-justify-end tw-gap-2 tw-pt-2",
    });
    const cancelBtn = buttonRow.createEl("button", {
      cls: "mod-secondary",
      text: t("common.cancel"),
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
    const confirmBtn = buttonRow.createEl("button", {
      cls: "mod-cta",
      text: buildConfirmLabel(this.args),
    });
    confirmBtn.addEventListener("click", () => {
      this.confirmed = true;
      const result = this.args.onConfirm(this.suppressFuture);
      if (result instanceof Promise) {
        result.catch((err) => logError("MigrateSkillConfirmModal onConfirm failed", err));
      }
      this.close();
    });
  }

  onClose(): void {
    if (!this.confirmed) {
      this.args.onCancel?.();
    }
    this.contentEl.empty();
  }
}

function buildTitle(args: MigrateSkillConfirmModalArgs): string {
  const name = args.skill.name;
  switch (args.variant) {
    case "project-single":
      return t("agentInfra.skills.migrate.title.projectSingle", {
        name,
        target: args.targetAgentDisplayName ?? t("agentInfra.skills.migrate.anotherAgent"),
      });
    case "project-mirrored":
      return t("agentInfra.skills.migrate.title.projectMirrored", {
        name,
        target: args.targetAgentDisplayName ?? t("agentInfra.skills.migrate.anotherAgent"),
      });
    case "disable-last-agent":
      return t("agentInfra.skills.migrate.title.disableLastAgent", {
        name,
        target: args.targetAgentDisplayName ?? t("agentInfra.skills.migrate.thisAgent"),
      });
    case "proactive-consolidate":
      return t("agentInfra.skills.migrate.title.proactiveConsolidate", { name });
  }
}

function buildBody(args: MigrateSkillConfirmModalArgs): string {
  const target = args.targetAgentDisplayName ?? t("agentInfra.skills.migrate.anotherAgent");
  switch (args.variant) {
    case "project-single":
      return t("agentInfra.skills.migrate.body.projectSingle", {
        source: sourceAgentLabel(args),
        target,
      });
    case "project-mirrored":
      return t("agentInfra.skills.migrate.body.projectMirrored", {
        folders: pluralFolders(args.sourceDuplicatePaths.length),
      });
    case "disable-last-agent":
      return t("agentInfra.skills.migrate.body.disableLastAgent");
    case "proactive-consolidate":
      return t("agentInfra.skills.migrate.body.proactiveConsolidate");
  }
}

function buildOutro(args: MigrateSkillConfirmModalArgs): string | null {
  const source = args.targetAgentDisplayName ?? t("agentInfra.skills.migrate.thisAgent");
  switch (args.variant) {
    case "project-single":
      return t("agentInfra.skills.migrate.outro.projectSingle");
    case "project-mirrored":
      return t("agentInfra.skills.migrate.outro.projectMirrored", {
        count: args.actionLines.filter((l) => l.verb === "Create").length,
      });
    case "disable-last-agent":
      return t("agentInfra.skills.migrate.outro.disableLastAgent", { source });
    case "proactive-consolidate":
      return t("agentInfra.skills.migrate.outro.proactiveConsolidate");
  }
}

function buildConfirmLabel(args: MigrateSkillConfirmModalArgs): string {
  const target = args.targetAgentDisplayName ?? t("agentInfra.skills.migrate.agent");
  switch (args.variant) {
    case "project-single":
    case "project-mirrored":
      return t("agentInfra.skills.migrate.confirmMoveEnable", { target });
    case "disable-last-agent":
      return t("agentInfra.skills.migrate.confirmMoveDisable", { target });
    case "proactive-consolidate":
      return t("agentInfra.skills.migrate.confirmConsolidate");
  }
}

function sourceAgentLabel(args: MigrateSkillConfirmModalArgs): string {
  if (args.skill.location.kind !== "project") return t("agentInfra.skills.migrate.agent");
  const [first] = args.skill.location.agentDirs;
  return first ?? t("agentInfra.skills.migrate.agent");
}

function pluralFolders(n: number): string {
  if (n === 2) return t("agentInfra.skills.migrate.foldersTwo");
  if (n === 3) return t("agentInfra.skills.migrate.foldersThree");
  return t("agentInfra.skills.migrate.foldersMany", { count: n });
}

function verbLabel(verb: string): string {
  switch (verb) {
    case "Move":
      return t("agentInfra.skills.migrate.verb.move");
    case "Delete":
      return t("agentInfra.skills.migrate.verb.delete");
    case "Create":
      return t("agentInfra.skills.migrate.verb.create");
    case "Not create":
      return t("agentInfra.skills.migrate.verb.notCreate");
    default:
      return verb;
  }
}
