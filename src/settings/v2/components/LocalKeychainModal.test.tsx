import { LocalKeychainDetailContent } from "./LocalKeychainModal";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("LocalKeychainModal", () => {
  describe("LocalKeychainDetailContent()", () => {
    it("lists each entry with its label, storage identifier and stored time without any secret value https://github.com/ItsDalk-Lane/Vault-Agent/issues/8", () => {
      const storedAt = new Date(2026, 9, 22, 12, 47).getTime();
      render(
        <LocalKeychainDetailContent
          groupLabel="Provider keys"
          entries={[
            {
              id: "copilot-vexample-provider-lm-studio-api-key",
              label: "LM Studio",
              createdAt: storedAt,
            },
            { id: "copilot-vexample-provider-unknown-api-key" },
          ]}
        />
      );
      expect(screen.getByText("Provider keys · 2 entries")).toBeTruthy();
      expect(screen.getByText("LM Studio")).toBeTruthy();
      expect(screen.getByText("Unrecognized purpose")).toBeTruthy();
      expect(screen.getByText("copilot-vexample-provider-lm-studio-api-key")).toBeTruthy();
      expect(screen.getByText("Stored 2026-10-22 12:47")).toBeTruthy();
      expect(screen.getByText("Storage time unavailable")).toBeTruthy();
      expect(screen.queryByText("sk-secret")).toBeNull();
    });
    it("explains the unreferenced variant and renders no close control of its own https://github.com/ItsDalk-Lane/Vault-Agent/issues/8", () => {
      render(
        <LocalKeychainDetailContent
          groupLabel="Other plugin entries"
          entries={[{ id: "copilot-vexample-9d1c4a02" }]}
          unreferencedOnly
        />
      );
      expect(screen.getByText(/only show their storage identifier/)).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
