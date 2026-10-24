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
jest.mock("@/services/settingsSecretTransforms", () => ({
  ...jest.requireActual<typeof import("@/services/settingsSecretTransforms")>(
    "@/services/settingsSecretTransforms"
  ),
  hasPersistedSecrets: () => true,
}));
jest.mock("./LegacyChatPromptsNotice", () => ({ LegacyChatPromptsNotice: () => null }));
jest.mock("./DebuggingSupportSection", () => ({
  DebuggingSupportSection: () => <div>Diagnostics</div>,
}));
jest.mock("@/agentMode", () => ({
  acpFrameSink: { getPath: () => "/tmp/activity.log" },
  AgentToolsSettings: () => <div>Saved tools and permissions</div>,
}));

describe("AdvancedSettings", () => {
  describe("AdvancedSettings()", () => {
    beforeEach(() => {
      mockDesktop = true;
      settingsStore.set(settingsAtom, DEFAULT_SETTINGS);
    });

    it("opens existing tools and permissions in Advanced without changing saved preferences https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const before = settingsStore.get(settingsAtom);
      render(<AdvancedSettings />);
      const tools = await screen.findByText("Saved tools and permissions");
      expect(
        tools.compareDocumentPosition(screen.getByText("API Key Storage")) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(screen.getByText("Diagnostics")).not.toBeNull();
      expect(settingsStore.get(settingsAtom)).toBe(before);
    });

    it("keeps desktop tool controls outside the mobile settings path https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      mockDesktop = false;
      render(<AdvancedSettings />);
      expect(screen.queryByText("Saved tools and permissions")).toBeNull();
      expect(screen.getByText("API Key Storage")).not.toBeNull();
    });
  });
});
