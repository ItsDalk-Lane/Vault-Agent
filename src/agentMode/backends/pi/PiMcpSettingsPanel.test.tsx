import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import type VaultAgentPlugin from "@/main";
import type { VaultAgentSettings } from "@/settings/model";
import { setSettings, updateAgentModeBackendFields } from "@/settings/model";
import { PiMcpSettingsPanel } from "./PiMcpSettingsPanel";
import { PiMcpService } from "@/agentMode/sdk/pi/mcp/PiMcpService";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";

let mockSettings: VaultAgentSettings;
const mockKeychain = {
  isAvailable: () => true,
  getVaultId: () => "panel-vault",
  getSecretById: () => null,
  setSecretById: jest.fn(),
  deleteSecretById: jest.fn(),
};
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  useSettingsValue: jest.fn(() => mockSettings),
  subscribeToSettingsChange: () => () => undefined,
  updateAgentModeBackendFields: jest.fn(),
  setSettings: jest.fn(),
}));
jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: () => mockKeychain },
}));
jest.mock("@/logger", () => ({ logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/components/modals/ConfirmModal", () => ({ ConfirmModal: class {} }));
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: () => jest.requireActual("node:path"),
}));

function show() {
  return render(
    <PiMcpSettingsPanel
      app={{} as App}
      plugin={
        {
          agentSessionManager: { getActiveProjectId: () => "project-a" },
        } as unknown as VaultAgentPlugin
      }
    />
  );
}

describe("PiMcpSettingsPanel", () => {
  describe("PiMcpSettingsPanel()", () => {
    beforeEach(() => {
      mockSettings = {
        configuredModels: [],
        providers: {},
        backends: {},
        agentMode: { backends: { pi: {} } },
      } as unknown as VaultAgentSettings;
      jest.clearAllMocks();
      Object.defineProperty(window.crypto, "randomUUID", {
        configurable: true,
        value: () => "test-server-id",
      });
    });

    it("saves a reviewed server through real settings while keeping its password exclusively in keychain https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      show();
      fireEvent.click(screen.getByText("Add server"));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs" } });
      fireEvent.change(screen.getByLabelText("Server URL"), {
        target: { value: "https://docs.example.com/mcp" },
      });
      fireEvent.change(screen.getByLabelText(/Access token/), {
        target: { value: "private-panel-token" },
      });
      fireEvent.click(screen.getByText("Save and enable"));
      const saved = jest.mocked(updateAgentModeBackendFields).mock.calls[0]?.[1];
      expect(saved).toMatchObject({
        mcpServers: [
          expect.objectContaining({
            displayName: "Docs",
            enabled: true,
            trusted: true,
            toolExposure: "deferred",
          }),
        ],
      });
      expect(JSON.stringify(saved)).not.toContain("private-panel-token");
      expect(mockKeychain.setSecretById).toHaveBeenCalledWith(
        expect.stringMatching(/^mcp:panel-vault-/),
        "Bearer private-panel-token"
      );
    });

    it("wires test, connect, disable and delete to the stored server https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const config = normalizeMcpServerConfig({
        serverId: "docs",
        displayName: "Docs",
        enabled: true,
        trusted: true,
        transport: { kind: "http", url: "https://docs.example.com/mcp", headerSecretRefs: {} },
      });
      mockSettings.agentMode.backends.pi!.mcpServers = [config];
      const test = jest
        .spyOn(PiMcpService.prototype, "test")
        .mockResolvedValue({ status: "connected", toolCount: 1 } as never);
      const connect = jest.spyOn(PiMcpService.prototype, "connect").mockResolvedValue({} as never);
      const signOut = jest.spyOn(PiMcpService.prototype, "signOut").mockResolvedValue();
      show();
      await act(async () => {
        fireEvent.click(screen.getByText("Test"));
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Connect"));
      });
      expect(test).toHaveBeenCalledWith("docs");
      expect(connect).toHaveBeenCalledWith("docs");
      fireEvent.click(screen.getByText("Disable"));
      expect(updateAgentModeBackendFields).toHaveBeenCalledWith("pi", {
        mcpServers: [expect.objectContaining({ serverId: "docs", enabled: false })],
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Delete"));
      });
      expect(signOut).toHaveBeenCalledWith("docs");
      expect(updateAgentModeBackendFields).toHaveBeenCalledWith("pi", { mcpServers: [] });
      test.mockRestore();
      connect.mockRestore();
      signOut.mockRestore();
    });

    it("opens existing servers without rewriting configuration or mounting file permissions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const config = normalizeMcpServerConfig({
        serverId: "saved-service",
        displayName: "Saved service",
        enabled: false,
        trusted: true,
        transport: { kind: "http", url: "https://docs.example.com/mcp", headerSecretRefs: {} },
      });
      mockSettings.agentMode.backends.pi!.mcpServers = [config];
      const original = JSON.parse(JSON.stringify(mockSettings));
      show();
      expect(screen.getByText("Saved service")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
      expect(screen.queryByLabelText("Allow writing subtasks")).toBeNull();
      expect(screen.queryByLabelText("Full folder path")).toBeNull();
      expect(setSettings).not.toHaveBeenCalled();
      expect(updateAgentModeBackendFields).not.toHaveBeenCalled();
      expect(mockKeychain.setSecretById).not.toHaveBeenCalled();
      expect(mockSettings).toEqual(original);
    });
  });
});
