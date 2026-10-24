import type { AgentChatMessage } from "@/agentMode/session/types";
import { cacheHitPercent, turnDisplayTokens } from "@/agentMode/ui/usageFormat";

// 从消息列表汇总会话级统计：轮数、模型请求数、token 总量、模型/工具耗时、加权平均 TTFT。
// 只用已提交轮次的 turnUsage，流式中的轮不编造数字。https://github.com/ItsDalk-Lane/Vault-Agent/issues/11
export interface SessionStats {
  rounds: number;
  steps: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHit: number | null;
  modelDurationMs: number | null;
  toolDurationMs: number | null;
  ttftMs: number | null;
  tokensPerSecond: number | null;
}

export function computeSessionStats(messages: readonly AgentChatMessage[]): SessionStats | null {
  let rounds = 0;
  let steps = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let modelDurationMs: number | null = null;
  let toolDurationMs: number | null = null;
  let ttftWeightedSum = 0;
  let ttftWeight = 0;
  for (const message of messages) {
    if (message.sender === "user") {
      if (!message.isAuxiliary) rounds += 1;
      continue;
    }
    const usage = message.turnUsage;
    if (!usage) continue;
    steps += usage.modelRequests;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheReadTokens += usage.cacheReadTokens;
    cacheWriteTokens += usage.cacheWriteTokens;
    if (usage.modelDurationMs !== undefined)
      modelDurationMs = (modelDurationMs ?? 0) + usage.modelDurationMs;
    if (usage.toolDurationMs !== undefined)
      toolDurationMs = (toolDurationMs ?? 0) + usage.toolDurationMs;
    if (usage.ttftMs !== undefined) {
      ttftWeightedSum += usage.ttftMs * usage.modelRequests;
      ttftWeight += usage.modelRequests;
    }
  }
  if (rounds === 0 && steps === 0) return null;
  return {
    rounds,
    steps,
    totalTokens: turnDisplayTokens({ inputTokens, outputTokens, cacheReadTokens }),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheHit: cacheHitPercent(inputTokens, cacheReadTokens),
    modelDurationMs,
    toolDurationMs,
    ttftMs: ttftWeight > 0 ? Math.round(ttftWeightedSum / ttftWeight) : null,
    tokensPerSecond:
      modelDurationMs !== null && modelDurationMs > 0 && outputTokens > 0
        ? outputTokens / (modelDurationMs / 1000)
        : null,
  };
}
