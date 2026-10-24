import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import { ReactModal } from "@/components/modals/ReactModal";
import { SubagentHistory, SubagentHistoryModal } from "@/agentMode/ui/SubagentHistoryModal";
import type { AgentChatMessage } from "@/agentMode/session/types";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div>{text}</div>,
}));
jest.mock("@/utils", () => ({
  cleanMessageForCopy: (text: string) => text,
  insertAtCursor: jest.fn(),
}));

const messages: readonly AgentChatMessage[] = [
  { id: "user", sender: "user", timestamp: null, isVisible: true, message: "Check the saved note" },
  {
    id: "answer",
    sender: "ai",
    timestamp: null,
    isVisible: true,
    message: "Saved child answer",
    parts: [{ kind: "text", text: "Saved child answer" }],
    turnStopReason: "end_turn",
    turnDurationMs: 1200,
  },
];

describe("SubagentHistoryModal", () => {
  describe("SubagentHistory()", () => {
    it("shows a clear empty state when no visible saved messages exist https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      render(<SubagentHistory app={new App()} messages={[{ ...messages[0], isVisible: false }]} />);
      expect(screen.getByText("No saved messages yet.")).toBeTruthy();
      expect(screen.queryByText("Check the saved note")).toBeNull();
    });
  });

  describe("SubagentHistoryModal", () => {
    describe("constructor()", () => {
      it("titles the native dialog as saved subtask history", () => {
        const modal = new SubagentHistoryModal(new App(), messages);
        expect(modal.titleEl.textContent).toBe("Subtask history");
      });
    });

    describe("onOpen()", () => {
      it("opens actual saved answer parts without a composer, write actions, or rerunning a child https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const openHistory = jest.fn(async () => undefined);
        const modal = new SubagentHistoryModal(new App(), messages, openHistory);
        modal.contentEl.empty = () => modal.contentEl.replaceChildren();
        document.body.appendChild(modal.containerEl);
        try {
          await act(async () => ReactModal.prototype.onOpen.call(modal));
          const content = within(modal.contentEl);
          expect(content.getByText("Check the saved note")).toBeTruthy();
          expect(content.getByText("Saved child answer")).toBeTruthy();
          expect(
            content.getByText("Read-only history. Viewing it does not rerun the subtask.")
          ).toBeTruthy();
          expect(content.queryByRole("textbox")).toBeNull();
          expect(content.queryByTitle("Insert / Replace at cursor")).toBeNull();
          expect(openHistory).not.toHaveBeenCalled();
        } finally {
          await act(async () => ReactModal.prototype.onClose.call(modal));
          modal.containerEl.remove();
        }
      });
    });
  });
});
