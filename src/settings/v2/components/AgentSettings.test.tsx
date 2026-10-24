import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { setSettings } from "@/settings/model";
import { playNotificationSound } from "@/utils/notificationSound";
import { AgentSettings } from "./AgentSettings";

jest.mock("@/utils/notificationSound", () => ({ playNotificationSound: jest.fn() }));

let mockSettings = {
  agentMode: {
    activeBackend: "pi",
    backends: { pi: { hostExecutionMode: "strict", mcpServers: [{ serverId: "saved" }] } },
    notificationSound: true,
    notificationSoundId: "piano",
  },
  defaultModelKey: "saved-quick-model",
  backends: { chat: { enabledModels: ["saved-quick-model"] } },
};
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 必须匹配真实 hook 的导出名称
  useSettingsValue: () => mockSettings,
  setSettings: jest.fn(),
}));

describe("AgentSettings", () => {
  describe("AgentSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettings.agentMode.notificationSound = true;
      mockSettings.agentMode.notificationSoundId = "piano";
    });

    it("shows notification controls without the nonfunctional Quick Chat configuration https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const before = JSON.stringify(mockSettings);
      render(<AgentSettings />);
      expect(screen.queryByText("Agent Chat")).toBeNull();
      expect(screen.queryByText("Quick Chat models")).toBeNull();
      expect(screen.queryByText("Default backend")).toBeNull();
      expect(screen.queryByText(/\bPi\b/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Configure" })).toBeNull();
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(setSettings).not.toHaveBeenCalled();
      expect(JSON.stringify(mockSettings)).toBe(before);
    });

    it("mutes notifications while preserving all existing permissions and service settings", () => {
      render(<AgentSettings />);
      fireEvent.click(screen.getByRole("switch"));
      const apply = jest.mocked(setSettings).mock.calls[0][0];
      if (typeof apply !== "function") throw new Error("expected settings updater");
      expect(apply(mockSettings as never)).toEqual({
        agentMode: { ...mockSettings.agentMode, notificationSound: false },
      });
    });

    it("previews and saves a selected sound without changing other settings", () => {
      render(<AgentSettings />);
      fireEvent.change(screen.getByDisplayValue("Piano key"), { target: { value: "doorbell" } });
      const apply = jest.mocked(setSettings).mock.calls[0][0];
      if (typeof apply !== "function") throw new Error("expected settings updater");
      expect(apply(mockSettings as never)).toEqual({
        agentMode: { ...mockSettings.agentMode, notificationSoundId: "doorbell" },
      });
      expect(playNotificationSound).toHaveBeenCalledWith("doorbell");
    });

    it("ignores an unknown sound instead of saving a broken preference", () => {
      render(<AgentSettings />);
      fireEvent.change(screen.getByDisplayValue("Piano key"), { target: { value: "unknown" } });
      expect(setSettings).not.toHaveBeenCalled();
      expect(playNotificationSound).not.toHaveBeenCalled();
    });
  });
});
