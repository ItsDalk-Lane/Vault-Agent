import type { TranscriptContext } from "@earendil-works/pi-ai";
import type { ToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";

const METADATA_MAX_BYTES = 2048;

export function formatToolOutcomeMetadata(outcome: ToolOutcome): string {
  const receipts = [...(outcome.receipts ?? [])];
  const metadata = {
    operationId: outcome.operationId,
    source: outcome.source,
    status: outcome.status,
    effect: outcome.effect,
    ...(outcome.error ? { error: { code: outcome.error.code, phase: outcome.error.phase } } : {}),
    truncation: {
      hostTruncated: outcome.truncation?.truncated === true,
      metadataTruncated: false,
    },
    receipts,
    receiptsOmitted: 0,
    nextActions: outcome.nextActions,
  };
  const render = () =>
    `<host-tool-outcome>\nstatus describes this call's result; effect describes side effects. A successful read can be success + not_applied. hostTruncated covers host output only; metadataTruncated covers receipt references. SDK output-limit warnings remain in the original harness diagnostics.\n${JSON.stringify(metadata).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")}\n</host-tool-outcome>`;
  let text = render();
  while (new TextEncoder().encode(text).byteLength > METADATA_MAX_BYTES && receipts.length > 0) {
    receipts.pop();
    metadata.receiptsOmitted += 1;
    metadata.truncation.metadataTruncated = true;
    text = render();
  }
  return text;
}

export function compileModelToolResults(context: TranscriptContext): TranscriptContext {
  let changed = false;
  const messages = context.messages.map((message) => {
    if (message.role !== "toolResult") return message;
    const details = message.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) return message;
    const value = (details as Record<string, unknown>).outcome;
    if (!value || typeof value !== "object" || Array.isArray(value)) return message;
    const outcome = value as unknown as ToolOutcome;
    if (
      typeof outcome.operationId !== "string" ||
      !outcome.source ||
      !outcome.status ||
      !outcome.effect
    )
      return message;
    const text = formatToolOutcomeMetadata(outcome);
    if (message.content.some((part) => part.type === "text" && part.text === text)) return message;
    changed = true;
    // SDK 已经裁切正文；请求层只补真实结果元数据，随后统一窗口门会计算它，既不改原工具消费也不再被正文裁切。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    return { ...message, content: [...message.content, { type: "text" as const, text }] };
  });
  return changed ? { ...context, messages } : context;
}
