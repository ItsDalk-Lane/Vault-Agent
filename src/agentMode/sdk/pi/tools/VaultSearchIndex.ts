// Search is layered and local: title/tag candidates come from metadata, body text is read on demand
// in abort-aware order, results are sorted deterministically with a cursor, Vault file events
// invalidate the index, and config/session-private directories are never searched:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type VaultSearchHitKind = "title" | "tag" | "body";

export interface VaultSearchHit {
  readonly path: string;
  readonly kind: VaultSearchHitKind;
  readonly score: number;
  readonly snippet: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface VaultSearchResult {
  readonly hits: readonly VaultSearchHit[];
  readonly total: number;
  readonly truncated: boolean;
  readonly nextCursor?: string;
  readonly cancelled: boolean;
}

export interface SearchVaultAdapter {
  listMarkdownFiles(): Promise<readonly string[]>;
  read(path: string): Promise<string>;
}

export interface SearchMetadata {
  titleOf?(path: string): string | undefined;
  tagsOf?(path: string): readonly string[];
}

export type VaultSearchFileEventType = "create" | "modify" | "delete" | "rename";

export interface VaultSearchFileEvent {
  readonly type: VaultSearchFileEventType;
  readonly path: string;
  readonly oldPath?: string;
}

export interface SearchEventSource {
  subscribe(listener: (event: VaultSearchFileEvent) => void): () => void;
}

export interface VaultSearchIndexOptions {
  readonly vault: SearchVaultAdapter;
  readonly metadata?: SearchMetadata;
  readonly events?: SearchEventSource;
  readonly configDir?: string;
  readonly excludedPrefixes?: readonly string[];
  readonly defaultLimit?: number;
  readonly maxLimit?: number;
}

export interface VaultSearchOptions {
  readonly folder?: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
  readonly isPathAllowed?: (relativePath: string) => boolean;
}

const DEFAULT_EXCLUDED_PREFIXES: readonly string[] = Object.freeze([".vault-agent/", ".trash/"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface IndexedDocument {
  readonly path: string;
  readonly title: string | undefined;
  readonly tags: readonly string[];
}

export class VaultSearchIndex {
  private readonly vault: SearchVaultAdapter;
  private readonly metadata: SearchMetadata | undefined;
  private readonly excludedPrefixes: readonly string[];
  private readonly defaultLimit: number;
  private readonly maxLimit: number;
  private readonly unsubscribe: (() => void) | undefined;
  private documents: readonly IndexedDocument[] | null = null;

  constructor(options: VaultSearchIndexOptions) {
    this.vault = options.vault;
    this.metadata = options.metadata;
    this.excludedPrefixes = [
      ...(options.excludedPrefixes ?? DEFAULT_EXCLUDED_PREFIXES),
      ...(options.configDir !== undefined ? [`${options.configDir}/`] : []),
    ];
    this.defaultLimit = options.defaultLimit ?? DEFAULT_LIMIT;
    this.maxLimit = options.maxLimit ?? MAX_LIMIT;
    this.unsubscribe = options.events?.subscribe(() => {
      this.documents = null;
    });
  }

  dispose(): void {
    this.unsubscribe?.();
  }

  async search(query: string, options: VaultSearchOptions = {}): Promise<VaultSearchResult> {
    const limit = options.limit ?? this.defaultLimit;
    const offset = parseCursor(options.cursor);
    if (query.trim().length === 0 || offset === null || limit < 1 || limit > this.maxLimit) {
      return { hits: [], total: 0, truncated: false, cancelled: false };
    }
    const documents = await this.ensureDocuments();
    const queryLower = query.toLocaleLowerCase();
    const hits: VaultSearchHit[] = [];
    const bodyCandidates: IndexedDocument[] = [];
    for (const document of documents) {
      if (options.folder !== undefined && !document.path.startsWith(`${options.folder}/`)) continue;
      if (options.isPathAllowed !== undefined && !options.isPathAllowed(document.path)) continue;
      const title = document.title ?? "";
      if (title.toLocaleLowerCase().includes(queryLower)) {
        hits.push(titleHit(document, title));
        continue;
      }
      const tag = document.tags.find((candidate) =>
        candidate.toLocaleLowerCase().includes(queryLower)
      );
      if (tag !== undefined) {
        hits.push(tagHit(document, tag));
        continue;
      }
      bodyCandidates.push(document);
    }
    for (const document of bodyCandidates) {
      if (isAborted(options.signal)) return cancelled(hits, options);
      let content: string;
      try {
        content = await this.vault.read(document.path);
      } catch {
        continue;
      }
      if (isAborted(options.signal)) return cancelled(hits, options);
      const bodyHit = findBodyHit(document, content, query, queryLower);
      if (bodyHit !== undefined) hits.push(bodyHit);
    }
    hits.sort(compareHits);
    const page = hits.slice(offset, offset + limit);
    const truncated = offset + page.length < hits.length;
    return {
      hits: Object.freeze(page),
      total: hits.length,
      truncated,
      ...(truncated ? { nextCursor: String(offset + page.length) } : {}),
      cancelled: false,
    };
  }

  private async ensureDocuments(): Promise<readonly IndexedDocument[]> {
    if (this.documents !== null) return this.documents;
    const paths = await this.vault.listMarkdownFiles();
    const documents: IndexedDocument[] = [];
    for (const path of paths) {
      if (this.isExcluded(path)) continue;
      documents.push({
        path,
        title: this.metadata?.titleOf?.(path),
        tags: this.metadata?.tagsOf?.(path) ?? [],
      });
    }
    documents.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    this.documents = Object.freeze(documents);
    return this.documents;
  }

  private isExcluded(path: string): boolean {
    return this.excludedPrefixes.some((prefix) => path.startsWith(prefix));
  }
}

function titleHit(document: IndexedDocument, title: string): VaultSearchHit {
  return {
    path: document.path,
    kind: "title",
    score: 100,
    snippet: title,
    startLine: 1,
    endLine: 1,
  };
}

function tagHit(document: IndexedDocument, tag: string): VaultSearchHit {
  return {
    path: document.path,
    kind: "tag",
    score: 50,
    snippet: tag,
    startLine: 1,
    endLine: 1,
  };
}

function findBodyHit(
  document: IndexedDocument,
  content: string,
  query: string,
  queryLower: string
): VaultSearchHit | undefined {
  const lines = content.split("\n");
  let occurrences = 0;
  let matchLine = -1;
  let matchText = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineLower = line.toLocaleLowerCase();
    let cursor = 0;
    while (true) {
      const found = lineLower.indexOf(queryLower, cursor);
      if (found === -1) break;
      occurrences += 1;
      if (matchLine === -1) {
        matchLine = index;
        matchText = line.trim();
      }
      cursor = found + Math.max(1, queryLower.length);
    }
  }
  if (matchLine === -1) return undefined;
  return {
    path: document.path,
    kind: "body",
    score: 10 + occurrences,
    snippet: matchText.length > 200 ? matchText.slice(0, 200) : matchText,
    startLine: matchLine + 1,
    endLine: matchLine + 1,
  };
}

function compareHits(left: VaultSearchHit, right: VaultSearchHit): number {
  if (left.score !== right.score) return right.score - left.score;
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function parseCursor(cursor: string | undefined): number | null {
  if (cursor === undefined) return 0;
  if (!/^\d+$/.test(cursor)) return null;
  return Number.parseInt(cursor, 10);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function cancelled(
  hits: readonly VaultSearchHit[],
  options: VaultSearchOptions
): VaultSearchResult {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const page = hits.slice(0, limit);
  return { hits: Object.freeze(page), total: page.length, truncated: false, cancelled: true };
}
