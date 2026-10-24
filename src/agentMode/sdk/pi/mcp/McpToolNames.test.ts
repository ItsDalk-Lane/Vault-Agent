import {
  MCP_TOOL_HASH_LENGTH,
  MCP_TOOL_NAME_MAX_LENGTH,
  McpToolNameRegistry,
  mcpToolName,
  mcpToolSlug,
} from "@/agentMode/sdk/pi/mcp/McpToolNames";

// Model-facing tool names stay ASCII and at most 64 characters, and the hash over the full serverId
// plus original toolName keeps long, punctuated and non-Latin names distinct, so resolving an
// internal name always returns the exact original tool:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
describe("McpToolNames", () => {
  describe("mcpToolName()", () => {
    it("builds an ASCII name within 64 characters with a 12-character hash", () => {
      const name = mcpToolName("docs-server", "search_notes");

      expect(name).toBe(`mcp_docs-server_search-notes_${name.slice(-MCP_TOOL_HASH_LENGTH)}`);
      expect(name.length).toBeLessThanOrEqual(MCP_TOOL_NAME_MAX_LENGTH);
      expect(/^[\x20-\x7e]+$/.test(name)).toBe(true);
      expect(name.endsWith(`_${name.slice(-MCP_TOOL_HASH_LENGTH)}`)).toBe(true);
    });

    it("truncates long names while keeping distinct hashes", () => {
      const long = "a".repeat(200);
      const first = mcpToolName("server", `${long}-one`);
      const second = mcpToolName("server", `${long}-two`);

      expect(first.length).toBeLessThanOrEqual(MCP_TOOL_NAME_MAX_LENGTH);
      expect(second.length).toBeLessThanOrEqual(MCP_TOOL_NAME_MAX_LENGTH);
      expect(first).not.toBe(second);
    });

    it("keeps non-Latin names distinct through the hash and a fallback slug", () => {
      const first = mcpToolName("服务器", "搜索笔记");
      const second = mcpToolName("服务器", "创建笔记");

      expect(first).toMatch(/^mcp_server_tool_[0-9a-f]{12}$/);
      expect(second).toMatch(/^mcp_server_tool_[0-9a-f]{12}$/);
      expect(first).not.toBe(second);
      expect(first.length).toBeLessThanOrEqual(MCP_TOOL_NAME_MAX_LENGTH);
    });
  });

  describe("mcpToolSlug()", () => {
    it("normalizes punctuation and falls back when nothing is left", () => {
      expect(mcpToolSlug("My Tool!!", "tool")).toBe("my-tool");
      expect(mcpToolSlug("---", "tool")).toBe("tool");
      expect(mcpToolSlug("搜索", "tool")).toBe("tool");
    });
  });

  describe("McpToolNameRegistry", () => {
    it("registers names deterministically and resolves them back to the original tool", () => {
      const registry = new McpToolNameRegistry();

      const first = registry.register("docs-server", "a b");
      const second = registry.register("docs-server", "a-b");
      const repeated = registry.register("docs-server", "a b");

      expect(first).not.toBe(second);
      expect(repeated).toBe(first);
      expect(registry.resolve(first)).toEqual({ serverId: "docs-server", toolName: "a b" });
      expect(registry.resolve(second)).toEqual({ serverId: "docs-server", toolName: "a-b" });
      expect(registry.resolve("mcp_unknown_unknown_000000000000")).toBeUndefined();
      expect(registry.size).toBe(2);
    });

    it("keeps long and non-Latin names collision-free and resolvable", () => {
      const registry = new McpToolNameRegistry();
      const long = "x".repeat(120);
      const names = [
        registry.register("s", `${long}1`),
        registry.register("s", `${long}2`),
        registry.register("服务器", "搜索笔记"),
        registry.register("服务器", "创建笔记"),
      ];

      expect(new Set(names).size).toBe(4);
      for (const name of names) {
        expect(name.length).toBeLessThanOrEqual(MCP_TOOL_NAME_MAX_LENGTH);
      }
      expect(registry.resolve(names[2] ?? "")).toEqual({
        serverId: "服务器",
        toolName: "搜索笔记",
      });
    });
  });
});
