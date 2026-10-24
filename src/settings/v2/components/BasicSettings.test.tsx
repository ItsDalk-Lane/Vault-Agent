import { DEFAULT_SETTINGS } from "@/constants";
import { applyLanguage } from "@/i18n";
import { settingsAtom, settingsStore } from "@/settings/model";
import { BasicSettings } from "@/settings/v2/components/BasicSettings";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

jest.mock("@/settings/v2/components/AgentSettings", () => ({
  AgentSettings: () => <div data-testid="agents-section">agents</div>,
}));

const isDesktopRuntime = jest.fn<boolean, []>().mockReturnValue(true);
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => isDesktopRuntime() }));

jest.mock("@/context", () => {
  const app = {
    vault: { configDir: ".vault-config", getMarkdownFiles: () => [] },
    setting: { close: jest.fn() },
  };
  return {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
    useApp: () => app,
  };
});

const openAgentsFile = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
const readAgentsFile = jest.fn<Promise<string>, unknown[]>().mockResolvedValue("");
const writeAgentsFile = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
jest.mock("@/instructions/agentsFile", () => ({
  openAgentsFile: (...a: unknown[]): Promise<void> => openAgentsFile(...a),
  readAgentsFile: (...a: unknown[]): Promise<string> => readAgentsFile(...a),
  writeAgentsFile: (...a: unknown[]): Promise<void> => writeAgentsFile(...a),
}));

const applyVaultAgentRootChange = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
const vaultAgentRootContainsNotes = jest.fn<boolean, unknown[]>().mockReturnValue(false);
const findVaultAgentRootFileConflict = jest.fn<string | null, unknown[]>().mockReturnValue(null);
jest.mock("@/settings/vaultAgentRootChange", () => ({
  applyVaultAgentRootChange: (...a: unknown[]) => applyVaultAgentRootChange(...a),
  vaultAgentRootContainsNotes: (...a: unknown[]) => vaultAgentRootContainsNotes(...a),
  findVaultAgentRootFileConflict: (...a: unknown[]) => findVaultAgentRootFileConflict(...a),
}));

let capturedOnConfirm: (() => void) | null = null;
let capturedConfirmButtonText = "";
const modalCtor = jest.fn((onConfirm: () => void, confirmButtonText: string) => {
  capturedOnConfirm = onConfirm;
  capturedConfirmButtonText = confirmButtonText;
});
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    open = jest.fn();
    constructor(
      _app: unknown,
      onConfirm: () => void,
      _content: unknown,
      _title: string,
      confirmButtonText: string
    ) {
      modalCtor(onConfirm, confirmButtonText);
    }
  },
}));

describe("BasicSettings", () => {
  describe("BasicSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      capturedOnConfirm = null;
      capturedConfirmButtonText = "";
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, vaultAgentFolder: "vault-agent" });
      vaultAgentRootContainsNotes.mockReturnValue(false);
      findVaultAgentRootFileConflict.mockReturnValue(null);
      isDesktopRuntime.mockReturnValue(true);
    });

    it("renders the settings copy in Simplified Chinese after switching language", () => {
      applyLanguage("zh-CN", []);
      try {
        render(<BasicSettings />);
        expect(screen.getByText("常规")).not.toBeNull();
        expect(screen.getByText("语言")).not.toBeNull();
        expect(screen.getByLabelText("Vault Agent 文件夹")).not.toBeNull();
      } finally {
        applyLanguage("en", []);
      }
    });

    it("puts the Agents section above General so setup comes before preferences", async () => {
      render(<BasicSettings />);
      const agents = await screen.findByTestId("agents-section");
      const general = screen.getByText("General");
      expect(
        agents.compareDocumentPosition(general) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("shows only the desktop notice without nonfunctional model controls on mobile (https://github.com/Brevilabs/obsidian-copilot-private/issues/373)", async () => {
      isDesktopRuntime.mockReturnValue(false);
      render(<BasicSettings />);
      expect(screen.getByText("Agent settings are available on desktop.")).not.toBeNull();
      expect(screen.queryByTestId("agents-section")).toBeNull();
      expect(screen.queryByText("Quick Chat models")).toBeNull();
      expect(screen.getByText("General")).not.toBeNull();
    });

    it("binds the Vault Agent folder input to the persisted root", () => {
      render(<BasicSettings />);
      expect(screen.getByLabelText<HTMLInputElement>("Vault Agent folder").value).toBe(
        "vault-agent"
      );
    });

    it("rejects an invalid root on Apply without opening the confirm modal", () => {
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Vault Agent folder"), {
        target: { value: "../escape" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply Vault Agent folder" }));
      expect(Notice).toHaveBeenCalledTimes(1);
      expect(modalCtor).not.toHaveBeenCalled();
      expect(applyVaultAgentRootChange).not.toHaveBeenCalled();
    });

    it("rejects a root inside the vault's active config directory", () => {
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Vault Agent folder"), {
        target: { value: ".vault-config/plugins" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply Vault Agent folder" }));

      expect(Notice).toHaveBeenCalledTimes(1);
      expect(modalCtor).not.toHaveBeenCalled();
      expect(applyVaultAgentRootChange).not.toHaveBeenCalled();
    });

    it("rejects a root whose path is occupied by an existing file without opening the confirm modal", () => {
      findVaultAgentRootFileConflict.mockReturnValue("ai.txt");
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Vault Agent folder"), {
        target: { value: "ai.txt" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply Vault Agent folder" }));
      expect(Notice).toHaveBeenCalledTimes(1);
      expect(modalCtor).not.toHaveBeenCalled();
      expect(applyVaultAgentRootChange).not.toHaveBeenCalled();
    });

    it("opens a warning confirmation for a root that already contains Markdown", () => {
      vaultAgentRootContainsNotes.mockReturnValue(true);
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Vault Agent folder"), {
        target: { value: "existing" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply Vault Agent folder" }));

      expect(modalCtor).toHaveBeenCalledTimes(1);
      expect(capturedConfirmButtonText).toBe("Use folder");
      expect(applyVaultAgentRootChange).not.toHaveBeenCalled();

      capturedOnConfirm?.();
      expect(applyVaultAgentRootChange).toHaveBeenCalledWith(expect.anything(), "existing");
    });

    it("still warns when the non-empty folder is a previously used Vault Agent root", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        vaultAgentFolder: "vault-agent",
        vaultAgentRootHistory: ["vault-agent", "old-root"],
      });
      vaultAgentRootContainsNotes.mockReturnValue(true);
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Vault Agent folder"), {
        target: { value: "old-root" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply Vault Agent folder" }));

      expect(vaultAgentRootContainsNotes).toHaveBeenCalledWith(expect.anything(), "old-root");
      expect(modalCtor).toHaveBeenCalledTimes(1);
      expect(capturedConfirmButtonText).toBe("Use folder");
    });

    it("opens the confirm modal for a valid new root and applies the change on confirm", () => {
      render(<BasicSettings />);
      fireEvent.change(screen.getByLabelText("Vault Agent folder"), { target: { value: "ai" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply Vault Agent folder" }));
      expect(modalCtor).toHaveBeenCalledTimes(1);
      expect(capturedConfirmButtonText).toBe("Change folder");
      expect(applyVaultAgentRootChange).not.toHaveBeenCalled();

      capturedOnConfirm?.();
      expect(applyVaultAgentRootChange).toHaveBeenCalledWith(expect.anything(), "ai");
    });

    it("does nothing when Apply is pressed with the current root unchanged", () => {
      render(<BasicSettings />);
      fireEvent.click(screen.getByRole("button", { name: "Apply Vault Agent folder" }));
      expect(modalCtor).not.toHaveBeenCalled();
      expect(applyVaultAgentRootChange).not.toHaveBeenCalled();
    });

    it("opens a blank vault AGENTS.md, never seeded from a Chat prompt", async () => {
      render(<BasicSettings />);
      fireEvent.click(await screen.findByRole("button", { name: /Open AGENTS.md/ }));
      await waitFor(() => expect(openAgentsFile).toHaveBeenCalledWith(expect.anything(), ""));
    });

    it("lands a pending edit before opening the file, so the open cannot race the save", async () => {
      render(<BasicSettings />);
      const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
      fireEvent.change(editor, { target: { value: "Always cite." } });

      fireEvent.click(screen.getByRole("button", { name: /Open AGENTS.md/ }));

      await waitFor(() => expect(openAgentsFile).toHaveBeenCalledWith(expect.anything(), ""));
      expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Always cite.");
      expect(writeAgentsFile.mock.invocationCallOrder[0]).toBeLessThan(
        openAgentsFile.mock.invocationCallOrder[0]
      );
    });

    it("shows what the vault AGENTS.md already says, so editing starts from the real file", async () => {
      readAgentsFile.mockResolvedValue("Cite every source.");
      render(<BasicSettings />);
      const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", {
        name: "Custom vault instructions",
      });
      expect(editor.value).toBe("Cite every source.");
      expect(readAgentsFile).toHaveBeenCalledWith(expect.anything(), "");
    });

    it("saves an edit back to the vault AGENTS.md once typing settles", async () => {
      jest.useFakeTimers();
      try {
        render(<BasicSettings />);
        const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
        fireEvent.change(editor, { target: { value: "Always cite." } });

        expect(writeAgentsFile).not.toHaveBeenCalled();
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });

        expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Always cite.");
      } finally {
        jest.useRealTimers();
      }
    });

    it("queues instruction writes so a slow save cannot land after — and overwrite — a newer one", async () => {
      jest.useFakeTimers();
      try {
        let settleFirst!: () => void;
        writeAgentsFile.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              settleFirst = resolve;
            })
        );
        render(<BasicSettings />);
        const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });

        fireEvent.change(editor, { target: { value: "First" } });
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
        expect(writeAgentsFile).toHaveBeenCalledTimes(1);

        fireEvent.change(editor, { target: { value: "Second" } });
        await act(async () => {
          jest.advanceTimersByTime(1000);
        });
        expect(writeAgentsFile).toHaveBeenCalledTimes(1);

        settleFirst();
        await act(async () => {
          await Promise.resolve();
        });

        expect(writeAgentsFile).toHaveBeenCalledTimes(2);
        expect(writeAgentsFile).toHaveBeenLastCalledWith(expect.anything(), "", "Second");
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not lose a pending edit when the tab closes mid-sentence", async () => {
      jest.useFakeTimers();
      try {
        const { unmount } = render(<BasicSettings />);
        const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
        fireEvent.change(editor, { target: { value: "Half a thou" } });
        unmount();
        await act(async () => {
          await Promise.resolve();
        });

        expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Half a thou");
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
