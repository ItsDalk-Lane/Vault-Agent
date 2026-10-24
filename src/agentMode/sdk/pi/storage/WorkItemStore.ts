import type { JsonValue } from "@earendil-works/chord";
import type { Conversation, Harness } from "@earendil-works/pi-durable";
import type {
  BudgetReserveRecord,
  ReserveCommitResult,
} from "@/agentMode/sdk/pi/runtime/RunBudget";
import { DEFAULT_MODEL_ATTEMPTS } from "@/agentMode/sdk/pi/runtime/RunBudget";

export interface WorkInstructionSource {
  readonly sourceId: string;
  readonly revision: string;
  readonly kind: string;
  readonly scope?: string;
}

export interface WorkInput {
  readonly requestId: string;
  readonly text: string;
  readonly instructionSources: readonly WorkInstructionSource[];
}

export interface TaskCheckpoint {
  readonly goal: string;
  readonly userRequests?: readonly { readonly requestId: string; readonly text: string }[];
  readonly instructionSources?: readonly WorkInstructionSource[];
  readonly constraints: readonly string[];
  readonly evidenceEntryIds: readonly string[];
  readonly remainingItems: readonly string[];
  readonly nextStep: string;
  readonly reason: string;
  readonly sourceSeq: number;
  readonly savedAtMs: number;
}

export interface WorkItem {
  readonly id: string;
  readonly status:
    | "active"
    | "paused_budget"
    | "paused_storage"
    | "paused_stalled"
    | "paused_user"
    | "waiting_user";
  readonly grants: readonly {
    readonly segment: number;
    readonly requests: number;
    readonly authorizedAtMs: number;
  }[];
  readonly reservations: readonly BudgetReserveRecord[];
  readonly usage: Readonly<Record<string, { readonly usd: number | null }>>;
  readonly checkpoint: TaskCheckpoint;
}

export interface WorkItemStore {
  read(id: string): Promise<WorkItem | null>;
  ensure(
    id: string,
    goal: string,
    reservations?: readonly BudgetReserveRecord[]
  ): Promise<WorkItem>;
  recordInput(id: string, input: WorkInput): Promise<void>;
  recordInstructionSources(id: string, sources: readonly WorkInstructionSource[]): Promise<void>;
  importWorkItem(item: WorkItem): Promise<void>;
  authorizeNextSegment(id: string): Promise<WorkItem>;
  reserve(record: BudgetReserveRecord): Promise<ReserveCommitResult>;
  refund(id: string, attemptId: string): Promise<void>;
  recordUsage(id: string, attemptId: string, usd: number | null): Promise<void>;
  checkpoint(id: string, checkpoint: TaskCheckpoint, status?: WorkItem["status"]): Promise<void>;
}

export async function createWorkItemStore(input: {
  readonly harness: Harness;
  readonly conversation: Conversation;
}): Promise<WorkItemStore> {
  const [{ defineDoc }, { BACKGROUND_CONTEXT }] = await Promise.all([
    import("@earendil-works/pi-durable"),
    import("@earendil-works/chord/context"),
  ]);
  const token = defineDoc<{ items: JsonValue }>({
    kind: "va.work-items",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "initial",
    initial: () => ({ items: {} }),
  });
  const read = async (id: string): Promise<WorkItem | null> => {
    const document = await input.harness.snapshot(token, input.conversation.id, BACKGROUND_CONTEXT);
    return document
      ? ((JSON.parse(JSON.stringify(document.items)) as Record<string, WorkItem>)[id] ?? null)
      : null;
  };
  const change = async <T>(
    id: string,
    update: (item: WorkItem | undefined) => {
      item: WorkItem;
      result: T;
      reserve?: BudgetReserveRecord;
    }
  ): Promise<T> =>
    input.conversation.commit(async (tx) => {
      const document = await tx.doc(token, input.conversation.id);
      const items = JSON.parse(JSON.stringify(document.items)) as Record<string, WorkItem>;
      const next = update(items[id]);
      items[id] = next.item;
      document.items = JSON.parse(JSON.stringify(items)) as JsonValue;
      if (next.reserve)
        await tx.appendEntry(input.conversation.id, {
          kind: "va.budget",
          data: JSON.parse(JSON.stringify(next.reserve)),
        });
      return next.result;
    }, BACKGROUND_CONTEXT);
  return {
    read,
    ensure: (id, goal, reservations = []) =>
      change(id, (existing) => {
        const item: WorkItem = existing ?? {
          id,
          status: "active",
          grants: [{ segment: 1, requests: DEFAULT_MODEL_ATTEMPTS, authorizedAtMs: Date.now() }],
          reservations: [...reservations],
          usage: {},
          checkpoint: {
            goal,
            constraints: [],
            evidenceEntryIds: [],
            remainingItems: [],
            nextStep: "继续当前任务",
            reason: "accepted",
            sourceSeq: 0,
            savedAtMs: Date.now(),
          },
        };
        const updated =
          goal && !item.checkpoint.goal
            ? { ...item, checkpoint: { ...item.checkpoint, goal } }
            : item;
        return { item: updated, result: updated };
      }),
    recordInput: async (id, input) => {
      await change(id, (item) => {
        if (!item) throw new Error("无法记录不存在任务的用户请求。");
        const previous = item.checkpoint.userRequests ?? [];
        if (previous.some((request) => request.requestId === input.requestId))
          return { item, result: undefined };
        return {
          item: {
            ...item,
            checkpoint: {
              ...item.checkpoint,
              userRequests: [...previous, { requestId: input.requestId, text: input.text }],
              instructionSources: [...input.instructionSources],
            },
          },
          result: undefined,
        };
      });
    },
    recordInstructionSources: (id, sources) =>
      change(id, (item) => {
        if (!item) throw new Error("无法记录不存在任务的指令来源。");
        return {
          item: { ...item, checkpoint: { ...item.checkpoint, instructionSources: [...sources] } },
          result: undefined,
        };
      }),
    importWorkItem: (item) =>
      change(item.id, (existing) => ({ item: existing ?? item, result: undefined })),
    authorizeNextSegment: (id) =>
      change(id, (item) => {
        if (!item) throw new Error("找不到需要继续的任务。");
        const updated: WorkItem =
          item.status === "paused_budget" ||
          item.status === "paused_stalled" ||
          item.status === "paused_user" ||
          item.status === "waiting_user"
            ? {
                ...item,
                status: "active",
                grants: [
                  ...item.grants,
                  {
                    segment: item.grants.length + 1,
                    requests: DEFAULT_MODEL_ATTEMPTS,
                    authorizedAtMs: Date.now(),
                  },
                ],
              }
            : item;
        return { item: updated, result: updated };
      }),
    reserve: (record) =>
      change<ReserveCommitResult>(record.runId, (item) => {
        if (!item) throw new Error("模型请求没有持久化的任务归属。");
        if (item.reservations.some((entry) => entry.attemptId === record.attemptId))
          return { item, result: { accepted: true } };
        if (item.status !== "active")
          return {
            item,
            result: {
              accepted: false,
              code: "BUDGET_EXCEEDED" as const,
              message: "任务正在等待用户明确继续，新的请求不会执行。",
            },
          };
        if (item.reservations.length >= item.grants.reduce((sum, grant) => sum + grant.requests, 0))
          return {
            item: { ...item, status: "paused_budget" },
            result: {
              accepted: false,
              code: "BUDGET_EXCEEDED" as const,
              message: "本段请求额度已用完；任务已保存，点击继续可追加下一段额度。",
            },
          };
        return {
          item: { ...item, reservations: [...item.reservations, record] },
          result: { accepted: true },
          reserve: record,
        };
      }),
    refund: async (id, attemptId) => {
      await change(id, (item) => {
        if (!item) throw new Error("找不到需要退还预留的任务。");
        return {
          item: item.usage[attemptId]
            ? item
            : {
                ...item,
                reservations: item.reservations.filter((record) => record.attemptId !== attemptId),
              },
          result: undefined,
        };
      });
    },
    recordUsage: async (id, attemptId, usd) => {
      await change(id, (item) => {
        if (!item) throw new Error("模型用量没有持久化的任务归属。");
        return {
          item: {
            ...item,
            usage: {
              ...item.usage,
              [attemptId]:
                item.usage[attemptId]?.usd === null ? { usd } : (item.usage[attemptId] ?? { usd }),
            },
          },
          result: undefined,
        };
      });
    },
    checkpoint: async (id, checkpoint, status) => {
      await change(id, (item) => {
        if (!item) throw new Error("无法保存不存在任务的进度。");
        if (checkpoint.sourceSeq < item.checkpoint.sourceSeq) return { item, result: undefined };
        return {
          item: {
            ...item,
            checkpoint: {
              ...checkpoint,
              ...(item.checkpoint.userRequests
                ? { userRequests: item.checkpoint.userRequests }
                : {}),
              ...(item.checkpoint.instructionSources
                ? { instructionSources: item.checkpoint.instructionSources }
                : {}),
            },
            status: status ?? item.status,
          },
          result: undefined,
        };
      });
    },
  };
}
