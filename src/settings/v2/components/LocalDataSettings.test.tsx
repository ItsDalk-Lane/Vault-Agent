import { LocalDataSettings } from "./LocalDataSettings";
import { collectLocalData, type LocalDataStatus } from "@/services/localDataStatus";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileSystemAdapter, Notice } from "obsidian";
import React from "react";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/8";
const paths = {
  dataRoot: "/private",
  sessionsRoot: "/private/sessions",
  indexPath: "/private/index.json",
  deletionsRoot: "/private/deletions",
  logsRoot: "/private/logs",
  tempRoot: "/private/tmp",
};
const result: LocalDataStatus = {
  totalBytes: 1024,
  totalSessionCount: 3,
  sessions: [],
  indexBytes: 2,
  indexCount: 0,
  settingsBytes: 100,
  logsBytes: 0,
  tempBytes: 0,
  pendingBytes: 0,
  legacyPaths: [],
};
const mockUnsubscribe = jest.fn();
const mockSubscribe = jest.fn((_listener: () => void) => mockUnsubscribe);
const mockLoadBackend = jest.fn();
const mockListSecrets = jest.fn();
const mockReadSecret = jest.fn();
const mockShowItem = jest.fn();
const mockClipboard = jest.fn();
const mockGetSecretMeta = jest.fn(() => ({}));
const mockPlugin = {
  app: {
    vault: {
      adapter: new FileSystemAdapter(),
      configDir: ".config",
      getName: () => "houde",
    },
    secretStorage: { listSecrets: mockListSecrets, getSecret: mockReadSecret },
  },
  manifest: { id: "vault-agent" },
  agentSessionManager: {
    getLocalDataBackend: mockLoadBackend,
    subscribeStorageChanges: mockSubscribe,
  },
};
jest.mock("@/settings/model", () => ({
  getSettings: () => ({
    providers: {},
    agentMode: {
      backends: {
        pi: {
          mcpServers: [
            {
              displayName: "Docs server",
              transport: {
                kind: "http",
                headerSecretRefs: { Authorization: "mcp:shared-docs:token" },
              },
            },
          ],
        },
      },
    },
  }),
}));
jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 保持被替换 hook 的公开名称
  usePlugin: () => mockPlugin,
}));
jest.mock("@/services/localDataStatus", () => ({
  ...jest.requireActual<typeof import("@/services/localDataStatus")>("@/services/localDataStatus"),
  collectLocalData: jest.fn(),
}));
jest.mock("@/services/keychainService", () => ({
  ...jest.requireActual<typeof import("@/services/keychainService")>("@/services/keychainService"),
  KeychainService: {
    getInstance: () => ({ getVaultId: () => "vault", getSecretMeta: mockGetSecretMeta }),
  },
}));
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (name: string): unknown =>
    name === "electron" ? { shell: { showItemInFolder: mockShowItem } } : jest.requireActual(name),
}));
const collect = jest.mocked(collectLocalData);
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("LocalDataSettings", () => {
  describe("LocalDataSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSecretMeta.mockReturnValue({});
      collect.mockResolvedValue(result);
      mockLoadBackend.mockResolvedValue({
        getLocalStoragePaths: () => paths,
        subscribeStorageChanges: mockSubscribe,
      });
      mockListSecrets.mockReturnValue([
        "copilot-vvault-provider-openai-api-key",
        "copilot-vvault-provider-mcp-models-api-key",
        "copilot-vvault-pi-credential-openai-12345678",
        "copilot-vvault-pi-credential-index",
        "mcp-oauth-vault:docs:abcdef",
        "mcp:shared-docs:token",
        "mcp:unrelated:token",
        "copilot-vother-provider-openai-api-key",
        "mcp-oauth-other:docs:abcdef",
      ]);
      mockClipboard.mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: mockClipboard },
      });
    });
    it(`builds the storage map from the current paths and lists keychain categories without reading secret values (${ISSUE})`, async () => {
      render(<LocalDataSettings />);
      await screen.findByText("All vaults · 3 chats");
      expect(collect).toHaveBeenCalledWith(paths, "/vault/.config/plugins/vault-agent/data.json");
      const expandFirst = (name: string) =>
        fireEvent.click(screen.getAllByRole("button", { name: `Expand or collapse ${name}` })[0]);
      expandFirst("//");
      expandFirst("private/");
      expandFirst("vaults/");
      fireEvent.click(screen.getAllByRole("button", { name: "Expand or collapse private/" })[1]);
      expect(screen.getByText(/Partition of houde/)).toBeTruthy();
      const providerCell = screen.getByRole("button", { name: /Provider keys/ });
      expect(providerCell.textContent).toContain("3");
      const mcpCell = screen.getByRole("button", { name: /External tool credentials/ });
      expect(mcpCell.textContent).toContain("2");
      const otherCell = screen.getByRole("button", { name: /Other plugin entries/ });
      expect(otherCell.textContent).toContain("1");
      expect(mockReadSecret).not.toHaveBeenCalled();
    });
    it(`coalesces storage changes during a calculation and presents the final result (${ISSUE})`, async () => {
      const first = pending<LocalDataStatus>();
      const second = pending<LocalDataStatus>();
      collect.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const view = render(<LocalDataSettings />);
      await waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
      act(() => {
        mockSubscribe.mock.calls[0][0]();
        mockSubscribe.mock.calls[0][0]();
      });
      expect(collect).toHaveBeenCalledTimes(1);
      await act(async () => {
        first.resolve(result);
        await first.promise;
      });
      await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(true);
      await act(async () => {
        second.resolve({ ...result, totalBytes: 0 });
        await second.promise;
      });
      await screen.findAllByText("0 B");
      view.unmount();
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });
    it(`refreshes on a click or window focus and safely copies or reveals listed paths (${ISSUE})`, async () => {
      render(<LocalDataSettings />);
      await screen.findByText("All vaults · 3 chats");
      const expandFirst = (name: string) =>
        fireEvent.click(screen.getAllByRole("button", { name: `Expand or collapse ${name}` })[0]);
      expandFirst("//");
      expandFirst("private/");
      expandFirst("vaults/");
      fireEvent.click(screen.getAllByRole("button", { name: "Expand or collapse private/" })[1]);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false)
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy path: index.json", hidden: true }));
      fireEvent.click(
        screen.getByRole("button", { name: "Show in folder: index.json", hidden: true })
      );
      expect(mockClipboard).toHaveBeenCalledWith("/private/index.json");
      expect(mockShowItem).toHaveBeenCalledWith("/private/index.json");
    });
    it(`can retry a failed calculation and reports unavailable keychain enumeration separately (${ISSUE})`, async () => {
      collect.mockRejectedValueOnce(new Error("Permission denied"));
      mockListSecrets.mockImplementation(() => {
        throw new Error("Keychain locked");
      });
      render(<LocalDataSettings />);
      expect((await screen.findByRole("alert")).textContent).toContain("Permission denied");
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await screen.findByText("All vaults · 3 chats");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Could not count keychain entries: Keychain locked")).toBeTruthy();
    });
    it(`explains when the host cannot enumerate keychain entries without reporting zero (${ISSUE})`, async () => {
      Object.defineProperty(mockPlugin.app.secretStorage, "listSecrets", {
        value: undefined,
        configurable: true,
      });
      try {
        render(<LocalDataSettings />);
        await screen.findByText("This Obsidian version cannot list keychain entries.");
        expect(mockReadSecret).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(mockPlugin.app.secretStorage, "listSecrets", {
          value: mockListSecrets,
          configurable: true,
        });
      }
    });
    it(`reports copy failures without an unhandled promise rejection (${ISSUE})`, async () => {
      mockClipboard.mockRejectedValueOnce(new Error("Clipboard denied"));
      render(<LocalDataSettings />);
      await screen.findByText("All vaults · 3 chats");
      const expandCopyPath = (index: number, name: string) =>
        fireEvent.click(
          screen.getAllByRole("button", { name: `Expand or collapse ${name}` })[index]
        );
      expandCopyPath(0, "//");
      expandCopyPath(0, "private/");
      expandCopyPath(0, "vaults/");
      expandCopyPath(1, "private/");
      fireEvent.click(screen.getByRole("button", { name: "Copy path: index.json", hidden: true }));
      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith("Could not open or copy this path: Clipboard denied")
      );
    });
  });
});
