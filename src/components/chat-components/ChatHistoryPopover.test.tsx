import { ChatHistoryPopover } from "@/components/chat-components/ChatHistoryPopover";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 保持被替换 hook 的公开名称
  useApp: () => ({}),
}));
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn(() => ({ open: jest.fn() })),
}));

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn(() => ({ chatHistorySortStrategy: "recent" })),
}));

const issue = "https://github.com/Brevilabs/obsidian-copilot-private/issues/429";
const history = ["Open research", "Saved research"].map((title, index) => ({
  id: `root-${index + 1}`,
  title,
  createdAt: new Date(),
  lastAccessedAt: new Date(),
}));

describe("ChatHistoryPopover", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.IntersectionObserver = jest.fn(() => ({
      observe: jest.fn(),
      disconnect: jest.fn(),
    })) as unknown as typeof IntersectionObserver;
  });
  describe("ChatHistoryPopover()", () => {
    it("opens a permanent deletion dialog before stopping a running chat https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onDeleteChat = jest.fn(async () => {});
      render(
        <ChatHistoryPopover
          chatHistory={history}
          onUpdateTitle={jest.fn()}
          onDeleteChat={onDeleteChat}
          runningChatIds={new Set([history[0].id])}
        >
          <button type="button">History</button>
        </ChatHistoryPopover>
      );
      fireEvent.click(screen.getByText("History"));
      fireEvent.click(screen.getAllByTitle("Permanently delete")[0]);
      expect(onDeleteChat).not.toHaveBeenCalled();
      expect(ConfirmModal).toHaveBeenCalledWith(
        {},
        expect.any(Function),
        "Stop this chat and permanently delete all its local records, attachments and revert backups? This cannot be undone.",
        "Delete chat",
        "Permanently delete",
        "Cancel",
        undefined,
        true
      );
      await act(async () => {
        await jest.mocked(ConfirmModal).mock.calls[0][1]();
      });
      expect(onDeleteChat).toHaveBeenCalledWith(history[0].id);
    });
    it(`${issue} closes an open session while preserving its saved history and leaving the popover open`, async () => {
      const onCloseSession = jest.fn(async () => {});
      const onLoadChat = jest.fn(async () => {});
      const onDeleteChat = jest.fn(async () => {});
      const props = {
        chatHistory: history,
        onUpdateTitle: jest.fn(),
        onDeleteChat,
        onLoadChat,
        onCloseSession,
      };
      const { rerender } = render(
        <ChatHistoryPopover {...props} openChatIds={new Set([history[0].id])}>
          <button type="button">History</button>
        </ChatHistoryPopover>
      );
      fireEvent.click(screen.getByText("History"));
      expect(screen.getAllByLabelText("Session live")).toHaveLength(1);
      const button = screen.getByRole("button", { name: "Close session" });
      fireEvent.keyDown(button, { key: "Enter" });
      await act(async () => fireEvent.click(button));
      expect(onCloseSession).toHaveBeenCalledWith(history[0].id);
      expect(onLoadChat).not.toHaveBeenCalled();
      expect(onDeleteChat).not.toHaveBeenCalled();
      rerender(
        <ChatHistoryPopover {...props} openChatIds={new Set()}>
          <button type="button">History</button>
        </ChatHistoryPopover>
      );
      expect(screen.queryByLabelText("Session live")).toBeNull();
      expect(screen.queryByRole("button", { name: "Close session" })).toBeNull();
      expect(screen.getByText("Open research")).toBeTruthy();
      expect(screen.getByText("Saved research")).toBeTruthy();
      await act(async () =>
        fireEvent.keyDown(screen.getByRole("button", { name: "Open research" }), { key: "Enter" })
      );
      expect(onLoadChat).toHaveBeenCalledWith(history[0].id);
    });

    it(`${issue} keeps the live-session dot while showing the responding spinner`, () => {
      render(
        <ChatHistoryPopover
          chatHistory={history}
          openChatIds={new Set(history.map((chat) => chat.id))}
          runningChatIds={new Set([history[0].id])}
          onCloseSession={async () => {}}
          onUpdateTitle={async () => {}}
          onDeleteChat={async () => {}}
          onLoadChat={async () => {}}
        >
          <button type="button">History</button>
        </ChatHistoryPopover>
      );

      fireEvent.click(screen.getByText("History"));
      expect(screen.getByLabelText("Responding")).toBeTruthy();
      expect(screen.getAllByLabelText("Session live")).toHaveLength(2);
    });
  });
});
