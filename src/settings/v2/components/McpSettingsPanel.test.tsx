import { render, screen } from "@testing-library/react";
import React from "react";
import { McpSettingsPanel } from "./McpSettingsPanel";

let mockDesktop = true;
const mockApp = {};
const mockPlugin = {};
const mockMcpPanel = jest.fn();
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 必须匹配真实 hook 的导出名称
  useApp: () => mockApp,
}));
jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 必须匹配真实 hook 的导出名称
  usePlugin: () => mockPlugin,
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => mockDesktop }));
jest.mock("@/agentMode", () => ({
  AgentMcpSettings: (props: unknown) => {
    mockMcpPanel(props);
    return <div>Saved MCP servers</div>;
  },
}));

describe("McpSettingsPanel", () => {
  describe("McpSettingsPanel()", () => {
    beforeEach(() => {
      mockDesktop = true;
      mockMcpPanel.mockClear();
    });

    it("opens the saved MCP panel with the current vault and plugin https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      render(<McpSettingsPanel />);
      expect(await screen.findByText("Saved MCP servers")).not.toBeNull();
      expect(mockMcpPanel).toHaveBeenCalledWith({ app: mockApp, plugin: mockPlugin });
    });

    it("keeps the desktop service outside the mobile settings path https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      mockDesktop = false;
      render(<McpSettingsPanel />);
      expect(screen.getByText("MCP servers are available on desktop.")).not.toBeNull();
      expect(screen.queryByText("Saved MCP servers")).toBeNull();
      expect(mockMcpPanel).not.toHaveBeenCalled();
    });
  });
});
