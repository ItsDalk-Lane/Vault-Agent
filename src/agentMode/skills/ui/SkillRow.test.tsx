import type { Skill } from "@/agentMode/skills/types";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { Notice } from "obsidian";
import { SkillRow } from "./SkillRow";

const mockSetSkillEnabled = jest.fn();
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: { getInstance: () => ({ setSkillEnabled: mockSetSkillEnabled }) },
}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

const canonicalSkill: Skill = {
  name: "writing-helper",
  description: "Helps with writing.",
  filePath: "/vault/vault-agent/skills/writing-helper/SKILL.md",
  dirPath: "/vault/vault-agent/skills/writing-helper",
  body: "User instructions remain unchanged.",
  enabledAgents: ["claude", "codex"],
  location: { kind: "canonical" },
};

function renderRow(skill = canonicalSkill, onRevealInVault = jest.fn()) {
  const containerRef: React.RefObject<HTMLDivElement> = { current: null };
  return render(
    <>
      <div ref={containerRef} />
      <SkillRow skill={skill} onRevealInVault={onRevealInVault} containerRef={containerRef} />
    </>
  );
}

function openMenu() {
  fireEvent.pointerDown(screen.getByLabelText(/More actions/i), { button: 0, ctrlKey: false });
}

describe("SkillRow", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  describe("SkillRow()", () => {
    beforeEach(() => {
      mockSetSkillEnabled.mockReset().mockResolvedValue({ ok: true });
      jest.mocked(Notice).mockClear();
    });

    it("offers one Vault Agent switch and enables only its identity while retaining legacy metadata https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      renderRow();
      expect(screen.getAllByRole("switch")).toHaveLength(1);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      await act(async () => {
        fireEvent.click(screen.getByRole("switch"));
      });
      expect(mockSetSkillEnabled).toHaveBeenCalledWith(canonicalSkill, true);
      expect(canonicalSkill.enabledAgents).toEqual(["claude", "codex"]);
      expect(screen.queryByRole("button", { name: /Claude|Codex|OpenCode/i })).toBeNull();
    });

    it("disables an enabled Vault Agent skill through the same saved metadata path https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const skill = { ...canonicalSkill, enabledAgents: ["pi", "claude"] };
      renderRow(skill);
      await act(async () => {
        fireEvent.click(screen.getByRole("switch"));
      });
      expect(mockSetSkillEnabled).toHaveBeenCalledWith(skill, false);
    });

    it.each(["fs-error", "eperm"])(
      "reports a %s toggle failure instead of silently dropping it https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (code) => {
        mockSetSkillEnabled.mockResolvedValue({ ok: false, code, message: "permission denied" });
        renderRow();
        await act(async () => {
          fireEvent.click(screen.getByRole("switch"));
        });
        expect(Notice).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
      }
    );

    it("reports a thrown toggle failure without leaving an unhandled rejection", async () => {
      mockSetSkillEnabled.mockRejectedValue(new Error("write failed"));
      renderRow();
      await act(async () => {
        fireEvent.click(screen.getByRole("switch"));
      });
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("write failed"));
    });

    it("keeps Reveal in vault functional without engaging a body scroll lock", () => {
      const reveal = jest.fn();
      renderRow(canonicalSkill, reveal);
      openMenu();
      expect(activeDocument.body.hasAttribute("data-scroll-locked")).toBe(false);
      fireEvent.click(screen.getByText("Reveal in vault"));
      expect(reveal).toHaveBeenCalledTimes(1);
    });

    it("shows the effective slash-menu preference without claiming unused Claude behavior https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      renderRow({
        ...canonicalSkill,
        model: "claude-opus-4-7",
        disableModelInvocation: true,
        userInvocable: false,
      });
      expect(screen.queryByText(/claude ·|model-invoke off/)).toBeNull();
      expect(screen.getByText("hidden from /")).toBeTruthy();
    });
  });
});
