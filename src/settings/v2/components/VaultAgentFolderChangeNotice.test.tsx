import {
  VaultAgentFolderChangeNotice,
  type VaultAgentFolderChangeNoticeProps,
} from "@/settings/v2/components/VaultAgentFolderChangeNotice";
import { render, screen } from "@testing-library/react";
import React from "react";

const DEFAULT_PROPS: VaultAgentFolderChangeNoticeProps = {
  oldRoot: "vault-agent",
  newRoot: "90 System/vault-agent",
  containsMarkdown: false,
};

describe("VaultAgentFolderChangeNotice", () => {
  describe("VaultAgentFolderChangeNotice()", () => {
    it("explains where new and existing Copilot data will remain", () => {
      render(<VaultAgentFolderChangeNotice {...DEFAULT_PROPS} />);

      expect(screen.getByText("90 System/vault-agent/", { selector: "code" })).not.toBeNull();
      expect(screen.getByText("vault-agent/", { selector: "strong" })).not.toBeNull();
      expect(screen.getByText(/stays permanently excluded from vault search/)).not.toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("warns that every Markdown file in a non-empty folder will stay excluded", () => {
      render(<VaultAgentFolderChangeNotice {...DEFAULT_PROPS} containsMarkdown />);

      const warning = screen.getByRole("alert");
      expect(warning.textContent).toContain("This folder already contains Markdown files.");
      expect(warning.textContent).toContain("including regular notes");
      expect(warning.textContent).toContain("excluded from vault search");
      expect(warning.textContent).toContain("stays excluded even if you change");
    });
  });
});
