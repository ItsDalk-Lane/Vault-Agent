import {
  LocalDataPanel,
  type LocalDataKeychainGroup,
  type LocalDataPanelProps,
} from "./LocalDataPanel";
import { buildLocalDataTree } from "./localDataTree";
import type { LocalDataStatus } from "@/services/localDataStatus";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Settings/LocalData",
  component: LocalDataPanel,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<LocalDataPanelProps>;
export default meta;

const status: LocalDataStatus = {
  totalBytes: 4194304,
  totalSessionCount: 2,
  sessions: [
    {
      id: "root-e6877d76-bb6a-49c2-b310-d53adccd8850",
      title: "整理项目笔记",
      path: "/Users/example/.vault-agent/v2/vaults/example/sessions/root-e6877d76-bb6a-49c2-b310-d53adccd8850",
      bytes: 4169519,
      attachments: 0,
      backups: 7820,
      transcripts: 3961340,
      recovery: 199794,
      metadata: 565,
      children: 0,
      docFileCount: 12,
    },
    {
      id: "root-e7386a88-b80a-48c9-8290-6ab3fd3a123b",
      title: "未命名的新会话",
      path: "/Users/example/.vault-agent/v2/vaults/example/sessions/root-e7386a88-b80a-48c9-8290-6ab3fd3a123b",
      bytes: 8268,
      attachments: 0,
      backups: 0,
      transcripts: 6734,
      recovery: 1129,
      metadata: 405,
      children: 0,
      docFileCount: 6,
    },
  ],
  indexBytes: 605,
  indexCount: 2,
  settingsBytes: 13107,
  logsBytes: 0,
  tempBytes: 0,
  pendingBytes: 0,
  legacyPaths: [{ name: "vaults", path: "/Users/example/.vault-agent/vaults" }],
};
const paths = {
  dataRoot: "/Users/example/.vault-agent/v2",
  sessionsRoot: "/Users/example/.vault-agent/v2/vaults/example/sessions",
  indexPath: "/Users/example/.vault-agent/v2/vaults/example/agent-chat-index.json",
  deletionsRoot: "/Users/example/.vault-agent/v2/vaults/example/deletions",
  logsRoot: "/Users/example/.vault-agent/v2/logs/example",
  tempRoot: "/Users/example/.vault-agent/v2/tmp",
};
const keychainGroups: readonly LocalDataKeychainGroup[] = [
  {
    key: "providers",
    label: "Provider keys",
    entries: [
      {
        id: "copilot-vexample-provider-lm-studio-api-key",
        label: "LM Studio",
        createdAt: 1760000000000,
      },
      { id: "copilot-vexample-provider-opencode-go-api-key", label: "OpenCode Go" },
    ],
  },
  {
    key: "mcp",
    label: "External tool credentials",
    entries: [{ id: "mcp:docs:token", label: "Docs server · Authorization" }],
  },
  {
    key: "other",
    label: "Other plugin entries",
    entries: [{ id: "copilot-vexample-9d1c4a02" }],
  },
];
const args: LocalDataPanelProps = {
  status: null,
  tree: [],
  loading: false,
  keychainGroups: null,
  settingsFileNote:
    "Plugin settings live in the vault at …/plugins/vault-agent; API keys are stored only as keychain references.",
  onRefresh: () => {},
  onCopy: () => {},
  onReveal: () => {},
  onOpenKeychainGroup: () => {},
};
const withTree: LocalDataPanelProps = {
  ...args,
  status,
  tree: buildLocalDataTree({ paths, status, vaultName: "example" }),
  keychainGroups,
};

export const Loading: StoryObj<LocalDataPanelProps> = { args: { ...args, loading: true } };
export const Failed: StoryObj<LocalDataPanelProps> = {
  args: { ...args, error: "Permission denied" },
};
export const Empty: StoryObj<LocalDataPanelProps> = {
  args: {
    ...args,
    status: {
      totalBytes: 0,
      totalSessionCount: 0,
      sessions: [],
      indexBytes: 0,
      indexCount: 0,
      settingsBytes: 0,
      logsBytes: 0,
      tempBytes: 0,
      pendingBytes: 0,
      legacyPaths: [],
    },
    tree: buildLocalDataTree({
      paths,
      status: {
        totalBytes: 0,
        totalSessionCount: 0,
        sessions: [],
        indexBytes: 0,
        indexCount: 0,
        settingsBytes: 0,
        logsBytes: 0,
        tempBytes: 0,
        pendingBytes: 0,
        legacyPaths: [],
      },
      vaultName: "example",
    }),
  },
};
export const WithDataMap: StoryObj<LocalDataPanelProps> = { args: withTree };
export const KeychainUnavailable: StoryObj<LocalDataPanelProps> = {
  args: { ...withTree, keychainGroups: null, credentialsError: "Keychain is locked." },
};
