import type { JsonValue } from "@earendil-works/chord";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import {
  createToolOutcome,
  type ToolEffectState,
  type ToolOutcome,
  type ToolOutcomePhase,
} from "./ToolOutcome";

export interface ToolResultIdentity {
  readonly operationId: string;
  readonly toolId: string;
  readonly caller: string;
}

export function readToolOutcomeData(details: unknown): unknown {
  const outcome = readOutcome(details);
  return outcome ? outcome.data : details;
}

// 结构数据只保留在 outcome.data；旧 details 仍可读取，显示文字裁切不会丢掉操作身份、错误阶段和实际收据。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export function withToolOutcome(
  result: ToolExecutionResult,
  input: ToolResultIdentity & {
    readonly effect: ToolEffectState;
    readonly phase?: ToolOutcomePhase;
  }
): ToolExecutionResult {
  const existing = readOutcome(result.details);
  const data = existing ? existing.data : result.details;
  const record = object(data);
  const error = object(record?.error);
  const code =
    string(record?.code) ?? string(record?.errorCode) ?? string(error?.code) ?? "TOOL_FAILED";
  const failed = result.isError === true || existing?.status === "error";
  const references = [
    record?.answerEntryId,
    record?.resultRef,
    record?.submissionId,
    record?.taskId,
    record?.childConversationId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const outcome = createToolOutcome({
    ...input,
    success: !failed,
    effect: existing?.effect ?? input.effect,
    data,
    ...(failed
      ? {
          error: existing?.error ?? {
            code,
            phase: input.phase ?? (code.endsWith("_CONFLICT") ? "verification" : "review"),
            message:
              string(record?.message) ?? string(error?.message) ?? "工具未能完成，请查看结果。",
          },
        }
      : {}),
    truncated:
      existing?.truncation?.truncated === true ||
      record?.truncated === true ||
      record?.outputTruncated === true,
    receipts: [
      ...new Set([
        ...(existing?.receipts ?? []),
        ...(existing && existing.operationId !== input.operationId ? [existing.operationId] : []),
        ...references,
      ]),
    ],
  });
  return { ...result, isError: failed, details: { outcome: outcome as unknown as JsonValue } };
}

export function failedToolOutcome(
  error: unknown,
  input: ToolResultIdentity & { readonly invoked: boolean; readonly mayMutate: boolean }
): ToolExecutionResult {
  const record = object(error);
  const code = string(record?.code) ?? "TOOL_FAILED";
  const name = error instanceof Error ? error.name : string(record?.name);
  // Durable 的 SessionFailed 表示无法证明最终保存结果；参数/审批/版本错误和普通读取失败不能冒充未知副作用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const persistenceFailure =
    name === "SessionFailed" || ["EIO", "ENOSPC", "EROFS", "STORAGE_FAILED"].includes(code);
  return withToolOutcome(
    {
      isError: true,
      output: [
        {
          type: "text",
          text: JSON.stringify({
            code,
            message: error instanceof Error ? error.message : "工具执行失败。",
          }),
        },
      ],
      details: { code, message: error instanceof Error ? error.message : "工具执行失败。" },
    },
    {
      ...input,
      effect: input.invoked && input.mayMutate && persistenceFailure ? "unknown" : "not_applied",
      phase: persistenceFailure
        ? "persistence"
        : code.endsWith("_CONFLICT")
          ? "verification"
          : input.invoked
            ? "execution"
            : "review",
    }
  );
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function readOutcome(details: unknown): ToolOutcome | undefined {
  const candidate = object(object(details)?.outcome);
  const source = object(candidate?.source);
  return candidate &&
    typeof candidate.operationId === "string" &&
    typeof source?.toolId === "string" &&
    typeof source?.caller === "string" &&
    ["success", "error"].includes(String(candidate.status)) &&
    ["not_applied", "applied", "partially_applied", "unknown"].includes(String(candidate.effect))
    ? (candidate as unknown as ToolOutcome)
    : undefined;
}
