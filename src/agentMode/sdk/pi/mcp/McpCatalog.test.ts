import {
  MCP_CATALOG_TOOL_LIMIT,
  MCP_SCHEMA_MAX_BYTES,
  MCP_SCHEMA_MAX_DEPTH,
  McpCatalog,
  validateSchema,
  type McpToolListItem,
  type McpToolPage,
} from "@/agentMode/sdk/pi/mcp/McpCatalog";

// The catalog walks every page until the server ends or the 500-tool limit is hit and then says the
// catalog is incomplete; a malicious schema is disabled with a reason and never registered; and a
// tool-list change bumps the version so an approval recorded against the old schema stops working:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeToolList {
  readonly cursors: Array<string | undefined> = [];
  pages = new Map<string, McpToolPage>();

  async listToolsPage(cursor?: string): Promise<McpToolPage> {
    this.cursors.push(cursor);
    const page = this.pages.get(cursor ?? "");
    if (page === undefined) throw new Error(`no page for cursor ${cursor ?? "<first>"}`);
    return page;
  }
}

function tool(name: string, schema: unknown = { type: "object", properties: {} }): McpToolListItem {
  return { name, inputSchema: schema };
}

function pagedTools(count: number, pageSize: number): Map<string, McpToolPage> {
  const pages = new Map<string, McpToolPage>();
  let cursor = "";
  let produced = 0;
  for (;;) {
    const items: McpToolListItem[] = [];
    while (items.length < pageSize && produced < count) {
      produced += 1;
      items.push(tool(`tool-${produced}`));
    }
    const next = produced < count ? `cursor-${produced}` : null;
    pages.set(cursor, { tools: items, nextCursor: next });
    if (next === null) break;
    cursor = next;
  }
  return pages;
}

function catalogWith(client: FakeToolList, serverId = "docs") {
  return new McpCatalog({ serverId, client, now: () => 1_000 });
}

describe("McpCatalog", () => {
  describe("refresh()", () => {
    it("walks every page and reports a complete catalog when the server ends", async () => {
      const client = new FakeToolList();
      client.pages = pagedTools(300, 100);
      const catalog = catalogWith(client);

      const snapshot = await catalog.refresh();

      expect(snapshot.tools).toHaveLength(300);
      expect(snapshot.complete).toBe(true);
      expect(snapshot.limit).toBe(MCP_CATALOG_TOOL_LIMIT);
      expect(client.cursors).toEqual([undefined, "cursor-100", "cursor-200"]);
      expect(snapshot.disabled).toEqual([]);
    });

    it("stops at the 500-tool limit and reports the catalog as incomplete", async () => {
      const client = new FakeToolList();
      client.pages = pagedTools(900, 200);
      const catalog = catalogWith(client);

      const snapshot = await catalog.refresh();

      expect(snapshot.tools).toHaveLength(MCP_CATALOG_TOOL_LIMIT);
      expect(snapshot.complete).toBe(false);
      expect(client.cursors).toEqual([undefined, "cursor-200", "cursor-400"]);
    });

    it("treats exactly 500 tools with no further cursor as complete", async () => {
      const client = new FakeToolList();
      client.pages = pagedTools(500, 250);
      const catalog = catalogWith(client);

      const snapshot = await catalog.refresh();

      expect(snapshot.tools).toHaveLength(500);
      expect(snapshot.complete).toBe(true);
    });

    it("truncates a single oversized page and marks the catalog incomplete", async () => {
      const client = new FakeToolList();
      client.pages = new Map([
        [
          "",
          {
            tools: Array.from({ length: 600 }, (_, index) => tool(`tool-${index}`)),
            nextCursor: null,
          },
        ],
      ]);
      const catalog = catalogWith(client);

      const snapshot = await catalog.refresh();

      expect(snapshot.tools).toHaveLength(MCP_CATALOG_TOOL_LIMIT);
      expect(snapshot.complete).toBe(false);
    });

    it("registers long and non-Latin tool names without collisions", async () => {
      const client = new FakeToolList();
      const long = "l".repeat(150);
      client.pages = new Map([
        [
          "",
          {
            tools: [tool(`${long}-a`), tool(`${long}-b`), tool("搜索笔记"), tool("创建笔记")],
            nextCursor: null,
          },
        ],
      ]);
      const catalog = catalogWith(client);

      const snapshot = await catalog.refresh();
      const names = snapshot.tools.map((entry) => entry.internalName);

      expect(new Set(names).size).toBe(4);
      expect(catalog.resolve(names[2] ?? "")).toEqual({ serverId: "docs", toolName: "搜索笔记" });
      expect(catalog.resolve(names[0] ?? "")?.toolName).toBe(`${long}-a`);
    });

    it("disables a malicious schema with a reason and never registers it", async () => {
      const client = new FakeToolList();
      const deep = (levels: number): unknown => {
        let schema: Record<string, unknown> = { type: "string" };
        for (let index = 0; index < levels; index += 1) {
          schema = { type: "object", properties: { nested: schema } };
        }
        return schema;
      };
      client.pages = new Map([
        [
          "",
          {
            tools: [
              tool("not-object", { type: "string" }),
              tool("too-deep", deep(MCP_SCHEMA_MAX_DEPTH + 2)),
              tool("too-large", {
                type: "object",
                properties: {
                  blob: { type: "string", description: "x".repeat(MCP_SCHEMA_MAX_BYTES) },
                },
              }),
              tool("broken-required", { type: "object", properties: {}, required: ["missing"] }),
              tool("ok", { type: "object" }),
            ],
            nextCursor: null,
          },
        ],
      ]);
      const catalog = catalogWith(client);

      const snapshot = await catalog.refresh();

      expect(snapshot.tools.map((entry) => entry.toolName)).toEqual(["ok"]);
      expect(snapshot.disabled.map((entry) => [entry.toolName, entry.reason])).toEqual([
        ["not-object", "MCP_SCHEMA_INVALID"],
        ["too-deep", "MCP_SCHEMA_TOO_DEEP"],
        ["too-large", "MCP_SCHEMA_TOO_LARGE"],
        ["broken-required", "MCP_SCHEMA_INVALID"],
      ]);
      const registered = snapshot.tools[0]?.internalName ?? "";
      expect(catalog.resolve(registered)).toEqual({ serverId: "docs", toolName: "ok" });
      expect(catalog.findTool("mcp_docs_not-object_000000000000")).toBeUndefined();
    });

    it("adds empty properties and preserves the required list", async () => {
      const client = new FakeToolList();
      client.pages = new Map([
        [
          "",
          {
            tools: [
              tool("plain", { type: "object" }),
              tool("required", {
                type: "object",
                properties: { q: { type: "string" } },
                required: ["q"],
              }),
            ],
            nextCursor: null,
          },
        ],
      ]);
      const catalog = catalogWith(client);

      const snapshot = await catalog.refresh();

      expect(snapshot.tools[0]?.inputSchema).toEqual({ type: "object", properties: {} });
      expect(snapshot.tools[1]?.inputSchema).toMatchObject({ required: ["q"] });
    });
  });

  describe("isApprovalValid()", () => {
    it("invalidates an approval after a tool-list change and keeps it for an unchanged list", async () => {
      const client = new FakeToolList();
      client.pages = new Map([
        [
          "",
          {
            tools: [tool("search", { type: "object", properties: { q: { type: "string" } } })],
            nextCursor: null,
          },
        ],
      ]);
      const catalog = catalogWith(client);

      const first = await catalog.refresh();
      const internalName = first.tools[0]?.internalName ?? "";
      const approval = { version: first.version, schemaHash: first.tools[0]?.schemaHash ?? "" };
      expect(catalog.isApprovalValid(internalName, approval)).toBe(true);

      const unchanged = await catalog.refresh();
      expect(unchanged.version).toBe(first.version);
      expect(catalog.isApprovalValid(internalName, approval)).toBe(true);

      client.pages = new Map([
        [
          "",
          {
            tools: [
              tool("search", {
                type: "object",
                properties: { q: { type: "string" }, limit: { type: "number" } },
              }),
            ],
            nextCursor: null,
          },
        ],
      ]);
      const changed = await catalog.refresh();

      expect(changed.version).toBe(first.version + 1);
      expect(catalog.isApprovalValid(internalName, approval)).toBe(false);
      expect(
        catalog.isApprovalValid(internalName, {
          version: changed.version,
          schemaHash: changed.tools[0]?.schemaHash ?? "",
        })
      ).toBe(true);
      expect(catalog.isApprovalValid("mcp_missing_tool_000000000000", approval)).toBe(false);
    });
  });
});

describe("validateSchema", () => {
  it("disables unknown nested types and unresolved references instead of silently widening arguments https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
    for (const nested of [
      { type: "unicorn" },
      { type: ["string", "unicorn"] },
      { $ref: "https://example.com/schema.json" },
      { $ref: "#/$defs/Unknown" },
      { type: "array", items: { type: "unicorn" } },
      { anyOf: [{ type: "string" }, { type: "unicorn" }] },
    ]) {
      expect(
        validateSchema({ type: "object", properties: { payload: nested } }, 20, 4096)
      ).toMatchObject({ ok: false, code: "MCP_SCHEMA_INVALID" });
    }
    expect(
      validateSchema(
        {
          type: "object",
          properties: { type: { type: ["string", "null"], enum: ["unicorn", null] } },
        },
        20,
        4096
      )
    ).toMatchObject({ ok: true });
  });

  it("rejects non-object roots, non-object properties and missing required names", () => {
    expect(validateSchema({ type: "array" }, 20, 1024)).toMatchObject({
      ok: false,
      code: "MCP_SCHEMA_INVALID",
    });
    expect(validateSchema({ type: "object", properties: [] }, 20, 1024)).toMatchObject({
      ok: false,
      code: "MCP_SCHEMA_INVALID",
    });
    expect(
      validateSchema({ type: "object", properties: { a: {} }, required: ["b"] }, 20, 1024)
    ).toMatchObject({ ok: false, code: "MCP_SCHEMA_INVALID" });
    expect(validateSchema({ type: "object" }, 20, 1024)).toMatchObject({ ok: true });
  });
});
