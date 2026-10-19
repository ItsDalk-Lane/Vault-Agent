import type { Meta, StoryObj } from "@/lib/story";
import {
  VaultAgentFolderMigration,
  type VaultAgentFolderMigrationProps,
} from "./VaultAgentFolderMigration";

const meta = {
  title: "Modals/Copilot Folder Migration",
  component: VaultAgentFolderMigration,
  args: { migration: { status: "moved", from: ".vault-agent", to: "vault-agent", leftBehind: [] } },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<VaultAgentFolderMigrationProps>;
export default meta;

export const Moved: StoryObj<VaultAgentFolderMigrationProps> = {};

export const FilesLeftBehind: StoryObj<VaultAgentFolderMigrationProps> = {
  args: {
    migration: {
      status: "moved",
      from: ".vault-agent",
      to: "vault-agent",
      leftBehind: [
        ".vault-agent/memory/User Role.md",
        ".vault-agent/conversations/A very long conversation title that wraps onto a second line.md",
      ],
    },
  },
};

export const Failed: StoryObj<VaultAgentFolderMigrationProps> = {
  args: {
    migration: {
      status: "failed",
      from: ".vault-agent",
      to: "vault-agent",
      reason: "EACCES: permission denied, rename '.vault-agent/memory'",
    },
  },
};
