import type { Api, Model, TranscriptContext } from "@earendil-works/pi-ai";

export function withStructuredToolSampling(
  model: Model<Api>,
  context: TranscriptContext
): TranscriptContext {
  const compat = model.compat;
  const supported =
    compat &&
    (("supportsStrictMode" in compat && compat.supportsStrictMode === true) ||
      ("supportsStrictTools" in compat && compat.supportsStrictTools === true));
  // 声明结构化能力后为普通工具启用首选约束，复杂 schema 仍由 SDK 安全降级。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (!supported) return context;
  return {
    ...context,
    messages: context.messages.map((message) =>
      message.role === "system" && message.toolsAdded
        ? {
            ...message,
            toolsAdded: message.toolsAdded.map((tool) => ({
              ...tool,
              constrainedSampling: tool.constrainedSampling ?? {
                type: "json_schema",
                strict: "prefer",
              },
            })),
          }
        : message
    ),
  };
}
