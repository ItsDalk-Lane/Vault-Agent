import type { Meta, StoryObj } from "@/lib/story";
import { SkillPropertiesEditor, type SkillPropertiesEditorProps } from "./SkillPropertiesEditor";
const meta = {
  title: "Skills/Properties",
  component: SkillPropertiesEditor,
  args: {
    skill: {
      name: "writing-helper",
      description: "Review the writing and supporting evidence in a note.",
      body: "",
      filePath: "skills/writing-helper/SKILL.md",
      dirPath: "skills/writing-helper",
      enabledAgents: ["pi"],
      location: { kind: "canonical" },
    },
    skillsFolderRel: "vault-agent/skills",
    collisionError: false,
    saving: false,
    onCancel: () => undefined,
    onSave: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<SkillPropertiesEditorProps>;
export default meta;
export const Default: StoryObj<SkillPropertiesEditorProps> = {};
export const NameCollision: StoryObj<SkillPropertiesEditorProps> = {
  args: { collisionError: true },
};
export const Saving: StoryObj<SkillPropertiesEditorProps> = { args: { saving: true } };
