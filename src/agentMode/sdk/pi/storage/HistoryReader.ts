// Full history is reconstructed read-only from ascending Conversation.entries pages, never
// from the active snapshot: compaction markers do not hide older messages, fork ancestors
// merge once, and a cancelled read cancels only the read:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface HistoryEntry {
  readonly id: string;
  readonly kind: string;
  readonly data?: unknown;
}

export type HistoryCursor = Readonly<Record<string, unknown>>;

export interface HistoryReadCancellation {
  readonly aborted: boolean;
}

export const NEVER_CANCELLED: HistoryReadCancellation = Object.freeze({ aborted: false });

const EMPTY_ENTRIES: readonly HistoryEntry[] = Object.freeze([]);
const EMPTY_CONVERSATIONS: readonly string[] = Object.freeze([]);
const EMPTY_ATTACHMENTS: readonly HistoryMissingAttachment[] = Object.freeze([]);

export interface HistoryEntryPage {
  readonly entries: readonly HistoryEntry[];
  readonly nextCursor: HistoryCursor | null;
}

export interface HistoryResolvedConversation {
  readonly id: string;
  entries(input: {
    readonly cursor: HistoryCursor | null;
    readonly cancellation: HistoryReadCancellation;
  }): Promise<HistoryEntryPage>;
  forkParentId(cancellation: HistoryReadCancellation): Promise<string | null>;
}

export type ResolveHistoryConversation = (
  conversationId: string
) => Promise<HistoryResolvedConversation>;

export interface HistoryAttachmentPort {
  isAvailable(path: string): Promise<boolean>;
}

export interface HistoryMissingAttachment {
  readonly entryId: string;
  readonly path: string;
}

export interface HistoryPage {
  readonly entries: readonly HistoryEntry[];
  readonly nextCursor: HistoryCursor | null;
  readonly compacted: boolean;
}

export type HistoryReadResult =
  | {
      readonly kind: "complete";
      readonly entries: readonly HistoryEntry[];
      readonly conversations: readonly string[];
      readonly compacted: boolean;
      readonly missingAttachments: readonly HistoryMissingAttachment[];
    }
  | {
      readonly kind: "cancelled";
      readonly entries: readonly HistoryEntry[];
      readonly conversations: readonly string[];
      readonly compacted: boolean;
      readonly missingAttachments: readonly HistoryMissingAttachment[];
    };

export type HistoryReaderErrorCode = "FORK_CYCLE";

export class HistoryReaderError extends Error {
  readonly code: HistoryReaderErrorCode;

  constructor(code: HistoryReaderErrorCode, message: string) {
    super(message);
    this.name = "HistoryReaderError";
    this.code = code;
  }
}

export interface HistoryReaderOptions {
  resolveConversation: ResolveHistoryConversation;
  attachments?: HistoryAttachmentPort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompactionEntry(entry: HistoryEntry): boolean {
  return entry.kind === "pi.compaction";
}

function attachmentPaths(entry: HistoryEntry): string[] {
  if (!isRecord(entry.data)) return [];
  const references = entry.data.attachments;
  if (!Array.isArray(references)) return [];
  const paths: string[] = [];
  for (const reference of references) {
    if (isRecord(reference) && typeof reference.path === "string" && reference.path.length > 0) {
      paths.push(reference.path);
    }
  }
  return paths;
}

export class HistoryReader {
  private readonly resolveConversation: ResolveHistoryConversation;
  private readonly attachments: HistoryAttachmentPort | undefined;

  constructor(options: HistoryReaderOptions) {
    this.resolveConversation = options.resolveConversation;
    this.attachments = options.attachments;
  }

  async readPage(input: {
    conversationId: string;
    cursor?: HistoryCursor | null;
    cancellation?: HistoryReadCancellation;
  }): Promise<HistoryPage> {
    const cursor = input.cursor ?? null;
    const cancellation = input.cancellation ?? NEVER_CANCELLED;
    if (cancellation.aborted) {
      return { entries: EMPTY_ENTRIES, nextCursor: cursor, compacted: false };
    }
    const conversation = await this.resolveConversation(input.conversationId);
    const page = await conversation.entries({ cursor, cancellation });
    return {
      entries: page.entries,
      nextCursor: page.nextCursor,
      compacted: page.entries.some(isCompactionEntry),
    };
  }

  async readHistory(input: {
    conversationId: string;
    cancellation?: HistoryReadCancellation;
  }): Promise<HistoryReadResult> {
    const cancellation = input.cancellation ?? NEVER_CANCELLED;
    const chain = await this.resolveChain(input.conversationId, cancellation);

    const seen = new Set<string>();
    const entries: HistoryEntry[] = [];
    let compacted = false;

    for (const conversation of chain) {
      let cursor: HistoryCursor | null = null;
      do {
        if (cancellation.aborted) {
          return this.finish("cancelled", chain, entries, compacted);
        }
        const page = await conversation.entries({ cursor, cancellation });
        for (const entry of page.entries) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          entries.push(entry);
          if (isCompactionEntry(entry)) compacted = true;
        }
        cursor = page.nextCursor;
      } while (cursor !== null);
    }

    return this.finish("complete", chain, entries, compacted);
  }

  private async resolveChain(
    conversationId: string,
    cancellation: HistoryReadCancellation
  ): Promise<HistoryResolvedConversation[]> {
    const chain: HistoryResolvedConversation[] = [];
    const visited = new Set<string>();
    let currentId: string | null = conversationId;
    while (currentId !== null) {
      if (visited.has(currentId)) {
        throw new HistoryReaderError(
          "FORK_CYCLE",
          `The fork ancestry of ${conversationId} contains a cycle at ${currentId}.`
        );
      }
      visited.add(currentId);
      const conversation = await this.resolveConversation(currentId);
      chain.unshift(conversation);
      currentId = await conversation.forkParentId(cancellation);
    }
    return chain;
  }

  private async finish(
    kind: "complete" | "cancelled",
    chain: readonly HistoryResolvedConversation[],
    entries: readonly HistoryEntry[],
    compacted: boolean
  ): Promise<HistoryReadResult> {
    return {
      kind,
      entries: entries.length === 0 ? EMPTY_ENTRIES : Object.freeze([...entries]),
      conversations:
        chain.length === 0 ? EMPTY_CONVERSATIONS : Object.freeze(chain.map((item) => item.id)),
      compacted,
      missingAttachments: await this.collectMissingAttachments(entries),
    };
  }

  private async collectMissingAttachments(
    entries: readonly HistoryEntry[]
  ): Promise<readonly HistoryMissingAttachment[]> {
    if (!this.attachments) return EMPTY_ATTACHMENTS;
    const missing: HistoryMissingAttachment[] = [];
    for (const entry of entries) {
      for (const path of attachmentPaths(entry)) {
        if (!(await this.attachments.isAvailable(path))) {
          missing.push({ entryId: entry.id, path });
        }
      }
    }
    return missing.length === 0 ? EMPTY_ATTACHMENTS : Object.freeze(missing);
  }
}
