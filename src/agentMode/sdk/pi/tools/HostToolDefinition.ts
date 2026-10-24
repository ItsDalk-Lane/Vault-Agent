import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import type {
  CapabilityCatalog,
  CapabilityDefinition,
} from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import { createToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";
import { withToolOutcome } from "@/agentMode/sdk/pi/tools/ToolResultOutcome";
import {
  deriveSdkToolRejection,
  type NestedRejectionReceipt,
} from "@/agentMode/sdk/pi/tools/SdkToolRejections";

export interface HostToolExecutionDecision {
  readonly block?: string;
  readonly caller?: string;
  readonly code?: string;
  readonly operationId?: string;
  readonly ownerSessionId?: string;
}

export interface HostToolDefinition extends CapabilityDefinition {
  readonly description: string;
  readonly parameters: ToolRegistration["parameters"];
  readonly replay: NonNullable<ToolRegistration["replay"]>;
  readonly executionMode?: ToolRegistration["executionMode"];
  readonly callers?: ToolRegistration["callers"];
  readonly outputLimits: NonNullable<ToolRegistration["outputLimits"]>;
  readonly execute: ToolRegistration["execute"];
  readonly prepareArguments?: ToolRegistration["prepareArguments"];
  readonly structuredOutputSchema?: ToolRegistration["structuredOutputSchema"];
  readonly constrainedSampling?: ToolRegistration["constrainedSampling"];
  readonly deferred?: ToolRegistration["deferred"];
}

export type HostToolExecutionGate = (
  name: string,
  args: unknown,
  api: Pick<ToolExecutionApi, "conversationId" | "taskId">,
  context: Context
) => Promise<HostToolExecutionDecision>;

export function compileHostToolDefinition<T extends HostToolDefinition>(
  definition: T,
  catalog?: CapabilityCatalog
): Omit<ToolRegistration, "replay" | "parameters" | "outputLimits"> &
  Pick<T, "replay" | "parameters" | "outputLimits"> {
  const parameters = freezeSchema(JSON.parse(JSON.stringify(definition.parameters)));
  const bound = Object.freeze({
    ...definition,
    effects: Object.freeze([...definition.effects]),
    allowedCallers: Object.freeze([...definition.allowedCallers]),
    parameters,
    outputLimits: Object.freeze({ ...definition.outputLimits }),
    ...(definition.callers ? { callers: Object.freeze([...definition.callers]) } : {}),
    outputContract: "tool-outcome-v1" as const,
  });
  catalog?.register(bound);
  return Object.freeze({
    name: bound.toolId,
    description: bound.description,
    parameters: bound.parameters,
    replay: bound.replay,
    ...(bound.executionMode ? { executionMode: bound.executionMode } : {}),
    ...(bound.callers ? { callers: bound.callers } : {}),
    ...(bound.prepareArguments ? { prepareArguments: bound.prepareArguments } : {}),
    ...(bound.structuredOutputSchema
      ? { structuredOutputSchema: bound.structuredOutputSchema }
      : {}),
    ...(bound.constrainedSampling ? { constrainedSampling: bound.constrainedSampling } : {}),
    ...(bound.deferred ? { deferred: bound.deferred } : {}),
    outputLimits: bound.outputLimits,
    execute: async (args: unknown, api: ToolExecutionApi, context: Context) => {
      // SDK 从 execute 检查点安全重放时不再经过 beforeTool，实际执行入口必须重验当前宿主门。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const current = await catalog?.checkExecution(bound.toolId, args, api, context);
      const decision = context.abortSignal?.aborted
        ? { ...current, code: "CANCELLED", block: "本次工具调用已取消。" }
        : current;
      const identity = {
        operationId:
          decision?.operationId ?? `tool:${api.conversationId}:${api.taskId ?? api.callId}`,
        toolId: bound.toolId,
        caller: decision?.caller ?? "host",
      };
      if (decision?.block) {
        const outcome = createToolOutcome({
          ...identity,
          success: false,
          effect: "not_applied",
          error: {
            code: decision.code ?? "TOOL_EXECUTION_BLOCKED",
            phase: "review",
            message: decision.block,
          },
        });
        return {
          isError: true,
          output: [{ type: "text" as const, text: decision.block }],
          details: { outcome: JSON.parse(JSON.stringify(outcome)) },
        };
      }
      const nestedRejections: (NestedRejectionReceipt & {
        readonly taskId: string;
        readonly outcome: import("./ToolOutcome").ToolOutcome;
      })[] = [];
      const actualApi: ToolExecutionApi = api.executeTool
        ? {
            ...api,
            executeTool: async (name, arguments_, nestedContext, options) => {
              const result = await api.executeTool(name, arguments_, nestedContext, options);
              const task = await api.getTask(result.taskId, nestedContext);
              const input = task?.input as
                | { kind?: string; parent?: unknown; key?: unknown }
                | undefined;
              if (
                !task ||
                input?.kind !== "nested" ||
                input.parent !== api.taskId ||
                typeof input.key !== "string"
              )
                return result;
              const nested = { parentTaskId: String(api.taskId), key: input.key, result };
              const fact = deriveSdkToolRejection({
                ownerSessionId: decision?.ownerSessionId ?? "host",
                caller: identity.caller,
                task,
                nested,
              });
              if (!fact) return result;
              const receipt = {
                parentTaskId: nested.parentTaskId,
                key: nested.key,
                taskId: fact.taskId,
                result: { taskId: result.taskId, isError: true, diagnostics: result.diagnostics },
                outcome: fact.outcome,
              };
              nestedRejections.push(receipt);
              return {
                ...result,
                details: {
                  ...(result.details &&
                  typeof result.details === "object" &&
                  !Array.isArray(result.details)
                    ? result.details
                    : {}),
                  outcome: JSON.parse(JSON.stringify(fact.outcome)),
                },
              };
            },
          }
        : api;
      const result = await bound.execute(args, actualApi, context);
      const existing =
        result.details && typeof result.details === "object" && !Array.isArray(result.details)
          ? result.details.outcome
          : null;
      const normalized = existing
        ? result
        : withToolOutcome(result, {
            ...identity,
            effect:
              !result.isError &&
              bound.effects.some((effect) => effect !== "read" && effect !== "network")
                ? "applied"
                : "not_applied",
          });
      // 嵌套校验回执随父调用现有结果保存，避免 SDK 回收 task 文档后冷开丢失来源。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      return nestedRejections.length
        ? {
            ...normalized,
            details: JSON.parse(
              JSON.stringify({
                ...(normalized.details &&
                typeof normalized.details === "object" &&
                !Array.isArray(normalized.details)
                  ? normalized.details
                  : {}),
                sdkToolRejections: nestedRejections,
              })
            ),
          }
        : normalized;
    },
  });
}

function freezeSchema<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeSchema(child);
    Object.freeze(value);
  }
  return value;
}
