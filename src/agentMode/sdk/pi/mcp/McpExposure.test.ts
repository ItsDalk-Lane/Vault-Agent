import {
  MCP_MAX_DIRECT_TOOLS,
  McpExposureController,
  McpExposureError,
  planMcpExposure,
  type McpExposureSessionPort,
  type McpExposureTool,
} from "@/agentMode/sdk/pi/mcp/McpExposure";
import { isReservedToolName } from "@/agentMode/sdk/pi/policy/ToolManifest";

// Direct tools are offered up to 40 and the rest guide deferred search; hidden tools leave both the
// model-visible and the callable set; a reserved control name keeps its own tool; a new or changed
// tool needs approval again; and loaded deferred tools survive a session restore:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemorySession implements McpExposureSessionPort {
  saved: readonly string[] = [];
  saves = 0;
  async load(): Promise<readonly string[]> {
    return this.saved;
  }
  async save(loaded: readonly string[]): Promise<void> {
    this.saves += 1;
    this.saved = [...loaded];
  }
}

function tool(
  internalName: string,
  exposure: McpExposureTool["exposure"],
  schemaHash = "hash-1"
): McpExposureTool {
  return { internalName, serverId: "docs", toolName: internalName, exposure, schemaHash };
}

function expectCode(operation: () => Promise<unknown>, code: string): Promise<void> {
  return operation().then(
    () => {
      throw new Error(`Expected ${code}`);
    },
    (thrown: unknown) => {
      expect(thrown).toBeInstanceOf(McpExposureError);
      expect((thrown as McpExposureError).code).toBe(code);
    }
  );
}

describe("McpExposure", () => {
  describe("planMcpExposure()", () => {
    it("offers at most 40 direct tools and guides the rest to deferred", () => {
      const tools = [
        ...Array.from({ length: 42 }, (_, index) => tool(`mcp_docs_direct_${index}`, "direct")),
        tool("mcp_docs_deferred_1", "deferred"),
        tool("mcp_docs_hidden_1", "hidden"),
      ];

      const plan = planMcpExposure(tools);

      expect(plan.direct).toHaveLength(MCP_MAX_DIRECT_TOOLS);
      expect(plan.deferred).toHaveLength(3);
      expect(plan.hidden).toEqual(["mcp_docs_hidden_1"]);
      expect(plan.guideDeferred).toBe(true);
      expect(plan.conflicts).toEqual([]);
    });

    it("keeps reserved control tool names out of the exposure sets", () => {
      const reserved = "search";
      expect(isReservedToolName(reserved)).toBe(true);

      const plan = planMcpExposure([tool(reserved, "direct"), tool("mcp_docs_search", "direct")]);

      expect(plan.conflicts).toEqual([reserved]);
      expect(plan.direct).toEqual(["mcp_docs_search"]);
      expect(plan.hidden).toEqual([]);
    });
  });

  describe("McpExposureController", () => {
    it("removes a hidden tool from the model-visible and callable sets and refuses nested calls", async () => {
      const controller = new McpExposureController({
        tools: [tool("mcp_docs_visible", "direct"), tool("mcp_docs_secret", "hidden")],
      });

      expect(controller.modelTools()).toEqual(["mcp_docs_visible"]);
      expect(controller.callableTools()).toEqual(["mcp_docs_visible"]);
      expect(controller.canCall("mcp_docs_secret")).toBe(false);
      expect(controller.isModelVisible("mcp_docs_secret")).toBe(false);
      await expectCode(() => controller.load("mcp_docs_secret"), "MCP_EXPOSURE_HIDDEN");
    });

    it("loads a deferred tool into the session and keeps it after a restore", async () => {
      const session = new MemorySession();
      const tools = [tool("mcp_docs_direct", "direct"), tool("mcp_docs_deferred", "deferred")];
      const first = new McpExposureController({ tools, session });

      const offered = await first.load("mcp_docs_deferred");

      expect(offered).toContain("mcp_docs_deferred");
      expect(session.saved).toEqual(["mcp_docs_deferred"]);
      expect(first.isLoaded("mcp_docs_deferred")).toBe(true);

      const restored = new McpExposureController({ tools, session });
      expect(restored.isLoaded("mcp_docs_deferred")).toBe(false);
      const afterRestore = await restored.restore();

      expect(afterRestore).toContain("mcp_docs_deferred");
      expect(restored.modelTools()).toEqual(["mcp_docs_direct", "mcp_docs_deferred"]);
    });

    it("requires approval again for a newly registered or changed tool", async () => {
      const controller = new McpExposureController({
        tools: [tool("mcp_docs_known", "direct", "hash-1")],
        approvedFingerprints: { mcp_docs_known: "hash-1" },
      });
      expect(controller.canCall("mcp_docs_known")).toBe(true);

      controller.registerTool(tool("mcp_docs_new", "direct", "hash-new"));
      controller.registerTool(tool("mcp_docs_known", "direct", "hash-2"));

      expect(controller.canCall("mcp_docs_new")).toBe(false);
      expect(controller.isModelVisible("mcp_docs_new")).toBe(false);
      expect(controller.isApprovalRequired("mcp_docs_new")).toBe(true);
      await expectCode(() => controller.load("mcp_docs_new"), "MCP_EXPOSURE_APPROVAL_REQUIRED");

      controller.approve("mcp_docs_new", "hash-new");
      controller.approve("mcp_docs_known", "hash-2");

      expect(controller.canCall("mcp_docs_new")).toBe(true);
      expect(controller.canCall("mcp_docs_known")).toBe(true);
    });

    it("refuses to load a tool whose name collides with a reserved control tool", async () => {
      const controller = new McpExposureController({
        tools: [tool("search", "deferred"), tool("mcp_docs_ok", "direct")],
      });

      expect(controller.canCall("search")).toBe(false);
      await expectCode(() => controller.load("search"), "MCP_EXPOSURE_RESERVED_NAME");
      await expectCode(() => controller.load("mcp_docs_missing"), "MCP_EXPOSURE_UNKNOWN_TOOL");
    });
  });
});
