import type { Api, Model, TranscriptContext } from "@earendil-works/pi-ai";

export async function budgetModelRequest(
  model: Model<Api>,
  context: TranscriptContext,
  requestedMaxTokens?: number
): Promise<{ readonly inputTokens: number; readonly maxTokens: number }> {
  const window = model.contextWindow;
  if (!Number.isSafeInteger(window) || window <= 0)
    throw new Error("请先声明模型的真实上下文容量，再发送请求。");
  const [{ resolveTranscript }, { estimateMessageTokens }] = await Promise.all([
    import("@earendil-works/pi-ai/utils/transcript"),
    import("@earendil-works/pi-ai/utils/estimate"),
  ]);
  const compat = model.compat;
  const nativeSystem =
    compat &&
    "supportsMidConvoSystemMessages" in compat &&
    compat.supportsMidConvoSystemMessages === true;
  const transcript = resolveTranscript(context, nativeSystem);
  // SDK 估算包含工具、图片和正文；额外预留协议包装，最终输出与最新检查点必须共同受真实窗口约束：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const inputTokens = transcript.messages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0
  );
  const remaining = window - inputTokens - Math.max(64, transcript.messages.length * 4);
  if (remaining < 1)
    throw new Error(
      "context_length_exceeded: 当前指令、工具和对话已超过模型声明容量；请缩小输入或整理会话后再继续。"
    );
  const modelLimit = model.maxTokens > 0 ? model.maxTokens : remaining;
  const requested = requestedMaxTokens ?? modelLimit;
  if (!Number.isFinite(requested) || requested < 1)
    throw new Error("模型请求的输出容量必须为正数。");
  return { inputTokens, maxTokens: Math.floor(Math.min(requested, modelLimit, remaining)) };
}
