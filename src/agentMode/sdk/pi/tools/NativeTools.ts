import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { createTwoFilesPatch } from "diff";

import { sha256 } from "@/utils/hash";
import type { PathLockPool } from "@/agentMode/sdk/pi/tools/PathLockPool";
import { isPathWithin, type PathFileSystem } from "@/agentMode/sdk/pi/policy/PathResolver";

// Native read/write/edit stay the official Pi algorithms. The wrappers inject the GuardedExternalEnv,
// capture the exact bytes the algorithm wants to write behind one concrete approval (zero writes
// before it), refuse vault targets with USE_VAULT_TOOL instead of silently switching tools, re-check
// scope/current hash after approval, record a mutation receipt, and never turn a real failure into
// an empty success:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface NativeToolOutputItem {
  readonly type: "text";
  readonly text: string;
}

export interface NativeToolResult {
  readonly output?: string | readonly NativeToolOutputItem[];
  readonly isError?: boolean;
  readonly details?: unknown;
  readonly [key: string]: unknown;
}

export interface NativeToolApiLike {
  env?: ExecutionEnv;
  readonly [key: string]: unknown;
}

export interface NativeToolRegistrationLike {
  readonly name: string;
  readonly description?: string;
  readonly parameters: unknown;
  execute(
    args: Record<string, unknown>,
    api: NativeToolApiLike,
    context: unknown
  ): Promise<NativeToolResult>;
}

export type NativeToolName = "read" | "write" | "edit";

export type NativeWritableToolName = Exclude<NativeToolName, "read">;

export interface NativeReadSetEntry {
  readonly path: string;
  readonly hash: string;
}

export interface NativeMutationPlan {
  readonly tool: NativeWritableToolName;
  readonly path: string;
  readonly before: string | null;
  readonly after: string;
  readonly diff: string;
  readonly readSet: readonly NativeReadSetEntry[];
}

export type NativeWriteApproval =
  | { readonly approved: true }
  | { readonly approved: false; readonly code?: string; readonly message?: string };

export interface NativeWriteApprovalGate {
  request(plan: NativeMutationPlan, context: unknown): Promise<NativeWriteApproval>;
}

export interface NativeMutationReceipt {
  readonly operationId: string;
  readonly tool: NativeWritableToolName;
  readonly path: string;
  readonly beforeHash: string | null;
  readonly afterHash: string;
  readonly readSet: readonly NativeReadSetEntry[];
  readonly approvedAtMs: number;
  readonly committedAtMs: number;
}

export interface NativeMutationReceiptSink {
  prepare?(
    intent: NativeMutationPlan & { readonly operationId: string; readonly approvedAtMs: number }
  ): Promise<void>;
  record(receipt: NativeMutationReceipt): Promise<void>;
}

export interface NativePathOperations {
  isAbsolute(target: string): boolean;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(target: string): string;
  readonly sep: string;
}

export interface NativeToolsOptions {
  readonly registrations: Readonly<Record<NativeToolName, NativeToolRegistrationLike>>;
  readonly env: ExecutionEnv;
  readonly vaultRoot: string;
  readonly approvals: NativeWriteApprovalGate;
  readonly receipts: NativeMutationReceiptSink;
  readonly path: NativePathOperations;
  readonly fileSystem?: Pick<PathFileSystem, "stat">;
  readonly now?: () => number;
  readonly operationId?: () => string;
  readonly locks?: PathLockPool;
  readonly lockPath?: string;
}

interface CapturedWrite {
  readonly path: string;
  readonly content: string;
}

interface CapturingEnv {
  readonly env: ExecutionEnv;
  readonly pendingWrites: CapturedWrite[];
  readonly readContents: Map<string, string>;
}

export class NativeTools {
  readonly tools: Readonly<Record<NativeToolName, NativeToolRegistrationLike>>;
  readonly #env: ExecutionEnv;
  readonly #vaultRoot: string;
  readonly #approvals: NativeWriteApprovalGate;
  readonly #receipts: NativeMutationReceiptSink;
  readonly #path: NativePathOperations;
  readonly #fileSystem: Pick<PathFileSystem, "stat">;
  readonly #now: () => number;
  readonly #operationId: (() => string) | undefined;
  readonly #locks: PathLockPool | undefined;
  readonly #lockPath: string | undefined;

  constructor(options: NativeToolsOptions) {
    this.#env = options.env;
    this.#vaultRoot = options.vaultRoot;
    this.#approvals = options.approvals;
    this.#receipts = options.receipts;
    this.#path = options.path;
    this.#fileSystem = options.fileSystem ?? {};
    this.#now = options.now ?? Date.now;
    this.#operationId = options.operationId;
    this.#locks = options.locks;
    this.#lockPath = options.lockPath;
    this.tools = Object.freeze({
      read: options.registrations.read,
      write: options.registrations.write,
      edit: options.registrations.edit,
    });
  }

  async execute(
    name: NativeToolName,
    args: Record<string, unknown>,
    api: NativeToolApiLike,
    context: unknown
  ): Promise<NativeToolResult> {
    const registration = this.tools[name];
    if (registration === undefined) {
      return errorResult("INVALID_ARGUMENT", `Unknown native tool "${String(name)}".`);
    }
    const target = args.path;
    if (typeof target !== "string" || target.length === 0) {
      return errorResult("INVALID_ARGUMENT", "A path is required.");
    }
    let insideVault: boolean;
    // 无法核实大小写别名时必须停止，不能把边界检查失败当成库外可写。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    try {
      insideVault = await this.#isInsideVault(target);
    } catch (error) {
      return errorResult("NATIVE_TOOL_FAILED", messageOf(error));
    }
    if (insideVault) {
      return errorResult(
        "USE_VAULT_TOOL",
        "Vault files must be changed through the Vault tools; this request was not executed."
      );
    }
    const capture = name === "read" ? undefined : createCapturingEnv(this.#env);
    const wrappedApi = Object.create(api) as NativeToolApiLike;
    Object.defineProperty(wrappedApi, "env", {
      value: capture?.env ?? this.#env,
      enumerable: true,
    });
    let result: NativeToolResult;
    try {
      result = await registration.execute(args, wrappedApi, context);
    } catch (thrown) {
      return errorResult("NATIVE_TOOL_FAILED", messageOf(thrown));
    }
    if (result.isError === true || capture === undefined) return result;
    if (capture.pendingWrites.length === 0) return result;
    try {
      return await this.#commit(capture, name as NativeWritableToolName, target, result, context);
    } catch (thrown) {
      return errorResult("NATIVE_TOOL_FAILED", messageOf(thrown));
    }
  }

  async #commit(
    capture: CapturingEnv,
    tool: NativeWritableToolName,
    target: string,
    nativeResult: NativeToolResult,
    context: unknown
  ): Promise<NativeToolResult> {
    if (capture.pendingWrites.length > 1) {
      return errorResult(
        "PLAN_MULTIPLE_WRITES",
        "The native tool proposed more than one write; no write was performed."
      );
    }
    const write = capture.pendingWrites[0];
    const absoluteTarget = this.#absolute(target);
    if (this.#path.resolve(write.path) !== absoluteTarget) {
      return errorResult(
        "PLAN_PATH_MISMATCH",
        "The native tool proposed a write to a different path; no write was performed."
      );
    }
    const before =
      capture.readContents.get(absoluteTarget) ?? (await this.#readContent(absoluteTarget));
    const after = write.content;
    const plan: NativeMutationPlan = {
      tool,
      path: target,
      before,
      after,
      diff: createTwoFilesPatch(
        `a/${target}`,
        `b/${target}`,
        before ?? "",
        after,
        undefined,
        undefined,
        { context: 3 }
      ),
      readSet: Object.freeze(
        [...capture.readContents.entries()].map(([readPath, content]) => ({
          path: readPath,
          hash: sha256(content),
        }))
      ),
    };
    const approvedAtMs = this.#now();
    const approval = await this.#approvals.request(plan, context);
    if (!approval.approved) {
      return errorResult(
        "WRITE_NOT_APPROVED",
        approval.message ?? approval.code ?? "The write was not approved."
      );
    }
    if (isAborted(context)) {
      return errorResult("CANCELLED", "The write was cancelled after approval.");
    }
    const lease = await this.#locks?.acquire([this.#lockPath ?? absoluteTarget]);
    try {
      const current = await this.#readContent(absoluteTarget);
      // Durable 的取消信号名为 abortSignal，基线读取期间的停止也必须挡住最后一次写入：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (isAborted(context))
        return errorResult("CANCELLED", "The write was cancelled before writing.");
      if (current !== before) {
        return errorResult(
          "STALE_BASELINE",
          "The file changed while the approval was pending; nothing was written."
        );
      }
      const operationId =
        this.#operationId?.() ??
        `native-${sha256(`${tool}\0${target}\0${after}\0${this.#now()}`).slice(0, 16)}`;
      // 先持久化已批准的准确内容，崩溃后只能核对结果，不能自动重放已可能执行的写入：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      try {
        await this.#receipts.prepare?.({ ...plan, operationId, approvedAtMs });
      } catch {
        return errorResult(
          "INTENT_FAILED",
          "The write intent could not be saved; nothing was written."
        );
      }
      if (isAborted(context))
        return errorResult("CANCELLED", "The write was cancelled before writing.");
      if ((await this.#readContent(absoluteTarget)) !== before)
        return errorResult(
          "STALE_BASELINE",
          "The file changed while its intent was saved; nothing was written."
        );
      // 主机可能先改文件再报告错误，写入后的读取、返回失败或异常都必须暂停，不能诱发模型盲目重写。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      try {
        const written = await this.#env.writeFile(write.path, after, context as never);
        if (!written.ok) return errorResult("EFFECT_UNKNOWN", written.error.message);
        const verified = await this.#readContent(absoluteTarget);
        if (verified !== after)
          return errorResult(
            "EFFECT_UNKNOWN",
            "The write was attempted but its final content could not be verified."
          );
      } catch (thrown) {
        return errorResult("EFFECT_UNKNOWN", messageOf(thrown));
      }
      const receipt: NativeMutationReceipt = {
        operationId,
        tool,
        path: target,
        beforeHash: before === null ? null : sha256(before),
        afterHash: sha256(after),
        readSet: plan.readSet,
        approvedAtMs,
        committedAtMs: this.#now(),
      };
      try {
        await this.#receipts.record(receipt);
      } catch {
        return errorResult(
          "EFFECT_UNKNOWN",
          "The write landed but its receipt could not be recorded."
        );
      }
      return {
        ...nativeResult,
        details: {
          ...(isRecord(nativeResult.details) ? nativeResult.details : {}),
          mutationPlan: plan,
          receipt,
        },
      };
    } finally {
      lease?.release();
    }
  }

  async #readContent(target: string): Promise<string | null> {
    const result = await this.#env.readTextFile(target, {} as never);
    if (result.ok) return result.value;
    if (result.error.code === "not_found") return null;
    // 无法读取不等于文件不存在，不能据此展示空白预览并覆盖用户原文。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    throw new Error(result.error.message);
  }

  #absolute(target: string): string {
    return this.#path.resolve(target);
  }

  #isInsideVault(target: string): Promise<boolean> {
    const absolute = this.#absolute(target);
    return isPathWithin(this.#vaultRoot, absolute, this.#path, this.#fileSystem);
  }
}

function createCapturingEnv(base: ExecutionEnv): CapturingEnv {
  const pendingWrites: CapturedWrite[] = [];
  const readContents = new Map<string, string>();
  const env = new Proxy(base, {
    get(target, property, receiver) {
      if (property === "writeFile") {
        return async (writePath: string, content: string | Uint8Array) => {
          pendingWrites.push({
            path: String(writePath),
            content: typeof content === "string" ? content : new TextDecoder().decode(content),
          });
          return { ok: true, value: undefined };
        };
      }
      if (property === "appendFile") {
        return async (writePath: string, content: string | Uint8Array) => {
          pendingWrites.push({
            path: String(writePath),
            content: typeof content === "string" ? content : new TextDecoder().decode(content),
          });
          return { ok: true, value: undefined };
        };
      }
      if (property === "readTextFile") {
        return async (readPath: string, context: unknown) => {
          const result = await target.readTextFile(readPath, context as never);
          if (result.ok) readContents.set(String(readPath), result.value);
          return result;
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === "function") {
        const fn = value as unknown as (...args: unknown[]) => unknown;
        const bound: (...args: unknown[]) => unknown = fn.bind(target);
        return bound;
      }
      return value;
    },
  });
  return { env, pendingWrites, readContents };
}

export interface OfficialNativeRegistrations {
  readonly read: NativeToolRegistrationLike;
  readonly write: NativeToolRegistrationLike;
  readonly edit: NativeToolRegistrationLike;
}

export async function loadOfficialNativeRegistrations(): Promise<OfficialNativeRegistrations> {
  const tools = await import("@earendil-works/pi-durable/tools");
  return {
    read: tools.createReadTool() as unknown as NativeToolRegistrationLike,
    write: tools.createWriteTool() as unknown as NativeToolRegistrationLike,
    edit: tools.createEditTool() as unknown as NativeToolRegistrationLike,
  };
}

function isAborted(context: unknown): boolean {
  return (
    isRecord(context) &&
    ((isRecord(context.abortSignal) && context.abortSignal.aborted === true) ||
      (isRecord(context.signal) && context.signal.aborted === true))
  );
}

function errorResult(code: string, message: string): NativeToolResult {
  return {
    output: [{ type: "text", text: `${code}: ${message}` }],
    isError: true,
    details: { error: { code, message } },
  };
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
