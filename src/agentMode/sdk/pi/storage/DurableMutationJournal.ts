import { requireNodeModule } from "@/utils/desktopRuntime";
import type { JsonValue } from "@earendil-works/chord";
import type {
  Conversation,
  ConversationDocToken,
  Harness,
  JsonObject,
} from "@earendil-works/pi-durable";
import type {
  MutationJournal,
  MutationJournalStore,
} from "@/agentMode/sdk/pi/storage/MutationJournal";
import type {
  NativeMutationJournal,
  NativeMutationJournalStore,
} from "@/agentMode/sdk/pi/storage/NativeMutationJournal";

export interface MutationDocState extends JsonObject {
  kind: string;
  version: number;
  revision: number;
  updatedAtMs: number;
  items: JsonObject[];
  journal: JsonValue;
  nativeJournal: JsonValue;
}

let tokenPromise: Promise<ConversationDocToken<MutationDocState>> | undefined;

export function getMutationJournalDoc(): Promise<ConversationDocToken<MutationDocState>> {
  tokenPromise ??= import("@earendil-works/pi-durable").then(({ defineDoc }) =>
    defineDoc<MutationDocState>({
      kind: "va.mutations",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "initial",
      initial: () => ({
        kind: "va.mutations",
        version: 1,
        revision: 0,
        updatedAtMs: 0,
        items: [],
        journal: null,
        nativeJournal: null,
      }),
    })
  );
  return tokenPromise;
}

export async function createDurableNativeMutationJournal(input: {
  readonly harness: Harness;
  readonly conversation: Conversation;
}): Promise<NativeMutationJournalStore> {
  const [token, { BACKGROUND_CONTEXT }] = await Promise.all([
    getMutationJournalDoc(),
    import("@earendil-works/chord/context"),
  ]);
  return {
    load: async () => {
      const document = await input.harness.snapshot(
        token,
        input.conversation.id,
        BACKGROUND_CONTEXT
      );
      return document?.nativeJournal
        ? (JSON.parse(JSON.stringify(document.nativeJournal)) as NativeMutationJournal)
        : null;
    },
    save: async (journal) => {
      const value = JSON.parse(JSON.stringify(journal)) as JsonValue;
      await input.conversation.commit(async (tx) => {
        const document = await tx.doc(token, input.conversation.id);
        document.nativeJournal = value;
        document.revision += 1;
        document.updatedAtMs = Date.now();
      }, BACKGROUND_CONTEXT);
    },
  };
}

export async function createDurableMutationJournal(input: {
  readonly harness: Harness;
  readonly conversation: Conversation;
}): Promise<MutationJournalStore> {
  const [token, { BACKGROUND_CONTEXT }] = await Promise.all([
    getMutationJournalDoc(),
    import("@earendil-works/chord/context"),
  ]);
  return {
    migrateOperationIdentities: async (journal) => {
      if (journal.operationIdentityVersion === 2) {
        if (!journal.ambiguousLegacyTasks?.length) return journal;
        const pending = new Set(
          (await input.harness.inspect(BACKGROUND_CONTEXT)).tasks.map((task) =>
            String(task.record.id)
          )
        );
        const unresolved = journal.ambiguousLegacyTasks.filter((id) => pending.has(id));
        return unresolved.length === journal.ambiguousLegacyTasks.length
          ? journal
          : { ...journal, ambiguousLegacyTasks: unresolved };
      }
      const { isDeepStrictEqual } = requireNodeModule<typeof import("node:util")>("node:util");
      const legacyTaskOperations: NonNullable<MutationJournal["legacyTaskOperations"]> = {};
      const ambiguousLegacyTasks: string[] = [];
      // 迁移只能关联升级时已存在且来源唯一的SDK任务，重复供应商ID或参数不一致必须保留证据并停止，不能猜测后重做。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      for (const { record } of (await input.harness.inspect(BACKGROUND_CONTEXT)).tasks) {
        if (record.kind !== "pi.tool") continue;
        const original = recordValue(record.input);
        const nestedCall = recordValue(original?.call);
        const callId = original?.kind === "model" ? original.callId : nestedCall?.id;
        if (typeof callId !== "string") continue;
        const legacyIds = Object.keys(journal.mutations).filter(
          (id) =>
            !id.startsWith("vault-task:") && id.endsWith(`:${record.conversationId}:${callId}`)
        );
        if (!legacyIds.length) continue;
        const taskId = String(record.id);
        const checkpoint = recordValue(recordValue(record.state)?.checkpoint);
        const conversation = await input.harness.conversation(
          record.conversationId,
          BACKGROUND_CONTEXT
        );
        const calls: { assistantId: string; name: string; arguments: unknown }[] = [];
        if (conversation) {
          let cursor: import("@earendil-works/pi-durable").Cursor | undefined;
          do {
            const page = await conversation.entries(
              { order: "ascending" },
              100,
              cursor,
              BACKGROUND_CONTEXT
            );
            for (const entry of page.items)
              for (const message of entry.model ?? []) {
                if (message.role !== "assistant") continue;
                for (const block of message.content)
                  if (block.type === "toolCall" && block.id === callId)
                    calls.push({
                      assistantId: String(entry.id),
                      name: block.name,
                      arguments: block.arguments,
                    });
              }
            cursor = page.next;
          } while (cursor);
        }
        if (
          legacyIds.length === 1 &&
          original?.kind === "model" &&
          calls.length === 1 &&
          calls[0].assistantId === String(original.assistant) &&
          checkpoint?.phase === "execute" &&
          isDeepStrictEqual(checkpoint.arguments, calls[0].arguments)
        )
          legacyTaskOperations[taskId] = {
            operationId: legacyIds[0],
            toolId: calls[0].name,
            arguments: checkpoint.arguments,
          };
        else ambiguousLegacyTasks.push(taskId);
      }
      return {
        ...journal,
        operationIdentityVersion: 2,
        legacyTaskOperations,
        ambiguousLegacyTasks,
      };
    },
    load: async () => {
      const document = await input.harness.snapshot(
        token,
        input.conversation.id,
        BACKGROUND_CONTEXT
      );
      return document?.journal
        ? (JSON.parse(JSON.stringify(document.journal)) as MutationJournal)
        : null;
    },
    save: async (journal) => {
      const value = JSON.parse(JSON.stringify(journal)) as JsonValue;
      await input.conversation.commit(async (tx) => {
        const document = await tx.doc(token, input.conversation.id);
        document.journal = value;
        document.revision += 1;
        document.updatedAtMs = Date.now();
      }, BACKGROUND_CONTEXT);
    },
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
