import { ActionCard } from "@/agentMode/ui/ActionCard";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { openVaultPath } from "@/utils/openVaultPath";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

jest.mock("@/context", () => ({ useApp: jest.fn().mockReturnValue({}) }));
jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));

const renderCard = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

function readTool(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    kind: "tool_call",
    id: "read-1",
    title: "Read notes/today.md",
    vendorToolName: "Read",
    input: { file_path: "notes/today.md" },
    status: "completed",
    ...overrides,
  };
}

describe("ActionCard", () => {
  describe("ActionCard()", () => {
    it("links only the file path of a completed read, keeping the verb as plain text", () => {
      render(<ActionCard part={readTool()} open={false} onToggle={jest.fn()} />);

      const link = screen.getByRole("link");
      expect(link.textContent).toBe("notes/today.md");
      expect(screen.getByText("Read").closest("a")).toBeNull();

      fireEvent.click(link);
      expect(openVaultPath).toHaveBeenCalledWith({}, "notes/today.md", { newLeaf: true });
    });

    it("renders a denied edit as Didn't edit with no file link (https://github.com/Brevilabs/obsidian-copilot-private/issues/691)", () => {
      renderCard(
        <ActionCard
          part={readTool({
            vendorToolName: "Edit",
            title: "Edit plan.md",
            input: { file_path: "plan.md" },
            status: "failed",
          })}
          open={false}
          onToggle={jest.fn()}
        />
      );

      expect(screen.getByText("Didn't edit plan.md")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("renders an in-progress read as plain text without a link", () => {
      render(
        <ActionCard part={readTool({ status: "in_progress" })} open={false} onToggle={jest.fn()} />
      );

      expect(screen.getByText("Reading notes/today.md")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("shows the tool input as a labeled pretty-JSON section when expanded (https://github.com/ItsDalk-Lane/Vault-Agent/issues/10)", () => {
      renderCard(<ActionCard part={readTool()} open onToggle={jest.fn()} />);

      expect(screen.getByText("Input")).toBeTruthy();
      expect(screen.getByText(/"file_path": "notes\/today.md"/)).toBeTruthy();
    });

    it("pretty-prints a complete JSON text output (https://github.com/ItsDalk-Lane/Vault-Agent/issues/10)", () => {
      renderCard(
        <ActionCard
          part={readTool({
            output: [{ type: "text", text: '{"result":"ok"}' }],
          })}
          open
          onToggle={jest.fn()}
        />
      );

      expect(screen.getByText(/"result": "ok"/)).toBeTruthy();
    });

    it("numbers output sections when a tool returns several text outputs (https://github.com/ItsDalk-Lane/Vault-Agent/issues/10)", () => {
      renderCard(
        <ActionCard
          part={readTool({
            output: [
              { type: "text", text: "first" },
              { type: "text", text: "second" },
            ],
          })}
          open
          onToggle={jest.fn()}
        />
      );

      expect(screen.getByText("Output 1")).toBeTruthy();
      expect(screen.getByText("Output 2")).toBeTruthy();
    });

    it("renders diff outputs as colored line rows with the path as section label (https://github.com/ItsDalk-Lane/Vault-Agent/issues/10)", () => {
      renderCard(
        <ActionCard
          part={readTool({
            vendorToolName: "Edit",
            title: "Edit plan.md",
            input: { file_path: "plan.md" },
            output: [{ type: "diff", path: "plan.md", oldText: "old", newText: "new" }],
          })}
          open
          onToggle={jest.fn()}
        />
      );

      const diffSection = screen.getByText("- old").closest("section");
      expect(diffSection).toBeTruthy();
      expect(within(diffSection as HTMLElement).getByText("plan.md")).toBeTruthy();
      expect(screen.getByText("- old").getAttribute("data-change")).toBe("deleted");
      expect(screen.getByText("+ new").getAttribute("data-change")).toBe("inserted");
    });

    it("expands a Bash call into a command section instead of raw JSON input (https://github.com/ItsDalk-Lane/Vault-Agent/issues/10)", () => {
      renderCard(
        <ActionCard
          part={readTool({
            vendorToolName: "Bash",
            title: "Run npm test",
            input: { command: "npm test" },
          })}
          open
          onToggle={jest.fn()}
        />
      );

      expect(screen.getByText("Command")).toBeTruthy();
      expect(screen.getByText("npm test")).toBeTruthy();
      expect(screen.queryByText("Input")).toBeNull();
    });
  });
});
