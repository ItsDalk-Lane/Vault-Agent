import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";

// The audit trail records identity, hashes, normalized targets and the decision — never argument
// bodies, headers or env. A denial cannot be recorded as a successful execution, sink failures fail
// or skip without leaking the original text, and every error maps to an actionable machine-readable
// code:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type AuditActor = "root" | "child" | "system";

export type AuditDecision = "allow" | "deny" | "cancelled";

export type AuditStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface AuditRecordInput {
  readonly operationId: string;
  readonly actor: AuditActor;
  readonly toolId: string;
  readonly arguments: unknown;
  readonly targets: readonly string[];
  readonly effects: readonly string[];
  readonly decision: AuditDecision;
  readonly status: AuditStatus;
  readonly ruleId?: string;
  readonly requestId?: string;
  readonly timestamp?: number;
}

export interface AuditRecord {
  readonly operationId: string;
  readonly actor: AuditActor;
  readonly toolId: string;
  readonly argumentsHash: string;
  readonly targets: readonly string[];
  readonly effects: readonly string[];
  readonly decision: AuditDecision;
  readonly status: AuditStatus;
  readonly ruleId?: string;
  readonly requestId?: string;
  readonly timestamp: number;
}

export interface AuditSink {
  write(record: AuditRecord): void | Promise<void>;
}

export type AuditErrorCode = "INVALID_RECORD" | "AUDIT_FAILED";

export class AuditError extends Error {
  readonly code: AuditErrorCode;

  constructor(code: AuditErrorCode, message: string) {
    super(message);
    this.name = "AuditError";
    this.code = code;
  }
}

export interface AuditLogOptions {
  readonly sink?: AuditSink;
  readonly redactor?: Redactor;
  readonly now?: () => number;
  readonly onFailure?: "fail" | "skip";
}

const STATUSES: ReadonlySet<string> = new Set<AuditStatus>([
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
  "skipped",
]);

export class AuditLog {
  private readonly sink: AuditSink | undefined;
  private readonly redactor: Redactor;
  private readonly now: () => number;
  private readonly onFailure: "fail" | "skip";

  constructor(options: AuditLogOptions = {}) {
    this.sink = options.sink;
    this.redactor = options.redactor ?? new Redactor();
    this.now = options.now ?? Date.now;
    this.onFailure = options.onFailure ?? "fail";
  }

  async record(input: AuditRecordInput): Promise<AuditRecord | null> {
    if (!STATUSES.has(input.status)) {
      throw new AuditError("INVALID_RECORD", "The audit record has an unknown status.");
    }
    if (input.decision === "deny" && (input.status === "executed" || input.status === "approved")) {
      throw new AuditError(
        "INVALID_RECORD",
        "A denied operation cannot be recorded as approved or executed."
      );
    }
    const record: AuditRecord = Object.freeze({
      operationId: input.operationId,
      actor: input.actor,
      toolId: input.toolId,
      argumentsHash: this.redactor.summarize(input.arguments),
      targets: Object.freeze(
        input.targets.map((target) => this.redactor.redactAndTruncate(target, 2_048))
      ),
      effects: Object.freeze([...input.effects]),
      decision: input.decision,
      status: input.status,
      ...(input.ruleId !== undefined ? { ruleId: input.ruleId } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      timestamp: input.timestamp ?? this.now(),
    });
    if (this.sink === undefined) return record;
    try {
      await this.sink.write(record);
      return record;
    } catch {
      if (this.onFailure === "skip") return null;
      throw new AuditError("AUDIT_FAILED", "The audit sink failed; the record was not persisted.");
    }
  }
}

export interface SafeError {
  readonly code: string;
  readonly message: string;
  readonly suggestedTool?: string;
}

const SAFE_ERRORS: Readonly<
  Record<string, { readonly message: string; readonly suggestedTool?: string }>
> = {
  INVALID_ARGUMENT: { message: "参数不合法，请修正后重试。" },
  USE_VAULT_TOOL: {
    message: "该路径属于 Vault，请改用 Vault 工具。",
    suggestedTool: "vault_read",
  },
  USE_EXTERNAL_TOOL: { message: "该路径在 Vault 之外，请改用外部文件工具并显式授权根目录。" },
  PATH_OUT_OF_SCOPE: { message: "目标超出已批准范围，请缩小路径或重新授权 scope。" },
  PROTECTED_PATH: { message: "该路径属于宿主保护目录，禁止读写。" },
  PERMISSION_DENIED: { message: "权限规则拒绝了该操作。" },
  READ_ONLY_MODE: { message: "当前为只读/计划模式，不能执行修改操作。" },
  OPAQUE_EXECUTION_DISABLED: { message: "严格模式不允许不透明的本地进程执行。" },
  EXTERNAL_SCOPE_REQUIRED: { message: "访问外部文件前需显式授权外部根目录。" },
  CALLER_NOT_ALLOWED: { message: "当前调用者无权使用该工具。" },
  TOOL_DISABLED: { message: "该工具已禁用，请启用后重试。" },
  UNKNOWN_TOOL: { message: "未注册的工具不可调用。" },
  UNSAFE_FILE_ALIAS: { message: "该文件是硬链接或不支持的别名，写入被拒绝。" },
  APPROVAL_EXPIRED: { message: "审批已过期，请重新发起审批。" },
  APPROVAL_STALE: { message: "调用内容已变化，原审批失效，请重新审批。" },
  APPROVAL_CONSUMED: { message: "该一次审批已使用，请重新审批。" },
  APPROVAL_UNAVAILABLE: { message: "当前无法展示审批弹窗，操作已拒绝。" },
  APPROVAL_REJECTED: { message: "此次操作已被拒绝，没有执行。" },
  SCOPE_REVOKED: { message: "批准范围已撤回，请重新授权后再操作。" },
  TARGET_CHANGED: { message: "目标已变化，请重新读取并审批。" },
  TOOL_REVIEW_FAILED: { message: "安全检查失败，操作已拒绝。" },
  TOOL_EXECUTION_FAILED: { message: "工具执行失败，请检查实际结果后再决定是否重试。" },
  AUDIT_FAILED: { message: "审计记录无法保存，已停止操作。请检查会话存储后再恢复。" },
  STALE_BASELINE: { message: "文件版本已变化，请重新读取并准备新的修改。" },
  EFFECT_UNKNOWN: { message: "实际操作结果尚未核实，请先对账，不要重复执行。" },
  CANCELLED: { message: "操作已取消，未执行。" },
  BUDGET_EXCEEDED: { message: "本次运行预算已用尽，请提高预算或稍后重试。" },
  STORE_UNAVAILABLE: { message: "会话存储不可用，请稍后重试。" },
  PROVIDER_AUTH_MISSING: { message: "模型提供方凭据缺失，请在设置中配置。" },
  MODEL_CAPABILITY_UNSUPPORTED: { message: "当前模型不支持该能力，请更换模型。" },
  SCHEMA_UNSUPPORTED: { message: "当前状态 schema 版本不受支持，请升级插件。" },
  VERSION_UNSUPPORTED: { message: "当前版本不受支持，请升级插件。" },
};

export function toSafeError(code: string): SafeError {
  const mapped = SAFE_ERRORS[code];
  if (mapped === undefined) {
    return { code: "INTERNAL_ERROR", message: "发生未预期错误，请重试或查看日志。" };
  }
  return {
    code,
    message: mapped.message,
    ...(mapped.suggestedTool !== undefined ? { suggestedTool: mapped.suggestedTool } : {}),
  };
}
