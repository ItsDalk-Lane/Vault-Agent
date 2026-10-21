import { FormField } from "@/components/ui/form-field";
import { t } from "@/i18n";
import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import React from "react";

export interface ProjectInstructionsFieldProps {
  value: string;
  onChange: (next: string) => void;
}

export const ProjectInstructionsField: React.FC<ProjectInstructionsFieldProps> = ({
  value,
  onChange,
}) => {
  const label = t("settings.instructions.projectLabel");
  return (
    <FormField label={label} description={t("settings.instructions.projectDescription")}>
      <InstructionsTextarea label={label} value={value} onChange={onChange} />
    </FormField>
  );
};
