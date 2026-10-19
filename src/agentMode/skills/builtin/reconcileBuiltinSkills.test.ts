import { availableBuiltinAgents } from "./reconcileBuiltinSkills";
import type {} from "./seedBuiltinSkills";

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";

describe("reconcileBuiltinSkills", () => {
  describe("availableBuiltinAgents()", () => {
    it("reuses the ready agent list when membership is unchanged https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      const previous = ["claude"];
      expect(
        availableBuiltinAgents({ claude: { kind: "ready", source: "managed" } }, previous)
      ).toBe(previous);
    });

    it(`preserves a known ready agent during checking without enabling an unverified first install ${ISSUE}`, () => {
      expect(
        availableBuiltinAgents(
          {
            claude: { kind: "checking", source: "custom" },
            codex: { kind: "checking", source: "custom" },
            opencode: { kind: "ready", source: "managed" },
          },
          ["claude"]
        )
      ).toEqual(["claude", "opencode"]);
      expect(
        availableBuiltinAgents(
          { claude: { kind: "absent" }, codex: { kind: "error", message: "incompatible" } },
          ["claude", "codex"]
        )
      ).toEqual([]);
    });
  });
});
