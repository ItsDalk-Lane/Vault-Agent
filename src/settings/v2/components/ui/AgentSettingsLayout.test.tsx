import { render, screen } from "@testing-library/react";
import React from "react";
import { AgentSettingsLayout } from "./AgentSettingsLayout";

describe("AgentSettingsLayout", () => {
  describe("AgentSettingsLayout()", () => {
    it("groups notifications without displaying nonfunctional model controls https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      render(<AgentSettingsLayout notificationSettings={<span>Sound</span>} />);
      expect(screen.queryByText("Agent Chat")).toBeNull();
      expect(screen.getByText("Notifications")).not.toBeNull();
      expect(screen.getByText("Sound")).not.toBeNull();
      expect(screen.queryByText("Quick Chat")).toBeNull();
      expect(screen.queryByRole("tablist")).toBeNull();
    });
  });
});
