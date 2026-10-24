import type { Meta, StoryObj } from "@/lib/story";
import { BuiltinSkillsTable, type BuiltinSkillsTableProps } from "./BuiltinSkillsTable";

const noop = () => {};
const args: BuiltinSkillsTableProps = {
  skills: [
    {
      name: "obsidian-markdown",
      description: "Create and edit Obsidian Markdown notes.",
      content: "# Obsidian Markdown",
    },
  ],
  pendingSkills: [],
  onToggleSkill: noop,
};
const meta = {
  title: "Skills/Built-in Skills",
  component: BuiltinSkillsTable,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<BuiltinSkillsTableProps>;
export default meta;
export const EnabledSkill: StoryObj<BuiltinSkillsTableProps> = {
  name: "Enabled skill with one switch",
  args,
};
export const DisabledSkill: StoryObj<BuiltinSkillsTableProps> = {
  name: "Disabled skill with visible badge",
  args: { ...args, preferences: { [args.skills[0].name]: { disabled: true } } },
};
export const NameCollision: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    ...args,
    unavailableReasons: {
      [args.skills[0].name]:
        "A skill with this name already exists in Your Skills. Your file is kept unchanged.",
    },
  },
};
export const CleanupError: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    ...args,
    error:
      "Your preference is saved, but some skill files could not be removed. Check folder permissions and try again.",
  },
};

export const UpdatingOneSkill: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    ...args,
    pendingSkills: [args.skills[0].name],
    skills: [
      ...args.skills,
      { ...args.skills[0], name: "json-canvas", description: "Create and edit JSON Canvas files." },
    ],
  },
};
