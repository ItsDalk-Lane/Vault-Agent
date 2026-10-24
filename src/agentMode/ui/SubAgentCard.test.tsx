import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SubAgentCard, SubagentHistoryOpenerContext } from "./SubAgentCard";
import type { ToolCallPart } from "./agentTrail";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div>{text}</div>,
}));

const parent: ToolCallPart = {
  kind: "tool_call",
  id: "parent",
  title: "Agent",
  vendorToolName: "Agent",
  status: "completed",
  input: {
    subagent_type: "researcher",
    description: "Check notes",
    childConversationId: "child-7",
  },
};

describe("SubAgentCard", () => {
  describe("SubAgentCard()", () => {
    it("opens saved child history only after the user chooses to view it https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const open = jest.fn(async () => undefined);
      render(
        <SubagentHistoryOpenerContext.Provider value={open}>
          <SubAgentCard parent={parent} childNodes={[]} app={{} as never} renderNode={() => null} />
        </SubagentHistoryOpenerContext.Provider>
      );
      expect(open).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /Check notes/ }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "View subtask history" }));
        await open.mock.results[0].value;
      });
      expect(open).toHaveBeenCalledWith("child-7");
    });

    it("keeps a failed history load visible and allows a deliberate retry https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let fail!: (error: Error) => void;
      const pending = new Promise<void>((_resolve, reject) => {
        fail = reject;
      });
      const open = jest.fn(() => pending);
      render(
        <SubagentHistoryOpenerContext.Provider value={open}>
          <SubAgentCard parent={parent} childNodes={[]} app={{} as never} renderNode={() => null} />
        </SubagentHistoryOpenerContext.Provider>
      );
      fireEvent.click(screen.getByRole("button", { name: /Check notes/ }));
      fireEvent.click(screen.getByRole("button", { name: "View subtask history" }));
      expect(screen.getByRole("button", { name: "Loading history…" })).toHaveProperty(
        "disabled",
        true
      );
      await act(async () => {
        fail(new Error("Saved history is unavailable"));
        await pending.catch(() => undefined);
      });
      expect(screen.getByRole("alert").textContent).toBe("Saved history is unavailable");
      expect(screen.getByRole("button", { name: "View subtask history" })).toHaveProperty(
        "disabled",
        false
      );
    });

    it("does not advertise unavailable history for a tool without a saved child id https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const open = jest.fn(async () => undefined);
      render(
        <SubagentHistoryOpenerContext.Provider value={open}>
          <SubAgentCard
            parent={{ ...parent, input: { description: "Check notes" } }}
            childNodes={[]}
            app={{} as never}
            renderNode={() => null}
          />
        </SubagentHistoryOpenerContext.Provider>
      );
      fireEvent.click(screen.getByRole("button", { name: /Check notes/ }));
      expect(screen.queryByRole("button", { name: "View subtask history" })).toBeNull();
      expect(open).not.toHaveBeenCalled();
    });
  });
});
