import { getSettings, resetSettings, updateSetting, type CopilotSettings } from "@/settings/model";
import {
  setDisableBuiltinSystemPrompt,
  setSelectedPromptTitle,
  updateCachedSystemPrompts,
} from "@/system-prompts/state";
import type { UserSystemPrompt } from "@/system-prompts/type";
import {
  buildAgentSystemPrompt,
  COPILOT_FEEDBACK_POINTER,
  COPILOT_INSTRUCTION_PRECEDENCE,
  COPILOT_PROJECT_WORKSPACE_POLICY,
  COPILOT_PROMPT_BASE,
  COPILOT_WEB_RESEARCH_STEERING,
} from "./agentSystemPrompt";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makePrompt(title: string, content: string): UserSystemPrompt {
  return { title, content, createdMs: 0, modifiedMs: 0, lastUsedMs: 0 };
}

const ISSUE_599 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/599";
const ISSUE_717 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/717";
const ISSUE_656 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/656";
const AGENT = "opencode";
const ALL_RELAY_SKILLS_LINE =
  "For these jobs, load and run the matching Copilot skill before any built-in web tool (websearch, webfetch, WebSearch, WebFetch, web_search or similar): copilot-web-search for web search, copilot-web-fetch for pages/URLs, copilot-youtube-transcript for YouTube, copilot-fetch-x for X posts.";

function setBuiltinPreferences(
  builtinPreferences: NonNullable<CopilotSettings["agentMode"]["skills"]["builtinPreferences"]>
): void {
  const agentMode = getSettings().agentMode;
  updateSetting("agentMode", { ...agentMode, skills: { ...agentMode.skills, builtinPreferences } });
}

function resetPromptState(): void {
  setDisableBuiltinSystemPrompt(false);
  setSelectedPromptTitle("");
  updateSetting("defaultSystemPromptTitle", "");
  updateCachedSystemPrompts([]);
}

describe("agentSystemPrompt", () => {

  describe("COPILOT_PROMPT_BASE", () => {
    it("does not carry chat-mode-only baggage that misfires in tool-driven agents", () => {
      expect(COPILOT_PROMPT_BASE).not.toMatch(/@vault/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/getCurrentTime/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/getTimeRangeMs/);
      expect(COPILOT_PROMPT_BASE).not.toMatch(/YouTube/);
    });
  });
});
