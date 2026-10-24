import { sha256 } from "@/utils/hash";
import { McpToolNameRegistry, type McpToolIdentity } from "@/agentMode/sdk/pi/mcp/McpToolNames";

// A catalog lists every page until the server ends or the 500-tool limit is reached, in which case it
// reports an explicitly incomplete catalog instead of claiming a full one. Each tool's parameter
// schema must be an object within the depth and byte limits with its required list intact; anything
// else is disabled with a reason and never registered. A tool-list change bumps the catalog version,
// which invalidates approvals recorded against the previous version/schema:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const MCP_CATALOG_TOOL_LIMIT = 500;
export const MCP_SCHEMA_MAX_DEPTH = 20;
export const MCP_SCHEMA_MAX_BYTES = 64 * 1024;

export type McpSchemaErrorCode =
  | "MCP_SCHEMA_INVALID"
  | "MCP_SCHEMA_TOO_DEEP"
  | "MCP_SCHEMA_TOO_LARGE";

export interface McpToolListItem {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpToolPage {
  readonly tools: readonly McpToolListItem[];
  readonly nextCursor?: string | null;
}

export interface McpToolListPort {
  listToolsPage(cursor?: string): Promise<McpToolPage>;
}

export interface McpCatalogTool extends McpToolIdentity {
  readonly internalName: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly schemaHash: string;
}

export interface McpDisabledTool extends McpToolIdentity {
  readonly reason: McpSchemaErrorCode;
  readonly detail: string;
}

export interface McpCatalogSnapshot {
  readonly serverId: string;
  readonly version: number;
  readonly tools: readonly McpCatalogTool[];
  readonly disabled: readonly McpDisabledTool[];
  readonly complete: boolean;
  readonly limit: number;
  readonly fetchedAtMs: number;
}

export interface McpToolApproval {
  readonly version: number;
  readonly schemaHash: string;
}

export interface McpCatalogOptions {
  readonly serverId: string;
  readonly client: McpToolListPort;
  readonly names?: McpToolNameRegistry;
  readonly toolLimit?: number;
  readonly maxSchemaDepth?: number;
  readonly maxSchemaBytes?: number;
  readonly now?: () => number;
}

const EMPTY_SNAPSHOT_TOOLS: readonly McpCatalogTool[] = Object.freeze([]);
const EMPTY_SNAPSHOT_DISABLED: readonly McpDisabledTool[] = Object.freeze([]);

export class McpCatalog {
  readonly #serverId: string;
  readonly #client: McpToolListPort;
  readonly #names: McpToolNameRegistry;
  readonly #toolLimit: number;
  readonly #maxSchemaDepth: number;
  readonly #maxSchemaBytes: number;
  readonly #now: () => number;
  #snapshot: McpCatalogSnapshot;
  #version = 0;
  #signature = "";

  constructor(options: McpCatalogOptions) {
    this.#serverId = options.serverId;
    this.#client = options.client;
    this.#names = options.names ?? new McpToolNameRegistry();
    this.#toolLimit = options.toolLimit ?? MCP_CATALOG_TOOL_LIMIT;
    this.#maxSchemaDepth = options.maxSchemaDepth ?? MCP_SCHEMA_MAX_DEPTH;
    this.#maxSchemaBytes = options.maxSchemaBytes ?? MCP_SCHEMA_MAX_BYTES;
    this.#now = options.now ?? Date.now;
    this.#snapshot = Object.freeze({
      serverId: this.#serverId,
      version: 0,
      tools: EMPTY_SNAPSHOT_TOOLS,
      disabled: EMPTY_SNAPSHOT_DISABLED,
      complete: true,
      limit: this.#toolLimit,
      fetchedAtMs: this.#now(),
    });
  }

  get snapshot(): McpCatalogSnapshot {
    return this.#snapshot;
  }

  async refresh(): Promise<McpCatalogSnapshot> {
    const items: McpToolListItem[] = [];
    let cursor: string | undefined;
    let complete = true;
    let truncated = false;
    for (;;) {
      const page = await this.#client.listToolsPage(cursor);
      for (const item of page.tools) {
        if (items.length >= this.#toolLimit) {
          truncated = true;
          break;
        }
        items.push(item);
      }
      if (truncated) {
        complete = false;
        break;
      }
      if (items.length >= this.#toolLimit) {
        complete = page.nextCursor === null || page.nextCursor === undefined;
        break;
      }
      if (page.nextCursor === null || page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    const tools: McpCatalogTool[] = [];
    const disabled: McpDisabledTool[] = [];
    for (const item of items) {
      const toolName = typeof item.name === "string" ? item.name.trim() : "";
      if (toolName.length === 0) {
        disabled.push({
          serverId: this.#serverId,
          toolName: "",
          reason: "MCP_SCHEMA_INVALID",
          detail: "Tool name is empty.",
        });
        continue;
      }
      const validated = validateSchema(
        item.inputSchema,
        this.#maxSchemaDepth,
        this.#maxSchemaBytes
      );
      if (!validated.ok) {
        disabled.push({
          serverId: this.#serverId,
          toolName,
          reason: validated.code,
          detail: validated.detail,
        });
        continue;
      }
      const internalName = this.#names.register(this.#serverId, toolName);
      tools.push(
        Object.freeze({
          serverId: this.#serverId,
          toolName,
          internalName,
          ...(typeof item.description === "string" ? { description: item.description } : {}),
          inputSchema: validated.schema,
          schemaHash: sha256(canonicalize(validated.schema)),
        })
      );
    }
    const signature = tools.map((tool) => `${tool.internalName}:${tool.schemaHash}`).join("|");
    if (signature !== this.#signature) {
      this.#version += 1;
      this.#signature = signature;
    }
    this.#snapshot = Object.freeze({
      serverId: this.#serverId,
      version: this.#version,
      tools: Object.freeze(tools),
      disabled: Object.freeze(disabled),
      complete,
      limit: this.#toolLimit,
      fetchedAtMs: this.#now(),
    });
    return this.#snapshot;
  }

  resolve(internalName: string): McpToolIdentity | undefined {
    return this.#names.resolve(internalName);
  }

  findTool(internalName: string): McpCatalogTool | undefined {
    return this.#snapshot.tools.find((tool) => tool.internalName === internalName);
  }

  isApprovalValid(internalName: string, approval: McpToolApproval): boolean {
    const tool = this.findTool(internalName);
    if (tool === undefined) return false;
    return approval.version === this.#snapshot.version && approval.schemaHash === tool.schemaHash;
  }
}

type SchemaValidation =
  | { readonly ok: true; readonly schema: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: McpSchemaErrorCode; readonly detail: string };

export function validateSchema(
  input: unknown,
  maxDepth: number,
  maxBytes: number
): SchemaValidation {
  if (!isRecord(input)) {
    return { ok: false, code: "MCP_SCHEMA_INVALID", detail: "inputSchema must be an object." };
  }
  if (input.type !== "object") {
    return {
      ok: false,
      code: "MCP_SCHEMA_INVALID",
      detail: 'inputSchema.type must be "object".',
    };
  }
  const properties = input.properties === undefined ? {} : input.properties;
  if (!isRecord(properties)) {
    return {
      ok: false,
      code: "MCP_SCHEMA_INVALID",
      detail: "inputSchema.properties must be an object.",
    };
  }
  const required = input.required === undefined ? undefined : input.required;
  if (required !== undefined) {
    if (!Array.isArray(required)) {
      return {
        ok: false,
        code: "MCP_SCHEMA_INVALID",
        detail: "inputSchema.required must be an array.",
      };
    }
    for (const name of required as readonly unknown[]) {
      if (typeof name !== "string" || name.length === 0 || !(name in properties)) {
        return {
          ok: false,
          code: "MCP_SCHEMA_INVALID",
          detail: "inputSchema.required must name existing properties.",
        };
      }
    }
  }
  const schema: Record<string, unknown> = { ...input, properties };
  if (depthOf(schema) > maxDepth) {
    return {
      ok: false,
      code: "MCP_SCHEMA_TOO_DEEP",
      detail: `inputSchema nesting exceeds ${maxDepth}.`,
    };
  }
  if (byteLength(JSON.stringify(schema)) > maxBytes) {
    return {
      ok: false,
      code: "MCP_SCHEMA_TOO_LARGE",
      detail: `inputSchema exceeds ${maxBytes} bytes.`,
    };
  }
  // 未知类型会被下游校验器放宽，未配置解析器的引用也不能假装可用；必须保留禁用原因。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  if (hasUnsupportedSchema(schema)) {
    return {
      ok: false,
      code: "MCP_SCHEMA_INVALID",
      detail: "inputSchema contains an unsupported type, schema shape or unresolved reference.",
    };
  }
  return { ok: true, schema: Object.freeze(schema) };
}

function hasUnsupportedSchema(input: unknown): boolean {
  if (typeof input === "boolean") return false;
  if (!isRecord(input)) return true;
  if ("$ref" in input || "$dynamicRef" in input || "$recursiveRef" in input) return true;
  if (input.type !== undefined) {
    const types = Array.isArray(input.type) ? input.type : [input.type];
    if (
      types.length === 0 ||
      types.some(
        (type) =>
          typeof type !== "string" ||
          !["object", "array", "string", "number", "integer", "boolean", "null"].includes(type)
      )
    )
      return true;
  }
  for (const key of ["properties", "patternProperties", "$defs", "definitions"]) {
    const schemas = input[key];
    if (
      schemas !== undefined &&
      (!isRecord(schemas) || Object.values(schemas).some(hasUnsupportedSchema))
    )
      return true;
  }
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    const schemas = input[key];
    if (schemas !== undefined && (!Array.isArray(schemas) || schemas.some(hasUnsupportedSchema)))
      return true;
  }
  for (const key of [
    "items",
    "additionalItems",
    "contains",
    "additionalProperties",
    "propertyNames",
    "not",
    "if",
    "then",
    "else",
    "unevaluatedProperties",
    "unevaluatedItems",
  ]) {
    const schema = input[key];
    if (
      schema !== undefined &&
      (key === "items" && Array.isArray(schema)
        ? schema.some(hasUnsupportedSchema)
        : hasUnsupportedSchema(schema))
    )
      return true;
  }
  return false;
}

function depthOf(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    let deepest = 0;
    for (const entry of items) {
      deepest = Math.max(deepest, depthOf(entry));
    }
    return 1 + deepest;
  }
  let deepest = 0;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepest = Math.max(deepest, depthOf(entry));
  }
  return 1 + deepest;
}

function byteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
