import type { Conversation, Harness, JsonObject } from "@earendil-works/pi-durable";
import type { PermissionDecision, PermissionPrompt } from "@/agentMode/session/types";
import {
  ApprovalStore,
  type ApprovalState,
  type ApprovalBindingInput,
} from "@/agentMode/sdk/pi/policy/ApprovalStore";
import type {
  RecoveryApproval,
  RecoveryPolicySnapshot,
} from "@/agentMode/sdk/pi/storage/RecoveryCoordinator";
import { sha256 } from "@/utils/hash";

interface ApprovalRecord {
  readonly prompt: PermissionPrompt;
  readonly policyKey: string;
  readonly status: "pending" | "cancelled" | "stale";
}

interface ApprovalDocument extends JsonObject {
  revision: number;
  approvals: JsonObject;
  records: JsonObject;
}

export interface PiRuntimeApprovalsOptions {
  readonly harness: Harness;
  readonly conversation: Conversation;
  readonly sessionId: string;
  readonly scopeId: string;
  readonly getPolicyKey: () => string;
  readonly validate: (prompt: PermissionPrompt) => Promise<boolean>;
  readonly show: (prompt: PermissionPrompt) => Promise<PermissionDecision>;
  readonly emit: () => void;
}

export interface PiRuntimeApprovals {
  readonly pending: readonly PermissionPrompt[];
  request(prompt: PermissionPrompt): Promise<PermissionDecision>;
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  cancelAll(): Promise<void>;
  prepareRecovery(): Promise<RecoveryPolicySnapshot>;
  recoveryApprovals(): readonly RecoveryApproval[];
  dispose(options?: { readonly preservePending?: boolean }): void;
}

const EMPTY_PERMISSIONS: readonly PermissionPrompt[] = Object.freeze([]);
const CANCELLED: PermissionDecision = Object.freeze({
  outcome: Object.freeze({ outcome: "cancelled" }),
});

// 原卡片、决定和消费意图先落盘再放行；重开只读取，明确继续后才允许原工具重新核对并消费：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function createPiRuntimeApprovals(
  options: PiRuntimeApprovalsOptions
): Promise<PiRuntimeApprovals> {
  const [{ defineDoc }, { BACKGROUND_CONTEXT }] = await Promise.all([
    import("@earendil-works/pi-durable"),
    import("@earendil-works/chord/context"),
  ]);
  const token = defineDoc<ApprovalDocument>({
    kind: "va.approvals",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "initial",
    initial: () => ({ revision: 0, approvals: { decisions: {}, requests: {} }, records: {} }),
  });
  const saved = await options.harness.snapshot(token, options.conversation.id, BACKGROUND_CONTEXT);
  let records = decode<Record<string, ApprovalRecord>>(saved?.records ?? {});
  let committedRecords = records;
  let state: ApprovalState = decode(saved?.approvals ?? { decisions: {}, requests: {} });
  let writes: Promise<unknown> = Promise.resolve();
  let disposed = false;
  let suspended = false;
  const livePrompts = new Set<AbortController>();
  const waiters = new Map<
    string,
    { promise: Promise<PermissionDecision>; resolve: (decision: PermissionDecision) => void }
  >();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writes.then(work);
    writes = next.catch(() => undefined);
    return next;
  };
  const save = async (nextState: ApprovalState, nextRecords = records): Promise<void> => {
    await options.conversation.commit(async (tx) => {
      const doc = await tx.doc(token, options.conversation.id);
      doc.approvals = encode(nextState);
      doc.records = encode(nextRecords);
      doc.revision += 1;
      for (const [requestId, record] of Object.entries(nextRecords)) {
        const decision = nextState.decisions[requestId];
        if (committedRecords[requestId] === record && state.decisions[requestId] === decision)
          continue;
        await tx.appendEntry(options.conversation.id, {
          kind: "va.approval",
          data: encode({
            requestId,
            prompt: record.prompt,
            status: record.status,
            ...(decision ? { decision } : {}),
          }),
        });
      }
      await tx.appendEntry(options.conversation.id, {
        kind: "va.state",
        data: {
          docKind: "va.approvals",
          revision: doc.revision,
          change: "updated",
          atMs: Date.now(),
        },
      });
    }, BACKGROUND_CONTEXT);
    records = nextRecords;
    committedRecords = nextRecords;
    state = nextState;
    options.emit();
  };
  const store = new ApprovalStore({
    persistence: { load: async () => state, save: (nextState) => save(nextState) },
  });
  await store.load();
  const inputFor = (prompt: PermissionPrompt): ApprovalBindingInput => ({
    approvalId: prompt.toolCall.toolCallId,
    toolId: prompt.binding?.toolId ?? prompt.toolCall.title ?? "host_permission",
    schemaHash:
      prompt.binding?.schemaHash ??
      sha256(JSON.stringify({ kind: prompt.toolCall.kind, options: prompt.options })),
    arguments: {
      input: prompt.toolCall.rawInput ?? null,
      preview: prompt.toolCall.content ?? [],
      policyKey: options.getPolicyKey(),
    },
    targets: prompt.binding?.targets ?? [],
    ...(prompt.binding?.beforeHash ? { beforeHash: prompt.binding.beforeHash } : {}),
    scopeVersion: prompt.binding?.scopeVersion ?? 1,
    policyVersion: prompt.binding?.policyVersion ?? 1,
  });
  const pending = (): readonly PermissionPrompt[] => {
    const value = Object.entries(records)
      .filter(([id, record]) => record.status === "pending" && !state.decisions[id])
      .map(([, record]) => record.prompt);
    return value.length ? Object.freeze(value) : EMPTY_PERMISSIONS;
  };
  const settle = (id: string, decision: PermissionDecision): void => {
    waiters.get(id)?.resolve(decision);
    waiters.delete(id);
  };
  const retire = async (id: string, status: "cancelled" | "stale"): Promise<void> => {
    const record = records[id];
    if (!record || record.status !== "pending") return;
    await save(state, { ...records, [id]: { ...record, status } });
    settle(id, CANCELLED);
  };
  const decide = (id: string, decision: PermissionDecision): Promise<void> =>
    serialize(async () => {
      const record = records[id];
      if (suspended || !record || record.status !== "pending" || state.decisions[id]?.consumed)
        return;
      // 已选允许仍可能在消费前被停止，必须撤销已保存的许可，不能留给同一旧调用重用：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (decision.outcome.outcome === "cancelled") {
        await retire(id, "cancelled");
        return;
      }
      if (state.decisions[id]) return;
      const request = state.requests?.[id];
      if (!request) throw new Error("原批准请求不存在。");
      await store.decide(request, decision.outcome.optionId);
      settle(id, decision);
    });
  const consume = (
    prompt: PermissionPrompt,
    decision: PermissionDecision
  ): Promise<PermissionDecision> =>
    serialize(async () => {
      const id = prompt.toolCall.toolCallId;
      const record = records[id];
      if (disposed || prompt.signal?.aborted || record?.status !== "pending") return CANCELLED;
      const selected = state.decisions[id];
      if (!selected) return CANCELLED;
      if (selected.kind === "reject_once" || selected.kind === "reject_always") return decision;
      if (record.policyKey !== options.getPolicyKey() || !(await options.validate(prompt))) {
        await retire(id, "stale");
        return CANCELLED;
      }
      await store.consumeOnce(id, inputFor(prompt), `approval-intent:${id}`);
      return decision;
    });
  const recoveryApprovals = (): readonly RecoveryApproval[] =>
    Object.entries(records).flatMap(([id, record]) => {
      const request = state.requests?.[id];
      const decision = state.decisions[id];
      if (
        !request ||
        record.status !== "pending" ||
        decision?.consumed ||
        decision?.kind === "reject_once" ||
        decision?.kind === "reject_always"
      )
        return [];
      const beforeHashes: Record<string, string | null> = {};
      for (const part of record.prompt.toolCall.content ?? [])
        if (part.type === "diff") beforeHashes[part.path] = sha256(part.oldText ?? "");
      return [
        {
          requestId: id,
          bindingHash: request.binding.bindingHash,
          scopeId: options.scopeId,
          policyVersion: request.binding.policyVersion,
          beforeHashes,
          state: decision ? ("approved" as const) : ("pending" as const),
        },
      ];
    });
  return {
    get pending() {
      return pending();
    },
    request: async (prompt) => {
      if (disposed || prompt.signal?.aborted) return CANCELLED;
      const id = prompt.toolCall.toolCallId;
      const registration = await serialize(async () => {
        if (disposed) return { decision: CANCELLED };
        const record = records[id];
        const previous = state.decisions[id];
        const status = store.status(id, inputFor(prompt));
        if (
          record?.status === "pending" &&
          previous &&
          (status === "allowed" || status === "rejected")
        ) {
          return {
            decision: { outcome: { outcome: "selected" as const, optionId: previous.optionId } },
          };
        }
        if (waiters.has(id)) return { waiter: waiters.get(id)!, show: false };
        // 已消费或失效的批准不等于这次执行许可；新的精确预览必须重新询问：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const serializablePrompt = { ...prompt };
        delete serializablePrompt.signal;
        const cleanPrompt = decode<PermissionPrompt>(encode(serializablePrompt));
        const previousRecords = records;
        records = {
          ...records,
          [id]: { prompt: cleanPrompt, policyKey: options.getPolicyKey(), status: "pending" },
        };
        try {
          await store.createRequest(inputFor(prompt), prompt.options);
        } catch (error) {
          records = previousRecords;
          throw error;
        }
        let resolve!: (decision: PermissionDecision) => void;
        const promise = new Promise<PermissionDecision>((complete) => {
          resolve = complete;
        });
        const waiter = { promise, resolve };
        waiters.set(id, waiter);
        return { waiter, show: true };
      });
      if (registration.decision) return consume(prompt, registration.decision);
      const waiter = registration.waiter;
      const livePrompt = new AbortController();
      livePrompts.add(livePrompt);
      const onAbort = () => {
        livePrompt.abort();
        if (suspended) settle(id, CANCELLED);
        else void decide(id, CANCELLED).catch(() => settle(id, CANCELLED));
      };
      prompt.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        if (prompt.signal?.aborted) onAbort();
        const decision = await Promise.race([
          waiter.promise,
          ...(registration.show && !disposed
            ? [
                options.show({ ...prompt, signal: livePrompt.signal }).then(
                  (decision) => (suspended ? waiter.promise : decision),
                  (error: unknown) => {
                    if (suspended) return waiter.promise;
                    throw error;
                  }
                ),
              ]
            : []),
        ]);
        if (suspended) return CANCELLED;
        await decide(id, decision);
        return await consume(prompt, decision);
      } catch (error) {
        if (!suspended) await decide(id, CANCELLED);
        throw error;
      } finally {
        // 持久决定可能先于临时窗口完成；只撤销窗口，不能把已批准结果再写成取消。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        livePrompt.abort();
        livePrompts.delete(livePrompt);
        prompt.signal?.removeEventListener("abort", onAbort);
      }
    },
    decide,
    cancelAll: () =>
      serialize(async () => {
        const next = { ...records };
        for (const [id, record] of Object.entries(next))
          if (record.status === "pending" && !state.decisions[id]?.consumed)
            next[id] = { ...record, status: "cancelled" };
        await save(state, next);
        for (const id of waiters.keys()) settle(id, CANCELLED);
      }),
    prepareRecovery: () =>
      serialize(async () => {
        for (const [id, record] of Object.entries(records)) {
          const decision = state.decisions[id];
          // 已消费许可和拒绝都是已发生的决定，当前文件变化或到期只能撤销尚未使用的许可，不能改写历史。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          if (
            record.status !== "pending" ||
            decision?.consumed ||
            decision?.kind === "reject_once" ||
            decision?.kind === "reject_always"
          )
            continue;
          const request = state.requests?.[id];
          if (
            !request ||
            request.binding.expiresAtMs < Date.now() ||
            record.policyKey !== options.getPolicyKey() ||
            !(await options.validate(record.prompt))
          )
            await retire(id, "stale");
        }
        const fileHashes: Record<string, string | null> = {};
        const bindingHashes: Record<string, string> = {};
        for (const approval of recoveryApprovals()) {
          Object.assign(fileHashes, approval.beforeHashes);
          bindingHashes[approval.requestId] = approval.bindingHash;
        }
        return { scopeId: options.scopeId, policyVersion: 1, fileHashes, bindingHashes };
      }),
    recoveryApprovals,
    dispose: (disposeOptions) => {
      disposed = true;
      // 暂停或退出只撤临时窗口；必须等原 SDK 关闭后结束等待，不能把待批准工作提交为取消。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (disposeOptions?.preservePending) suspended = true;
      for (const livePrompt of livePrompts) livePrompt.abort();
      if (!disposeOptions?.preservePending) for (const id of waiters.keys()) settle(id, CANCELLED);
    },
  };
}

function encode(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function decode<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
