import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor } from "@/agentMode/session/types";
import type VaultAgentPlugin from "@/main";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

let descriptor: BackendDescriptor;

jest.mock("@/agentMode/backends/registry", () => ({
  creatableBackendDescriptors: () => [descriptor],
}));

// The status strip only reports a held config change and a boot error now; install/upgrade/sign-in
// actions belonged to the removed legacy execution chains.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
describe("AgentModeStatus", () => {
  describe("AgentModeStatus()", () => {
    beforeEach(() => {
      descriptor = { id: "pi", displayName: "Pi" } as unknown as BackendDescriptor;
    });

    it("stays hidden when there is no held config change and no boot error", () => {
      const plugin = { app: {} } as unknown as VaultAgentPlugin;
      const manager = {
        subscribe: () => () => undefined,
        hasHeldConfigChange: () => false,
        isBackendRestartPending: () => false,
        getLastError: () => null,
      } as unknown as AgentSessionManager;

      const { container } = render(<AgentModeStatus manager={manager} plugin={plugin} />);

      expect(container.firstChild).toBeNull();
    });

    it("offers to reload when the running agent's settings changed", () => {
      const plugin = { app: {} } as unknown as VaultAgentPlugin;
      const applyHeldConfigChange = jest.fn(async () => undefined);
      const manager = {
        subscribe: () => () => undefined,
        hasHeldConfigChange: () => true,
        isBackendRestartPending: () => false,
        applyHeldConfigChange,
        getLastError: () => null,
      } as unknown as AgentSessionManager;

      render(<AgentModeStatus manager={manager} plugin={plugin} />);
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));

      expect(applyHeldConfigChange).toHaveBeenCalledWith("pi");
    });

    it("keeps a boot error with a retry action", () => {
      const plugin = { app: {} } as unknown as VaultAgentPlugin;
      const getOrCreateActiveSession = jest.fn(async () => undefined);
      const manager = {
        subscribe: () => () => undefined,
        hasHeldConfigChange: () => false,
        isBackendRestartPending: () => false,
        getLastError: () => "Pi runtime failed to start",
        getOrCreateActiveSession,
      } as unknown as AgentSessionManager;

      render(<AgentModeStatus manager={manager} plugin={plugin} />);

      expect(screen.getByText("Pi runtime failed to start")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(getOrCreateActiveSession).toHaveBeenCalledTimes(1);
    });
  });
});
