export type ToolEffectState = "not_applied" | "applied" | "partially_applied" | "unknown";
export type ToolOutcomePhase =
  | "validation"
  | "review"
  | "execution"
  | "verification"
  | "persistence";
export type ToolNextAction = "continue" | "revise_request" | "read" | "reconcile";

export interface ToolOutcome {
  readonly operationId: string;
  readonly source: { readonly toolId: string; readonly caller: string };
  readonly status: "success" | "error";
  readonly effect: ToolEffectState;
  readonly data?: unknown;
  readonly error?: {
    readonly code: string;
    readonly phase: ToolOutcomePhase;
    readonly message: string;
  };
  readonly truncation: { readonly truncated: boolean };
  readonly receipts: readonly string[];
  readonly nextActions: readonly ToolNextAction[];
}

export interface ToolOutcomeInput {
  readonly operationId: string;
  readonly toolId: string;
  readonly caller: string;
  readonly success: boolean;
  readonly effect: ToolEffectState;
  readonly data?: unknown;
  readonly error?: ToolOutcome["error"];
  readonly truncated?: boolean;
  readonly receipts?: readonly string[];
}

export function createToolOutcome(input: ToolOutcomeInput): ToolOutcome {
  return {
    operationId: input.operationId,
    source: { toolId: input.toolId, caller: input.caller },
    status: input.success ? "success" : "error",
    effect: input.effect,
    ...(input.data === undefined ? {} : { data: input.data }),
    ...(input.error ? { error: input.error } : {}),
    truncation: { truncated: input.truncated === true },
    receipts: [...(input.receipts ?? [])],
    nextActions:
      input.effect === "unknown" || input.effect === "partially_applied"
        ? ["read", "reconcile"]
        : input.success
          ? ["continue"]
          : ["revise_request"],
  };
}
