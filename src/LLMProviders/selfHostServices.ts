import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { desktopProviderFetch } from "@/utils/desktopProviderFetch";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions";
const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search";
const PARALLEL_SEARCH_QUERY_MAX_LENGTH = 200;
const PARALLEL_OBJECTIVE_MAX_LENGTH = 5000;
const EXA_SEARCH_URL = "https://api.exa.ai/search";
export interface SelfHostWebSearchResult {
  content: string;
  citations: string[];
}

interface FirecrawlSearchResult {
  title?: string;
  description?: string;
  url?: string;
}

type SearchSnippetField = "excerpts" | "highlights";

function normalizeProviderResults(
  rawResults: unknown,
  snippetField: SearchSnippetField
): SelfHostWebSearchResult {
  if (!Array.isArray(rawResults)) {
    return { content: "", citations: [] };
  }

  const contentParts: string[] = [];
  const citations: string[] = [];

  for (const item of rawResults) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const title =
      typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Untitled";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    const snippets = Array.isArray(record[snippetField])
      ? record[snippetField].filter(
          (snippet): snippet is string => typeof snippet === "string" && snippet.trim().length > 0
        )
      : [];
    const content = [`### ${title}`, snippets.join("\n"), url ? `Source: ${url}` : ""]
      .filter(Boolean)
      .join("\n");

    contentParts.push(content);
    if (url) {
      citations.push(url);
    }
  }

  return { content: contentParts.join("\n\n"), citations };
}

export function hasSelfHostSearchKey(): boolean {
  const settings = getSettings();
  switch (settings.selfHostSearchProvider) {
    case "parallel":
      return !!settings.parallelApiKey;
    case "exa":
      return !!settings.exaApiKey;
    case "perplexity":
      return !!settings.perplexityApiKey;
    case "firecrawl":
    default:
      return !!settings.firecrawlApiKey;
  }
}

async function firecrawlSearch(
  query: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<SelfHostWebSearchResult> {
  const startTime = Date.now();

  const response = await desktopProviderFetch(FIRECRAWL_SEARCH_URL, {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit: 5 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl search failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    data?: FirecrawlSearchResult[] | { web?: FirecrawlSearchResult[] };
  };

  const rawData = json?.data;
  const results: FirecrawlSearchResult[] = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.web)
      ? rawData.web
      : [];

  const contentParts: string[] = [];
  const citations: string[] = [];

  for (const item of results) {
    const title = item.title || "Untitled";
    const description = item.description || "";
    const url = item.url || "";
    contentParts.push(`### ${title}\n${description}\nSource: ${url}`);
    if (url) {
      citations.push(url);
    }
  }

  const elapsed = Date.now() - startTime;
  logInfo(`[selfHostWebSearch] Firecrawl: ${results.length} results in ${elapsed}ms`);

  return { content: contentParts.join("\n\n"), citations };
}

async function perplexitySonarSearch(
  query: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<SelfHostWebSearchResult> {
  const response = await desktopProviderFetch(PERPLEXITY_CHAT_URL, {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Pplx-Integration": "vault-agent",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: query }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Perplexity Sonar search failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: unknown;
  };
  const content = json?.choices?.[0]?.message?.content ?? "";
  const citations: string[] = Array.isArray(json?.citations) ? (json.citations as string[]) : [];

  return { content, citations };
}

async function parallelSearch(
  query: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<SelfHostWebSearchResult> {
  // Parallel rejects requests above these per-field limits.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/285
  const response = await desktopProviderFetch(PARALLEL_SEARCH_URL, {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      objective: query.slice(0, PARALLEL_OBJECTIVE_MAX_LENGTH),
      search_queries: [query.slice(0, PARALLEL_SEARCH_QUERY_MAX_LENGTH)],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Parallel search failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as { results?: unknown };
  return normalizeProviderResults(json?.results, "excerpts");
}

async function exaSearch(
  query: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<SelfHostWebSearchResult> {
  const response = await desktopProviderFetch(EXA_SEARCH_URL, {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      numResults: 5,
      contents: { highlights: true },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Exa search failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as { results?: unknown };
  return normalizeProviderResults(json?.results, "highlights");
}

export async function selfHostWebSearch(
  query: string,
  signal?: AbortSignal
): Promise<SelfHostWebSearchResult> {
  if (!hasSelfHostSearchKey())
    throw new Error("Add an API key for the selected web search provider.");
  const settings = getSettings();
  switch (settings.selfHostSearchProvider) {
    case "parallel":
      return parallelSearch(query, settings.parallelApiKey, signal);
    case "exa":
      return exaSearch(query, settings.exaApiKey, signal);
    case "perplexity":
      return perplexitySonarSearch(query, settings.perplexityApiKey, signal);
    case "firecrawl":
    default:
      return firecrawlSearch(query, settings.firecrawlApiKey, signal);
  }
}
