// 用量胶囊的数字格式化与派生指标；口径与 deepseek-harness 参考图一致。
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/11

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toLocaleString();
}

export function formatSecondsFromMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function turnDisplayTokens(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.outputTokens;
}

export function cacheHitPercent(inputTokens: number, cacheReadTokens: number): number | null {
  const denominator = inputTokens + cacheReadTokens;
  return denominator > 0 ? Math.round((cacheReadTokens / denominator) * 100) : null;
}
