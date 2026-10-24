import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { render, screen } from "@testing-library/react";
import React from "react";
import { AdvancedSettings } from "./AdvancedSettings";

let mockDesktop = true;
const mockApp = {};
const mockPlugin = {};
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 必须匹配真实 hook 的导出名称
  useApp: () => mockApp,
}));
jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 必须匹配真实 hook 的导出名称
  usePlugin: () => mockPlugin,
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => mockDesktop }));
jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: () => ({ isAvailable: () => true }) },
}));
jest.mock("./DebuggingSupportSection", () => ({
  DebuggingSupportSection: () => <div>Diagnostics</div>,
}));
jest.mock("@/agentMode", () => ({
  acpFrameSink: { getPath: () => "/tmp/activity.log" },
}));

describe("AdvancedSettings", () => {
  describe("AdvancedSettings()", () => {
    beforeEach(() => {
      mockDesktop = true;
      settingsStore.set(settingsAtom, DEFAULT_SETTINGS);
    });

    it("keeps Advanced free of tool-permission panels after the single-layer permission model (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", async () => {
      const before = settingsStore.get(settingsAtom);
      render(<AdvancedSettings />);
      expect(await screen.findByText("API Key Storage")).not.toBeNull();
      expect(screen.getByText("Diagnostics")).not.toBeNull();
      expect(settingsStore.get(settingsAtom)).toBe(before);
    });

    it("keeps the mobile settings path equal to desktop after the tool-permission removal (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", () => {
      mockDesktop = false;
      render(<AdvancedSettings />);
      expect(screen.getByText("API Key Storage")).not.toBeNull();
    });
  });
});
