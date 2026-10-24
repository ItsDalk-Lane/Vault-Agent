import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AI_SENDER } from "@/constants";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div>{text}</div>,
}));

jest.mock("@/agentMode/backends/registry", () => ({
  describeBackendForHistory: (id: string) => ({ id, label: id }),
}));

jest.mock("@/utils", () => ({
  cleanMessageForCopy: (text: string) => text,
  insertAtCursor: jest.fn(),
}));

describe("FanoutMessageCard", () => {
  describe("FanoutMessageCard()", () => {
    it("offers explicit recovery for unfinished saved answers without starting work on render https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const resume = jest.fn();
      const turn: FanoutTurn = {
        answers: {
          a: { backendId: "pi", status: "cancelled", text: "partial", modelKey: "a" },
          b: { backendId: "pi", status: "done", text: "answer", modelKey: "b" },
        },
        summary: { status: "done", text: "", complete: false },
        checkpoint: {
          fanoutId: "turn",
          mainModelKey: "a",
          originalPromptText: "Question",
          prompt: [{ type: "text", text: "Question" }],
        },
      };
      const message = {
        id: "resume",
        sender: AI_SENDER,
        message: "",
        isVisible: true,
      } as AgentChatMessage;
      const { rerender } = render(
        <TooltipProvider>
          <FanoutMessageCard message={message} turn={turn} app={{} as never} onResume={resume} />
        </TooltipProvider>
      );
      expect(resume).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Continue unfinished answers" }));
      expect(resume).toHaveBeenCalledTimes(1);
      rerender(
        <TooltipProvider>
          <FanoutMessageCard
            message={message}
            turn={turn}
            app={{} as never}
            onResume={resume}
            isRunning
          />
        </TooltipProvider>
      );
      expect(screen.queryByRole("button", { name: "Continue unfinished answers" })).toBeNull();
    });
    it("shows supplied duration metadata beside the timestamp in the response footer https://github.com/ItsDalk-Lane/Vault-Agent/issues/6", () => {
      const timestamp = "2026/08/07 20:31:10";
      const message: AgentChatMessage = {
        id: "fanout-1",
        sender: AI_SENDER,
        message: "Summary response",
        timestamp: { epoch: 1, display: timestamp, fileName: "now" },
        isVisible: true,
      };
      const turn: FanoutTurn = {
        answers: {},
        summary: { status: "done", text: "Summary response" },
      };

      const { rerender } = render(
        <TooltipProvider>
          <FanoutMessageCard
            message={message}
            turn={turn}
            app={{} as never}
            footerStart={<span>Worked for 24s</span>}
          />
        </TooltipProvider>
      );

      expect(screen.getByText("Summary response")).toBeTruthy();
      expect(screen.getByText("Worked for 24s")).toBeTruthy();
      expect(screen.getByTitle("Copy")).toBeTruthy();
      expect(screen.getByText(timestamp)).toBeTruthy();

      rerender(
        <TooltipProvider>
          <FanoutMessageCard message={message} turn={turn} app={{} as never} />
        </TooltipProvider>
      );
      expect(screen.getByText(timestamp)).toBeTruthy();
      expect(screen.queryByText("Worked for 24s")).toBeNull();
    });
  });
});
