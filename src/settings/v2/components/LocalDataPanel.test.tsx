import { LocalDataPanel, formatLocalBytes, type LocalDataPanelProps } from "./LocalDataPanel";
import { buildLocalDataTree } from "./localDataTree";
import { fireEvent, render, screen } from "@testing-library/react";
import { homedir } from "node:os";
import React from "react";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/8";
const home = homedir();
const base = `${home}/.vault-agent`;
const status = {
  totalBytes: 4194304,
  totalSessionCount: 2,
  sessions: [
    {
      id: "root-e6877d76-bb6a-49c2-b310-d53adccd8850",
      title: "整理项目笔记",
      path: `${base}/v2/vaults/example/sessions/root-e6877d76-bb6a-49c2-b310-d53adccd8850`,
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
      path: `${base}/v2/vaults/example/sessions/root-e7386a88-b80a-48c9-8290-6ab3fd3a123b`,
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
  legacyPaths: [{ name: "vaults", path: `${base}/vaults` }],
};
const paths = {
  dataRoot: `${base}/v2`,
  sessionsRoot: `${base}/v2/vaults/example/sessions`,
  indexPath: `${base}/v2/vaults/example/agent-chat-index.json`,
  deletionsRoot: `${base}/v2/vaults/example/deletions`,
  logsRoot: `${base}/v2/logs/example`,
  tempRoot: `${base}/v2/tmp`,
};
const keychainGroups = [
  {
    key: "providers" as const,
    label: "Provider keys",
    entries: [
      {
        id: "copilot-vexample-provider-lm-studio-api-key",
        label: "LM Studio",
        createdAt: 1760000000000,
      },
    ],
  },
  { key: "mcp" as const, label: "External tool credentials", entries: [] },
  { key: "other" as const, label: "Other plugin entries", entries: [] },
];
const expand = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Expand or collapse ${name}` }));

const props: LocalDataPanelProps = {
  status,
  tree: buildLocalDataTree({ paths, status, vaultName: "example" }),
  loading: false,
  keychainGroups,
  settingsFileNote: "Plugin settings live in the vault at …/plugins/vault-agent.",
  onRefresh: jest.fn(),
  onCopy: jest.fn(),
  onReveal: jest.fn(),
  onOpenKeychainGroup: jest.fn(),
};

describe("LocalDataPanel", () => {
  describe("formatLocalBytes()", () => {
    it.each([
      [0, "0 B"],
      [1023, "1023 B"],
      [1024, "1.0 KiB"],
      [1536, "1.5 KiB"],
      [1048576, "1.0 MiB"],
      [1073741824, "1.0 GiB"],
      [1099511627776, "1.0 TiB"],
    ])("formats %d bytes as %s", (bytes, expected) => {
      expect(formatLocalBytes(bytes)).toBe(expected);
    });
  });
  describe("LocalDataPanel()", () => {
    it(`opens with the total, session chips and the storage map rooted at the private data folder (${ISSUE})`, () => {
      render(<LocalDataPanel {...props} />);
      expect(screen.getByText("All vaults total")).toBeTruthy();
      expect(screen.getAllByText("4.0 MiB").length).toBeGreaterThan(0);
      expect(screen.getByText("All vaults · 2 chats")).toBeTruthy();
      expect(screen.getByText("Current vault · 2 chats")).toBeTruthy();
      expect(screen.getByText("~/.vault-agent/")).toBeTruthy();
      expect(screen.queryByText("v2/")).toBeNull();
      expand("~/.vault-agent/");
      expect(screen.getByText("v2/")).toBeTruthy();
      expect(screen.getByText("Pending cleanup 0 B")).toBeTruthy();
    });
    it(`shows each chat as a collapsible row with its content groups and per-group sizes (${ISSUE})`, () => {
      render(<LocalDataPanel {...props} />);
      expect(screen.queryByText("Conversation logs")).toBeNull();
      expand("~/.vault-agent/");
      expand("v2/");
      expand("vaults/");
      expand("example/");
      expand("sessions/");
      const sessionToggle = screen.getByRole("button", {
        name: /Expand or collapse root-e6877d76/,
      });
      fireEvent.click(sessionToggle);
      expect(screen.getByText("整理项目笔记")).toBeTruthy();
      expect(screen.getByText("main.jsonl + 12 × doc-*.jsonl")).toBeTruthy();
      const recoveryRow = screen.getByText("Recovery snapshot").closest("div");
      expect(recoveryRow?.textContent).toContain("195.1 KiB");
      const metadataRow = screen.getByText("Metadata").closest("div");
      expect(metadataRow?.textContent).toContain("565 B");
      fireEvent.click(screen.getByRole("button", { name: /Expand or collapse root-e6877d76/ }));
      expect(screen.queryByText("main.jsonl + 12 × doc-*.jsonl")).toBeNull();
    });
    it(`copies and reveals a node path and refreshes the counts (${ISSUE})`, () => {
      render(<LocalDataPanel {...props} />);
      expand("~/.vault-agent/");
      expand("v2/");
      expand("vaults/");
      expand("example/");
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      expect(props.onRefresh).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: "Copy path: agent-chat-index.json", hidden: true })
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Show in folder: agent-chat-index.json", hidden: true })
      );
      expect(props.onCopy).toHaveBeenCalledWith(paths.indexPath);
      expect(props.onReveal).toHaveBeenCalledWith(paths.indexPath);
    });
    it(`marks the private root and lists legacy folders without inventing sizes for them (${ISSUE})`, () => {
      render(<LocalDataPanel {...props} />);
      expect(screen.getByText("Private")).toBeTruthy();
      expand("~/.vault-agent/");
      const legacyRow = screen
        .getByText("Left over from an older version; not counted")
        .closest("div");
      expect(legacyRow?.textContent).toContain("—");
      expect(
        screen.getAllByRole("button", { name: "Copy path: vaults/", hidden: true }).length
      ).toBeGreaterThan(0);
    });
    it(`keeps the previous result visible while refreshing and clearly reports failure (${ISSUE})`, () => {
      render(<LocalDataPanel {...props} loading error="Permission denied" />);
      expect(screen.getByRole("status").textContent).toBe("Calculating…");
      expect(screen.getByRole("alert").textContent).toContain("Permission denied");
      expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByText("~/.vault-agent/")).toBeTruthy();
    });
    it(`shows keychain categories that open the detail dialog and reports an unavailable keychain without inventing counts (${ISSUE})`, () => {
      const onOpenKeychainGroup = jest.fn();
      const view = render(<LocalDataPanel {...props} onOpenKeychainGroup={onOpenKeychainGroup} />);
      fireEvent.click(screen.getByRole("button", { name: /Provider keys/ }));
      expect(onOpenKeychainGroup).toHaveBeenCalledWith("providers");
      fireEvent.click(screen.getByRole("button", { name: /Other plugin entries/ }));
      expect(onOpenKeychainGroup).toHaveBeenCalledWith("other");
      view.unmount();
      const unavailable = render(
        <LocalDataPanel {...props} keychainGroups={null} credentialsError="Keychain is locked." />
      );
      expect(unavailable.getByText("Keychain is locked.")).toBeTruthy();
      unavailable.unmount();
    });
    it(`renders an empty store without inventing sessions or categories (${ISSUE})`, () => {
      const emptyStatus = {
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
      };
      render(
        <LocalDataPanel
          {...props}
          status={emptyStatus}
          tree={buildLocalDataTree({ paths, status: emptyStatus, vaultName: "example" })}
        />
      );
      expect(screen.getByText("All vaults · 0 chats")).toBeTruthy();
      expect(screen.getAllByText("0 B").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /Expand or collapse root-/ })).toBeNull();
    });
  });
});
