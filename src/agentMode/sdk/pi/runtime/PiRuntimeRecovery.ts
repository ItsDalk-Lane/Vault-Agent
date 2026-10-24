import type {
  AgentChatMessage,
  BackendState,
  RecoveryStateUpdate,
} from "@/agentMode/session/types";
import {
  FailureSupervisor,
  type FailureSupervisorState,
} from "@/agentMode/sdk/pi/runtime/FailureSupervisor";
import {
  RecoveryCoordinator,
  type RecoveryCoordinatorOptions,
  type RecoveryState,
} from "@/agentMode/sdk/pi/storage/RecoveryCoordinator";
import type { SessionExportInput } from "@/agentMode/sdk/pi/storage/SessionExport";
import { requireNodeModule } from "@/utils/desktopRuntime";

export interface PiRecoverySnapshot {
  readonly version: 1;
  readonly messages: readonly AgentChatMessage[];
  readonly state: BackendState;
  readonly session: SessionExportInput;
}

export interface PiRuntimeRecoveryOptions extends Omit<RecoveryCoordinatorOptions, "supervisor"> {
  readonly privateDir: string;
  readonly hasActiveWork?: () => boolean;
  readonly pendingMutationIds?: () => readonly string[];
  readonly emit: (state: RecoveryStateUpdate) => void;
}

export interface PiRuntimeRecovery {
  readonly state: RecoveryStateUpdate | null;
  readonly blocked: boolean;
  readonly readOnly: boolean;
  inspect(): Promise<void>;
  assertCanStartWork(): void;
  recover(action: "continue" | "abort" | "reconcile"): Promise<void>;
  safeBoundary(): Promise<void>;
  storageFailed(error: unknown): Promise<void>;
  saveSnapshot(snapshot: PiRecoverySnapshot): Promise<void>;
  flush(): Promise<void>;
}

// 高版本或完整行损坏时只读取独立的显示快照，绝不猜测、改写执行日志或伪造空历史：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function readPiRecoverySnapshot(privateDir: string): Promise<PiRecoverySnapshot> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const parsed = JSON.parse(
    await fs.readFile(path.join(privateDir, "recovery-view.json"), "utf8")
  ) as Partial<PiRecoverySnapshot>;
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.messages) ||
    !parsed.state ||
    !parsed.session ||
    !Array.isArray(parsed.session.messages) ||
    !parsed.messages.every(
      (message: unknown) =>
        message &&
        typeof message === "object" &&
        "id" in message &&
        "message" in message &&
        "sender" in message &&
        typeof message.id === "string" &&
        typeof message.message === "string" &&
        (message.sender === "user" || message.sender === "ai")
    )
  )
    throw new Error("没有可验证的兼容历史快照；原始执行记录已保留，请使用兼容版本打开。");
  return parsed as PiRecoverySnapshot;
}

// 调度器的 submit、wait 和 abort 都可能唤醒旧任务，因此恢复门必须先于任何进度 API；异常次数持久化到宿主头文件：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function createPiRuntimeRecovery(
  options: PiRuntimeRecoveryOptions
): Promise<PiRuntimeRecovery> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const crypto = requireNodeModule<typeof import("node:crypto")>("node:crypto");
  const metadataPath = path.join(options.privateDir, "meta.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
    schemaVersion: number;
    recovery?: { consecutiveAbnormalOpens?: number };
    [key: string]: unknown;
  };
  let writes: Promise<void> = Promise.resolve();
  const write = (target: string, value: unknown): Promise<void> => {
    const content = JSON.stringify(value);
    const next = writes.then(async () => {
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.rename(temporary, target);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
    });
    writes = next;
    return next;
  };
  const supervisor = new FailureSupervisor({
    initialAbnormalOpens: metadata.recovery?.consecutiveAbnormalOpens,
    persist: (state: FailureSupervisorState) => {
      metadata.recovery = { consecutiveAbnormalOpens: state.consecutiveAbnormalOpens };
      return write(metadataPath, metadata);
    },
  });
  let blocked = true;
  let resuming = false;
  let state: RecoveryStateUpdate | null = null;
  const publish = (next: RecoveryStateUpdate | null): void => {
    state = next;
    options.emit(
      next ?? {
        status: "none",
        pendingPermissionIds: [],
        pendingQuestionIds: [],
        pendingMutationIds: [],
        crashLoopTripped: false,
      }
    );
  };
  const project = (recovery: RecoveryState): RecoveryStateUpdate | null => {
    if (recovery.kind === "clean") return null;
    const run = "run" in recovery ? recovery.run : null;
    const unsupportedTask = run?.status === "blocked";
    const unresolved =
      "unknownEffectMutations" in recovery && recovery.unknownEffectMutations.length > 0;
    return {
      ...(run?.status === "waiting_user" &&
      recovery.kind === "needs_recovery" &&
      !unresolved &&
      recovery.pendingApprovals.length === 0
        ? { continuationAvailable: true }
        : {}),
      status:
        recovery.kind === "read_only" || unresolved || unsupportedTask
          ? "read_only"
          : recovery.kind === "storage_failed"
            ? "storage_failed"
            : "available",
      ...(run
        ? {
            interruptedRun: {
              runId: run.runId,
              requestId: run.requestId ?? run.runId,
              status:
                run.status === "waiting_user"
                  ? "completed"
                  : run.status === "paused_user"
                    ? ("paused_user" as const)
                    : run.status === "paused_stalled"
                      ? ("paused_stalled" as const)
                      : run.status === "paused_budget"
                        ? ("paused_budget" as const)
                        : ("interrupted" as const),
              startedAtMs: run.startedAtMs,
              cancelEpoch: 0,
            },
          }
        : {}),
      pendingPermissionIds:
        "pendingApprovals" in recovery
          ? recovery.pendingApprovals.map((approval) => approval.requestId)
          : [],
      pendingQuestionIds:
        "pendingQuestionIds" in recovery ? [...(recovery.pendingQuestionIds ?? [])] : [],
      pendingMutationIds:
        "unknownEffectMutations" in recovery
          ? recovery.unknownEffectMutations.map((mutation) => mutation.operationId)
          : [],
      crashLoopTripped: recovery.crashLoop.readOnly,
      message:
        recovery.kind === "storage_failed"
          ? `保存失败，已停止执行：${recovery.failure.message}`
          : unsupportedTask
            ? "有任务定义缺失或版本不兼容，当前只能读取和导出。原执行记录已保留，请使用兼容版本。"
            : unresolved
              ? "部分文件或外部操作的实际结果尚未核对。可先检查操作结果；检查只读取已有事实，不能证明时会保持暂停，不会重做操作。"
              : recovery.kind === "read_only"
                ? "这段聊天连续三次未正常结束，已转为只读。可导出、停止未完成工作，或明确重试。"
                : run?.status === "waiting_user"
                  ? "本轮已结束，清单仍有剩余工作。点击继续会沿原目标启动下一段并追加32次请求额度；打开记录不会自动执行，也可直接发送新的要求。"
                  : run?.status === "paused_user"
                    ? "工作已按要求暂停，进度与已发生的修改保留。点击继续前不会重新执行。"
                    : run?.status === "paused_stalled"
                      ? "相同操作连续失败且没有新进展，已保存暂停。检查原因后可明确继续，或停止未完成的工作。"
                      : run?.status === "paused_budget"
                        ? "本段模型请求额度已用完，进度和操作结果已保存。点击继续可追加下一段32次请求额度；累计用量会保留。"
                        : "有尚未完成的工作。选择继续前不会重新调用模型或执行工具；也可以停止未完成工作。",
    };
  };
  const coordinator = new RecoveryCoordinator({
    ...options,
    supervisor,
    resume: async () => {
      resuming = true;
      blocked = false;
      publish(null);
      await options.resume();
    },
  });
  const safeBoundary = async (): Promise<void> => {
    const activeBeforeInspection = options.hasActiveWork?.() === true;
    const inspection = await options.inspect();
    const hasActiveWork = activeBeforeInspection || options.hasActiveWork?.() === true;
    // 同一存储中的活跃同伴不是崩溃遗留；未知写入结果仍立即暂停，已有暂停也不因同伴存活而解除。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (
      inspection.unknownEffectMutations.length > 0 ||
      (!hasActiveWork && inspection.run && inspection.run.status !== "waiting_user")
    ) {
      blocked = true;
      publish(project({ kind: "needs_recovery", ...inspection, crashLoop: supervisor.getState() }));
      return;
    }
    if (hasActiveWork) return;
    await supervisor.recordSafeBoundary();
    blocked = false;
    publish(
      inspection.run?.status === "waiting_user"
        ? project({ kind: "needs_recovery", ...inspection, crashLoop: supervisor.getState() })
        : null
    );
  };
  return {
    get state() {
      return state;
    },
    get blocked() {
      return blocked || !supervisor.canStartWork();
    },
    get readOnly() {
      return (
        state?.status === "read_only" ||
        supervisor.isReadOnly() ||
        supervisor.getState().hostIoBlocked
      );
    },
    inspect: async () => {
      const recovery = await coordinator.inspectAfterOpen();
      blocked =
        recovery.kind !== "clean" &&
        !(
          recovery.kind === "needs_recovery" &&
          recovery.run?.status === "waiting_user" &&
          recovery.pendingApprovals.length === 0 &&
          recovery.unknownEffectMutations.length === 0
        );
      publish(project(recovery));
    },
    assertCanStartWork: () => {
      supervisor.assertCanStartWork();
      if (blocked) throw new Error("请先选择继续或停止未完成的工作，再发送新消息。");
    },
    recover: async (action) => {
      const previous = state;
      resuming = false;
      blocked = true;
      if (action === "reconcile") {
        await coordinator.reconcileAfterUserChoice();
        await safeBoundary();
        return;
      }
      if (action === "abort") {
        await coordinator.stopAfterUserChoice();
        await safeBoundary();
        return;
      }
      if (supervisor.isReadOnly()) await supervisor.resumeAfterExplicitUserRetry();
      let result;
      try {
        result = await coordinator.continueAfterUserChoice();
      } catch (error) {
        blocked = true;
        if (state?.status !== "storage_failed") {
          if (resuming) await safeBoundary();
          else publish(previous);
        }
        throw error;
      }
      if (result.kind === "blocked") {
        blocked = true;
        throw new Error(`暂时不能恢复：${result.reasons.join(", ")}`);
      }
    },
    safeBoundary,
    storageFailed: async (error) => {
      blocked = true;
      const recording = supervisor.recordStorageFailure({
        code: "STORAGE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
      publish({
        status: "storage_failed",
        pendingPermissionIds: [],
        pendingQuestionIds: [],
        pendingMutationIds: options.pendingMutationIds?.() ?? state?.pendingMutationIds ?? [],
        crashLoopTripped: supervisor.isReadOnly(),
        message: "执行记录保存失败，已停止模型和文件操作。原始数据已保留，可导出最近可读的历史。",
      });
      await recording;
    },
    saveSnapshot: (snapshot) =>
      write(path.join(options.privateDir, "recovery-view.json"), snapshot),
    flush: () => writes,
  };
}
