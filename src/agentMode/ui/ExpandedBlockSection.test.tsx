import { ExpandedBlockSection, prettyIfJson } from "@/agentMode/ui/ExpandedBlockSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { render, screen } from "@testing-library/react";
import React from "react";

const renderSection = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe("ExpandedBlockSection", () => {
  describe("ExpandedBlockSection()", () => {
    it("renders the label, mono panel text, and a copy button for text content", () => {
      renderSection(<ExpandedBlockSection label="输入" text={prettyIfJson('{"file":"a.md"}')} />);

      expect(screen.getByText("输入")).toBeTruthy();
      expect(screen.getByText(/"file": "a.md"/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    });

    it("omits the copy button when only custom children are provided", () => {
      renderSection(
        <ExpandedBlockSection label="输出">
          <div>custom body</div>
        </ExpandedBlockSection>
      );

      expect(screen.getByText("custom body")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    });

    it("copies copyText instead of the displayed text when both are given", () => {
      renderSection(<ExpandedBlockSection label="输出" text="pretty" copyText="raw" />);

      expect(screen.getByText("pretty")).toBeTruthy();
      expect(screen.queryByText("raw")).toBeNull();
    });
  });

  describe("prettyIfJson()", () => {
    it("pretty-prints a complete JSON object", () => {
      expect(prettyIfJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    });

    it("pretty-prints a complete JSON array", () => {
      expect(prettyIfJson("[1,2]")).toBe("[\n  1,\n  2\n]");
    });

    it("returns plain text unchanged", () => {
      expect(prettyIfJson("plain output")).toBe("plain output");
    });

    it("returns broken JSON unchanged instead of throwing", () => {
      expect(prettyIfJson('{"a":')).toBe('{"a":');
    });
  });
});
