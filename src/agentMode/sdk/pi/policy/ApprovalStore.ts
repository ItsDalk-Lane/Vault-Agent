import { sha256 } from "@/utils/hash";

// An approval is bound to the exact call it was shown for. The binding hash covers arguments,
// schema, normalized targets, baseline, policy and scope, the once approval expires after ten
// minutes, only option ids from the real prompt are accepted, and consuming it writes the intent in
// the same commit so it can never be used twice:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type ApprovalOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface ApprovalOption {
  readonly optionId: string;
  readonly kind: ApprovalOptionKind;
}

export interface ApprovalBindingInput {
  readonly approvalId: string;
  readonly toolId: string;
  readonly schemaHash: string;
  readonly arguments: Record<string, unknown>;
  readonly targets: readonly string[];
  readonly beforeHash?: string;
  readonly scopeVersion: number;
  readonly policyVersion: number;
}

export interface ApprovalBinding extends ApprovalBindingInput {
  readonly argumentsHash: string;
  readonly bindingHash: string;
  readonly expiresAtMs: number;
}

export interface ApprovalRequest {
  readonly binding: ApprovalBinding;
  readonly options: readonly ApprovalOption[];
}

export interface BindingSnapshot {
  readonly schemaHash: string;
  readonly arguments: Record<string, unknown>;
  readonly targets: readonly string[];
  readonly beforeHash?: string;
  readonly scopeVersion: number;
  readonly policyVersion: number;
}

export interface ApprovalDecision {
  readonly approvalId: string;
  readonly optionId: string;
  readonly kind: ApprovalOptionKind;
  readonly decidedAtMs: number;
  readonly consumed: boolean;
  readonly intentId?: string;
  readonly binding: ApprovalBinding;
}

export interface ApprovalState {
  readonly decisions: Record<string, ApprovalDecision>;
  readonly requests?: Record<string, ApprovalRequest>;
}

export interface ApprovalPersistence {
  load(): Promise<ApprovalState | null>;
  save(state: ApprovalState): Promise<void>;
}

export type ApprovalStatus =
  | "missing"
  | "pending"
  | "allowed"
  | "rejected"
  | "expired"
  | "stale"
  | "consumed";

export type ApprovalErrorCode =
  | "UNKNOWN_OPTION"
  | "APPROVAL_MISSING"
  | "APPROVAL_PENDING"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_STALE"
  | "APPROVAL_REJECTED"
  | "APPROVAL_CONSUMED";

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;

  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

export interface ApprovalStoreOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly persistence?: ApprovalPersistence;
}

const DEFAULT_TTL_MS = 10 * 60 * 1_000;

export class ApprovalStore {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly persistence: ApprovalPersistence | undefined;
  private readonly decisions = new Map<string, ApprovalDecision>();
  private readonly requests = new Map<string, ApprovalRequest>();
  private writes: Promise<unknown> = Promise.resolve();

  constructor(options: ApprovalStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.persistence = options.persistence;
  }

  async load(): Promise<void> {
    if (this.persistence === undefined) return;
    const state = await this.persistence.load();
    if (state === null) return;
    for (const [approvalId, request] of Object.entries(state.requests ?? {})) {
      this.requests.set(approvalId, request);
    }
    for (const [approvalId, decision] of Object.entries(state.decisions)) {
      this.decisions.set(approvalId, decision);
    }
  }

  async createRequest(
    input: ApprovalBindingInput,
    options: readonly ApprovalOption[]
  ): Promise<ApprovalRequest> {
    return this.serialize(async () => {
      const binding: ApprovalBinding = Object.freeze({
        ...input,
        argumentsHash: hashJson(input.arguments),
        bindingHash: bindingHashOf(input),
        expiresAtMs: this.now() + this.ttlMs,
      });
      const request: ApprovalRequest = Object.freeze({
        binding,
        options: Object.freeze([...options]),
      });
      const requests = new Map(this.requests);
      requests.set(input.approvalId, request);
      const decisions = new Map(this.decisions);
      decisions.delete(input.approvalId);
      await this.persist(decisions, requests);
      return request;
    });
  }

  async decide(
    request: ApprovalRequest,
    optionId: string,
    atMs?: number
  ): Promise<ApprovalDecision> {
    return this.serialize(async () => {
      const option = request.options.find((candidate) => candidate.optionId === optionId);
      if (option === undefined) {
        throw new ApprovalError(
          "UNKNOWN_OPTION",
          `The option "${optionId}" is not part of this approval prompt.`
        );
      }
      const decision: ApprovalDecision = {
        approvalId: request.binding.approvalId,
        optionId,
        kind: option.kind,
        decidedAtMs: atMs ?? this.now(),
        consumed: false,
        binding: request.binding,
      };
      const decisions = new Map(this.decisions);
      decisions.set(decision.approvalId, decision);
      await this.persist(decisions, this.requests);
      return decision;
    });
  }

  status(approvalId: string, current: BindingSnapshot, atMs?: number): ApprovalStatus {
    const decision = this.decisions.get(approvalId);
    if (decision === undefined) {
      return this.requests.has(approvalId) ? "pending" : "missing";
    }
    if ((atMs ?? this.now()) > decision.binding.expiresAtMs) return "expired";
    if (bindingHashOf(current) !== decision.binding.bindingHash) return "stale";
    if (decision.kind === "reject_once" || decision.kind === "reject_always") return "rejected";
    if (decision.consumed) return "consumed";
    return "allowed";
  }

  peek(approvalId: string): ApprovalDecision | undefined {
    return this.decisions.get(approvalId);
  }

  async consumeOnce(
    approvalId: string,
    current: BindingSnapshot,
    intentId: string,
    atMs?: number
  ): Promise<ApprovalDecision> {
    return this.serialize(async () => {
      const decision = this.decisions.get(approvalId);
      if (decision === undefined) {
        throw new ApprovalError("APPROVAL_MISSING", `There is no approval "${approvalId}".`);
      }
      if ((atMs ?? this.now()) > decision.binding.expiresAtMs) {
        throw new ApprovalError("APPROVAL_EXPIRED", `The approval "${approvalId}" has expired.`);
      }
      if (bindingHashOf(current) !== decision.binding.bindingHash) {
        throw new ApprovalError(
          "APPROVAL_STALE",
          `The call no longer matches what was approved for "${approvalId}".`
        );
      }
      if (decision.kind === "reject_once" || decision.kind === "reject_always") {
        throw new ApprovalError("APPROVAL_REJECTED", `The approval "${approvalId}" was rejected.`);
      }
      if (decision.kind === "allow_always") {
        throw new ApprovalError(
          "APPROVAL_CONSUMED",
          `The approval "${approvalId}" is a long-term rule; consume the per-call intent through the rule.`
        );
      }
      if (decision.consumed) {
        throw new ApprovalError(
          "APPROVAL_CONSUMED",
          `The approval "${approvalId}" was already consumed.`
        );
      }
      const consumed: ApprovalDecision = Object.freeze({
        ...decision,
        consumed: true,
        intentId,
      });
      const decisions = new Map(this.decisions);
      decisions.set(approvalId, consumed);
      await this.persist(decisions, this.requests);
      return consumed;
    });
  }

  // 保存失败不能把未落盘的允许泄露给后续调用，并发消费也只能有一个成功：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.writes.then(run);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async persist(
    decisions: ReadonlyMap<string, ApprovalDecision>,
    requests: ReadonlyMap<string, ApprovalRequest>
  ): Promise<void> {
    await this.persistence?.save({
      decisions: Object.fromEntries(decisions),
      requests: Object.fromEntries(requests),
    });
    const savedDecisions = [...decisions];
    const savedRequests = [...requests];
    this.decisions.clear();
    this.requests.clear();
    for (const [id, decision] of savedDecisions) this.decisions.set(id, decision);
    for (const [id, request] of savedRequests) this.requests.set(id, request);
  }
}

function bindingHashOf(binding: ApprovalBindingInput | BindingSnapshot): string {
  return hashJson({
    schemaHash: binding.schemaHash,
    arguments: binding.arguments,
    targets: binding.targets,
    beforeHash: binding.beforeHash ?? null,
    scopeVersion: binding.scopeVersion,
    policyVersion: binding.policyVersion,
  });
}

function hashJson(value: unknown): string {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
