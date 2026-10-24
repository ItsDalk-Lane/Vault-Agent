import {
  ApprovalStore,
  type ApprovalBindingInput,
  type ApprovalOption,
  type ApprovalRequest,
} from "@/agentMode/sdk/pi/policy/ApprovalStore";
import type { PermissionDecision, PermissionPrompt } from "@/agentMode/session/types";

// The bridge adapts an approval binding to the existing permission prompt without changing its
// visual contract. A selected allow option is persisted before execution, a rejection has no
// effect, remounting the same requestId keeps one prompt, the first valid decision from any window
// wins, a missing prompter fails closed, and Stop clears the waiter instead of treating the closed
// dialog as approval:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface PermissionBridgeRequest {
  readonly requestId: string;
  readonly prompt: PermissionPrompt;
  readonly bindingInput: ApprovalBindingInput;
  readonly intentId: string;
}

export interface PermissionBridgeApproved {
  readonly status: "approved";
  readonly requestId: string;
  readonly approvalId: string;
  readonly optionId: string;
}

export interface PermissionBridgeRejected {
  readonly status: "rejected";
  readonly requestId: string;
  readonly approvalId: string;
  readonly optionId: string;
}

export interface PermissionBridgeCancelled {
  readonly status: "cancelled";
  readonly requestId: string;
}

export interface PermissionBridgeUnavailable {
  readonly status: "unavailable";
  readonly requestId: string;
  readonly code: "APPROVAL_UNAVAILABLE";
}

export type PermissionBridgeResult =
  | PermissionBridgeApproved
  | PermissionBridgeRejected
  | PermissionBridgeCancelled
  | PermissionBridgeUnavailable;

export interface PermissionBridgeOptions {
  readonly store: ApprovalStore;
  readonly prompter?: (request: PermissionPrompt) => Promise<PermissionDecision>;
  readonly onApproved?: (approved: PermissionBridgeApproved) => void | Promise<void>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

interface BridgeEntry {
  readonly request: PermissionBridgeRequest;
  readonly cancellation: Deferred<PermissionBridgeCancelled>;
  approvalRequest?: ApprovalRequest;
  inFlight?: Promise<PermissionBridgeResult>;
  settled?: PermissionBridgeResult;
}

export class PermissionBridge {
  private readonly store: ApprovalStore;
  private readonly prompter: PermissionBridgeOptions["prompter"];
  private readonly onApproved: PermissionBridgeOptions["onApproved"];
  private readonly entries = new Map<string, BridgeEntry>();

  constructor(options: PermissionBridgeOptions) {
    this.store = options.store;
    this.prompter = options.prompter;
    this.onApproved = options.onApproved;
  }

  register(request: PermissionBridgeRequest): void {
    if (this.entries.has(request.requestId)) return;
    this.entries.set(request.requestId, {
      request,
      cancellation: deferred<PermissionBridgeCancelled>(),
    });
  }

  pendingCount(): number {
    return [...this.entries.values()].filter((entry) => entry.settled === undefined).length;
  }

  getPending(): readonly PermissionPrompt[] {
    return Object.freeze(
      [...this.entries.values()]
        .filter((entry) => entry.settled === undefined)
        .map((entry) => entry.request.prompt)
    );
  }

  requestDecision(requestId: string): Promise<PermissionBridgeResult> {
    const entry = this.entries.get(requestId);
    if (entry === undefined) {
      return Promise.resolve({ status: "unavailable", requestId, code: "APPROVAL_UNAVAILABLE" });
    }
    if (entry.settled !== undefined) return Promise.resolve(entry.settled);
    if (entry.inFlight !== undefined) return entry.inFlight;
    if (this.prompter === undefined) {
      return this.settle(entry, unavailable(requestId));
    }
    entry.inFlight = Promise.race([this.answerFromPrompt(entry), entry.cancellation.promise]).then(
      (result) => this.finish(entry, result)
    );
    return entry.inFlight;
  }

  submit(requestId: string, optionId: string): boolean {
    const entry = this.entries.get(requestId);
    if (entry === undefined || entry.settled !== undefined || entry.inFlight !== undefined) {
      return false;
    }
    if (!entry.request.prompt.options.some((option) => option.optionId === optionId)) {
      return false;
    }
    entry.inFlight = this.answerWithOption(entry, optionId).then((result) =>
      this.finish(entry, result)
    );
    return true;
  }

  cancel(requestId: string): void {
    const entry = this.entries.get(requestId);
    if (entry === undefined || entry.settled !== undefined) return;
    const cancelled: PermissionBridgeCancelled = { status: "cancelled", requestId };
    entry.settled = cancelled;
    entry.cancellation.resolve(cancelled);
  }

  private async answerFromPrompt(entry: BridgeEntry): Promise<PermissionBridgeResult> {
    const decision = await this.prompter?.(entry.request.prompt);
    if (entry.settled !== undefined) return entry.settled;
    if (decision === undefined || decision.outcome.outcome === "cancelled") {
      return { status: "cancelled", requestId: entry.request.requestId };
    }
    return this.answerWithOption(entry, decision.outcome.optionId);
  }

  private async answerWithOption(
    entry: BridgeEntry,
    optionId: string
  ): Promise<PermissionBridgeResult> {
    if (entry.settled !== undefined) return entry.settled;
    const approvalRequest = await this.ensureApprovalRequest(entry);
    const option = approvalRequest.options.find((candidate) => candidate.optionId === optionId);
    if (option === undefined) return unavailable(entry.request.requestId);
    await this.store.decide(approvalRequest, optionId);
    if (option.kind === "reject_once" || option.kind === "reject_always") {
      return {
        status: "rejected",
        requestId: entry.request.requestId,
        approvalId: entry.request.bindingInput.approvalId,
        optionId,
      };
    }
    await this.store.consumeOnce(
      entry.request.bindingInput.approvalId,
      snapshotOf(entry.request.bindingInput),
      entry.request.intentId
    );
    const approved: PermissionBridgeApproved = {
      status: "approved",
      requestId: entry.request.requestId,
      approvalId: entry.request.bindingInput.approvalId,
      optionId,
    };
    await this.onApproved?.(approved);
    return approved;
  }

  private async ensureApprovalRequest(entry: BridgeEntry): Promise<ApprovalRequest> {
    if (entry.approvalRequest !== undefined) return entry.approvalRequest;
    const options: ApprovalOption[] = entry.request.prompt.options.map((option) => ({
      optionId: option.optionId,
      kind: option.kind,
    }));
    entry.approvalRequest = await this.store.createRequest(entry.request.bindingInput, options);
    return entry.approvalRequest;
  }

  private async settle(
    entry: BridgeEntry,
    result: PermissionBridgeResult
  ): Promise<PermissionBridgeResult> {
    entry.settled = result;
    return result;
  }

  private finish(entry: BridgeEntry, result: PermissionBridgeResult): PermissionBridgeResult {
    if (entry.settled === undefined) entry.settled = result;
    return entry.settled;
  }
}

function unavailable(requestId: string): PermissionBridgeUnavailable {
  return { status: "unavailable", requestId, code: "APPROVAL_UNAVAILABLE" };
}

function snapshotOf(input: ApprovalBindingInput) {
  return {
    schemaHash: input.schemaHash,
    arguments: input.arguments,
    targets: input.targets,
    beforeHash: input.beforeHash,
    scopeVersion: input.scopeVersion,
    policyVersion: input.policyVersion,
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
