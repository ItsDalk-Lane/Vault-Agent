import React from "react";
import { t } from "@/i18n";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal } from "obsidian";
import type { Root } from "react-dom/client";
import type { Skill } from "@/agentMode/skills/types";
import { SkillPropertiesEditor, type PropertiesSaveRequest } from "./SkillPropertiesEditor";
export type { PropertiesSaveRequest } from "./SkillPropertiesEditor";

export type PropertiesSaveOutcome = "close" | "stay" | "collision";

export class PropertiesModal extends Modal {
  private root: Root | null = null;
  private collisionError = false;
  private saving = false;

  constructor(
    app: App,
    private readonly skill: Skill,
    private readonly skillsFolderRel: string,
    private readonly onSaveCallback: (
      req: PropertiesSaveRequest
    ) => Promise<PropertiesSaveOutcome> | PropertiesSaveOutcome
  ) {
    super(app);
    // @ts-expect-error — setTitle exists on Modal but is missing from @types/obsidian.
    this.setTitle(t("agentInfra.skills.properties.title", { name: skill.name }));
  }

  onOpen(): void {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.renderBody();
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
  }

  private renderBody(): void {
    this.root?.render(
      <SkillPropertiesEditor
        key={this.skill.dirPath}
        skill={this.skill}
        skillsFolderRel={this.skillsFolderRel}
        collisionError={this.collisionError}
        saving={this.saving}
        onCancel={() => this.close()}
        onSave={(req) => {
          void this.handleSave(req);
        }}
      />
    );
  }

  private async handleSave(req: PropertiesSaveRequest): Promise<void> {
    this.saving = true;
    this.collisionError = false;
    this.renderBody();
    try {
      const outcome = await this.onSaveCallback(req);
      if (outcome === "close") {
        this.close();
        return;
      }
      this.saving = false;
      this.collisionError = outcome === "collision";
      this.renderBody();
    } catch (err) {
      logError("PropertiesModal save failed", err);
      this.saving = false;
      this.renderBody();
    }
  }
}
