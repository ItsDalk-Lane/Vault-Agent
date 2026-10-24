import type { JsonObject } from "@earendil-works/pi-durable";
import { sha256 } from "@/utils/hash";

export interface ProgressGuardState extends JsonObject {
  fingerprint: string;
  consecutive: number;
  seen: Record<string, boolean>;
}

export interface ToolProgressObservation {
  readonly executionId: string;
  readonly conversationId: string;
  readonly toolId: string;
  readonly arguments: unknown;
  readonly errorCode?: string;
}

export function recordToolProgress(
  state: ProgressGuardState,
  input: ToolProgressObservation
): boolean {
  const callKey = `${input.conversationId}:${input.executionId}`;
  if (state.seen[callKey]) return state.consecutive >= 3;
  state.seen[callKey] = true;
  if (!input.errorCode) {
    state.fingerprint = "";
    state.consecutive = 0;
    return false;
  }
  const fingerprint = sha256(
    JSON.stringify(
      {
        conversationId: input.conversationId,
        toolId: input.toolId,
        arguments: input.arguments,
        errorCode: input.errorCode,
      },
      (_key, value: unknown) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
                left.localeCompare(right)
              )
            )
          : value
    )
  );
  state.consecutive = state.fingerprint === fingerprint ? state.consecutive + 1 : 1;
  state.fingerprint = fingerprint;
  return state.consecutive >= 3;
}
