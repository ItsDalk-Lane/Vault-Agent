import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentReasoningBlock", () => {
  describe("AgentReasoningBlock()", () => {
    it("keeps the brain icon when reasoning changes from active to complete", () => {
      const { container, rerender } = render(
        <AgentReasoningBlock
          status="reasoning"
          elapsedSeconds={3}
          steps={["Inspecting the current interface"]}
        />
      );

      expect(container.querySelector(".lucide-brain")).toBeTruthy();
      expect(container.querySelector(".vault-agent-spinner")).toBeNull();
      expect(container.textContent).toContain("Reasoning...");
      expect(screen.queryByText("3s")).toBeNull();
      expect(container.querySelector(".vault-agent-shimmer-text")?.textContent).toBe("...");

      rerender(
        <AgentReasoningBlock
          status="complete"
          elapsedSeconds={4}
          steps={["Inspecting the current interface"]}
        />
      );

      expect(container.querySelector(".lucide-brain")).toBeTruthy();
      expect(container.querySelector(".vault-agent-spinner")).toBeNull();
      expect(screen.getByText("Thought for")).toBeTruthy();
      expect(screen.getByText("4s")).toBeTruthy();
      expect(container.querySelector(".vault-agent-shimmer-text")).toBeNull();
    });

    it("renders expanded text layout as one joined panel without list markers (https://github.com/ItsDalk-Lane/Vault-Agent/issues/10)", () => {
      const { container } = render(
        <AgentReasoningBlock
          status="complete"
          elapsedSeconds={4}
          steps={["First thought.", "Second thought."]}
          layout="text"
        />
      );

      fireEvent.click(screen.getByRole("button"));
      expect(container.textContent).toContain("First thought.\n\nSecond thought.");
      expect(container.querySelector("ul")).toBeNull();
    });

    it("keeps the step list for the default layout (https://github.com/ItsDalk-Lane/Vault-Agent/issues/10)", () => {
      const { container } = render(
        <AgentReasoningBlock status="complete" elapsedSeconds={4} steps={["Only step"]} />
      );

      fireEvent.click(screen.getByRole("button"));
      expect(container.querySelector("ul li")).toBeTruthy();
    });
  });
});
