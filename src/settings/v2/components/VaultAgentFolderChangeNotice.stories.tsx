import type { Meta, StoryObj } from "@/lib/story";
import {
  VaultAgentFolderChangeNotice,
  type VaultAgentFolderChangeNoticeProps,
} from "./VaultAgentFolderChangeNotice";

const meta = {
  title: "Settings/Copilot Folder Change Notice",
  component: VaultAgentFolderChangeNotice,
  args: {
    oldRoot: "vault-agent",
    newRoot: "90 System/vault-agent",
    containsMarkdown: false,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<VaultAgentFolderChangeNoticeProps>;
export default meta;

export const EmptyFolder: StoryObj<VaultAgentFolderChangeNoticeProps> = {};

export const FolderWithMarkdown: StoryObj<VaultAgentFolderChangeNoticeProps> = {
  args: { containsMarkdown: true },
};
