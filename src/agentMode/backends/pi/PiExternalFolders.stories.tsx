import { PiExternalFolders, type PiExternalFoldersProps } from "./PiExternalFolders";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Pi External Folders",
  component: PiExternalFolders,
  args: { scopes: [], onChange: () => undefined },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<PiExternalFoldersProps>;
export default meta;
export const Empty: StoryObj<PiExternalFoldersProps> = {};
export const GrantedFolders: StoryObj<PiExternalFoldersProps> = {
  args: {
    scopes: [
      { root: "/Users/example/Documents/Reference", permissions: ["read"] },
      { root: "/Users/example/Documents/Project", permissions: ["read", "write"] },
    ],
  },
};
