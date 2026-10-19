import { VaultAgentSpinner } from "@/components/chat-components/VaultAgentSpinner";
import { render } from "@testing-library/react";
import React from "react";

describe("VaultAgentSpinner", () => {
  describe("VaultAgentSpinner()", () => {
    it("animates by default", () => {
      const { container } = render(<VaultAgentSpinner />);

      expect(container.querySelectorAll('[class*="vault-agent-spinner-dot-"]')).toHaveLength(7);
    });

    it("renders the same icon without animation classes when animation is disabled", () => {
      const { container } = render(<VaultAgentSpinner animated={false} />);

      expect(container.querySelectorAll(".vault-agent-spinner-dot")).toHaveLength(7);
      expect(container.querySelectorAll('[class*="vault-agent-spinner-dot-"]')).toHaveLength(0);
    });
  });
});
