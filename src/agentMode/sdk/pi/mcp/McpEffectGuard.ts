import type { ConversationId, Harness, JsonObject } from "@earendil-works/pi-durable";
import type { ToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";

export interface McpEffectDecision {
  readonly operationId: string;
  readonly serverId: string;
  readonly canContinue: boolean;
  readonly effect: ToolOutcome["effect"];
}

export interface McpEffectGuard {
  readonly recovery: { readonly decisions: readonly McpEffectDecision[] };
  begin(serverId: string, outcome: ToolOutcome): Promise<boolean>;
  complete(serverId: string, outcome: ToolOutcome): Promise<void>;
  reconcile(): Promise<{ readonly decisions: readonly McpEffectDecision[] }>;
}

interface EffectsDocument extends JsonObject {
  operations: JsonObject;
}

interface StoredEffect {
  readonly serverId: string;
  readonly outcome: ToolOutcome;
}

const EMPTY_DECISIONS: readonly McpEffectDecision[] = Object.freeze([]);

// 外部操作先在同一 Durable 保存未知结果；这里仅投影统一 ToolOutcome，不另建文件账本或把重连当成副作用证明。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function createMcpEffectGuard(options: {
  readonly harness: Pick<Harness, "snapshot" | "conversation">;
  readonly conversationId: string;
}): Promise<McpEffectGuard> {
  const [{ defineDoc }, { BACKGROUND_CONTEXT }] = await Promise.all([
    import("@earendil-works/pi-durable"),
    import("@earendil-works/chord/context"),
  ]);
  const token = defineDoc<EffectsDocument>({
    kind: "va.mcp.effects",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ operations: {} }),
  });
  const conversationId = Number(options.conversationId) as ConversationId;
  let decisions: readonly McpEffectDecision[] = EMPTY_DECISIONS;
  const refresh = async () => {
    const state = await options.harness.snapshot(token, conversationId, BACKGROUND_CONTEXT);
    const records = Object.values(state?.operations ?? {}) as unknown as StoredEffect[];
    decisions = records.length
      ? Object.freeze(
          records.map(({ serverId, outcome }) => ({
            operationId: outcome.operationId,
            serverId,
            effect: outcome.effect,
            canContinue: outcome.effect !== "unknown" && outcome.effect !== "partially_applied",
          }))
        )
      : EMPTY_DECISIONS;
  };
  const conversation = async () => {
    const value = await options.harness.conversation(conversationId, BACKGROUND_CONTEXT);
    if (!value) throw new Error("外部操作所属会话不可用，未执行请求。");
    return value;
  };
  await refresh();
  return {
    get recovery() {
      return { decisions };
    },
    begin: async (serverId, outcome) => {
      const owner = await conversation();
      const admitted = await owner.commit(async (tx) => {
        const state = await tx.doc(token, conversationId);
        const records = Object.values(state.operations) as unknown as StoredEffect[];
        if (
          records.some(
            (record) =>
              record.outcome.operationId === outcome.operationId ||
              (record.serverId === serverId &&
                (record.outcome.effect === "unknown" ||
                  record.outcome.effect === "partially_applied"))
          )
        )
          return false;
        state.operations[outcome.operationId] = JSON.parse(JSON.stringify({ serverId, outcome }));
        return true;
      }, BACKGROUND_CONTEXT);
      await refresh();
      return admitted;
    },
    complete: async (serverId, outcome) => {
      const owner = await conversation();
      await owner.commit(async (tx) => {
        const state = await tx.doc(token, conversationId);
        const prior = state.operations[outcome.operationId] as unknown as StoredEffect | undefined;
        if (!prior || prior.serverId !== serverId)
          throw new Error("外部操作缺少原始持久记录，不能确认结果。");
        state.operations[outcome.operationId] = JSON.parse(JSON.stringify({ serverId, outcome }));
      }, BACKGROUND_CONTEXT);
      await refresh();
    },
    reconcile: async () => {
      // 通用 MCP 没有可信的操作状态协议；读取已保存事实不能证明远程效果，必须保持未知且绝不重发原操作。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      await refresh();
      return { decisions };
    },
  };
}
