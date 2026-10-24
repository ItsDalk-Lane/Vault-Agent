import type { CompactionPolicy } from "@earendil-works/pi-durable";
import type { CatalogModelEntry } from "./ModelCatalog";

export const MIN_MODEL_CONTEXT_WINDOW = 8192;

export function requireModelContextWindow(entry: CatalogModelEntry): number {
  const size = entry.contextWindow;
  if (size === null || !Number.isSafeInteger(size) || size < MIN_MODEL_CONTEXT_WINDOW) {
    // 未声明容量时猜测会让长聊天溢出或无法压缩，必须由用户确认真实模型容量。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    throw new Error(
      `请在 模型配置中声明模型 ${entry.configuredModelId} 的上下文容量（至少 ${MIN_MODEL_CONTEXT_WINDOW}），再发送消息。`
    );
  }
  return size;
}

export function compactionPolicyForWindow(window: number): CompactionPolicy {
  return {
    enabled: true,
    reserveTokens: Math.min(16384, Math.floor(window / 8)),
    keepRecentTokens: Math.min(20000, Math.floor(window / 4)),
    backgroundTokens: Math.min(32768, Math.floor(window / 8)),
  };
}
