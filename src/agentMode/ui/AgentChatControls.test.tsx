import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { TooltipProvider } from "@/components/ui/tooltip";

jest.mock("@/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn(() => ({ chatHistorySortStrategy: "recent" })),
}));
jest.mock("@/agentMode/backends/registry", () => ({
  describeBackendForHistory: (id: string) => ({ id, label: id, displayName: id }),
}));

describe("AgentChatControls", () => {
  describe("AgentChatControls()", () => {
    it("sends a deliberate pause from the chat actions without stopping or undoing work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onPause = jest.fn(async () => undefined);
      render(
        <TooltipProvider>
          <AgentChatControls onNewChat={() => undefined} onPause={onPause} />
        </TooltipProvider>
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "controls.moreActions" }), {
        key: "Enter",
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "controls.pauseWork" }));
      await waitFor(() => expect(onPause).toHaveBeenCalledTimes(1));
    });

    it("offers an explicit summary-and-new-chat action and disables it while current work is active https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onRolloverSession = jest.fn();
      const props = { onNewChat: () => undefined, onRolloverSession, rolloverDisabled: false };
      const { rerender } = render(
        <TooltipProvider>
          <AgentChatControls {...props} />
        </TooltipProvider>
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "controls.moreActions" }), {
        key: "Enter",
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "controls.rolloverSession" }));
      expect(onRolloverSession).toHaveBeenCalledTimes(1);
      const disabledProps = { ...props, rolloverDisabled: true };
      rerender(
        <TooltipProvider>
          <AgentChatControls {...disabledProps} />
        </TooltipProvider>
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "controls.moreActions" }), {
        key: "Enter",
      });
      const disabled = await screen.findByRole("menuitem", { name: "controls.rolloverSession" });
      expect(disabled.getAttribute("data-disabled")).not.toBeNull();
      fireEvent.click(disabled);
      expect(onRolloverSession).toHaveBeenCalledTimes(1);
    });

    it("lets the user explicitly export a standalone chat copy https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onExportArchive = jest.fn();
      render(
        <TooltipProvider>
          <AgentChatControls onNewChat={() => undefined} onExportArchive={onExportArchive} />
        </TooltipProvider>
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "controls.moreActions" }), {
        key: "Enter",
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "controls.exportArchive" }));
      expect(onExportArchive).toHaveBeenCalledTimes(1);
    });

    it("forks a settled chat when the action is enabled https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onForkChat = jest.fn();
      render(
        <TooltipProvider>
          <AgentChatControls onNewChat={() => undefined} onForkChat={onForkChat} />
        </TooltipProvider>
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "controls.moreActions" }), {
        key: "Enter",
      });
      fireEvent.click(await screen.findByRole("menuitem", { name: "localData.fork" }));
      expect(onForkChat).toHaveBeenCalledTimes(1);
    });
    it("prevents forking while work or pending decisions make the action unavailable https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onForkChat = jest.fn();
      render(
        <TooltipProvider>
          <AgentChatControls onNewChat={() => undefined} onForkChat={onForkChat} forkDisabled />
        </TooltipProvider>
      );
      fireEvent.keyDown(screen.getByRole("button", { name: "controls.moreActions" }), {
        key: "Enter",
      });
      const item = await screen.findByRole("menuitem", { name: "localData.fork" });
      expect(item.getAttribute("data-disabled")).not.toBeNull();
      fireEvent.click(item);
      expect(onForkChat).not.toHaveBeenCalled();
    });
  });
});
