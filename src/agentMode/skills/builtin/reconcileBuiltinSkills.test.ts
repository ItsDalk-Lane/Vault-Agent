import { DEFAULT_SETTINGS } from "@/constants";
import {
  ALL_MANAGED_SKILLS,
  BUILTIN_SKILLS,
  RETIRED_BUILTIN_SKILLS,
} from "@/builtinSkills/builtinSkills";
import { getBuiltinSkillVersion } from "./builtinOwnership";
import {
  availableBuiltinAgents,
  reconcileBuiltinSkills,
  type BuiltinPreferences,
} from "./reconcileBuiltinSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import type { BuiltinSeedFs } from "./seedBuiltinSkills";

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
const ISSUE_717 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/717";
const ISSUE_656 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/656";
const INSTALLED_PLUS_READ_PDF_MD = `---
name: copilot-read-pdf
description: Extract the full text of a PDF as Markdown using Copilot Plus.
license: Copilot Plus
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "9"
---

# Copilot read PDF
`;
const folder = "copilot/skills";
function fixture(preferences?: BuiltinPreferences) {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const fs: BuiltinSeedFs = {
    exists: async (path) => files.has(path) || dirs.has(path),
    read: async (path) => {
      if (!files.has(path)) throw new Error("unreadable");
      return files.get(path)!;
    },
    write: async (path, content) => {
      files.set(path, content);
    },
    mkdir: async (path) => {
      dirs.add(path);
    },
    removeDir: async (path) => {
      for (const file of files.keys()) {
        if (file.startsWith(`${path}/`)) files.delete(file);
      }
      for (const dir of dirs) {
        if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      }
    },
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    agentMode: { ...DEFAULT_SETTINGS.agentMode, skills: { ...DEFAULT_SETTINGS.agentMode.skills } },
  };
  settings.agentMode.skills.builtinPreferences = preferences;
  const options = {
    folder,
    fs,
    settings,
    availableAgents: [] as string[],
    registeredAgents: ["claude", "codex", "opencode"],
  };
  return {
    files,
    dirs,
    options,
    path: (name: string) => `${folder}/${name}/SKILL.md`,
  };
}

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
