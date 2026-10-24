import { compileHostToolDefinition } from "@/agentMode/sdk/pi/tools/HostToolDefinition";
import type {
  CapabilityCatalog,
  CapabilityDefinition,
} from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { sha256 } from "@/utils/hash";
import { diffLines } from "diff";
import { logWarn } from "@/logger";
import type { Context } from "@earendil-works/chord";
import type {
  ExecutionEnv,
  ShellExecOptions,
  ShellExecResult,
  Result,
  ExecutionError,
} from "@earendil-works/pi-durable/env";
import type {
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import type {
  PermissionDecision,
  PermissionPrompt,
  VaultAgentMode,
  TurnFileChange,
} from "@/agentMode/session/types";
import { PolicyEngine, type PolicyCaller } from "@/agentMode/sdk/pi/policy/PolicyEngine";
import { isPathWithin } from "@/agentMode/sdk/pi/policy/PathResolver";
import { PlatformPathPolicy } from "@/agentMode/sdk/pi/policy/PlatformPathPolicy";
import { defineToolManifest } from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { HostExecutionPolicy } from "@/agentMode/sdk/pi/policy/HostExecutionPolicy";
import { GuardedExternalEnv } from "@/agentMode/sdk/pi/tools/GuardedExternalEnv";
import {
  NativeTools,
  loadOfficialNativeRegistrations,
  type NativeToolName,
  type NativeMutationReceipt,
  type NativeMutationPlan,
  type NativeToolApiLike,
  type NativeToolResult,
} from "@/agentMode/sdk/pi/tools/NativeTools";
import {
  NativeCommands,
  loadOfficialNativeCommandRegistrations,
  type NativeCommandId,
} from "@/agentMode/sdk/pi/tools/NativeCommands";
import {
  InterpreterResolver,
  type HostPlatform,
} from "@/agentMode/sdk/pi/tools/InterpreterResolver";
import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import {
  ProcessSupervisor,
  type ProcessChildLike,
} from "@/agentMode/sdk/pi/tools/ProcessSupervisor";
import { PathLockPool } from "@/agentMode/sdk/pi/tools/PathLockPool";
import { type AuditLog, toSafeError } from "@/agentMode/sdk/pi/policy/AuditLog";
import type { RecoveryDecision, RecoveryResult } from "@/agentMode/sdk/pi/storage/MutationRecovery";
import type {
  NativeMutationJournal,
  NativeMutationJournalStore,
} from "@/agentMode/sdk/pi/storage/NativeMutationJournal";
import type { JsonObject } from "@earendil-works/pi-durable";
import { durableToolCallId } from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";
import { createToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";
import { withToolOutcome } from "@/agentMode/sdk/pi/tools/ToolResultOutcome";
import type { ToolEffectState } from "@/agentMode/sdk/pi/tools/ToolOutcome";
import type { ProcessResult } from "@/agentMode/sdk/pi/tools/ProcessSupervisor";

export interface PiNativeHostToolsOptions {
  readonly capabilities?: CapabilityCatalog;
  readonly audit?: Pick<AuditLog, "record">;
  readonly vaultRoot: string;
  readonly privateDir: string;
  readonly protectedRoots?: readonly string[];
  readonly sessionId: string;
  readonly getMode: () => VaultAgentMode;
  readonly getModeForConversation?: (conversationId: string) => VaultAgentMode;
  readonly getCaller?: (conversationId: string) => PolicyCaller;
  readonly isReadOnly?: (conversationId: string) => boolean;
  readonly requestPermission?: (prompt: PermissionPrompt) => Promise<PermissionDecision>;
  readonly knownSecrets?: () => readonly string[];
  readonly onFileChanges?: (changes: readonly TurnFileChange[]) => void;
  readonly onUnknownEffect?: () => Promise<void>;
  readonly subscribeSettings?: (listener: () => void) => () => void;
  readonly beforeOperation?: (signal?: AbortSignal) => Promise<void>;
}

export interface PiNativeHostTools {
  readonly registrations: readonly ToolRegistration[];
  readonly recovery: RecoveryResult;
  bindMutationJournal(store: NativeMutationJournalStore): Promise<void>;
  reconcile(): Promise<RecoveryResult>;
  runSkillHostProcess(
    input: { readonly skillId: string; readonly command: string },
    api: ToolExecutionApi,
    context: Context
  ): Promise<ToolExecutionResult>;
  dispose(): Promise<void>;
}

const NATIVE_PATH_LOCKS = new PathLockPool();
const EMPTY_RECOVERY: RecoveryResult = Object.freeze({ decisions: Object.freeze([]) });

// 文件算法使用锁定版本的官方实现；每次实际 I/O 都重新核对当前用户授权，设置撤回不能留下旧能力：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function createPiNativeHostTools(
  options: PiNativeHostToolsOptions
): Promise<PiNativeHostTools> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const os = requireNodeModule<typeof import("node:os")>("node:os");
  const { spawn } = requireNodeModule<typeof import("node:child_process")>("node:child_process");
  const { randomUUID } = requireNodeModule<typeof import("node:crypto")>("node:crypto");
  const timers = requireNodeModule<typeof import("node:timers")>("node:timers");
  const [
    { NodeExecutionEnv },
    { BACKGROUND_CONTEXT, withAbortSignal },
    official,
    commandDefinitions,
  ] = await Promise.all([
    import("@earendil-works/pi-durable/env/node"),
    import("@earendil-works/chord/context"),
    loadOfficialNativeRegistrations(),
    loadOfficialNativeCommandRegistrations(),
  ]);
  await fs.mkdir(options.privateDir, { recursive: true, mode: 0o700 });
  const raw = new NodeExecutionEnv({ cwd: options.privateDir, shellEnv: {} });
  const protectedRoots = [
    await fs.realpath(options.vaultRoot),
    await fs.realpath(options.privateDir),
    ...(await Promise.all(
      (options.protectedRoots ?? []).map((root) =>
        fs.realpath(root).catch(() => path.resolve(root))
      )
    )),
  ];
  const platform: HostPlatform =
    process.platform === "darwin" || process.platform === "linux" || process.platform === "win32"
      ? process.platform
      : "other";
  const controllers = new Set<AbortController>();
  let recovery = EMPTY_RECOVERY;
  let closed = false;
  let journalBound = false;
  let journalStore: NativeMutationJournalStore | undefined;
  let journal: NativeMutationJournal = { version: 1, records: {} };
  let journalWrites = Promise.resolve();
  // 撤权后重新授权也必须让旧批准失效，避免同值设置掩盖等待期间的权限变化：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  let settingsVersion = 1;
  const unsubscribeSettings = options.subscribeSettings?.(() => {
    settingsVersion += 1;
  });
  let guarded: GuardedExternalEnv | undefined;
  let guardedVersion = 0;
  const currentEnv = async (): Promise<GuardedExternalEnv> => {
    if (guarded && guardedVersion === settingsVersion) return guarded;
    const version = settingsVersion;
    // 外部文件不再有预授权范围；设置变化仍会整体作废等待中的旧环境与批准。https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
    guarded = new GuardedExternalEnv({
      raw,
      isAccessCurrent: () => !closed && version === settingsVersion,
      inspector: {
        realpath: (target) => fs.realpath(target),
        stat: (target) => fs.stat(target, { bigint: true }),
        lstat: async (target) => {
          try {
            const info = await fs.lstat(target);
            return {
              kind: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file",
              nlink: info.nlink,
            };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
            throw error;
          }
        },
      },
      path,
      protectedRoots,
    });
    guardedVersion = version;
    return guarded;
  };
  const mode = (id: string): VaultAgentMode =>
    options.getModeForConversation?.(id) ??
    (options.getCaller?.(id) === "subagent" ? "plan" : options.getMode());
  const executionIdentity = (name: string, api: ToolExecutionApi) => ({
    operationId:
      api.taskId === undefined
        ? `native:${options.sessionId}:${api.conversationId}:${api.callId}`
        : `native-task:${options.sessionId}:${api.conversationId}:${api.taskId}`,
    toolId: name,
    caller: options.getCaller?.(String(api.conversationId)) ?? "root",
  });
  const blocked = (id: string, context: Context, write: boolean): boolean =>
    closed ||
    !journalBound ||
    context.abortSignal?.aborted === true ||
    (write && (mode(id) === "plan" || options.isReadOnly?.(id) === true));
  const allowed = async (prompt: PermissionPrompt, context: Context): Promise<boolean> => {
    if (closed || context.abortSignal?.aborted || !options.requestPermission) return false;
    let abort: (() => void) | undefined;
    const cancelled = new Promise<PermissionDecision>((resolve) => {
      abort = () => resolve({ outcome: { outcome: "cancelled" } });
      context.abortSignal?.addEventListener("abort", abort, { once: true });
    });
    try {
      const decision = await Promise.race([
        options.requestPermission({ ...prompt, signal: context.abortSignal }),
        cancelled,
      ]);
      return (
        !closed &&
        !context.abortSignal?.aborted &&
        decision.outcome.outcome === "selected" &&
        decision.outcome.optionId === "allow_once"
      );
    } finally {
      if (abort) context.abortSignal?.removeEventListener("abort", abort);
    }
  };
  const permissionOptions = [
    { optionId: "allow_once", name: "允许这一次", kind: "allow_once" as const },
    { optionId: "reject_once", name: "拒绝", kind: "reject_once" as const },
  ];
  const persistRecord = async (operationId: string, record: unknown): Promise<void> => {
    if (!journalStore) throw new Error("操作记录尚未绑定。");
    const nextWrite = journalWrites.then(async () => {
      const next: NativeMutationJournal = {
        ...journal,
        records: {
          ...journal.records,
          [operationId]: JSON.parse(JSON.stringify(record)) as JsonObject,
        },
      };
      await journalStore!.save(next);
      journal = next;
    });
    journalWrites = nextWrite.catch(() => undefined);
    return nextWrite;
  };
  const prepareIntent = async (
    intent: NativeMutationPlan & { operationId: string; approvedAtMs: number }
  ): Promise<void> => {
    await persistRecord(intent.operationId, { state: "prepared", intent });
  };
  const persistReceipt = async (receipt: NativeMutationReceipt): Promise<void> => {
    const saved = journal.records[receipt.operationId] as unknown as { intent: NativeMutationPlan };
    await persistRecord(receipt.operationId, { state: "committed", intent: saved.intent, receipt });
    const chunks = diffLines(saved.intent.before ?? "", saved.intent.after);
    const change: TurnFileChange = {
      path: receipt.path,
      status: saved.intent.before === null ? "created" : "modified",
      before: saved.intent.before,
      after: saved.intent.after,
      additions: chunks.reduce((count, chunk) => count + (chunk.added ? (chunk.count ?? 0) : 0), 0),
      deletions: chunks.reduce(
        (count, chunk) => count + (chunk.removed ? (chunk.count ?? 0) : 0),
        0
      ),
    };
    try {
      options.onFileChanges?.([change]);
    } catch (error) {
      logWarn("[PiNativeHostTools] File change listener failed", error);
    }
  };
  const unknown = (operationId: string, target: string): RecoveryDecision => ({
    operationId,
    path: target,
    state: "needs_reconciliation",
    action: "manual",
    canReapprove: false,
    canContinue: false,
    receiptWritten: false,
  });
  const recordUnknown = async (operationId: string, target: string): Promise<void> => {
    recovery = {
      decisions: Object.freeze([
        ...recovery.decisions.filter((decision) => decision.operationId !== operationId),
        unknown(operationId, target),
      ]),
    };
    await options.onUnknownEffect?.();
  };
  // 外部写入也须关闭实际调度入口；无法保存回执或读取最终内容时，重开只能核对，不能重放写入：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const reconcile = async (): Promise<RecoveryResult> => {
    if (!journalBound) throw new Error("操作记录尚未绑定。");
    const decisions: RecoveryDecision[] = [];
    const filenames = Object.keys(journal.records).map((id) => `${id}.json`);
    for (const filename of filenames) {
      if (!filename.endsWith(".json")) continue;
      let operationId = filename.slice(0, -5);
      let target = "";
      try {
        const saved = journal.records[operationId] as unknown as {
          state: string;
          intent?: NativeMutationPlan & { operationId: string };
        };
        if (
          saved.state === "invalid" ||
          saved.state === "command_prepared" ||
          saved.state === "command_unknown"
        ) {
          decisions.push(unknown(operationId, ""));
          continue;
        }
        if (saved.state === "command_settled") continue;
        if (!["prepared", "effect_unknown", "committed", "not_applied"].includes(saved.state))
          throw new Error("操作记录状态不可验证；已保留原记录。");
        if (!saved.intent) throw new Error("外部写入记录缺少原始内容。");
        const intent = saved.intent;
        if (
          typeof intent.path !== "string" ||
          !path.isAbsolute(intent.path) ||
          typeof intent.after !== "string" ||
          !(intent.before === null || typeof intent.before === "string") ||
          !/^native-[A-Za-z0-9-]+$/.test(intent.operationId) ||
          filename !== `${intent.operationId}.json`
        )
          throw new Error("外部写入记录不完整；已保留原记录。");
        if (saved.state === "committed" || saved.state === "not_applied") continue;
        operationId = intent.operationId;
        target = intent.path;
        const inspected = await (await currentEnv()).readTextFile(intent.path, BACKGROUND_CONTEXT);
        const actual = inspected.ok
          ? inspected.value
          : inspected.error.code === "not_found"
            ? null
            : undefined;
        const state =
          actual === intent.after
            ? "committed"
            : actual === intent.before
              ? "not_applied"
              : "effect_unknown";
        await persistRecord(intent.operationId, { ...saved, state, reconciledAtMs: Date.now() });
        decisions.push(
          state === "effect_unknown"
            ? unknown(operationId, target)
            : {
                operationId,
                path: target,
                state: state === "committed" ? "committed" : "prepared",
                action: state === "committed" ? "complete_receipt" : "reapprove",
                canContinue: true,
                canReapprove: state === "not_applied",
                receiptWritten: state === "committed",
              }
        );
      } catch (error) {
        decisions.push(unknown(operationId, target));
        logWarn("[PiNativeHostTools] External mutation reconciliation unavailable", error);
      }
    }
    recovery = { decisions: Object.freeze(decisions) };
    return recovery;
  };
  const bindMutationJournal = async (store: NativeMutationJournalStore): Promise<void> => {
    if (journalStore) throw new Error("操作记录已绑定。");
    const saved = await store.load();
    journal = saved ?? { version: 1, records: {} };
    if (!saved) await store.save(journal);
    journalStore = store;
    journalBound = true;
    await reconcile();
  };
  const auditDenied = async (
    name: string,
    args: Record<string, unknown>,
    api: ToolExecutionApi,
    context: Context,
    code: string,
    message: string
  ): Promise<ToolExecutionResult> => {
    const cancelled = context.abortSignal?.aborted === true;
    try {
      await options.audit?.record({
        operationId:
          api.taskId === undefined
            ? `native:${options.sessionId}:${api.conversationId}:${api.callId}`
            : `native-task:${options.sessionId}:${api.conversationId}:${api.taskId}`,
        actor:
          (options.getCaller?.(String(api.conversationId)) ?? "root") === "root" ? "root" : "child",
        toolId: name,
        arguments: args,
        targets: typeof args.path === "string" ? [args.path] : [],
        effects:
          name === "read"
            ? ["read"]
            : name === "bash" || name === "powershell"
              ? ["execute"]
              : ["write"],
        decision: cancelled ? "cancelled" : "deny",
        status: cancelled ? "cancelled" : "rejected",
      });
    } catch {
      return withToolOutcome(failure("AUDIT_FAILED", toSafeError("AUDIT_FAILED").message), {
        ...executionIdentity(name, api),
        effect: "not_applied",
        phase: "persistence",
      });
    }
    const safe = toSafeError(code);
    return withToolOutcome(failure(code, safe.code === "INTERNAL_ERROR" ? message : safe.message), {
      ...executionIdentity(name, api),
      effect: "not_applied",
      phase: "review",
    });
  };
  const fileDefinition = (name: NativeToolName): CapabilityDefinition => ({
    toolId: name,
    family: "native_file",
    effects: name === "read" ? ["read"] : ["write", "create"],
    allowedCallers: ["root", "subagent", "fanout"],
    checkAvailability: () => ({
      available: !closed,
      reason: "The feature session is closed.",
    }),
  });
  const fileRegistration = (name: NativeToolName): ToolRegistration => {
    const definition = fileDefinition(name);
    return compileHostToolDefinition(
      {
        ...(official[name] as unknown as ToolRegistration),
        ...definition,
        description: `External files only: use absolute paths outside the Vault. Vault files must use vault_read/vault_create/vault_edit instead. ${official[name].description}`,
        replay: name === "read" ? "safe" : "unsafe",
        callers: ["model", "tools"],
        outputLimits: { maxBytes: 256 * 1024 },
        execute: async (value, api, context) => {
          await options.beforeOperation?.(context.abortSignal);
          const args = value as Record<string, unknown>;
          const id = String(api.conversationId);
          if (blocked(id, context, name !== "read"))
            return auditDenied(
              name,
              args,
              api,
              context,
              "PERMISSION_DENIED",
              "当前请求不允许修改外部文件，或已经停止。"
            );
          if (typeof args.path !== "string" || !path.isAbsolute(args.path))
            return auditDenied(
              name,
              args,
              api,
              context,
              "EXTERNAL_ROOT_REQUIRED",
              "外部文件必须使用绝对路径。"
            );
          let canonical: string;
          try {
            new PlatformPathPolicy({
              platform: path.sep === "\\" ? "win32" : "posix",
              uncAccess: "open",
            }).validate(args.path);
            canonical = await canonicalTarget(args.path);
          } catch (error) {
            return auditDenied(
              name,
              args,
              api,
              context,
              "EXTERNAL_PATH_DENIED",
              error instanceof Error ? error.message : String(error)
            );
          }
          if (
            await isPathWithin(protectedRoots[0], canonical, path, {
              stat: (target) => fs.stat(target, { bigint: true }),
            })
          )
            return auditDenied(
              name,
              args,
              api,
              context,
              "USE_VAULT_TOOL",
              "库内文件必须使用笔记工具。"
            );
          const operationId = `native-${randomUUID()}`;
          const env = new Proxy(raw, {
            get(target, property, receiver) {
              const member: unknown = Reflect.get(target, property, receiver);
              if (typeof member !== "function") return member;
              return async (...parameters: unknown[]) => {
                // 技能与外部文件也须在真实副作用前检查收尾空间，不能只依赖模型工具钩子。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
                if (property === "writeFile") await options.beforeOperation?.(context.abortSignal);
                if (name !== "read" && settingsVersion !== reviewVersion)
                  throw new Error("外部文件授权版本已经改变。");
                if (blocked(id, context, name !== "read"))
                  throw new Error("请求已停止或权限已撤回。");
                const fresh = await currentEnv();
                if (blocked(id, context, name !== "read"))
                  throw new Error("请求已停止或权限已撤回。");
                const implementation: unknown = Reflect.get(fresh, property);
                if (typeof implementation !== "function") throw new Error("外部环境不支持此操作。");
                return Reflect.apply(implementation, fresh, parameters) as unknown;
              };
            },
          }) as ExecutionEnv;
          let reviewed: NativeMutationPlan | undefined;
          let preview: NativeToolResult | undefined;
          let result: NativeToolResult | undefined;
          let approved = false;
          let executing = false;
          const tools = new NativeTools({
            registrations: official,
            locks: NATIVE_PATH_LOCKS,
            lockPath: canonical,
            env,
            vaultRoot: protectedRoots[0],
            path,
            fileSystem: { stat: (target) => fs.stat(target, { bigint: true }) },
            operationId: () => operationId,
            receipts: { prepare: prepareIntent, record: persistReceipt },
            approvals: {
              request: async (plan) => {
                if (!executing) {
                  reviewed = plan;
                  return { approved: false };
                }
                return {
                  approved:
                    approved &&
                    !!reviewed &&
                    plan.path === reviewed.path &&
                    plan.before === reviewed.before &&
                    plan.after === reviewed.after &&
                    settingsVersion === reviewVersion &&
                    !blocked(id, context, true),
                };
              },
            },
          });
          await currentEnv();
          const reviewVersion = settingsVersion;
          const initialMode = mode(id);
          const manifest = defineToolManifest({
            ...definition,
            parameters: official[name].parameters as Record<string, unknown>,
            extractTargets: () => [{ kind: "external_path", value: canonical }],
            implementationVersion: 1,
            schemaVersion: 1,
            replayPolicy: name === "read" ? "read_only" : "unsafe",
            maxOutputBytes: 256 * 1024,
          });
          const registry = new ToolRegistry();
          registry.register(manifest, "host");
          // 先让官方算法只捕获预览，统一网关审批后再执行同一算法；实际计划有任何变化都拒绝复用批准：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const gateway = new ToolGateway({
            audit: options.audit,
            registry,
            policy: new PolicyEngine(),
            isScopeActive: (version) =>
              version === settingsVersion &&
              !blocked(id, context, name !== "read") &&
              mode(id) === initialMode,
            revalidateTargets: async () =>
              (await canonicalTarget(args.path as string)) === canonical,
            requestApproval: async () => {
              preview = await tools.execute(
                name,
                args,
                api as unknown as NativeToolApiLike,
                context
              );
              if (!reviewed) return "rejected";
              if (blocked(id, context, true)) return "cancelled";
              approved = await allowed(
                {
                  sessionId: options.sessionId,
                  binding: {
                    toolId: manifest.toolId,
                    schemaHash: manifest.schemaHash,
                    targets: [canonical],
                    beforeHash: sha256(reviewed.before ?? ""),
                    scopeVersion: settingsVersion,
                    policyVersion: 1,
                  },
                  toolCall: {
                    toolCallId: durableToolCallId(options.sessionId, api.taskId, api.callId),
                    title: name,
                    kind: "edit",
                    status: "pending",
                    rawInput: { ...args, affectedPaths: [canonical] },
                    content: [
                      {
                        type: "diff",
                        path: canonical,
                        oldText: reviewed.before ?? "",
                        newText: reviewed.after,
                      },
                    ],
                  },
                  options: permissionOptions,
                },
                context
              );
              return approved
                ? "approved"
                : context.abortSignal?.aborted
                  ? "cancelled"
                  : "rejected";
            },
          });
          gateway.registerTool({
            toolId: name,
            manifest,
            execute: async (isolated) => {
              executing = true;
              result = await tools.execute(
                name,
                isolated,
                api as unknown as NativeToolApiLike,
                context
              );
              const details = result.details as
                | {
                    error?: { code?: unknown; message?: unknown };
                    receipt?: { operationId?: unknown };
                  }
                | undefined;
              const code =
                typeof details?.error?.code === "string"
                  ? details.error.code
                  : "NATIVE_TOOL_FAILED";
              if (result.isError && code === "EFFECT_UNKNOWN")
                await recordUnknown(operationId, canonical);
              const receiptId =
                typeof details?.receipt?.operationId === "string"
                  ? details.receipt.operationId
                  : undefined;
              // 官方文件算法已区分未执行与未知作用，共同结果必须保留这一事实和实际凭据，不能按isError一概猜未知。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
              return {
                content: "native-result",
                isError: result.isError,
                outcome: createToolOutcome({
                  ...executionIdentity(name, api),
                  operationId,
                  success: !result.isError,
                  effect: result.isError
                    ? code === "EFFECT_UNKNOWN"
                      ? "unknown"
                      : "not_applied"
                    : receiptId
                      ? "applied"
                      : "not_applied",
                  data: result.details,
                  receipts: receiptId ? [receiptId] : [],
                  ...(result.isError
                    ? {
                        error: {
                          code,
                          phase:
                            code === "INTENT_FAILED"
                              ? ("persistence" as const)
                              : code === "STALE_BASELINE" || code === "EFFECT_UNKNOWN"
                                ? ("verification" as const)
                                : code === "CANCELLED" || code === "WRITE_NOT_APPROVED"
                                  ? ("review" as const)
                                  : ("execution" as const),
                          message:
                            typeof details?.error?.message === "string"
                              ? details.error.message
                              : "外部文件工具未能完成。",
                        },
                      }
                    : {}),
                }),
              };
            },
          });
          const outcome = await gateway.executeTool(name, args, {
            operationId:
              api.taskId === undefined
                ? `native:${options.sessionId}:${id}:${api.callId}`
                : `native-task:${options.sessionId}:${id}:${api.taskId}`,
            caller: options.getCaller?.(id) ?? "root",
            mode: initialMode,
            scope: {
              vaultRoot: protectedRoots[0],
              readOnly: options.isReadOnly?.(id) ?? initialMode === "plan",
            },
            scopeVersion: reviewVersion,
            policyVersion: reviewVersion,
            targets: [{ kind: "external_path", value: canonical }],
            signal: context.abortSignal,
          });
          if (outcome.decision === "deny")
            return withToolOutcome(
              !reviewed && preview
                ? nativeResult(preview)
                : {
                    ...failure(outcome.code, outcome.message),
                    details: JSON.parse(JSON.stringify({ outcome: outcome.outcome })),
                  },
              {
                ...executionIdentity(name, api),
                effect: outcome.outcome?.effect ?? "not_applied",
                phase: "review",
              }
            );
          if (!result)
            return withToolOutcome(failure("NATIVE_TOOL_FAILED", "原生工具没有返回实际结果。"), {
              ...executionIdentity(name, api),
              effect: "not_applied",
              phase: "execution",
            });
          const projected = nativeResult(result);
          return {
            ...projected,
            details: JSON.parse(
              JSON.stringify({
                outcome: outcome.outcome,
              })
            ),
          };
        },
      },
      options.capabilities
    );
  };
  const interpreter = new InterpreterResolver({
    platform,
    path,
    fileSystem: {
      exists: async (target) => {
        try {
          await fs.access(target);
          return true;
        } catch {
          return false;
        }
      },
    },
  });
  const commandDefinitionsAvailable = new Map(
    await Promise.all(
      (["bash", "powershell"] as const).map(
        async (name) => [name, (await interpreter.resolve(name)).available] as const
      )
    )
  );
  const commandRegistration = (name: NativeCommandId): ToolRegistration => {
    const definition: CapabilityDefinition = {
      toolId: name,
      family: "host_process",
      effects: ["execute"],
      allowedCallers: ["root"],
      checkAvailability: () => ({
        available: !closed && commandDefinitionsAvailable.get(name) === true,
        reason: "Local commands need an available interpreter.",
      }),
    };
    return compileHostToolDefinition(
      {
        ...(commandDefinitions[name] as unknown as ToolRegistration),
        ...definition,
        replay: "unsafe",
        callers: ["model"],
        outputLimits: { maxBytes: 64 * 1024, retain: "tail" },
        execute: async (value, api, context) => {
          await options.beforeOperation?.(context.abortSignal);
          const args = value as Record<string, unknown>;
          const id = String(api.conversationId);
          if (blocked(id, context, true) || options.getCaller?.(id) === "subagent")
            return auditDenied(
              name,
              args,
              api,
              context,
              "PERMISSION_DENIED",
              "当前会话不能执行电脑命令。"
            );
          const resolved = await interpreter.resolve(name);
          if (!resolved.available)
            return auditDenied(name, args, api, context, resolved.code, resolved.reason);
          const cwd = os.homedir();
          const policy = new HostExecutionPolicy({
            path,
            vaultRoot: protectedRoots[0],
            interpreter: { available: true, label: resolved.path },
            defaultCwd: cwd,
          });
          const timeoutMs =
            typeof args.timeout === "number"
              ? Math.min(300_000, Math.max(1000, args.timeout * 1000))
              : 60_000;
          const request = {
            command: typeof args.command === "string" ? args.command : "",
            cwd,
            interpreter: resolved.path,
            timeoutMs,
            outputLimitBytes: 64 * 1024,
          };
          const decision = await policy.evaluate(request);
          if (
            decision.allowed ||
            decision.code !== "CONFIRMATION_REQUIRED" ||
            !decision.confirmation
          )
            return auditDenied(
              name,
              args,
              api,
              context,
              decision.allowed ? "APPROVAL_REQUIRED" : decision.code,
              "命令未获批准。"
            );
          const confirmation = decision.confirmation;
          const initialMode = mode(id);
          const reviewVersion = settingsVersion;
          let result: ToolExecutionResult | undefined;
          let commandReceiptId: string | undefined;
          let commandExecution:
            | {
                effect: ToolEffectState;
                result: ProcessResult;
                started: boolean;
                exited: boolean;
                receiptFailed?: boolean;
              }
            | undefined;
          const executeCommand = async (): Promise<ToolExecutionResult> => {
            const approved = policy.approveCommand(request, { approvedByUser: true });
            if (!approved.ok) return failure(approved.code, approved.message);
            const controller = new AbortController();
            controllers.add(controller);
            const abort = () => controller.abort();
            context.abortSignal?.addEventListener("abort", abort, { once: true });
            const environment = new CommandEnvironment({
              platform,
              parentEnv: process.env,
              knownSecrets: options.knownSecrets?.() ?? [],
            });
            const commandOperationId = `command-${randomUUID()}`;
            commandReceiptId = commandOperationId;
            let processStarted = false;
            let processExited = false;
            const supervisor = new ProcessSupervisor({
              environment,
              timer: {
                now: () => Date.now(),
                setTimeout: (callback, ms) => timers.setTimeout(callback, ms),
                clearTimeout: (timer) =>
                  timers.clearTimeout(timer as ReturnType<typeof timers.setTimeout>),
              },
              spawner: {
                spawn: (input) => {
                  if (settingsVersion !== reviewVersion || blocked(id, context, true))
                    throw new Error("命令授权已撤回。");
                  const child = spawn(input.command, [...input.args], {
                    cwd: input.cwd,
                    env: { ...input.env },
                    shell: false,
                    detached: platform !== "win32",
                    stdio: ["ignore", "pipe", "pipe"],
                  });
                  child.stdout.setEncoding("utf8");
                  child.stderr.setEncoding("utf8");
                  child.once("spawn", () => {
                    processStarted = true;
                  });
                  return {
                    get pid() {
                      return child.pid;
                    },
                    stdout: child.stdout,
                    stderr: child.stderr,
                    onExit: (listener) => {
                      child.once("close", (code, signal) => {
                        processExited = true;
                        listener(code, signal);
                      });
                    },
                    onError: (listener) => {
                      child.once("error", listener);
                    },
                    kill: (signal) => child.kill(signal as NodeJS.Signals),
                  } satisfies ProcessChildLike;
                },
              },
              killer: {
                terminate: async (child) => {
                  if (!child.pid) return "incomplete";
                  if (platform === "win32")
                    return new Promise<"confirmed" | "incomplete">((resolve) => {
                      const killer = spawn(
                        path.join(
                          process.env.SystemRoot ?? "C:\\Windows",
                          "System32",
                          "taskkill.exe"
                        ),
                        ["/pid", String(child.pid), "/T", "/F"],
                        { shell: false, windowsHide: true }
                      );
                      killer.once("error", () => resolve("incomplete"));
                      killer.once("close", (code) =>
                        resolve(code === 0 ? "confirmed" : "incomplete")
                      );
                    });
                  try {
                    process.kill(-child.pid, "SIGKILL");
                    return "confirmed";
                  } catch {
                    child.kill("SIGKILL");
                    return "incomplete";
                  }
                },
              },
              spill: {
                write: async (content) => {
                  const target = path.join(
                    options.privateDir,
                    `command-output-${randomUUID()}.txt`
                  );
                  await fs.writeFile(target, content, { mode: 0o600 });
                  return target;
                },
              },
              recordIntent: async (input) => {
                await persistRecord(commandOperationId, {
                  state: "command_prepared",
                  command: input,
                });
              },
            });
            const supervisedEnv = new Proxy(raw, {
              get(target, property, receiver) {
                if (property !== "exec") return Reflect.get(target, property, receiver) as unknown;
                return async (
                  command: string | readonly string[],
                  execution: ShellExecOptions | undefined,
                  runContext: Context
                ): Promise<Result<ShellExecResult, ExecutionError>> => {
                  await options.beforeOperation?.(controller.signal);
                  if (typeof command === "string" || blocked(id, context, true))
                    throw new Error("命令未通过最终检查。");
                  const result = await supervisor.run(
                    {
                      command: command[0],
                      args: command.slice(1),
                      cwd: execution?.cwd ?? cwd,
                      env: execution?.env,
                      timeoutMs:
                        execution?.timeout === undefined ? timeoutMs : execution.timeout * 1000,
                    },
                    { signal: controller.signal }
                  );
                  // 非零退出仍能确认程序实际运行；只有运行、退出或清理无法确认时才属于未知作用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
                  commandExecution = {
                    result,
                    started: processStarted,
                    exited: processExited,
                    effect:
                      result.cleanup === "cleanup_incomplete" || (processStarted && !processExited)
                        ? "unknown"
                        : processStarted
                          ? "applied"
                          : "not_applied",
                  };
                  if (journalStore && result.intentRecorded) {
                    // 程序已运行后的退出与清理结果也属操作事实，不能仅凭重连推断没有副作用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
                    try {
                      await persistRecord(commandOperationId, {
                        ...journal.records[commandOperationId],
                        state:
                          commandExecution.effect === "unknown"
                            ? "command_unknown"
                            : "command_settled",
                        result,
                        started: processStarted,
                        exited: processExited,
                      });
                    } catch (error) {
                      commandExecution.effect = "unknown";
                      commandExecution.receiptFailed = true;
                      await recordUnknown(commandOperationId, "");
                      throw error;
                    }
                    if (commandExecution.effect === "unknown")
                      await recordUnknown(commandOperationId, "");
                  }
                  execution?.onOutput?.(result.output, runContext, { stream: "stdout" });
                  if (result.status !== "completed" && result.status !== "failed")
                    throw new Error(`${result.errorCode ?? result.status}: ${result.cleanup}`);
                  return {
                    ok: true,
                    value: {
                      exitCode: result.exitCode ?? 1,
                      ...(result.spillPath ? { spillPath: result.spillPath } : {}),
                    },
                  };
                };
              },
            }) as ExecutionEnv;
            const native = new NativeCommands({
              registrations: commandDefinitions,
              policy,
              interpreter,
              env: supervisedEnv,
              path,
              defaultCwd: cwd,
            });
            const commandContext = Object.assign(withAbortSignal(controller.signal, context), {
              signal: controller.signal,
              approvalToken: approved.token,
            });
            try {
              return nativeResult(
                await native.execute(
                  name,
                  args,
                  api as unknown as NativeToolApiLike,
                  commandContext
                )
              );
            } finally {
              controllers.delete(controller);
              context.abortSignal?.removeEventListener("abort", abort);
            }
          };
          const manifest = defineToolManifest({
            ...definition,
            parameters: commandDefinitions[name].parameters as Record<string, unknown>,
            extractTargets: () => [{ kind: "operation", value: name }],
            implementationVersion: 1,
            schemaVersion: 1,
            replayPolicy: "unsafe",
            maxOutputBytes: 64 * 1024,
          });
          const registry = new ToolRegistry();
          registry.register(manifest, "host");
          const gateway = new ToolGateway({
            audit: options.audit,
            registry,
            policy: new PolicyEngine(),
            isScopeActive: (version) =>
              version === settingsVersion &&
              !blocked(id, context, true) &&
              mode(id) === initialMode,
            requestApproval: async () => {
              const accepted = await allowed(
                {
                  sessionId: options.sessionId,
                  binding: {
                    toolId: manifest.toolId,
                    schemaHash: manifest.schemaHash,
                    targets: [],
                    scopeVersion: settingsVersion,
                    policyVersion: 1,
                  },
                  toolCall: {
                    toolCallId: durableToolCallId(options.sessionId, api.taskId, api.callId),
                    title: name,
                    kind: "execute",
                    status: "pending",
                    rawInput: {
                      ...request,
                      ...(typeof args.skillId === "string" ? { skillId: args.skillId } : {}),
                      nonSandboxNotice: confirmation.nonSandboxNotice,
                      risks: confirmation.risks,
                    },
                  },
                  options: permissionOptions,
                },
                context
              );
              return accepted
                ? "approved"
                : context.abortSignal?.aborted
                  ? "cancelled"
                  : "rejected";
            },
          });
          gateway.registerTool({
            toolId: name,
            manifest,
            execute: async () => {
              result = await executeCommand();
              return { content: "native-command-result", isError: result.isError };
            },
          });
          const outcome = await gateway.executeTool(name, args, {
            operationId:
              api.taskId === undefined
                ? `native:${options.sessionId}:${id}:${api.callId}`
                : `native-task:${options.sessionId}:${id}:${api.taskId}`,
            caller: options.getCaller?.(id) ?? "root",
            mode: initialMode,
            scope: {
              vaultRoot: protectedRoots[0],
              readOnly: options.isReadOnly?.(id) ?? initialMode === "plan",
            },
            scopeVersion: reviewVersion,
            policyVersion: reviewVersion,
            targets: [{ kind: "operation", value: name }],
            signal: context.abortSignal,
          });
          const succeeded = outcome.decision === "allow" && result !== undefined && !result.isError;
          const auditFailed = outcome.decision === "deny" && outcome.code === "AUDIT_FAILED";
          const code = commandExecution?.receiptFailed
            ? "STORAGE_FAILED"
            : auditFailed
              ? "AUDIT_FAILED"
              : (commandExecution?.result.errorCode ??
                (commandExecution
                  ? "COMMAND_EXIT_FAILED"
                  : outcome.decision === "deny"
                    ? outcome.code
                    : "EXECUTION_FAILED"));
          const finalResult =
            result ??
            failure(code, outcome.decision === "deny" ? outcome.message : "命令没有返回实际结果。");
          const normalized = createToolOutcome({
            ...executionIdentity(name, api),
            success: succeeded,
            effect: commandExecution?.effect ?? "not_applied",
            data: result?.details,
            receipts:
              commandReceiptId && journal.records[commandReceiptId]?.state === "command_settled"
                ? [commandReceiptId]
                : [],
            ...(!succeeded
              ? {
                  error: {
                    code,
                    phase:
                      commandExecution?.receiptFailed || auditFailed
                        ? ("persistence" as const)
                        : commandExecution
                          ? ("execution" as const)
                          : ("review" as const),
                    message:
                      outcome.decision === "deny"
                        ? outcome.message
                        : "程序已运行但未成功完成，请检查输出后调整命令。",
                  },
                }
              : {}),
          });
          return {
            ...finalResult,
            isError: !succeeded,
            details: JSON.parse(JSON.stringify({ outcome: normalized })),
          };
        },
      },
      options.capabilities
    );
  };
  const bash = commandRegistration("bash");
  const powershell = commandRegistration("powershell");
  return {
    bindMutationJournal,
    get recovery() {
      return recovery;
    },
    reconcile,
    registrations: Object.freeze([
      fileRegistration("read"),
      fileRegistration("write"),
      fileRegistration("edit"),
      bash,
      powershell,
    ]),
    // 技能脚本复用同一条真实电脑命令入口，不能因来源是技能而绕过模式、单次批准或停止。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    runSkillHostProcess: (input, api, context) =>
      (platform === "win32" ? powershell : bash).execute(
        { command: input.command, skillId: input.skillId },
        api,
        context
      ),
    dispose: async () => {
      if (closed) return;
      closed = true;
      unsubscribeSettings?.();
      for (const controller of controllers) controller.abort();
      await raw.cleanup(BACKGROUND_CONTEXT);
    },
  };
}

async function canonicalTarget(target: string): Promise<string> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const tail: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...tail.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

function failure(code: string, message: string): ToolExecutionResult {
  return {
    isError: true,
    output: [{ type: "text", text: `${code}: ${message}` }],
    details: { code, message },
  };
}

function nativeResult(result: NativeToolResult): ToolExecutionResult {
  return {
    ...result,
    ...(typeof result.output === "string"
      ? { output: [{ type: "text" as const, text: result.output }] }
      : {}),
  } as ToolExecutionResult;
}
