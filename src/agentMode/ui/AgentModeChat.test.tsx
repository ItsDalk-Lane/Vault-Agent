import { AgentModeChat } from "./AgentModeChat";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type VaultAgentPlugin from "@/main";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode/backends/registry", () => ({
  creatableBackendDescriptors: () => [{ id: "pi", displayName: "Vault Agent" }],
}));
jest.mock("./AgentHome", () => ({ AgentHome: () => <div>Saved conversation</div> }));
jest.mock("./AgentModeStatus", () => ({ AgentModeStatus: () => <div>Recovery status</div> }));
jest.mock("./GlobalRecentChatsSection", () => ({
  GlobalRecentChatsSection: ({ onLoadHistory }: { onLoadHistory: () => void }) => {
    React.useEffect(() => {
      void onLoadHistory();
    }, [onLoadHistory]);
    return <div>Recent chats</div>;
  },
}));

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
    subscribeStorageChanges: () => () => undefined,
    getOrCreateActiveSession: jest.fn().mockResolvedValue(undefined),
    getChatHistoryItems: jest.fn().mockResolvedValue([]),
    getLocalDataBackend: jest
      .fn()
      .mockResolvedValue({ subscribeStorageChanges: () => () => undefined }),
  };
  const view = (
    <AgentModeChat
      plugin={{ agentSessionManager: manager } as unknown as VaultAgentPlugin}
      updateUserMessageHistory={() => undefined}
    />
  );
  return { manager, view };
}

describe("AgentModeChat", () => {
  describe("AgentModeChat()", () => {
    it("creates a chat only after an explicit new-chat action https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { manager, view } = setup();
      render(view);
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "New Chat" }));
      await waitFor(() => expect(manager.getOrCreateActiveSession).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/install|sign-in|Configure/i)).toBeNull();
    });

    it("loads the current scope history without creating a placeholder chat https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { manager, view } = setup();
      manager.getSessionsForScope.mockReturnValue([{ internalId: "saved" } as AgentSession]);
      render(view);
      await waitFor(() =>
        expect(manager.getChatHistoryItems).toHaveBeenCalledWith("current-project")
      );
      expect(screen.getByText("Recent chats")).not.toBeNull();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("waits for model loading before starting and leaves retry errors actionable", async () => {
      const { manager, view } = setup();
      manager.isPreloadReady.mockReturnValue(false);
      const { rerender } = render(view);
      expect(screen.getByText("Loading agent models…")).not.toBeNull();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
      manager.getLastError.mockReturnValue("Model unavailable");
      rerender(
        <AgentModeChat
          plugin={{ agentSessionManager: manager } as unknown as VaultAgentPlugin}
          updateUserMessageHistory={() => undefined}
        />
      );
      await waitFor(() => expect(manager.getChatHistoryItems).toHaveBeenCalled());
      expect(screen.getByText("Recovery status")).not.toBeNull();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("keeps an already open saved conversation visible while model loading is pending https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { manager, view } = setup();
      const saved = { internalId: "saved", backendId: "pi" } as AgentSession;
      manager.getActiveSession.mockReturnValue(saved);
      manager.getActiveChatUIState.mockReturnValue({});
      manager.getSessionsForScope.mockReturnValue([saved]);
      manager.isPreloadReady.mockReturnValue(false);
      render(view);
      expect(screen.getByText("Saved conversation")).not.toBeNull();
      expect(screen.queryByText("Loading agent models…")).toBeNull();
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("does not start another session while a current start is pending", async () => {
      const { manager, view } = setup();
      manager.getIsStarting.mockReturnValue(true);
      render(view);
      await waitFor(() => expect(manager.getChatHistoryItems).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: "New Chat" }).hasAttribute("disabled")).toBe(true);
      expect(manager.getOrCreateActiveSession).not.toHaveBeenCalled();
    });

    it("records an explicit startup failure without hiding the recovery controls", async () => {
      const { manager, view } = setup();
      manager.getOrCreateActiveSession.mockRejectedValue(new Error("failed"));
      render(view);
      fireEvent.click(screen.getByRole("button", { name: "New Chat" }));
      await waitFor(() => expect(manager.getOrCreateActiveSession).toHaveBeenCalled());
      expect(screen.getByText("Recovery status")).not.toBeNull();
    });

    it("renders nothing before the session manager is available", () => {
      const { container } = render(
        <AgentModeChat plugin={{} as VaultAgentPlugin} updateUserMessageHistory={() => undefined} />
      );
      expect(container.firstChild).toBeNull();
    });
  });
});
