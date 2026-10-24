import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PiExternalFolders } from "./PiExternalFolders";

jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: () => jest.requireActual("node:path"),
}));

describe("PiExternalFolders", () => {
  describe("PiExternalFolders()", () => {
    it("creates an expiring read grant only after an explicit user action https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const change = jest.fn();
      render(<PiExternalFolders scopes={[]} onChange={change} />);
      expect(change).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("Full folder path"), {
        target: { value: "/Users/example/Reference" },
      });
      fireEvent.click(screen.getByText("Grant access for one hour"));
      expect(change).toHaveBeenCalledWith([
        {
          root: "/Users/example/Reference",
          permissions: ["read"],
          expiresAtMs: expect.any(Number),
        },
      ]);
    });

    it("rejects relative paths and lets the user explicitly revoke an existing grant https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const change = jest.fn();
      render(
        <PiExternalFolders
          scopes={[{ root: "/Users/example/Reference", permissions: ["read"] }]}
          onChange={change}
        />
      );
      fireEvent.change(screen.getByLabelText("Full folder path"), {
        target: { value: "../Reference" },
      });
      fireEvent.click(screen.getByText("Grant access for one hour"));
      expect(change).not.toHaveBeenCalled();
      expect(screen.getByText("Enter the full absolute folder path.")).toBeTruthy();
      fireEvent.click(screen.getByText("Revoke"));
      expect(change).toHaveBeenCalledWith([]);
    });
  });
});
