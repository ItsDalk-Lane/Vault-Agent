import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { BuiltinSkillsTable, type BuiltinSkillsTableProps } from "./BuiltinSkillsTable";

function props(): BuiltinSkillsTableProps {
  return {
    skills: [
      { name: "transcript", description: "Read video transcripts", content: "# Read a transcript" },
    ],
    pendingSkills: [],
    onToggleSkill: jest.fn(),
  };
}

function openMenu() {
  fireEvent.pointerDown(screen.getByLabelText("More actions for transcript"), {
    button: 0,
    ctrlKey: false,
  });
}

describe("BuiltinSkillsTable", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  describe("BuiltinSkillsTable()", () => {
    it("uses one effective Vault Agent switch instead of per-backend icons https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const p = props();
      render(<BuiltinSkillsTable {...p} />);
      expect(screen.getAllByRole("switch")).toHaveLength(1);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      fireEvent.click(screen.getByRole("switch"));
      expect(p.onToggleSkill).toHaveBeenCalledWith("transcript", false);
      expect(screen.queryByRole("button", { name: /Claude|Codex|OpenCode/ })).toBeNull();
    });
    it("honors the saved current-engine opt-out without treating historical opt-outs as current https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const p = props();
      const { rerender } = render(
        <BuiltinSkillsTable
          {...p}
          preferences={{ transcript: { disabledAgents: ["pi", "claude"] } }}
        />
      );
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      fireEvent.click(screen.getByRole("switch"));
      expect(p.onToggleSkill).toHaveBeenCalledWith("transcript", true);
      rerender(
        <BuiltinSkillsTable {...p} preferences={{ transcript: { disabledAgents: ["claude"] } }} />
      );
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    });
    it("re-enables a disabled skill through the same single control and preserves another row's state", () => {
      const p = props();
      render(
        <BuiltinSkillsTable
          {...p}
          skills={[p.skills[0], { ...p.skills[0], name: "other" }]}
          preferences={{ transcript: { disabled: true } }}
        />
      );
      expect(
        screen
          .getByRole("switch", { name: "Enable transcript in Vault Agent" })
          .getAttribute("aria-checked")
      ).toBe("false");
      expect(
        screen
          .getByRole("switch", { name: "Enable other in Vault Agent" })
          .getAttribute("aria-checked")
      ).toBe("true");
      fireEvent.click(screen.getByRole("switch", { name: "Enable transcript in Vault Agent" }));
      expect(p.onToggleSkill).toHaveBeenCalledWith("transcript", true);
    });
    it.each(["unavailable", "pending"])("prevents state changes while %s", (state) => {
      const p = props();
      p.unavailableReasons = state === "unavailable" ? { transcript: "Name collision" } : undefined;
      p.pendingSkills = state === "pending" ? ["transcript"] : [];
      render(<BuiltinSkillsTable {...p} />);
      expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(screen.getByRole("switch"));
      expect(p.onToggleSkill).not.toHaveBeenCalled();
    });
    it("offers the whole-skill menu action and read-only preview without edit or delete controls", () => {
      const p = props();
      render(<BuiltinSkillsTable {...p} />);
      openMenu();
      expect(screen.getAllByRole("menuitem")).toHaveLength(2);
      expect(screen.queryByText(/Delete|Properties|Edit SKILL/)).toBeNull();
      fireEvent.click(screen.getByRole("menuitem", { name: "Disable skill" }));
      expect(p.onToggleSkill).toHaveBeenCalledWith("transcript", false);
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "View SKILL.md (read-only)" }));
      expect(screen.getByText("# Read a transcript")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
    });
    it("shows errors and an empty search result", () => {
      render(<BuiltinSkillsTable {...props()} skills={[]} error="Cleanup failed" />);
      expect(screen.getByRole("alert").textContent).toBe("Cleanup failed");
      expect(screen.getByText("No built-in skills match your search.")).toBeTruthy();
    });
  });
});
