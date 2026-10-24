import {
  DEFAULT_TOOL_SEARCH_LIMIT,
  TOOL_SEARCH_TOOL_NAME,
  ToolSearchService,
  type DeferredToolEntry,
} from "@/agentMode/sdk/pi/tools/ToolSearch";

// tool_search loads matching deferred tools and reports only their names as UI information; it never
// appends to the answer and repeated searches stay idempotent:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeDeferredSource {
  readonly entries: DeferredToolEntry[] = [
    { internalName: "mcp_docs_search_notes", description: "Search vault notes" },
    { internalName: "mcp_docs_index_vault", description: "Index the vault" },
    { internalName: "mcp_docs_delete_note", description: "Delete a note" },
  ];
  readonly loads: string[][] = [];
  async load(names: readonly string[]): Promise<void> {
    this.loads.push([...names]);
  }
  deferredTools(): readonly DeferredToolEntry[] {
    return this.entries;
  }
}

describe("ToolSearch", () => {
  describe("ToolSearchService", () => {
    it("loads the matching deferred tools and reports only their names", async () => {
      const source = new FakeDeferredSource();
      const notified: string[][] = [];
      const service = new ToolSearchService({
        source,
        notify: (result) => notified.push([...result.loaded]),
      });

      const result = await service.search({ query: "search notes" });

      expect(result).toEqual({
        query: "search notes",
        loaded: ["mcp_docs_search_notes"],
        truncated: false,
      });
      expect(source.loads).toEqual([["mcp_docs_search_notes"]]);
      expect(notified).toEqual([["mcp_docs_search_notes"]]);
      expect(Object.keys(result).sort()).toEqual(["loaded", "query", "truncated"]);
      expect(TOOL_SEARCH_TOOL_NAME).toBe("tool_search");
    });

    it("bounds the result by the search limit and marks truncation", async () => {
      const source = new FakeDeferredSource();
      source.entries.push({ internalName: "mcp_docs_search_more", description: "Search more" });
      const service = new ToolSearchService({ source, limit: DEFAULT_TOOL_SEARCH_LIMIT });

      const result = await service.search({ query: "search", limit: 1 });

      expect(result.loaded).toHaveLength(1);
      expect(result.truncated).toBe(true);
      expect(source.loads[0]).toHaveLength(1);
    });

    it("stays idempotent for a repeated query without duplicating loaded names", async () => {
      const source = new FakeDeferredSource();
      const service = new ToolSearchService({ source });

      const first = await service.search({ query: "index" });
      const second = await service.search({ query: "index" });

      expect(first.loaded).toEqual(["mcp_docs_index_vault"]);
      expect(second.loaded).toEqual(first.loaded);
      expect(source.loads).toEqual([["mcp_docs_index_vault"], ["mcp_docs_index_vault"]]);
    });

    it("returns no matches for an unrelated query without loading anything", async () => {
      const source = new FakeDeferredSource();
      const service = new ToolSearchService({ source });

      const result = await service.search({ query: "unrelated" });

      expect(result.loaded).toEqual([]);
      expect(source.loads).toEqual([]);
    });
  });
});
