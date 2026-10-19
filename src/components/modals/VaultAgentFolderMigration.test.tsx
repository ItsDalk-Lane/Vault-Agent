import { VaultAgentFolderMigration } from "./VaultAgentFolderMigration";
import { render, screen } from "@testing-library/react";
import React from "react";

const WHY = /Copilot no longer supports hidden folders/;

describe("VaultAgentFolderMigration", () => {
  describe("VaultAgentFolderMigration()", () => {
    it("explains why the folder moved and names where it is now", () => {
      render(
        <VaultAgentFolderMigration
          migration={{ status: "moved", from: ".vault-agent", to: "vault-agent", leftBehind: [] }}
        />
      );

      expect(screen.getByText(WHY)).toBeTruthy();
      expect(screen.getByText('Your Vault Agent folder is now "vault-agent".')).toBeTruthy();
      expect(screen.queryByRole("list")).toBeNull();
    });

    it("lists the files that stayed in the hidden folder for the user to move", () => {
      render(
        <VaultAgentFolderMigration
          migration={{
            status: "moved",
            from: ".vault-agent",
            to: "vault-agent",
            leftBehind: [".vault-agent/memory/User Role.md"],
          }}
        />
      );

      expect(screen.getByText(/already has files with the same names/)).toBeTruthy();
      expect(screen.getByRole("listitem").textContent).toBe(".vault-agent/memory/User Role.md");
    });

    it("shows why the move failed and asks the user to move the folder", () => {
      render(
        <VaultAgentFolderMigration
          migration={{
            status: "failed",
            from: ".vault-agent",
            to: "vault-agent",
            reason: "EACCES",
          }}
        />
      );

      expect(screen.getByText(WHY)).toBeTruthy();
      expect(
        screen.getByText(
          'Vault Agent could not move it: EACCES. Move the contents of ".vault-agent" to "vault-agent" yourself.'
        )
      ).toBeTruthy();
    });
  });
});
