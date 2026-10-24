import { registerEditorCommandMenu } from "./editorCommandMenu";
import { getCachedCustomCommands } from "@/commands/state";
import type VaultAgentPlugin from "@/main";
import {
  TFile,
  type App,
  type Editor,
  type MarkdownView,
  type Menu,
  type MenuItem,
} from "obsidian";

jest.mock("@/commands/state", () => ({ getCachedCustomCommands: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";

describe("editorCommandMenu", () => {
  describe("registerEditorCommandMenu()", () => {
    it(`registers the live editor menu and carries the original selection to an unsent command draft (${ISSUE})`, () => {
      let onMenu!: (menu: Menu, editor: Editor, view: MarkdownView) => void;
      const ref = {};
      const registerEvent = jest.fn();
      const newAgentChatWithDraft = jest.fn().mockResolvedValue(undefined);
      const plugin = {
        registerEvent,
        newAgentChatWithDraft,
        app: {
          workspace: {
            on: (_name: string, listener: typeof onMenu) => {
              onMenu = listener;
              return ref;
            },
          },
        } as unknown as App,
      } as unknown as VaultAgentPlugin;
      registerEditorCommandMenu(plugin);
      expect(registerEvent).toHaveBeenCalledWith(ref);
      jest.mocked(getCachedCustomCommands).mockReturnValue([
        {
          title: "Summary",
          content: "Summarize {}",
          showInContextMenu: true,
          showInSlashMenu: true,
          modelKey: "saved",
          order: 1,
          lastUsedMs: 0,
        },
        {
          title: "Hidden",
          content: "Hidden",
          showInContextMenu: false,
          showInSlashMenu: true,
          modelKey: "",
          order: 2,
          lastUsedMs: 0,
        },
      ]);
      const titles: string[] = [];
      let select!: () => void;
      const item = {
        setTitle: (title: string) => {
          titles.push(title);
          return item;
        },
        setIcon: () => item,
        setSection: () => item,
        onClick: (action: () => void) => {
          select = action;
          return item;
        },
      } as unknown as MenuItem;
      const menu = { addItem: (build: (item: MenuItem) => void) => build(item) } as unknown as Menu;
      const file = new TFile();
      file.path = "Source.md";
      onMenu(menu, { getSelection: () => "original excerpt" } as Editor, { file } as MarkdownView);
      expect(titles).toEqual(["Vault Agent: Summary"]);
      expect(newAgentChatWithDraft).not.toHaveBeenCalled();
      select();
      expect(newAgentChatWithDraft).toHaveBeenCalledWith("/Summary", {
        selectedText: "original excerpt",
        activeFile: file,
      });
    });
  });
});
