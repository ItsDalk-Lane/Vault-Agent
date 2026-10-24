import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PiMcpServerForm } from "./PiMcpServerForm";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";

describe("PiMcpServerForm", () => {
  describe("PiMcpServerForm()", () => {
    it("submits a reviewed HTTP address and a separate password without placing it in the config https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const save = jest.fn();
      render(<PiMcpServerForm onSave={save} onCancel={() => undefined} />);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs" } });
      fireEvent.change(screen.getByLabelText("Server URL"), {
        target: { value: "https://docs.example.com/mcp" },
      });
      fireEvent.change(screen.getByLabelText(/Access token/), {
        target: { value: "private-token" },
      });
      fireEvent.click(screen.getByText("Save and enable"));
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Docs",
          address: "https://docs.example.com/mcp",
          kind: "http",
          token: "private-token",
          exposure: "deferred",
          scope: "this-vault",
        })
      );
    });

    it("preserves local arguments as separate literal lines and permits cancellation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const cancel = jest.fn();
      const save = jest.fn();
      const config = normalizeMcpServerConfig({
        serverId: "local",
        displayName: "Local",
        transport: {
          kind: "stdio",
          commandPath: "/usr/bin/program",
          args: ["--literal", "space in value"],
          cwd: "/tmp",
        },
      });
      render(<PiMcpServerForm config={config} onSave={save} onCancel={cancel} />);
      fireEvent.click(screen.getByText("Save and enable"));
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "stdio",
          args: ["--literal", "space in value"],
          cwd: "/tmp",
        })
      );
      fireEvent.click(screen.getByText("Cancel"));
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("shows browser client and scope controls only after browser login is chosen https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const save = jest.fn();
      render(<PiMcpServerForm onSave={save} onCancel={() => undefined} />);
      fireEvent.click(screen.getByLabelText("Sign in through the browser"));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs" } });
      fireEvent.change(screen.getByLabelText("Server URL"), {
        target: { value: "https://docs.example.com/mcp" },
      });
      fireEvent.change(screen.getByLabelText("Client ID (optional)"), {
        target: { value: "client-1" },
      });
      fireEvent.change(screen.getByLabelText("Requested access (space separated)"), {
        target: { value: "read write" },
      });
      fireEvent.click(screen.getByText("Save and enable"));
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ oauth: true, clientId: "client-1", scopes: ["read", "write"] })
      );
    });
  });
});
