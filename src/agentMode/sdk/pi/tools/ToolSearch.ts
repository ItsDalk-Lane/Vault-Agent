// tool_search is the public Durable tool-search surface: the model searches deferred tools it is not
// offered yet and the matches are loaded into the session's modelTools. The host-side service here
// mirrors that contract for the exposure controller and the UI: it returns only the loaded names as
// information (loading is never a permission), it never appends anything to the answer, and repeated
// searches stay idempotent:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const TOOL_SEARCH_TOOL_NAME = "tool_search";
export const DEFAULT_TOOL_SEARCH_LIMIT = 8;

export interface DeferredToolEntry {
  readonly internalName: string;
  readonly description?: string;
}

export interface DeferredToolSourcePort {
  deferredTools(): readonly DeferredToolEntry[];
  load(names: readonly string[]): Promise<void>;
}

export interface ToolSearchResult {
  readonly query: string;
  readonly loaded: readonly string[];
  readonly truncated: boolean;
}

export interface ToolSearchServiceOptions {
  readonly source: DeferredToolSourcePort;
  readonly limit?: number;
  readonly notify?: (result: ToolSearchResult) => void;
}

export class ToolSearchService {
  readonly #source: DeferredToolSourcePort;
  readonly #limit: number;
  readonly #notify: ((result: ToolSearchResult) => void) | undefined;

  constructor(options: ToolSearchServiceOptions) {
    this.#source = options.source;
    this.#limit = options.limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
    this.#notify = options.notify;
  }

  async search(input: {
    readonly query: string;
    readonly limit?: number;
  }): Promise<ToolSearchResult> {
    const limit = Math.max(1, Math.min(input.limit ?? this.#limit, this.#limit));
    const terms = tokenize(input.query);
    const matches: string[] = [];
    for (const entry of this.#source.deferredTools()) {
      if (matches.length >= limit) break;
      if (matchesEntry(entry, terms)) matches.push(entry.internalName);
    }
    if (matches.length > 0) {
      await this.#source.load(Object.freeze([...matches]));
    }
    const result: ToolSearchResult = Object.freeze({
      query: input.query,
      loaded: Object.freeze([...new Set(matches)]),
      truncated: matches.length >= limit && this.#source.deferredTools().length > matches.length,
    });
    this.#notify?.(result);
    return result;
  }
}

export async function loadPiToolSearchExtension(): Promise<{
  readonly name: string;
  readonly extension: unknown;
}> {
  const sdk = await import("@earendil-works/pi-durable/tool-search");
  return { name: sdk.TOOL_SEARCH_TOOL_NAME, extension: sdk.createToolSearchExtension() };
}

function tokenize(query: string): readonly string[] {
  return Object.freeze(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 0)
  );
}

function matchesEntry(entry: DeferredToolEntry, terms: readonly string[]): boolean {
  if (terms.length === 0) return false;
  const haystack = `${entry.internalName} ${entry.description ?? ""}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}
