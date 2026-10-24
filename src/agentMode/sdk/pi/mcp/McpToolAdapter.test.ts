import { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import type { CallToolResult, LlmContent } from "@earendil-works/pi-mcp";
import {
  MCP_MAX_IMAGE_BYTES,
  McpToolAdapter,
  buildMcpToolManifest,
  mcpToolRiskFor,
  type McpGatewayDecision,
  type McpProgressNotification,
  type McpToolCallClient,
  type McpToolGatewayPort,
} from "@/agentMode/sdk/pi/mcp/McpToolAdapter";
import {
  McpCatalog,
  type McpToolListItem,
  type McpToolPage,
} from "@/agentMode/sdk/pi/mcp/McpCatalog";
import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";
import { AuditLog, type AuditRecord } from "@/agentMode/sdk/pi/policy/AuditLog";

// A server isError stays an error, the real abort signal reaches client.callTool, images and binary
// results are bounded with an explicit placeholder, unknown effects are never auto-allowed, progress
// becomes a tool_execution_update, and only redacted structuredContent is kept in details:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeToolList {
  items: McpToolListItem[] = [
    {
      name: "search",
      description: "Search notes",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    },
    { name: "broken", inputSchema: { type: "string" } },
  ];
  async listToolsPage(): Promise<McpToolPage> {
    return { tools: this.items, nextCursor: null };
  }
}

class FakeClient implements McpToolCallClient {
  readonly calls: Array<{
    name: string;
    args: Record<string, unknown> | undefined;
    signal: AbortSignal | undefined;
    onProgress: ((progress: McpProgressNotification) => void) | undefined;
  }> = [];
  result: CallToolResult = { content: [{ type: "text", text: "ok" }] };
  error: Error | null = null;
  onCall: ((onProgress: ((progress: McpProgressNotification) => void) | undefined) => void) | null =
    null;

  async callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    options: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (progress: McpProgressNotification) => void;
    }
  ): Promise<CallToolResult> {
    this.calls.push({ name, args, signal: options.signal, onProgress: options.onProgress });
    this.onCall?.(options.onProgress);
    if (this.error !== null) throw this.error;
    return this.result;
  }
}

class FakeGateway implements McpToolGatewayPort {
  readonly order: string[] = [];
  decision: McpGatewayDecision = { allowed: true };
  readonly inputs: Array<{ toolName: string; unknownEffects: boolean }> = [];

  async authorize(input: {
    manifest: { toolId: string };
    serverId: string;
    toolName: string;
    caller: string;
    unknownEffects: boolean;
  }): Promise<McpGatewayDecision> {
    this.order.push("gateway");
    this.inputs.push({ toolName: input.toolName, unknownEffects: input.unknownEffects });
    return this.decision;
  }
}

interface Harness {
  readonly adapter: McpToolAdapter;
  readonly client: FakeClient;
  readonly gateway: FakeGateway;
  readonly updates: Array<{
    toolCallId: string;
    progress: number;
    total?: number;
    message?: string;
  }>;
  readonly mapperCalls: Array<Pick<CallToolResult, "content" | "structuredContent">>;
}

async function harness(
  options: {
    supportsImages?: boolean;
    riskFor?: (tool: { internalName: string; toolName: string }) => {
      effects: readonly ["network"];
      unknownEffects: boolean;
    };
    gateway?: McpToolGatewayPort;
    omitGateway?: boolean;
    audit?: Pick<AuditLog, "record">;
    capabilities?: CapabilityCatalog;
    checkAvailability?: () => { available: boolean; reason?: string };
    effects?: import("./McpEffectGuard").McpEffectGuard;
  } = {}
): Promise<Harness> {
  const catalog = new McpCatalog({
    serverId: "docs",
    client: new FakeToolList(),
    now: () => 1_000,
  });
  await catalog.refresh();
  const client = new FakeClient();
  const gateway = new FakeGateway();
  const updates: Harness["updates"] = [];
  const mapperCalls: Harness["mapperCalls"] = [];
  const adapter = new McpToolAdapter({
    audit: options.audit,
    effects: options.effects,
    capabilities: options.capabilities,
    checkAvailability: options.checkAvailability,
    serverId: "docs",
    catalog,
    client,
    ...(options.omitGateway === true ? {} : { gateway: options.gateway ?? gateway }),
    redactor: new Redactor({ secretValues: ["sk-live-secret"] }),
    supportsImages: options.supportsImages === true,
    ...(options.riskFor !== undefined ? { riskFor: options.riskFor } : {}),
    contentMapper: (result) => {
      mapperCalls.push(result);
      const mapped: LlmContent[] = [];
      for (const block of result.content) {
        if (block.type === "text") mapped.push({ type: "text", text: block.text });
        else if (block.type === "image") {
          mapped.push({ type: "image", data: block.data, mimeType: block.mimeType });
        } else mapped.push({ type: "text", text: "mapped placeholder" });
      }
      return mapped;
    },
    onExecutionUpdate: (update) => {
      updates.push(update);
    },
  });
  return { adapter, client, gateway, updates, mapperCalls };
}

function internalName(adapter: McpToolAdapter, toolName: string): string {
  const tool = adapter.registrations().find((registration) => registration.name.includes(toolName));
  if (tool === undefined) throw new Error(`no registration for ${toolName}`);
  return tool.name;
}

function imageResult(bytes: number, count = 1): CallToolResult {
  const data = "A".repeat(Math.ceil((bytes * 4) / 3));
  return {
    content: Array.from({ length: count }, () => ({
      type: "image" as const,
      data,
      mimeType: "image/png",
    })),
  };
}

describe("McpToolAdapter", () => {
  describe("registrations()", () => {
    it("derives external capabilities from host risk metadata and withdraws disconnected tools without trusting server names https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const capabilities = new CapabilityCatalog();
      let connected = true;
      const fixture = await harness({
        capabilities,
        checkAvailability: () => ({ available: connected, reason: "Service is disconnected" }),
      });
      const name = internalName(fixture.adapter, "search");
      expect(capabilities.filter(name, { caller: "root", mode: "default" })).toBe(true);
      expect(capabilities.filter(name, { caller: "fanout", mode: "plan" })).toBe(false);
      connected = false;
      expect(capabilities.evaluate(name, { caller: "root", mode: "default" })).toEqual({
        available: false,
        reason: "Service is disconnected",
      });
      expect(fixture.client.calls).toHaveLength(0);
    });
    it("maps catalog tools into unsafe Durable registrations and skips disabled ones", async () => {
      const harnessed = await harness();
      const registrations = harnessed.adapter.registrations();

      expect(registrations).toHaveLength(1);
      expect(registrations[0]).toMatchObject({
        name: internalName(harnessed.adapter, "search"),
        description: "Search notes",
        replay: "unsafe",
        parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      });
      expect(typeof registrations[0]?.execute).toBe("function");
      expect(harnessed.adapter.registrations()[0]?.name).toBe(registrations[0]?.name);
    });
  });

  describe("executeTool()", () => {
    it("executes the exact nested arguments approved by the user even when the original payload changes during review https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const args = { q: "notes", payload: { text: "approved" } };
      let approvedArgs: unknown;
      const fixture = await harness({
        gateway: {
          authorize: async (input) => {
            approvedArgs = input.args;
            args.payload.text = "changed";
            return { allowed: true };
          },
        },
      });
      const result = await fixture.adapter.executeTool(
        internalName(fixture.adapter, "search"),
        args,
        { callId: "snapshot" },
        {}
      );
      expect(result.isError).toBe(false);
      expect(approvedArgs).toEqual({ q: "notes", payload: { text: "approved" } });
      expect(fixture.client.calls[0].args).toEqual(approvedArgs);
      expect(fixture.client.calls[0].args).not.toBe(args);
    });
    it.each(["service", "permission"])(
      "rechecks %s after saving the operation intent and settles withdrawal without dispatch https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (change) => {
        let current = true;
        const complete = jest.fn();
        const fixture = await harness({
          checkAvailability: () => ({
            available: change !== "service" || current,
            reason: "服务授权已撤回",
          }),
          gateway: {
            authorize: async () => ({
              allowed: true,
              revalidate: () => change !== "permission" || current,
            }),
          },
          effects: {
            recovery: { decisions: [] },
            begin: async () => {
              current = false;
              return true;
            },
            complete,
            reconcile: async () => ({ decisions: [] }),
          },
        });
        const result = await fixture.adapter.executeTool(
          internalName(fixture.adapter, "search"),
          { q: "notes" },
          { callId: "withdrawn", taskId: "99", conversationId: "root" },
          {}
        );
        expect(fixture.client.calls).toEqual([]);
        expect(result).toMatchObject({
          isError: true,
          details: { outcome: { effect: "not_applied", error: { code: "MCP_CALL_DENIED" } } },
        });
        expect(complete).toHaveBeenCalledWith(
          "docs",
          expect.objectContaining({ effect: "not_applied" })
        );
      }
    );

    it("uses the shared durable audit boundary before HTTP effects and preserves failed or denied status https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const records: AuditRecord[] = [];
      const fixture = await harness({
        audit: new AuditLog({
          sink: {
            write: (record) => {
              records.push(record);
            },
          },
        }),
      });
      fixture.client.onCall = () =>
        expect(records.at(-1)).toMatchObject({ decision: "allow", status: "approved" });
      await fixture.adapter.executeTool(
        internalName(fixture.adapter, "search"),
        { q: "sk-live-secret", headers: { authorization: "sk-live-secret" } },
        { callId: "audited", conversationId: "child" },
        {}
      );
      expect(records.map((record) => record.status)).toEqual(["approved", "executed"]);
      expect(JSON.stringify(records)).not.toContain("sk-live-secret");
      fixture.client.result = {
        content: [{ type: "text", text: "real server error" }],
        isError: true,
      };
      const failed = await fixture.adapter.executeTool(
        internalName(fixture.adapter, "search"),
        { q: "query" },
        { callId: "failed" },
        {}
      );
      expect(failed.isError).toBe(true);
      expect(records.at(-1)?.status).toBe("failed");
      fixture.gateway.decision = { allowed: false, code: "DECLINED", message: "User rejected" };
      const calls = fixture.client.calls.length;
      await fixture.adapter.executeTool(
        internalName(fixture.adapter, "search"),
        { q: "query" },
        { callId: "denied" },
        {}
      );
      expect(fixture.client.calls).toHaveLength(calls);
      expect(records.at(-1)).toMatchObject({ decision: "deny", status: "rejected" });
    });

    it("bounds combined multibyte MCP text and reports truncation before returning it to the model https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = await harness();
      harnessed.client.result = {
        content: [
          { type: "text", text: "汉".repeat(100_000) },
          { type: "text", text: "x".repeat(100_000) },
        ],
      };
      const result = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "large-output" },
        {}
      );
      const text = (result.output ?? [])
        .filter((item) => item.type === "text")
        .map((item) => (item.type === "text" ? item.text : ""))
        .join("");
      expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(256 * 1024);
      expect(text).not.toContain("�");
      expect(text).toContain("truncated");
      expect(result.details).toMatchObject({ outputTruncated: true });
    });

    it("keeps a server isError as an error result", async () => {
      const harnessed = await harness();
      harnessed.client.result = {
        content: [{ type: "text", text: "server exploded" }],
        isError: true,
      };

      const result = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-1" },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.output).toEqual([{ type: "text", text: "server exploded" }]);
      expect(harnessed.client.calls).toHaveLength(1);
    });

    it("passes the real abort signal to callTool and reports an abort as an error", async () => {
      const harnessed = await harness();
      const controller = new AbortController();
      harnessed.client.onCall = (onProgress) => {
        onProgress?.({ progress: 1, total: 2, message: "half" });
        controller.abort();
        harnessed.client.error = new Error("aborted");
      };

      const result = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-7" },
        { abortSignal: controller.signal }
      );

      expect(harnessed.client.calls[0]?.signal).toBe(controller.signal);
      expect(result.isError).toBe(true);
      expect(result.output).toEqual([
        { type: "text", text: "MCP_CALL_ABORTED: The MCP call was cancelled." },
      ]);
      expect(harnessed.updates).toEqual([
        {
          toolCallId: "call-7",
          serverId: "docs",
          toolName: "search",
          progress: 1,
          total: 2,
          message: "half",
        },
      ]);
    });

    it("replaces images with a reason when the model does not support them", async () => {
      const harnessed = await harness();
      harnessed.client.result = imageResult(1_000);

      const result = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-1" },
        {}
      );

      expect(result.output).toEqual([
        { type: "text", text: "image omitted: the selected model does not support images" },
      ]);
    });

    it("bounds oversized images and image count while keeping small images", async () => {
      const harnessed = await harness({ supportsImages: true });
      harnessed.client.result = imageResult(MCP_MAX_IMAGE_BYTES + 1_000);

      const oversized = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-1" },
        {}
      );
      expect(oversized.output?.[0]).toMatchObject({ type: "text" });
      expect(JSON.stringify(oversized.output)).toContain("exceeds");

      harnessed.client.result = imageResult(1_000, 6);
      const many = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-2" },
        {}
      );
      const images = (many.output ?? []).filter((item) => item.type === "image");
      const placeholders = (many.output ?? []).filter(
        (item) => item.type === "text" && item.text.includes("more than")
      );
      expect(images).toHaveLength(4);
      expect(placeholders).toHaveLength(2);
    });

    it("never auto-allows a tool whose effects are unknown", async () => {
      const harnessed = await harness({ omitGateway: true });
      const name = internalName(harnessed.adapter, "search");

      const denied = await harnessed.adapter.executeTool(
        name,
        { q: "x" },
        { callId: "call-1" },
        {}
      );

      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied.output)).toContain("MCP_CALL_DENIED");
      expect(harnessed.client.calls).toEqual([]);

      const allowedHarness = await harness({
        riskFor: () => ({ effects: ["network"], unknownEffects: false }),
      });
      const allowed = await allowedHarness.adapter.executeTool(
        internalName(allowedHarness.adapter, "search"),
        { q: "x" },
        { callId: "call-2" },
        {}
      );
      expect(allowedHarness.client.calls).toHaveLength(1);
      expect(allowed.isError).toBe(false);
      expect(allowedHarness.gateway.inputs[0]?.unknownEffects).toBe(false);
    });

    it("authorizes through the gateway before the client is called", async () => {
      const harnessed = await harness({
        riskFor: () => ({ effects: ["network"], unknownEffects: false }),
      });
      harnessed.gateway.order.push("start");

      await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-1" },
        {}
      );

      expect(harnessed.gateway.order).toEqual(["start", "gateway"]);
      expect(harnessed.client.calls).toHaveLength(1);
      const manifest = buildMcpToolManifest({
        serverId: "docs",
        tool: {
          serverId: "docs",
          toolName: "search",
          internalName: "mcp_docs_search_000000000000",
          inputSchema: { type: "object" },
          schemaHash: "hash",
        },
        risk: mcpToolRiskFor({
          serverId: "docs",
          toolName: "search",
          internalName: "mcp_docs_search_000000000000",
          inputSchema: { type: "object" },
          schemaHash: "hash",
        }),
      });
      expect(manifest).toMatchObject({
        family: "mcp",
        replayPolicy: "unsafe",
        effects: ["network"],
      });
    });

    it("counts images and text against the same output budget https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = await harness({ supportsImages: true });
      const data = Buffer.alloc(200_000).toString("base64");
      harnessed.client.result = {
        content: [
          { type: "image", data, mimeType: "image/png" },
          { type: "image", data, mimeType: "image/png" },
          { type: "text", text: "unbounded tail" },
        ],
      };
      const result = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "images" },
        {}
      );
      expect((result.output ?? []).filter((item) => item.type === "image")).toHaveLength(1);
      expect(result.details).toMatchObject({ outputTruncated: true });
      expect(harnessed.adapter.registrations()[0].outputLimits.maxBytes).toBe(256 * 1024);
    });

    it("applies the structured-content limit to UTF-8 bytes rather than character count https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = await harness();
      harnessed.client.result = {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { data: "汉".repeat(8_000) },
      };
      const result = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "details" },
        {}
      );
      expect(result.details).toMatchObject({
        structuredContentOmitted: "exceeds 16384 bytes",
        outcome: { operationId: "mcp:docs:root:details", status: "success", effect: "applied" },
      });
    });

    it("keeps only redacted, bounded structuredContent in details", async () => {
      const harnessed = await harness();
      harnessed.client.result = {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { answer: 42, token: "sk-live-secret" },
      };

      const result = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-1" },
        {}
      );

      expect(result.details).toMatchObject({
        structuredContent: { answer: 42, token: "[REDACTED]" },
        outcome: {
          source: { caller: "root" },
          data: { structuredContent: { token: "[REDACTED]" } },
        },
      });

      harnessed.client.result = {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { blob: "x".repeat(20_000) },
      };
      const oversized = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-2" },
        {}
      );
      expect(oversized.details).toMatchObject({
        structuredContentOmitted: "exceeds 16384 bytes",
        outcome: { status: "success" },
      });
    });

    it("rejects invalid arguments and unknown tools without calling the client", async () => {
      const harnessed = await harness();
      const name = internalName(harnessed.adapter, "search");

      const invalid = await harnessed.adapter.executeTool(
        name,
        "not-an-object",
        { callId: "c" },
        {}
      );
      const unknown = await harnessed.adapter.executeTool(
        "mcp_missing_tool_000000000000",
        {},
        { callId: "c" },
        {}
      );

      expect(JSON.stringify(invalid.output)).toContain("MCP_ARGUMENTS_INVALID");
      expect(JSON.stringify(unknown.output)).toContain("MCP_TOOL_UNKNOWN");
      expect(harnessed.client.calls).toEqual([]);
    });

    it("uses the injected content mapper instead of parsing the result itself", async () => {
      const harnessed = await harness();
      harnessed.client.result = { content: [{ type: "text", text: "raw" }] };

      const result = await harnessed.adapter.executeTool(
        internalName(harnessed.adapter, "search"),
        { q: "x" },
        { callId: "call-1" },
        {}
      );

      expect(harnessed.mapperCalls).toHaveLength(1);
      expect(result.output).toEqual([{ type: "text", text: "raw" }]);
    });
  });
});
