import { RunBudget, type ModelRequestPurpose } from "@/agentMode/sdk/pi/runtime/RunBudget";

// The hard dispatch gate: root/run ownership, cancel epoch, conversation mapping, endpoint
// fingerprint and credential availability are checked before any network stream exists,
// then the durable budget reserve commits with the stable attemptId; a denied gate returns
// a proper error stream and nothing is sent:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface RunDispatchState {
  readonly rootId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly state: "active" | "cancelled" | "finished";
  readonly cancelEpoch: number;
  readonly endpointFingerprint: string;
}

export type GuardFailureCode =
  | "CANCELLED"
  | "STALE_IDENTITY"
  | "ENDPOINT_MISMATCH"
  | "CREDENTIAL_REQUIRED"
  | "BUDGET_EXCEEDED"
  | "SUBAGENT_LIMIT";

export interface GuardFailure {
  readonly code: GuardFailureCode;
  readonly message: string;
}

export interface GuardRequest {
  readonly rootId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly cancelEpoch: number;
  readonly endpointFingerprint: string;
  readonly providerInstanceId: string;
  readonly modelId: string;
  readonly purpose: ModelRequestPurpose;
  readonly attemptId: string;
  readonly signal?: AbortSignal;
}

export interface ProviderGuardOptions<Stream> {
  readonly budget: RunBudget;
  readonly onBudgetDenied?: (failure: GuardFailure) => Promise<never>;
  readonly resolveRun: (conversationId: string) => Promise<RunDispatchState | null>;
  readonly credentialAvailable: (providerInstanceId: string) => Promise<boolean>;
  readonly createErrorStream: (failure: GuardFailure) => Stream;
  readonly beforeNetworkOpen?: () => void;
  readonly openNetworkStream: (request: GuardRequest) => Stream;
}

function cancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isSameRun(state: RunDispatchState, request: GuardRequest): boolean {
  return (
    state.rootId === request.rootId &&
    state.runId === request.runId &&
    state.conversationId === request.conversationId
  );
}

export class ProviderGuard<Stream = unknown> {
  private readonly options: ProviderGuardOptions<Stream>;

  constructor(options: ProviderGuardOptions<Stream>) {
    this.options = options;
  }

  async dispatch(request: GuardRequest): Promise<Stream> {
    const fail = (failure: GuardFailure): Stream => this.options.createErrorStream(failure);

    if (cancelled(request.signal)) {
      return fail({ code: "CANCELLED", message: "The request was cancelled before dispatch." });
    }

    let runState: RunDispatchState | null;
    try {
      runState = await this.options.resolveRun(request.conversationId);
    } catch {
      return fail({
        code: "STALE_IDENTITY",
        message: "The conversation-to-run mapping could not be verified.",
      });
    }
    if (!runState || !isSameRun(runState, request)) {
      return fail({
        code: "STALE_IDENTITY",
        message: "The conversation-to-run mapping does not belong to this run.",
      });
    }
    if (runState.state === "cancelled") {
      return fail({ code: "CANCELLED", message: "The run was cancelled." });
    }
    if (runState.state !== "active") {
      return fail({ code: "STALE_IDENTITY", message: "The run is no longer active." });
    }
    if (runState.cancelEpoch !== request.cancelEpoch) {
      return fail({
        code: "CANCELLED",
        message: "The request belongs to an earlier cancel epoch.",
      });
    }
    if (runState.endpointFingerprint !== request.endpointFingerprint) {
      return fail({
        code: "ENDPOINT_MISMATCH",
        message: "The endpoint changed; the request is not sent to another endpoint.",
      });
    }

    let credentialOk: boolean;
    try {
      credentialOk = await this.options.credentialAvailable(request.providerInstanceId);
    } catch {
      credentialOk = false;
    }
    if (!credentialOk) {
      return fail({
        code: "CREDENTIAL_REQUIRED",
        message: "No stored credential is available for this provider.",
      });
    }

    if (cancelled(request.signal)) {
      return fail({ code: "CANCELLED", message: "The request was cancelled before the reserve." });
    }

    const reserve = await this.options.budget.reserve({
      attemptId: request.attemptId,
      runId: request.runId,
      purpose: request.purpose,
    });
    if (reserve.kind === "denied") {
      if (reserve.code === "BUDGET_EXCEEDED" && this.options.onBudgetDenied)
        return this.options.onBudgetDenied({ code: reserve.code, message: reserve.message });
      return fail({ code: reserve.code, message: reserve.message });
    }

    if (cancelled(request.signal)) {
      await this.options.budget.refund(request.attemptId);
      return fail({
        code: "CANCELLED",
        message: "The request was cancelled before the network stream.",
      });
    }

    try {
      this.options.beforeNetworkOpen?.();
    } catch (error) {
      await this.options.budget.refund(request.attemptId);
      throw error;
    }
    return this.options.openNetworkStream(request);
  }
}
