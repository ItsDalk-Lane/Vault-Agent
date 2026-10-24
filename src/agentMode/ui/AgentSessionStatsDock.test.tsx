import { AgentSessionStatsDock } from "@/agentMode/ui/AgentSessionStatsDock";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentChatMessage, SessionUsage } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function createBackend(usage: SessionUsage | null): AgentChatBackend {
  return {
    subscribe: () => () => undefined,
    getSessionUsage: () => usage,
  } as unknown as AgentChatBackend;
}

function messages(): AgentChatMessage[] {
  return [
    { id: "u1", sender: "user", timestamp: null, isVisible: true, message: "go" },
    {
      id: "a1",
      sender: "ai",
      timestamp: null,
      isVisible: true,
      message: "answer",
      turnUsage: {
        inputTokens: 1_500,
        outputTokens: 300,
        cacheReadTokens: 2_700,
        cacheWriteTokens: 0,
        modelRequests: 2,
        modelDurationMs: 4_000,
        toolDurationMs: 1_000,
        ttftMs: 250,
        modelId: "m1",
      },
    },
  ];
}

describe("AgentSessionStatsDock", () => {
  describe("AgentSessionStatsDock()", () => {
    it("renders nothing before any round or committed usage exists (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      const { container } = render(
        <AgentSessionStatsDock backend={createBackend(null)} messages={[]} />
      );

      expect(container.firstElementChild).toBeNull();
    });

    it("shows rounds, steps and output speed on the activity capsule (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      render(<AgentSessionStatsDock backend={createBackend(null)} messages={messages()} />);

      expect(screen.getByText(/1 rounds/)).toBeTruthy();
      expect(screen.getByText(/2 steps/)).toBeTruthy();
      expect(screen.getByText(/75 tok\/s/)).toBeTruthy();
    });

    it("shows total tokens and cache hit on the usage capsule (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      render(<AgentSessionStatsDock backend={createBackend(null)} messages={messages()} />);

      expect(screen.getByText(/4.5K tok/)).toBeTruthy();
      expect(screen.getByText(/Cache hit 64%/)).toBeTruthy();
    });

    it("opens the session statistics popup with model and tool time plus TTFT (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      render(<AgentSessionStatsDock backend={createBackend(null)} messages={messages()} />);
      fireEvent.click(screen.getByRole("button", { name: "Session statistics" }));

      expect(screen.getByText("Model time")).toBeTruthy();
      expect(screen.getByText("4.0s")).toBeTruthy();
      expect(screen.getByText("Tool time")).toBeTruthy();
      expect(screen.getByText("1.0s")).toBeTruthy();
      expect(screen.getByText("Avg. first token")).toBeTruthy();
      expect(screen.getByText("0.3s")).toBeTruthy();
    });

    it("opens the token usage popup with the context ring row (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      render(
        <AgentSessionStatsDock
          backend={createBackend({
            usedTokens: 4_500,
            contextWindow: 100_000,
            updatedAt: 1,
          })}
          messages={messages()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Token usage" }));

      expect(screen.getByText("Token usage")).toBeTruthy();
      expect(screen.getByText("4,500 tok")).toBeTruthy();
      expect(screen.getByText("Context window")).toBeTruthy();
      expect(screen.getByText(/4.5K \/ 100.0K \(5%\)/)).toBeTruthy();
      expect(screen.getByText("64%")).toBeTruthy();
    });
  });
});
