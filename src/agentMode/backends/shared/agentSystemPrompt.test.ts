import { VAULT_AGENT_PROMPT_BASE } from "./agentSystemPrompt";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("agentSystemPrompt", () => {
  describe("VAULT_AGENT_PROMPT_BASE", () => {
    it("does not carry chat-mode-only baggage that misfires in tool-driven agents", () => {
      expect(VAULT_AGENT_PROMPT_BASE).not.toMatch(/@vault/);
      expect(VAULT_AGENT_PROMPT_BASE).not.toMatch(/getCurrentTime/);
      expect(VAULT_AGENT_PROMPT_BASE).not.toMatch(/getTimeRangeMs/);
      expect(VAULT_AGENT_PROMPT_BASE).not.toMatch(/YouTube/);
    });
  });
});
