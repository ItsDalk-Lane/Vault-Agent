import { render, screen } from "@testing-library/react";
import React from "react";
import { AgentToolsLayout } from "./AgentToolsLayout";

describe("AgentToolsLayout", () => {
  describe("AgentToolsLayout()", () => {
    it("groups permissions and external folders without a duplicate MCP section or engine configuration https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      render(
        <AgentToolsLayout
          permissions={<span>Local programs</span>}
          externalFolders={<span>Saved folders</span>}
        />
      );
      expect(screen.getByText("Local programs and subtasks")).not.toBeNull();
      expect(
        screen
          .getByText("Local programs")
          .compareDocumentPosition(screen.getByText("Saved folders")) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(screen.queryByText("MCP servers")).toBeNull();
      expect(screen.queryByText(/Pi/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Configure" })).toBeNull();
    });
  });
});
