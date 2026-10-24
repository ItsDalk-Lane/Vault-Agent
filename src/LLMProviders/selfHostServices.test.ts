import { hasSelfHostSearchKey, selfHostWebSearch } from "./selfHostServices";

const mockGetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: (): unknown => mockGetSettings(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

const mockFetch = jest.fn();
jest.mock("@/utils/desktopProviderFetch", () => ({
  desktopProviderFetch: (url: string, options?: RequestInit): unknown => mockFetch(url, options),
}));

function providerSettings(provider: string, overrides: Record<string, string> = {}) {
  return {
    selfHostSearchProvider: provider,
    firecrawlApiKey: "",
    perplexityApiKey: "",
    parallelApiKey: "",
    exaApiKey: "",
    supadataApiKey: "",
    ...overrides,
  };
}

function mockJsonResponse(json: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => json,
  });
}

function parallelRequestBody(): { objective: string; search_queries: string[] } {
  const options = mockFetch.mock.calls[0]?.[1] as RequestInit;
  if (typeof options.body !== "string") {
    throw new Error("Expected Parallel request body to be a string");
  }
  return JSON.parse(options.body) as { objective: string; search_queries: string[] };
}

describe("selfHostServices", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue(
      providerSettings("firecrawl", { firecrawlApiKey: "fc-test-key" })
    );
  });

  describe("hasSelfHostSearchKey()", () => {
    it.each([
      ["firecrawl", "firecrawlApiKey", "fc-key"],
      ["perplexity", "perplexityApiKey", "pplx-key"],
      ["parallel", "parallelApiKey", "parallel-key"],
      ["exa", "exaApiKey", "exa-key"],
    ])(
      "uses only the selected %s credential (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)",
      (provider, keyField, key) => {
        mockGetSettings.mockReturnValue(providerSettings(provider, { [keyField]: key }));

        expect(hasSelfHostSearchKey()).toBe(true);
      }
    );

    it.each([
      ["firecrawl", "perplexityApiKey", "pplx-key"],
      ["perplexity", "firecrawlApiKey", "fc-key"],
      ["parallel", "exaApiKey", "exa-key"],
      ["exa", "parallelApiKey", "parallel-key"],
    ])(
      "does not accept another provider's credential for %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)",
      (provider, otherKeyField, otherKey) => {
        mockGetSettings.mockReturnValue(providerSettings(provider, { [otherKeyField]: otherKey }));

        expect(hasSelfHostSearchKey()).toBe(false);
      }
    );

    it("defaults to the Firecrawl credential for an unknown provider", () => {
      mockGetSettings.mockReturnValue(providerSettings("unknown", { firecrawlApiKey: "fc-key" }));

      expect(hasSelfHostSearchKey()).toBe(true);
    });
  });

  describe("selfHostWebSearch()", () => {
    it.each([
      ["firecrawl", "firecrawlApiKey"],
      ["perplexity", "perplexityApiKey"],
      ["parallel", "parallelApiKey"],
      ["exa", "exaApiKey"],
    ])(
      "passes cancellation to the actual %s provider request https://github.com/ItsDalk-Lane/Vault-Agent/issues/2",
      async (provider, field) => {
        mockGetSettings.mockReturnValue(providerSettings(provider, { [field]: "fixture-key" }));
        mockJsonResponse({});
        const controller = new AbortController();
        await selfHostWebSearch("topic", controller.signal);
        expect((mockFetch.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
      }
    );
    it("reports a missing selected credential before making a network request https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      mockGetSettings.mockReturnValue(providerSettings("firecrawl"));
      await expect(selfHostWebSearch("topic")).rejects.toThrow("API key");
      expect(mockFetch).not.toHaveBeenCalled();
    });
    describe("Firecrawl", () => {
      beforeEach(() => {
        mockGetSettings.mockReturnValue(
          providerSettings("firecrawl", { firecrawlApiKey: "fc-test-key" })
        );
      });

      it("parses the v2 data.web format", async () => {
        mockJsonResponse({
          data: {
            web: [
              { title: "Result 1", description: "Desc 1", url: "https://example.com/1" },
              { title: "Result 2", description: "Desc 2", url: "https://example.com/2" },
            ],
          },
        });

        const result = await selfHostWebSearch("test query");

        expect(result.citations).toEqual(["https://example.com/1", "https://example.com/2"]);
        expect(result.content).toContain("### Result 1");
        expect(result.content).toContain("### Result 2");
      });

      it("falls back to the older flat data array", async () => {
        mockJsonResponse({
          data: [{ title: "Old", description: "Old desc", url: "https://old.com" }],
        });

        const result = await selfHostWebSearch("test query");

        expect(result.citations).toEqual(["https://old.com"]);
        expect(result.content).toContain("### Old");
      });

      it("returns empty results for malformed data", async () => {
        mockJsonResponse({ data: "not an array or object" });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("returns empty results for an empty result array", async () => {
        mockJsonResponse({ data: { web: [] } });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("includes the status and body in HTTP errors", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => "Unauthorized",
        });

        await expect(selfHostWebSearch("test query")).rejects.toThrow(
          "Firecrawl search failed (401): Unauthorized"
        );
      });

      it("sends the expected request", async () => {
        mockJsonResponse({ data: { web: [] } });

        await selfHostWebSearch("my query");

        expect(mockFetch).toHaveBeenCalledWith("https://api.firecrawl.dev/v2/search", {
          method: "POST",
          headers: {
            Authorization: "Bearer fc-test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: "my query", limit: 5 }),
        });
      });
    });

    describe("Perplexity Sonar", () => {
      beforeEach(() => {
        mockGetSettings.mockReturnValue(
          providerSettings("perplexity", { perplexityApiKey: "pplx-test-key" })
        );
      });

      it("parses the answer and citations", async () => {
        mockJsonResponse({
          choices: [{ message: { content: "Here is the answer about AI." } }],
          citations: ["https://source1.com", "https://source2.com"],
        });

        await expect(selfHostWebSearch("what is AI")).resolves.toEqual({
          content: "Here is the answer about AI.",
          citations: ["https://source1.com", "https://source2.com"],
        });
      });

      it("handles missing citations", async () => {
        mockJsonResponse({ choices: [{ message: { content: "Some answer" } }] });

        await expect(selfHostWebSearch("test")).resolves.toEqual({
          content: "Some answer",
          citations: [],
        });
      });

      it("handles an empty choices array", async () => {
        mockJsonResponse({ choices: [], citations: ["https://cite.com"] });

        await expect(selfHostWebSearch("test")).resolves.toEqual({
          content: "",
          citations: ["https://cite.com"],
        });
      });

      it("includes the status and body in HTTP errors", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "Rate limited",
        });

        await expect(selfHostWebSearch("test")).rejects.toThrow(
          "Perplexity Sonar search failed (429): Rate limited"
        );
      });

      it("sends the expected request", async () => {
        mockJsonResponse({ choices: [{ message: { content: "" } }], citations: [] });

        await selfHostWebSearch("my query");

        expect(mockFetch).toHaveBeenCalledWith("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer pplx-test-key",
            "Content-Type": "application/json",
            "X-Pplx-Integration": "vault-agent",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: "my query" }],
          }),
        });
      });
    });

    describe("Parallel", () => {
      beforeEach(() => {
        mockGetSettings.mockReturnValue(
          providerSettings("parallel", { parallelApiKey: "parallel-test-key" })
        );
      });

      it("normalizes excerpts and only nonempty URLs as citations (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({
          results: [
            null,
            {
              title: "Parallel result",
              url: "https://parallel.example/result",
              excerpts: ["First excerpt", "Second excerpt"],
            },
            { title: "No URL", url: "  ", excerpts: ["Still useful"] },
          ],
        });

        const result = await selfHostWebSearch("test query");

        expect(result.content).toContain("### Parallel result\nFirst excerpt\nSecond excerpt");
        expect(result.content).toContain("### No URL\nStill useful");
        expect(result.citations).toEqual(["https://parallel.example/result"]);
      });

      it("returns empty results for a malformed result collection (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: "not-an-array" });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("returns empty results for an empty result array (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: [] });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("includes the status and body in provider errors (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 422,
          text: async () => "Invalid query",
        });

        await expect(selfHostWebSearch("test query")).rejects.toThrow(
          "Parallel search failed (422): Invalid query"
        );
      });

      it("sends the GA request with only the Parallel credential (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: [] });

        await selfHostWebSearch("my query");

        expect(mockFetch).toHaveBeenCalledWith("https://api.parallel.ai/v1/search", {
          method: "POST",
          headers: {
            "x-api-key": "parallel-test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ objective: "my query", search_queries: ["my query"] }),
        });
      });

      it("keeps a 200-character search query unchanged (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        const query = "q".repeat(200);
        mockJsonResponse({ results: [] });

        await selfHostWebSearch(query);

        expect(parallelRequestBody().search_queries).toEqual([query]);
      });

      it("truncates a 201-character search query to 200 characters (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        const query = "q".repeat(201);
        mockJsonResponse({ results: [] });

        await selfHostWebSearch(query);

        expect(parallelRequestBody().search_queries).toEqual(["q".repeat(200)]);
      });

      it("keeps a 5000-character objective unchanged (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        const query = "q".repeat(5000);
        mockJsonResponse({ results: [] });

        await selfHostWebSearch(query);

        expect(parallelRequestBody().objective).toBe(query);
      });

      it("truncates a 5001-character objective to 5000 characters (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        const query = "q".repeat(5001);
        mockJsonResponse({ results: [] });

        await selfHostWebSearch(query);

        expect(parallelRequestBody().objective).toBe("q".repeat(5000));
      });
    });

    describe("Exa", () => {
      beforeEach(() => {
        mockGetSettings.mockReturnValue(providerSettings("exa", { exaApiKey: "exa-test-key" }));
      });

      it("normalizes highlights and only nonempty URLs as citations (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({
          results: [
            42,
            {
              title: "Exa result",
              url: "https://exa.example/result",
              highlights: ["First highlight", "Second highlight"],
            },
            { title: "No URL", highlights: ["Still useful"] },
          ],
        });

        const result = await selfHostWebSearch("test query");

        expect(result.content).toContain("### Exa result\nFirst highlight\nSecond highlight");
        expect(result.content).toContain("### No URL\nStill useful");
        expect(result.citations).toEqual(["https://exa.example/result"]);
      });

      it("returns empty results for a malformed result collection (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: { title: "not an array" } });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("returns empty results for an empty result array (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: [] });

        await expect(selfHostWebSearch("test query")).resolves.toEqual({
          content: "",
          citations: [],
        });
      });

      it("includes the status and body in provider errors (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => "Invalid API key",
        });

        await expect(selfHostWebSearch("test query")).rejects.toThrow(
          "Exa search failed (401): Invalid API key"
        );
      });

      it("sends the search request with only the Exa credential (https://github.com/Brevilabs/obsidian-copilot-private/issues/285)", async () => {
        mockJsonResponse({ results: [] });

        await selfHostWebSearch("my query");

        expect(mockFetch).toHaveBeenCalledWith("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "x-api-key": "exa-test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: "my query",
            numResults: 5,
            contents: { highlights: true },
          }),
        });
      });
    });

    it("defaults to Firecrawl for an unknown provider", async () => {
      mockGetSettings.mockReturnValue(
        providerSettings("unknown-provider", { firecrawlApiKey: "fc-key" })
      );
      mockJsonResponse({ data: { web: [] } });

      await selfHostWebSearch("test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.firecrawl.dev/v2/search",
        expect.any(Object)
      );
    });
  });
});
