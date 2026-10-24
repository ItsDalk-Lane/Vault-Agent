import type { App } from "obsidian";
import { getSettings, setSettings } from "@/settings/model";
import { createCopilotPatternFilter } from "./searchUtils";

const managedRoot = "自定管理目录";
const projectRules = `${managedRoot}/projects/中文项目/AGENTS.md`;
const app = { vault: { getAbstractFileByPath: () => null } } as unknown as App;

describe("searchUtils", () => {
  let previous: ReturnType<typeof getSettings>;
  beforeEach(() => {
    previous = getSettings();
    setSettings({ vaultAgentFolder: managedRoot, qaInclusions: "", qaExclusions: "" });
  });
  afterEach(() => setSettings(previous));

  describe("createCopilotPatternFilter()", () => {
    it("keeps system-managed content and AGENTS out of ordinary retrieval while retaining user path exclusions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(createCopilotPatternFilter(app)("AGENTS.md")).toBe(false);
      expect(createCopilotPatternFilter(app)(projectRules)).toBe(false);
      expect(createCopilotPatternFilter(app)("Notes/ordinary.md")).toBe(true);
      setSettings({ qaExclusions: "Notes" });
      expect(createCopilotPatternFilter(app)("Notes/ordinary.md")).toBe(false);
    });
  });
});
