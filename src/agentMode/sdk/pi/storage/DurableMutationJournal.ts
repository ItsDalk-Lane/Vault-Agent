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
