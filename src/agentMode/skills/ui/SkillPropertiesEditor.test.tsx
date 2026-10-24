import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { SkillPropertiesEditor, type SkillPropertiesEditorProps } from "./SkillPropertiesEditor";

function props(): SkillPropertiesEditorProps {
  return {
    skill: {
      name: "writing-helper",
      description: "Review the writing.",
      body: "Unchanged instructions",
      filePath: "/vault/skills/writing-helper/SKILL.md",
      dirPath: "/vault/skills/writing-helper",
      enabledAgents: ["pi"],
      location: { kind: "canonical" },
      allowedTools: "Read Grep",
      model: "claude-opus-4-7",
      disableModelInvocation: true,
    },
    skillsFolderRel: "vault-agent/skills",
    saving: false,
    collisionError: false,
    onSave: jest.fn(),
    onCancel: jest.fn(),
  };
}

describe("SkillPropertiesEditor", () => {
  describe("SkillPropertiesEditor()", () => {
    it("saves only supported properties and leaves legacy model, tool and invocation metadata untouched https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const p = props();
      render(<SkillPropertiesEditor {...p} />);
      expect(screen.queryByLabelText("Allowed tools")).toBeNull();
      expect(screen.queryByText(/Claude only|Model override|Don't let Claude/)).toBeNull();
      fireEvent.change(screen.getByLabelText("Description"), {
        target: { value: "Updated description." },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(p.onSave).toHaveBeenCalledWith({
        nameChanged: false,
        newName: "writing-helper",
        patch: { description: "Updated description.", userInvocable: false },
      });
      expect(p.skill.model).toBe("claude-opus-4-7");
      expect(p.skill.body).toBe("Unchanged instructions");
    });

    it("reports a valid renamed skill and allows a hidden skill back into slash commands", () => {
      const p = props();
      p.skill.userInvocable = false;
      render(<SkillPropertiesEditor {...p} />);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "writing-review" } });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(p.onSave).toHaveBeenCalledWith({
        nameChanged: true,
        newName: "writing-review",
        patch: { description: p.skill.description, userInvocable: undefined },
      });
    });

    it.each(["", "Invalid Name", "a".repeat(65)])(
      "blocks an invalid skill name %s without saving",
      (name) => {
        const p = props();
        render(<SkillPropertiesEditor {...p} />);
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
        expect(p.onSave).not.toHaveBeenCalled();
      }
    );

    it.each([" ", "a".repeat(1025)])(
      "blocks an invalid description without saving",
      (description) => {
        const p = props();
        render(<SkillPropertiesEditor {...p} />);
        fireEvent.change(screen.getByLabelText("Description"), { target: { value: description } });
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
      }
    );

    it("shows a collision while preserving the draft and leaves cancel functional", () => {
      const p = props();
      render(<SkillPropertiesEditor {...p} collisionError />);
      expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(p.onCancel).toHaveBeenCalledTimes(1);
    });

    it("prevents repeated save or cancel while the current save is pending", () => {
      const p = props();
      render(<SkillPropertiesEditor {...p} saving />);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(p.onSave).not.toHaveBeenCalled();
      expect(p.onCancel).not.toHaveBeenCalled();
    });
  });
});
