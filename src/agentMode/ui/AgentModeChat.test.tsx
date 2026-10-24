import { AgentModeChat } from "./AgentModeChat";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type VaultAgentPlugin from "@/main";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode/backends/registry", () => ({
  creatableBackendDescriptors: () => [{ id: "pi", displayName: "Vault Agent" }],
}));
jest.mock("./AgentHome", () => ({ AgentHome: () => <div>Saved conversation</div> }));
jest.mock("./AgentModeStatus", () => ({ AgentModeStatus: () => <div>Recovery status</div> }));
jest.mock("./AgentChatControls", () => ({ AgentChatControls: () => <div>Chat controls</div> }));

function setup() {
  const manager = {
    subscribe: () => () => undefined,
    isPreloadReady: jest.fn(() => true),
    getSessionsForScope: jest.fn(() => [] as AgentSession[]),
    getActiveProjectId: () => "current-project",
    getIsStarting: jest.fn(() => false),
    getLastError: jest.fn(() => null as string | null),
    getActiveSession: jest.fn(() => null as AgentSession | null),
    getActiveChatUIState: jest.fn(() => null as object | null),
    getOrCreateActiveSession: jest.fn().mockResolvedValue(undefined),
  };
  const view = (
    <AgentModeChat
      plugin={{ agentSessionManager: manager } as unknown as VaultAgentPlugin}
      onSaveChat={() => undefined}
      updateUserMessageHistory={() => undefined}
    />
  );
  return { manager, view };
}

describe("AgentModeChat", () => {
  describe("AgentModeChat()", () => {
    it("starts the current scope using the bundled engine without installation or authentication screens https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { manager, view } = setup();
      render(view);
      expect(manager.getOrCreateActiveSession).toHaveBeenCalledTimes(1);
      expect(manager.getSessionsForScope).toHaveBeenCalledWith("current-project");
      expect(screen.getByText("Chat controls")).not.toBeNull();
      expect(screen.queryByText(/install|sign-in|Configure/i)).toBeNull();
    });

    it("does not start a new conversation over an existing current-scope chat", () => {
      const { manager, view } = setup();
      manager.getSessionsForScope.mockReturnValue([{ internalId: "saved" } as AgentSession]);
      render(view);
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("waits for model loading before starting and leaves retry errors actionable", () => {
      const { manager, view } = setup();
      manager.isPreloadReady.mockReturnValue(false);
      const { rerender } = render(view);
      expect(screen.getByText("Loading agent models…")).not.toBeNull();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
      manager.getLastError.mockReturnValue("Model unavailable");
      rerender(
        <AgentModeChat
          plugin={{ agentSessionManager: manager } as unknown as VaultAgentPlugin}
          onSaveChat={() => undefined}
          updateUserMessageHistory={() => undefined}
        />
      );
      expect(screen.getByText("Recovery status")).not.toBeNull();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("keeps an already open historical conversation visible while model loading is pending https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { manager, view } = setup();
      const saved = { internalId: "legacy", backendId: "claude" } as AgentSession;
      manager.getActiveSession.mockReturnValue(saved);
      manager.getActiveChatUIState.mockReturnValue({});
      manager.getSessionsForScope.mockReturnValue([saved]);
      manager.isPreloadReady.mockReturnValue(false);
      render(view);
      expect(screen.getByText("Saved conversation")).not.toBeNull();
      expect(screen.queryByText("Loading agent models…")).toBeNull();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("does not start another session while a current start is pending", () => {
      const { manager, view } = setup();
      manager.getIsStarting.mockReturnValue(true);
      render(view);
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("records an automatic startup failure without hiding the recovery controls", async () => {
      const { manager, view } = setup();
      manager.getOrCreateActiveSession.mockRejectedValue(new Error("failed"));
      render(view);
      await waitFor(() => expect(manager.getOrCreateActiveSession).toHaveBeenCalled());
      expect(screen.getByText("Chat controls")).not.toBeNull();
    });

    it("renders nothing before the session manager is available", () => {
      const { container } = render(
        <AgentModeChat
          plugin={{} as VaultAgentPlugin}
          onSaveChat={() => undefined}
          updateUserMessageHistory={() => undefined}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });
});
