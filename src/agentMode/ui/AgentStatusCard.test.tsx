import { AgentStatusCard } from "./AgentStatusCard";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentStatusCard", () => {
  describe("AgentStatusCard()", () => {
    it("shows a neutral configuration message with its real reload action", () => {
      const onClick = jest.fn();
      render(
        <AgentStatusCard
          message="Vault Agent settings changed"
          action={{ label: "Reload", onClick }}
        />
      );
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
    it("announces warning and error messages with decorative semantic icons", () => {
      const { rerender } = render(<AgentStatusCard tone="warning" message="Task interrupted" />);
      expect(screen.getByRole("alert").textContent).toBe("Task interrupted");
      expect(screen.getByRole("alert").querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true"
      );
      expect(screen.getByRole("alert").querySelector("svg")?.getAttribute("class")).toContain(
        "tw-text-warning"
      );
      rerender(<AgentStatusCard tone="error" message="Model request failed" />);
      expect(screen.getByRole("alert").querySelector("svg")?.getAttribute("class")).toContain(
        "tw-text-error"
      );
    });
    it("preserves complete recovery details below a summary and invokes retry", () => {
      const message = "Could not read the saved conversation.\nEACCES: permission denied";
      const onClick = jest.fn();
      render(
        <AgentStatusCard
          tone="error"
          summary="Vault Agent session error"
          message={message}
          action={{ label: "Retry", onClick }}
        />
      );
      const summary = screen.getByText("Vault Agent session error");
      const details = screen.getByText(message, { normalizer: (text) => text });
      expect(
        summary.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
    it("keeps an outstanding reload action disabled", () => {
      render(
        <AgentStatusCard
          layout="row"
          message="Settings changed"
          action={{ label: "Reloading…", onClick: jest.fn(), disabled: true }}
        />
      );
      expect(screen.getByRole("button", { name: "Reloading…" }).hasAttribute("disabled")).toBe(
        true
      );
    });
  });
});
