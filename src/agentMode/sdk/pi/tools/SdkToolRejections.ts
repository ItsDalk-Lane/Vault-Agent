import type { EntryRecord, TaskRecord, Harness, TaskId } from "@earendil-works/pi-durable";
import { createToolOutcome, type ToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";

export interface SdkToolRejection {
  readonly taskId: string;
  readonly conversationId: string;
  readonly entryId?: string;
  readonly parentTaskId?: string;
  readonly assistantEntryId?: string;
  readonly toolId: string;
  readonly arguments?: unknown;
  readonly outcome: ToolOutcome;
}

export interface NestedRejectionReceipt {
  readonly parentTaskId: string;
  readonly key: string;
  readonly result: unknown;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function deriveSdkToolRejection(input: {
  readonly ownerSessionId: string;
  readonly caller: string;
  readonly task: TaskRecord<unknown, unknown, unknown>;
  readonly entry?: EntryRecord;
  readonly nested?: NestedRejectionReceipt;
}): SdkToolRejection | null {
  const { task, entry, nested } = input;
  if (
    task.kind !== "pi.tool" ||
    task.state.status !== "terminal" ||
    task.state.outcome.status !== "completed"
  )
    return null;
  const source = object(task.input);
  const settled = object(task.state.outcome.result);
  let diagnosticSource: unknown;
  let toolId: string;
  let receipt: string;
  let extra: Pick<SdkToolRejection, "entryId" | "parentTaskId" | "assistantEntryId" | "arguments">;
  if (
    source?.kind === "model" &&
    entry?.kind === "pi.tool-result" &&
    entry.byTaskId === task.id &&
    entry.conversationId === task.conversationId &&
    settled?.entryId === entry.id
  ) {
    const message = entry.model?.find((message) => message.role === "toolResult");
    if (message?.role !== "toolResult" || object(message.details)?.outcome || !message.isError)
      return null;
    diagnosticSource = object(entry.data)?.diagnostics;
    toolId = message.toolName;
    receipt = `entry:${entry.id}`;
    extra = { entryId: String(entry.id), assistantEntryId: String(source.assistant) };
  } else if (
    source?.kind === "nested" &&
    settled?.kind === "nested" &&
    nested &&
    String(source.parent) === nested.parentTaskId &&
    source.key === nested.key
  ) {
    const result = object(nested.result);
    const call = object(source.call);
    if (
      result?.taskId !== task.id ||
      result?.isError !== true ||
      object(result.details)?.outcome ||
      typeof call?.name !== "string"
    )
      return null;
    diagnosticSource = result.diagnostics;
    toolId = call.name;
    receipt = `nested:${nested.parentTaskId}:${nested.key}:${task.id}`;
    extra = { parentTaskId: nested.parentTaskId, arguments: call.arguments };
  } else return null;
  // 只有 SDK 明确的执行前拒绝可证明未作用；取消和中断仍沿各自原始事实处理。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const diagnostic = Array.isArray(diagnosticSource)
    ? diagnosticSource
        .map(object)
        .find(
          (item) =>
            item?.severity === "error" &&
            (item.code === "invalid_arguments" || item.code === "tool_unavailable")
        )
    : undefined;
  if (!diagnostic || typeof diagnostic.message !== "string") return null;
  return {
    taskId: String(task.id),
    conversationId: String(task.conversationId),
    toolId,
    ...extra,
    outcome: createToolOutcome({
      operationId: `tool-task:${input.ownerSessionId}:${task.conversationId}:${task.id}`,
      toolId,
      caller: input.caller,
      success: false,
      effect: "not_applied",
      error: { code: String(diagnostic.code), phase: "validation", message: diagnostic.message },
      receipts: [receipt],
    }),
  };
}

export async function readSdkToolRejections(input: {
  readonly harness: Pick<Harness, "getTask">;
  readonly entries: readonly EntryRecord[];
  readonly ownerSessionId: string;
  readonly caller: (conversationId: string) => string;
}): Promise<readonly SdkToolRejection[]> {
  const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
  const facts: SdkToolRejection[] = [];
  for (const entry of input.entries) {
    if (entry.kind !== "pi.tool-result" || entry.byTaskId === undefined) continue;
    const task = await input.harness.getTask(entry.byTaskId, BACKGROUND_CONTEXT);
    if (
      !task ||
      task.id !== entry.byTaskId ||
      task.kind !== "pi.tool" ||
      task.conversationId !== entry.conversationId
    )
      continue;
    const common = {
      ownerSessionId: input.ownerSessionId,
      caller: input.caller(String(entry.conversationId)),
    };
    const fact = deriveSdkToolRejection({ ...common, task, entry });
    if (fact) facts.push(fact);
    const message = entry.model?.find((message) => message.role === "toolResult");
    const nested =
      message?.role === "toolResult" ? object(message.details)?.sdkToolRejections : null;
    if (!Array.isArray(nested)) continue;
    for (const value of nested) {
      const receipt = object(value);
      if (
        !receipt ||
        typeof receipt.taskId !== "string" ||
        typeof receipt.key !== "string" ||
        receipt.parentTaskId !== String(entry.byTaskId)
      )
        continue;
      const child = await input.harness.getTask(
        Number(receipt.taskId) as TaskId,
        BACKGROUND_CONTEXT
      );
      if (!child) continue;
      const rejected = deriveSdkToolRejection({
        ...common,
        task: child,
        nested: { parentTaskId: String(entry.byTaskId), key: receipt.key, result: receipt.result },
      });
      if (rejected) facts.push(rejected);
    }
  }
  return facts;
}
