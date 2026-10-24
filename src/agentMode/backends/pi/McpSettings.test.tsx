import {
  McpSettings,
  applyMcpServerChange,
  type McpServerView,
} from "@/agentMode/backends/pi/McpSettings";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// The panel is driven by real state: Test/Connect call the injected handlers, disabling a server
// drops its connection and tool catalog and blocks connect/test, a cancelled authorization becomes
// actionable again, and an unsupported protocol is stated instead of silently failing:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function server(overrides: Partial<McpServerView> = {}): McpServerView {
  return {
    serverId: "docs-server",
    displayName: "Docs",
    scope: "this-vault",
    transport: "http",
    enabled: true,
    trusted: true,
    connection: "connected",
    toolCount: 12,
    ...overrides,
  };
}

function renderSettings(
  servers: readonly McpServerView[],
  handlers: Record<string, jest.Mock> = {}
) {
  const spies = {
    onTest: jest.fn(),
    onConnect: jest.fn(),
    onDisconnect: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onToggleEnabled: jest.fn(),
    onChangeScope: jest.fn(),
    onAuthorize: jest.fn(),
    onCancelAuthorize: jest.fn(),
    onAdd: jest.fn(),
    ...handlers,
  };
  render(<McpSettings servers={servers} {...spies} />);
  return spies;
}

describe("McpSettings", () => {
  describe("McpSettings", () => {
    it("calls the injected test and connect handlers instead of rendering a static mock", () => {
      const spies = renderSettings([server({ connection: "idle" })]);

      fireEvent.click(screen.getByText("Test"));
      fireEvent.click(screen.getByText("Connect"));

      expect(spies.onTest).toHaveBeenCalledWith("docs-server");
      expect(spies.onConnect).toHaveBeenCalledWith("docs-server");
    });

    it("shows a real test result with tool count and duration", () => {
      renderSettings([server({ testStatus: "connected", testToolCount: 12, testDurationMs: 240 })]);

      expect(screen.getByText(/Test: connected · 12 tools · 240 ms/)).toBeTruthy();
    });

    it("blocks connect and test for a disabled server and reports the dropped catalog", () => {
      const disabled = applyMcpServerChange([server()], {
        type: "disable",
        serverId: "docs-server",
      })[0];
      expect(disabled).toMatchObject({ enabled: false, connection: "closed", toolCount: 0 });
      expect(disabled?.testStatus).toBeUndefined();

      renderSettings(disabled === undefined ? [] : [disabled]);

      expect(screen.getByText("Connect").closest("button")?.disabled).toBe(true);
      expect(screen.getByText("Test").closest("button")?.disabled).toBe(true);
      expect(screen.getByText("0 tools")).toBeTruthy();
    });

    it("keeps the catalog when disabling removes only the connection", () => {
      const connected = server();
      const updated = applyMcpServerChange([connected], {
        type: "disconnect",
        serverId: "docs-server",
      })[0];

      expect(updated).toMatchObject({ connection: "closed", toolCount: 0, enabled: true });
    });

    it("makes a cancelled authorization actionable again", () => {
      const pending = server({
        connection: "auth_required",
        oauth: { status: "pending", host: "mcp.example.com", scopes: ["read"] },
      });
      const spies = renderSettings([pending]);

      fireEvent.click(screen.getByText("Cancel authorization"));

      expect(spies.onCancelAuthorize).toHaveBeenCalledWith("docs-server");

      const cancelled = applyMcpServerChange([pending], {
        type: "oauth-cancel",
        serverId: "docs-server",
      })[0];
      expect(cancelled?.oauth?.status).toBe("cancelled");

      cleanup();
      renderSettings(cancelled === undefined ? [] : [cancelled]);
      expect(screen.getByText(/Authorization cancelled/)).toBeTruthy();
      expect(screen.getByText("Authorize in browser")).toBeTruthy();
    });

    it("states an unsupported protocol and blocks connecting", () => {
      renderSettings([server({ connection: "error", unsupported: ["legacy_sse"] })]);

      expect(screen.getByText(/Unsupported protocol: legacy_sse/)).toBeTruthy();
      expect(screen.getByText("Connect").closest("button")?.disabled).toBe(true);
    });

    it("explains why a stdio server without an interpreter stays disabled", () => {
      renderSettings([
        server({
          transport: "stdio",
          enabled: false,
          connection: "idle",
          toolCount: 0,
          stdio: { commandPath: "/usr/local/bin/mcp-server", interpreterAvailable: false },
        }),
      ]);

      expect(screen.getByText(/No interpreter is available/)).toBeTruthy();
    });

    it("wires edit, delete, scope and add to their handlers", () => {
      const spies = renderSettings([server()]);

      fireEvent.click(screen.getByText("Edit"));
      fireEvent.click(screen.getByText("Delete"));
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "global" } });
      fireEvent.click(screen.getByText("Add server"));

      expect(spies.onEdit).toHaveBeenCalledWith("docs-server");
      expect(spies.onDelete).toHaveBeenCalledWith("docs-server");
      expect(spies.onChangeScope).toHaveBeenCalledWith("docs-server", "global");
      expect(spies.onAdd).toHaveBeenCalledTimes(1);
    });

    it("shows an empty state when nothing is configured", () => {
      renderSettings([]);

      expect(screen.getByText("No MCP server is configured yet.")).toBeTruthy();
    });
  });

  describe("applyMcpServerChange()", () => {
    it("deletes, re-enables and applies a scope change", () => {
      const servers = [server(), server({ serverId: "other", displayName: "Other" })];

      const deleted = applyMcpServerChange(servers, { type: "delete", serverId: "other" });
      expect(deleted.map((entry) => entry.serverId)).toEqual(["docs-server"]);

      const reenabled = applyMcpServerChange(
        applyMcpServerChange(servers, { type: "disable", serverId: "docs-server" }),
        { type: "enable", serverId: "docs-server" }
      )[0];
      expect(reenabled?.enabled).toBe(true);

      const rescoped = applyMcpServerChange(servers, {
        type: "scope",
        serverId: "docs-server",
        scope: "project",
      })[0];
      expect(rescoped?.scope).toBe("project");
    });

    it("records a test result and updates the catalog only on success", () => {
      const failed = applyMcpServerChange([server({ toolCount: 12 })], {
        type: "test-result",
        serverId: "docs-server",
        status: "timed_out",
        toolCount: 0,
        durationMs: 20_000,
      })[0];
      expect(failed).toMatchObject({
        testStatus: "timed_out",
        testDurationMs: 20_000,
        toolCount: 12,
      });

      const connected = applyMcpServerChange([server({ toolCount: 0 })], {
        type: "test-result",
        serverId: "docs-server",
        status: "connected",
        toolCount: 7,
        durationMs: 120,
      })[0];
      expect(connected).toMatchObject({ testStatus: "connected", toolCount: 7 });
    });
  });
});
