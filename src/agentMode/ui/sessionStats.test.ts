import { computeSessionStats } from "@/agentMode/ui/sessionStats";
import type { AgentChatMessage } from "@/agentMode/session/types";

function userMessage(id: string): AgentChatMessage {
  return { id, sender: "user", timestamp: null, isVisible: true, message: "prompt" };
}

function aiMessage(id: string, turnUsage: AgentChatMessage["turnUsage"]): AgentChatMessage {
  return { id, sender: "ai", timestamp: null, isVisible: true, message: "answer", turnUsage };
}

describe("sessionStats", () => {
  describe("computeSessionStats()", () => {
    it("returns null when no user round and no committed usage exists", () => {
      expect(computeSessionStats([aiMessage("a1", undefined)])).toBeNull();
      expect(computeSessionStats([])).toBeNull();
    });

    it("counts user rounds, model-request steps and token totals across turns (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      const stats = computeSessionStats([
        userMessage("u1"),
        aiMessage("a1", {
          inputTokens: 900,
          outputTokens: 100,
          cacheReadTokens: 1_000,
          cacheWriteTokens: 5,
          modelRequests: 3,
          modelDurationMs: 2_000,
          toolDurationMs: 500,
          ttftMs: 200,
          modelId: "m1",
        }),
        userMessage("u2"),
        aiMessage("a2", {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 300,
          cacheWriteTokens: 0,
          modelRequests: 1,
          modelDurationMs: 1_000,
          ttftMs: 400,
          modelId: "m2",
        }),
      ]);

      expect(stats).toMatchObject({
        rounds: 2,
        steps: 4,
        inputTokens: 1_000,
        outputTokens: 150,
        cacheReadTokens: 1_300,
        totalTokens: 2_450,
        cacheHit: 57,
        modelDurationMs: 3_000,
        toolDurationMs: 500,
        ttftMs: 250,
        tokensPerSecond: 50,
      });
    });

    it("skips auxiliary user rows from the round count (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      const auxiliary: AgentChatMessage = {
        ...userMessage("aux"),
        isAuxiliary: true,
      };
      const stats = computeSessionStats([auxiliary, userMessage("u1")]);
      expect(stats?.rounds).toBe(1);
      expect(computeSessionStats([auxiliary])).toBeNull();
    });

    it("leaves timing metrics null for legacy turns without instrumentation (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      const stats = computeSessionStats([
        userMessage("u1"),
        aiMessage("a1", {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          modelRequests: 1,
        }),
      ]);

      expect(stats).toMatchObject({
        rounds: 1,
        steps: 1,
        modelDurationMs: null,
        toolDurationMs: null,
        ttftMs: null,
        tokensPerSecond: null,
        cacheHit: 0,
      });
    });
  });
});
