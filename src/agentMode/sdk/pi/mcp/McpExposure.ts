import { isReservedToolName } from "@/agentMode/sdk/pi/policy/ToolManifest";
import type { McpToolExposure } from "@/agentMode/sdk/pi/mcp/McpConfig";

// Exposure decides what the model is offered and what may run: direct tools are offered up to 40 and
// the rest guide the model to deferred search, hidden tools leave both the model-visible set and the
// callable set (hiding is not merely an offer filter), reserved control names keep their own tool,
// and a newly discovered or changed tool needs its approval again before it becomes callable. Loaded
// deferred tools are recorded on the session so a restore keeps them:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const MCP_MAX_DIRECT_TOOLS = 40;

export interface McpExposureTool {
  readonly internalName: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly exposure: McpToolExposure;
  readonly description?: string;
  readonly schemaHash?: string;
}

export interface McpExposurePlan {
  readonly direct: readonly string[];
  readonly deferred: readonly string[];
  readonly hidden: readonly string[];
  readonly conflicts: readonly string[];
  readonly guideDeferred: boolean;
}

export interface McpExposurePlanOptions {
  readonly maxDirect?: number;
  readonly reserved?: (name: string) => boolean;
}

export type McpExposureErrorCode =
  | "MCP_EXPOSURE_HIDDEN"
  | "MCP_EXPOSURE_RESERVED_NAME"
  | "MCP_EXPOSURE_APPROVAL_REQUIRED"
  | "MCP_EXPOSURE_UNKNOWN_TOOL";

export class McpExposureError extends Error {
  readonly code: McpExposureErrorCode;

  constructor(code: McpExposureErrorCode, message: string) {
    super(message);
    this.name = "McpExposureError";
    this.code = code;
  }
}

export interface McpExposureSessionPort {
  load(): Promise<readonly string[]>;
  save(loaded: readonly string[]): Promise<void>;
}

export interface McpExposureControllerOptions {
  readonly tools: readonly McpExposureTool[];
  readonly maxDirect?: number;
  readonly reserved?: (name: string) => boolean;
  readonly session?: McpExposureSessionPort;
  readonly approvedFingerprints?: Readonly<Record<string, string>>;
}

export function planMcpExposure(
  tools: readonly McpExposureTool[],
  options: McpExposurePlanOptions = {}
): McpExposurePlan {
  const maxDirect = options.maxDirect ?? MCP_MAX_DIRECT_TOOLS;
  const reserved = options.reserved ?? isReservedToolName;
  const direct: string[] = [];
  const deferred: string[] = [];
  const hidden: string[] = [];
  const conflicts: string[] = [];
  let guideDeferred = false;
  for (const tool of tools) {
    if (reserved(tool.internalName)) {
      conflicts.push(tool.internalName);
      continue;
    }
    if (tool.exposure === "hidden") {
      hidden.push(tool.internalName);
      continue;
    }
    if (tool.exposure === "direct" && direct.length < maxDirect) {
      direct.push(tool.internalName);
      continue;
    }
    if (tool.exposure === "direct") guideDeferred = true;
    deferred.push(tool.internalName);
  }
  return Object.freeze({
    direct: Object.freeze(direct),
    deferred: Object.freeze(deferred),
    hidden: Object.freeze(hidden),
    conflicts: Object.freeze(conflicts),
    guideDeferred,
  });
}

export class McpExposureController {
  readonly #tools = new Map<string, McpExposureTool>();
  #plan: McpExposurePlan;
  readonly #maxDirect: number;
  readonly #reserved: ((name: string) => boolean) | undefined;
  readonly #session: McpExposureSessionPort | undefined;
  readonly #approved = new Map<string, string>();
  readonly #loaded = new Set<string>();

  constructor(options: McpExposureControllerOptions) {
    for (const tool of options.tools) this.#tools.set(tool.internalName, tool);
    this.#maxDirect = options.maxDirect ?? MCP_MAX_DIRECT_TOOLS;
    this.#reserved = options.reserved;
    this.#plan = this.#recomputePlan();
    this.#session = options.session;
    for (const tool of options.tools) {
      if (tool.schemaHash !== undefined) this.#approved.set(tool.internalName, tool.schemaHash);
    }
    for (const [name, fingerprint] of Object.entries(options.approvedFingerprints ?? {})) {
      this.#approved.set(name, fingerprint);
    }
  }

  get plan(): McpExposurePlan {
    return this.#plan;
  }

  modelTools(): readonly string[] {
    const offered = [...this.#plan.direct, ...this.#loaded].filter(
      (name) => this.#isCallable(name) && !this.#plan.hidden.includes(name)
    );
    return Object.freeze([...new Set(offered)]);
  }

  callableTools(): readonly string[] {
    const callable = [...this.#plan.direct, ...this.#plan.deferred].filter((name) =>
      this.#isCallable(name)
    );
    return Object.freeze([...new Set(callable)]);
  }

  isModelVisible(internalName: string): boolean {
    return this.modelTools().includes(internalName);
  }

  canCall(internalName: string): boolean {
    return this.callableTools().includes(internalName);
  }

  isLoaded(internalName: string): boolean {
    return this.#loaded.has(internalName);
  }

  async load(internalName: string): Promise<readonly string[]> {
    const tool = this.#tools.get(internalName);
    if (tool === undefined) {
      throw new McpExposureError(
        "MCP_EXPOSURE_UNKNOWN_TOOL",
        `Unknown MCP tool "${internalName}".`
      );
    }
    if (this.#plan.hidden.includes(internalName)) {
      throw new McpExposureError(
        "MCP_EXPOSURE_HIDDEN",
        `The hidden MCP tool "${internalName}" cannot be loaded or called.`
      );
    }
    if (this.#plan.conflicts.includes(internalName)) {
      throw new McpExposureError(
        "MCP_EXPOSURE_RESERVED_NAME",
        `"${internalName}" conflicts with a reserved control tool name.`
      );
    }
    if (!this.#isApproved(internalName)) {
      throw new McpExposureError(
        "MCP_EXPOSURE_APPROVAL_REQUIRED",
        `"${internalName}" needs its approval again before it can be loaded.`
      );
    }
    if (!this.#plan.deferred.includes(internalName) && !this.#plan.direct.includes(internalName)) {
      throw new McpExposureError(
        "MCP_EXPOSURE_UNKNOWN_TOOL",
        `"${internalName}" is not exposed by this server.`
      );
    }
    this.#loaded.add(internalName);
    await this.#session?.save(Object.freeze([...this.#loaded]));
    return this.modelTools();
  }

  async restore(): Promise<readonly string[]> {
    if (this.#session === undefined) return this.modelTools();
    for (const name of await this.#session.load()) {
      const tool = this.#tools.get(name);
      if (tool === undefined) continue;
      if (this.#plan.hidden.includes(name) || this.#plan.conflicts.includes(name)) continue;
      this.#loaded.add(name);
    }
    return this.modelTools();
  }

  registerTool(tool: McpExposureTool): void {
    this.#tools.set(tool.internalName, tool);
    this.#approved.delete(tool.internalName);
    this.#plan = this.#recomputePlan();
  }

  #recomputePlan(): McpExposurePlan {
    return planMcpExposure([...this.#tools.values()], {
      maxDirect: this.#maxDirect,
      ...(this.#reserved !== undefined ? { reserved: this.#reserved } : {}),
    });
  }

  approve(internalName: string, schemaHash: string): void {
    this.#approved.set(internalName, schemaHash);
  }

  isApprovalRequired(internalName: string): boolean {
    return !this.#isApproved(internalName);
  }

  #isApproved(internalName: string): boolean {
    const tool = this.#tools.get(internalName);
    if (tool === undefined) return false;
    const approved = this.#approved.get(internalName);
    if (approved === undefined) return tool.schemaHash === undefined;
    return tool.schemaHash === undefined || approved === tool.schemaHash;
  }

  #isCallable(internalName: string): boolean {
    if (this.#plan.hidden.includes(internalName)) return false;
    if (this.#plan.conflicts.includes(internalName)) return false;
    return this.#isApproved(internalName);
  }
}
