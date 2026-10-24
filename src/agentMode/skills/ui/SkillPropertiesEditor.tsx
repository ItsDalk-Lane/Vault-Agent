import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { DESCRIPTION_MAX, NAME_MAX, NAME_RE } from "@/agentMode/skills/skillFormat";
import type { Skill } from "@/agentMode/skills/types";
import React from "react";

interface PropertiesFormValues {
  name: string;
  description: string;
  hideFromSlashMenu: boolean;
}

export interface PropertiesSaveRequest {
  nameChanged: boolean;
  newName: string;
  patch: { description: string; userInvocable: boolean | undefined };
}

export interface SkillPropertiesEditorProps {
  skill: Skill;
  skillsFolderRel: string;
  collisionError: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (req: PropertiesSaveRequest) => void;
}

export function SkillPropertiesEditor({
  skill,
  skillsFolderRel,
  collisionError,
  saving,
  onCancel,
  onSave,
}: SkillPropertiesEditorProps) {
  const [values, setValues] = React.useState<PropertiesFormValues>(() => ({
    name: skill.name,
    description: skill.description,
    hideFromSlashMenu: skill.userInvocable === false,
  }));
  const nameError = validateNameField(values.name);
  const descriptionError = validateDescriptionField(values.description);
  const canSave = nameError === null && descriptionError === null && !saving;
  return (
    <div className="tw-flex tw-max-h-[70vh] tw-flex-col">
      <div className="tw-mb-3 tw-text-ui-smaller tw-text-muted">
        {t("agentInfra.skills.properties.writesTo")}{" "}
        <code className="tw-font-mono">
          {skillsFolderRel.replace(/\/+$/, "")}/{skill.name}/SKILL.md
        </code>
      </div>
      <div className="tw-flex tw-flex-1 tw-flex-col tw-gap-4 tw-overflow-y-auto tw-pr-1">
        <div className="tw-flex tw-flex-col tw-gap-1">
          <label htmlFor="properties-name" className="tw-text-sm tw-font-medium">
            {t("agentInfra.skills.properties.name")}
          </label>
          <Input
            id="properties-name"
            type="text"
            value={values.name}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
            aria-invalid={nameError !== null || collisionError}
            autoComplete="off"
            spellCheck={false}
          />
          {nameError !== null || collisionError ? (
            <div className="tw-text-ui-smaller tw-text-error">
              {nameError ?? t("agentInfra.skills.properties.collision", { name: values.name })}
            </div>
          ) : (
            <div className="tw-text-ui-smaller tw-text-muted">
              {t("agentInfra.skills.properties.nameHelpPrefix")} <code>/</code>{" "}
              {t("agentInfra.skills.properties.nameHelpSuffix")}
            </div>
          )}
        </div>
        <div className="tw-flex tw-flex-col tw-gap-1">
          <label htmlFor="properties-description" className="tw-text-sm tw-font-medium">
            {t("agentInfra.skills.properties.description")}
          </label>
          <Textarea
            id="properties-description"
            value={values.description}
            onChange={(event) =>
              setValues((current) => ({ ...current, description: event.target.value }))
            }
            aria-invalid={descriptionError !== null}
            spellCheck={true}
            className="tw-border-border tw-text-sm"
          />
          <div className="tw-text-ui-smaller tw-text-muted">
            {values.description.length} / {DESCRIPTION_MAX}
          </div>
          {descriptionError && (
            <div className="tw-text-ui-smaller tw-text-error">{descriptionError}</div>
          )}
        </div>
        <label className="tw-flex tw-cursor-pointer tw-items-start tw-gap-2.5">
          <Checkbox
            checked={values.hideFromSlashMenu}
            onCheckedChange={(checked) =>
              setValues((current) => ({ ...current, hideFromSlashMenu: checked === true }))
            }
            className="tw-mt-0.5"
          />
          <span className="tw-text-sm tw-text-normal">
            {t("agentInfra.skills.properties.hideSlash")}
          </span>
        </label>
      </div>
      <div className="tw-mt-4 tw-flex tw-justify-end tw-gap-2 tw-border-t tw-border-solid tw-border-border tw-pt-3">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="default"
          disabled={!canSave}
          onClick={() => {
            if (canSave)
              onSave({
                nameChanged: values.name !== skill.name,
                newName: values.name,
                patch: {
                  description: values.description,
                  userInvocable: values.hideFromSlashMenu ? false : undefined,
                },
              });
          }}
        >
          {t("agentInfra.skills.properties.save")}
        </Button>
      </div>
    </div>
  );
}

function validateNameField(name: string): string | null {
  if (name.length === 0) return t("agentInfra.skills.properties.error.nameRequired");
  if (name.length > NAME_MAX)
    return t("agentInfra.skills.properties.error.nameMax", { max: NAME_MAX });
  if (!NAME_RE.test(name)) return t("agentInfra.skills.properties.error.namePattern");
  return null;
}

function validateDescriptionField(description: string): string | null {
  if (description.trim().length === 0)
    return t("agentInfra.skills.properties.error.descriptionRequired");
  if (description.length > DESCRIPTION_MAX)
    return t("agentInfra.skills.properties.error.descriptionMax", { max: DESCRIPTION_MAX });
  return null;
}
