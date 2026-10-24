import {
  durableToolCallId,
  namespacedToolCallId,
  toolDisplayMetadataFor,
  toolKindFor,
  vendorToolNameFor,
} from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";

// Tool cards show native tools through a fixed alias/kind table, while MCP tools keep their raw
// name and server attribution so a tool called "Agent" is never rendered as a subagent:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
describe("ToolDisplayMetadata", () => {
  describe("durableToolCallId()", () => {
    it("uses real task identity across reused provider ids and preserves historical fallback without namespace collisions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(durableToolCallId("root", 10, "call_0")).not.toBe(
        durableToolCallId("root", 11, "call_0")
      );
      expect(durableToolCallId("root", undefined, "call_0")).toBe(
        namespacedToolCallId("root", "call_0")
      );
      expect(durableToolCallId("root", 10, "ignored")).not.toBe(
        namespacedToolCallId("root", "task:10")
      );
    });
  });

  describe("toolDisplayMetadataFor()", () => {
    it.each([
      ["read", "Read", "read"],
      ["web_search", "WebSearch", "fetch"],
      ["write", "Write", "edit"],
      ["edit", "Edit", "edit"],
      ["bash", "Bash", "execute"],
      ["powershell", "Bash", "execute"],
    ] as const)(
      "maps the native tool %s to its fixed display alias (%s) and kind (%s)",
      (toolName, vendorToolName, toolKind) => {
        expect(toolDisplayMetadataFor(toolName)).toEqual({
          title: toolName,
          vendorToolName,
          toolKind,
        });
      }
    );

    it("keeps an unknown tool name and marks it as other", () => {
      expect(toolDisplayMetadataFor("TodoWrite")).toEqual({
        title: "TodoWrite",
        vendorToolName: "TodoWrite",
        toolKind: "other",
      });
    });

    it("keeps an MCP tool's raw name and server even when the name shadows a native alias", () => {
      expect(toolDisplayMetadataFor("read", { mcpServer: "vault-mcp" })).toEqual({
        title: "read",
        vendorToolName: "read",
        toolKind: "other",
        mcpServer: "vault-mcp",
      });
      expect(toolDisplayMetadataFor("Agent", { mcpServer: "vault-mcp" })).toMatchObject({
        vendorToolName: "Agent",
        mcpServer: "vault-mcp",
        toolKind: "other",
      });
    });

    it("does not attribute a native tool to an MCP server", () => {
      expect(toolDisplayMetadataFor("bash").mcpServer).toBeUndefined();
    });
  });

  describe("toolKindFor()", () => {
    it.each([
      ["delete", "delete"],
      ["move", "move"],
      ["search", "search"],
      ["grep", "search"],
      ["fetch", "fetch"],
      ["web_search", "fetch"],
      ["BASH", "execute"],
      ["unknown-tool", "other"],
    ] as const)("maps %s to the %s card kind", (toolName, expected) => {
      expect(toolKindFor(toolName)).toBe(expected);
    });
  });

  describe("vendorToolNameFor()", () => {
    it("routes real delegate and background tools to the subagent card https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(vendorToolNameFor("delegate_task")).toBe("Agent");
      expect(vendorToolNameFor("start_background_task")).toBe("Agent");
      expect(toolDisplayMetadataFor("delegate_task", { mcpServer: "server" }).vendorToolName).toBe(
        "delegate_task"
      );
    });

    it("returns the raw name for tools that have no fixed alias", () => {
      expect(vendorToolNameFor("mcp__vault__search")).toBe("mcp__vault__search");
    });
  });

  describe("namespacedToolCallId()", () => {
    it("scopes a provider call id to its session", () => {
      expect(namespacedToolCallId("session-a", "call-1")).toBe("pi:session-a:call-1");
    });
  });
});
