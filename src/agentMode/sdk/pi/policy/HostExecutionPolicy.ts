import { sha256 } from "@/utils/hash";

// Commands are always offered; the only gate is a per-command single-use approval (never
// allow-always), a known interpreter, and vault targets staying rejected in favor of the vault
// tools: https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
export interface HostCommandRequest {
  readonly command: string | readonly string[];
  readonly cwd?: string;
  readonly interpreter?: string;
  readonly timeoutMs?: number;
  readonly outputLimitBytes?: number;
}

export interface HostCommandConfirmation {
  readonly command: string | readonly string[];
  readonly cwd: string;
  readonly interpreter: string;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly nonSandboxNotice: string;
  readonly risks: readonly string[];
}

export interface HostCommandApprovalToken {
  readonly id: string;
  readonly requestHash: string;
  readonly approvedAtMs: number;
  readonly expiresAtMs: number;
}

export type HostExecutionErrorCode =
  | "CONFIRMATION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "STALE_APPROVAL"
  | "VAULT_TARGET_IN_COMMAND"
  | "INTERPRETER_UNAVAILABLE"
  | "MODEL_CANNOT_APPROVE"
  | "EXECUTION_FAILED";

export type HostCommandDecision =
  | { readonly allowed: true; readonly confirmation: HostCommandConfirmation }
  | {
      readonly allowed: false;
      readonly code: HostExecutionErrorCode;
      readonly message: string;
      readonly confirmation?: HostCommandConfirmation;
    };

export type HostCommandRunResult =
  | { readonly ran: true; readonly confirmation: HostCommandConfirmation }
  | {
      readonly ran: false;
      readonly code: HostExecutionErrorCode;
      readonly message: string;
      readonly confirmation?: HostCommandConfirmation;
    };

export interface HostCommandApproval {
  readonly approvedByUser: boolean;
}

export type HostCommandApprovalResult =
  | { readonly ok: true; readonly token: HostCommandApprovalToken }
  | { readonly ok: false; readonly code: HostExecutionErrorCode; readonly message: string };

export interface HostPathOperations {
  isAbsolute(target: string): boolean;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  readonly sep: string;
}

export interface HostExecutionPolicyOptions {
  readonly path: HostPathOperations;
  readonly vaultRoot: string;
  readonly interpreter: { readonly available: boolean; readonly label?: string };
  readonly defaultCwd?: string;
  readonly now?: () => number;
  readonly approvalTtlMs?: number;
  readonly riskNoticeVersion?: number;
  readonly timeoutMs?: number;
  readonly outputLimitBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;
const DEFAULT_APPROVAL_TTL_MS = 2 * 60 * 1_000;
const DEFAULT_NOTICE_VERSION = 1;

export class HostExecutionPolicy {
  readonly #path: HostPathOperations;
  readonly #vaultRoot: string;
  readonly #interpreter: { readonly available: boolean; readonly label?: string };
  readonly #defaultCwd: string;
  readonly #now: () => number;
  readonly #approvalTtlMs: number;
  readonly #noticeVersion: number;
  readonly #timeoutMs: number;
  readonly #outputLimitBytes: number;
  readonly #tokens = new Map<string, HostCommandApprovalToken & { used: boolean }>();
  #tokenCounter = 0;

  constructor(options: HostExecutionPolicyOptions) {
    this.#path = options.path;
    this.#vaultRoot = options.path.resolve(options.vaultRoot);
    this.#interpreter = options.interpreter;
    this.#defaultCwd = options.defaultCwd ?? options.path.resolve("/");
    this.#now = options.now ?? Date.now;
    this.#approvalTtlMs = options.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.#noticeVersion = options.riskNoticeVersion ?? DEFAULT_NOTICE_VERSION;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
  }

  get noticeVersion(): number {
    return this.#noticeVersion;
  }

  riskNotice(): string {
    return (
      "Host commands are not a sandbox. They run with the capabilities of your current OS account " +
      "and may access the vault; network and file access cannot be bounded precisely."
    );
  }

  async evaluate(
    request: HostCommandRequest,
    context: { readonly approvalToken?: HostCommandApprovalToken } = {}
  ): Promise<HostCommandDecision> {
    const confirmation = this.#confirmationOf(request);
    if (context.approvalToken !== undefined) {
      const invalid = this.#validateToken(context.approvalToken, confirmation);
      if (invalid !== null) return invalid;
    }
    if (!this.#interpreter.available) {
      return denial(
        "INTERPRETER_UNAVAILABLE",
        "No supported interpreter is available; the command capability is disabled."
      );
    }
    if (this.#mentionsVaultTarget(request, confirmation.cwd)) {
      return denial(
        "VAULT_TARGET_IN_COMMAND",
        "The command names a vault target; use the Obsidian Vault tools instead.",
        confirmation
      );
    }
    if (context.approvalToken === undefined) {
      return denial(
        "CONFIRMATION_REQUIRED",
        "Every host command needs its own concrete confirmation.",
        confirmation
      );
    }
    const token = this.#tokens.get(context.approvalToken.id);
    if (token !== undefined) token.used = true;
    return { allowed: true, confirmation };
  }

  async runIfAllowed(
    request: HostCommandRequest,
    runner: (request: HostCommandRequest) => Promise<void>,
    context: { readonly approvalToken?: HostCommandApprovalToken } = {}
  ): Promise<HostCommandRunResult> {
    const decision = await this.evaluate(request, context);
    if (!decision.allowed) {
      return {
        ran: false,
        code: decision.code,
        message: decision.message,
        ...(decision.confirmation !== undefined ? { confirmation: decision.confirmation } : {}),
      };
    }
    try {
      await runner(request);
    } catch (thrown) {
      return {
        ran: false,
        code: "EXECUTION_FAILED",
        message: thrown instanceof Error ? thrown.message : String(thrown),
        confirmation: decision.confirmation,
      };
    }
    return { ran: true, confirmation: decision.confirmation };
  }

  approveCommand(
    request: HostCommandRequest,
    approval: HostCommandApproval
  ): HostCommandApprovalResult {
    if (approval.approvedByUser !== true) {
      return failure(
        "MODEL_CANNOT_APPROVE",
        "Only a real user confirmation can approve a host command."
      );
    }
    const confirmation = this.#confirmationOf(request);
    if (this.#mentionsVaultTarget(request, confirmation.cwd)) {
      return failure(
        "VAULT_TARGET_IN_COMMAND",
        "The command names a vault target; use the Obsidian Vault tools instead."
      );
    }
    const timestamp = this.#now();
    const token: HostCommandApprovalToken & { used: boolean } = {
      id: `host-approval-${++this.#tokenCounter}`,
      requestHash: requestHashOf(confirmation),
      approvedAtMs: timestamp,
      expiresAtMs: timestamp + this.#approvalTtlMs,
      used: false,
    };
    this.#tokens.set(token.id, token);
    return { ok: true, token };
  }

  #validateToken(
    token: HostCommandApprovalToken,
    confirmation: HostCommandConfirmation
  ): HostCommandDecision | null {
    const stored = this.#tokens.get(token.id);
    if (stored === undefined || stored.used) {
      return denial(
        "APPROVAL_REQUIRED",
        "No unused concrete approval exists for this command; confirm it again."
      );
    }
    if (stored.requestHash !== requestHashOf(confirmation) || stored.expiresAtMs <= this.#now()) {
      return denial("STALE_APPROVAL", "The command approval expired; confirm it again.");
    }
    return null;
  }

  #confirmationOf(request: HostCommandRequest): HostCommandConfirmation {
    return {
      command: request.command,
      cwd: this.#path.resolve(request.cwd ?? this.#defaultCwd),
      interpreter: request.interpreter ?? this.#interpreter.label ?? "system interpreter",
      timeoutMs: request.timeoutMs ?? this.#timeoutMs,
      outputLimitBytes: request.outputLimitBytes ?? this.#outputLimitBytes,
      nonSandboxNotice: this.riskNotice(),
      risks: [
        "Runs with the current OS account's capabilities, not a sandbox.",
        "May access the vault; use the Obsidian tools for vault changes.",
        "Network and file access cannot be bounded precisely.",
      ],
    };
  }

  #mentionsVaultTarget(request: HostCommandRequest, cwd: string): boolean {
    if (this.#insideVault(cwd)) return true;
    const parts = typeof request.command === "string" ? [request.command] : request.command;
    return parts.some((part) => {
      if (typeof part !== "string") return false;
      if (part.includes(this.#vaultRoot)) return true;
      if (!this.#path.isAbsolute(part)) return false;
      return this.#insideVault(part);
    });
  }

  #insideVault(target: string): boolean {
    const relative = this.#path.relative(this.#vaultRoot, this.#path.resolve(target));
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${this.#path.sep}`) &&
        !this.#path.isAbsolute(relative))
    );
  }
}

function requestHashOf(confirmation: HostCommandConfirmation): string {
  return sha256(
    JSON.stringify({
      command: confirmation.command,
      cwd: confirmation.cwd,
      interpreter: confirmation.interpreter,
      timeoutMs: confirmation.timeoutMs,
      outputLimitBytes: confirmation.outputLimitBytes,
    })
  );
}

function denial(
  code: HostExecutionErrorCode,
  message: string,
  confirmation?: HostCommandConfirmation
): HostCommandDecision {
  return { allowed: false, code, message, ...(confirmation !== undefined ? { confirmation } : {}) };
}

function failure(
  code: HostExecutionErrorCode,
  message: string
): { ok: false; code: HostExecutionErrorCode; message: string } {
  return { ok: false, code, message };
}
