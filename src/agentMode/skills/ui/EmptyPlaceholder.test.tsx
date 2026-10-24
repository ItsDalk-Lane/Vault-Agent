import { render, screen } from "@testing-library/react";
import React from "react";
import { EmptyPlaceholder } from "./EmptyPlaceholder";
describe("EmptyPlaceholder", () => {
  describe("EmptyPlaceholder()", () => {
    it("points only to the managed skill folder instead of removed backend folders https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { container } = render(<EmptyPlaceholder folder="team/vault-agent/skills" />);
      expect(screen.getByText("<vault>/team/vault-agent/skills/")).toBeTruthy();
      expect(container.textContent).not.toMatch(/\.claude|\.agents|\.opencode/);
    });
  });
});
