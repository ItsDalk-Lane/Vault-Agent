import {
  VAULT_AGENT_PROMPT_BASE,
  VAULT_AGENT_EXECUTION_POLICY,
  VAULT_AGENT_WEB_RESEARCH_STEERING,
  VAULT_AGENT_INSTRUCTION_PRECEDENCE,
} from "./agentSystemPrompt";

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
  describe("VAULT_AGENT_INSTRUCTION_PRECEDENCE", () => {
    it("states the complete agreed instruction priority without letting text override enforced permissions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const ordered = [
        "current explicit user request",
        "user's custom instructions",
        "nearest applicable directory instructions",
        "ancestor directory instructions",
        "skill recommendations",
        "product defaults",
      ];
      const positions = ordered.map((source) => VAULT_AGENT_INSTRUCTION_PRECEDENCE.indexOf(source));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      expect(VAULT_AGENT_INSTRUCTION_PRECEDENCE).toContain(
        "cannot override enforced permissions or actual tool results"
      );
    });
  });
  describe("VAULT_AGENT_EXECUTION_POLICY", () => {
    it("requires evidence for completion and distinguishes permission denial from unknown effects https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(VAULT_AGENT_EXECUTION_POLICY).toContain("verified results");
      expect(VAULT_AGENT_EXECUTION_POLICY).toContain("unknown");
      expect(VAULT_AGENT_EXECUTION_POLICY).toContain("rejection");
      expect(VAULT_AGENT_EXECUTION_POLICY).toContain("untrusted data");
    });
  });
  describe("VAULT_AGENT_WEB_RESEARCH_STEERING", () => {
    it("conditions external research on actual configured capability https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(VAULT_AGENT_WEB_RESEARCH_STEERING).toContain("available");
      expect(VAULT_AGENT_WEB_RESEARCH_STEERING).toContain("unavailable");
    });
  });
});
