import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VaultAgentSettings } from "@/settings/model";
import { setSettings, updateAgentModeBackendFields } from "@/settings/model";
import { PiSettingsPanel } from "./PiSettingsPanel";

let mockSettings: VaultAgentSettings;
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  useSettingsValue: jest.fn(() => mockSettings),
  subscribeToSettingsChange: () => () => undefined,
  updateAgentModeBackendFields: jest.fn(),
  setSettings: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: () => jest.requireActual("node:path"),
}));

function show() {
  return render(<PiSettingsPanel />);
}

describe("PiSettingsPanel", () => {
  describe("PiSettingsPanel()", () => {
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

    it("keeps tool permissions separate from model configuration without rewriting existing settings https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      mockSettings.configuredModels = [
        {
          configuredModelId: "local",
          providerId: "local-provider",
          configuredAt: 1,
          info: {
            id: "local-model",
            displayName: "Local",
            limits: { context: 16384, output: 4096 },
            modalities: { input: ["text", "audio"], output: ["text"] },
          },
        },
      ];
      mockSettings.backends.pi = { enabledModels: ["local"] };
      const original = JSON.parse(JSON.stringify(mockSettings));
      show();
      expect(screen.queryByLabelText("Image input")).toBeNull();
      expect(screen.getByLabelText("Allow writing subtasks")).toBeTruthy();
      expect(screen.getByLabelText("Full folder path")).toBeTruthy();
      expect(screen.queryByText("MCP servers")).toBeNull();
      expect(screen.queryByRole("button", { name: "Add server" })).toBeNull();
      expect(setSettings).not.toHaveBeenCalled();
      expect(updateAgentModeBackendFields).not.toHaveBeenCalled();
      expect(mockSettings).toEqual(original);
    });

    it("persists host mode and explicit expiring external-folder grants from user controls https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      show();
      fireEvent.click(screen.getByLabelText("Allow writing subtasks"));
      expect(updateAgentModeBackendFields).toHaveBeenCalledWith("pi", {
        enabledSubagentProfiles: ["researcher", "reviewer", "writer"],
      });
      fireEvent.click(screen.getByLabelText(/Allow approved local programs/));
      expect(updateAgentModeBackendFields).toHaveBeenCalledWith("pi", {
        hostExecutionMode: "trusted_host",
      });
      fireEvent.change(screen.getByLabelText("Full folder path"), {
        target: { value: "/Users/example/Reference" },
      });
      fireEvent.click(screen.getByText("Grant access for one hour"));
      expect(updateAgentModeBackendFields).toHaveBeenCalledWith("pi", {
        externalScopes: [
          {
            root: "/Users/example/Reference",
            permissions: ["read"],
            expiresAtMs: expect.any(Number),
          },
        ],
      });
    });
  });
});
