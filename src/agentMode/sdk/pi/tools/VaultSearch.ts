import { defineToolManifest, type ToolManifest } from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import {
  VaultSearchIndex,
  type VaultSearchHit,
  type VaultSearchResult,
} from "@/agentMode/sdk/pi/tools/VaultSearchIndex";

// vault_search is a host tool over the local VaultSearchIndex: closed schema, bounded query and
// limit, scope-filtered results, and no CLI or content upload:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface VaultSearchValue {
  readonly query: string;
  readonly hits: readonly VaultSearchHit[];
  readonly total: number;
  readonly truncated: boolean;
  readonly nextCursor?: string;
  readonly cancelled: boolean;
}

export type VaultSearchToolResult =
  | { readonly ok: true; readonly value: VaultSearchValue }
  | {
      readonly ok: false;
      readonly code: "INVALID_ARGUMENT" | "CANCELLED" | "SEARCH_FAILED";
      readonly message: string;
    };

export interface VaultSearchToolContext {
  readonly isPathInScope?: (relativePath: string) => boolean;
  readonly signal?: AbortSignal;
}

export interface VaultSearchOptions {
  readonly index: VaultSearchIndex;
  readonly maxLimit?: number;
}

const DEFAULT_MAX_LIMIT = 100;

const SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, maxLength: 500 },
    folder: { type: "string", maxLength: 512 },
    limit: { type: "integer", minimum: 1, maximum: DEFAULT_MAX_LIMIT, default: 50 },
    cursor: { type: "string", maxLength: 32 },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

export class VaultSearch {
  readonly manifest: ToolManifest;
  private readonly index: VaultSearchIndex;
  private readonly maxLimit: number;

  constructor(options: VaultSearchOptions) {
    this.index = options.index;
    this.maxLimit = options.maxLimit ?? DEFAULT_MAX_LIMIT;
    // 多模型候选应复用当前范围内的只读搜索，不能退回运行本地程序。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    this.manifest = defineToolManifest({
      toolId: "vault_search",
      description:
        "Search local vault note content within the authorized scope. Results are bounded snippets, not full notes; use vault_read on relevant paths before summarizing or editing. No matches does not prove inaccessible content is absent.",
      family: "vault",
      effects: ["read"],
      parameters: SEARCH_PARAMETERS,
      extractTargets: () => [],
      implementationVersion: 1,
      schemaVersion: 1,
      replayPolicy: "read_only",
      allowedCallers: ["root", "subagent", "fanout"],
      maxOutputBytes: 64 * 1_024,
    });
  }

  register(registry: ToolRegistry, gateway?: ToolGateway): void {
    registry.register(this.manifest, "host");
    gateway?.registerTool({
      toolId: this.manifest.toolId,
      manifest: this.manifest,
      execute: async (args) => {
        const result = await this.search(args, {});
        return { content: JSON.stringify(result), isError: result.ok === false };
      },
    });
  }

  async search(
    rawArgs: Record<string, unknown>,
    context: VaultSearchToolContext
  ): Promise<VaultSearchToolResult> {
    const query = rawArgs.query;
    if (typeof query !== "string" || query.trim().length === 0) {
      return invalidArgument("query is required.");
    }
    const folder = rawArgs.folder;
    if (folder !== undefined && typeof folder !== "string") {
      return invalidArgument("folder must be a string.");
    }
    const limit = rawArgs.limit;
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > this.maxLimit)
    ) {
      return invalidArgument(`limit must be an integer between 1 and ${this.maxLimit}.`);
    }
    const cursor = rawArgs.cursor;
    if (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor))) {
      return invalidArgument("cursor is invalid.");
    }
    let result: VaultSearchResult;
    try {
      result = await this.index.search(query, {
        ...(folder !== undefined ? { folder } : {}),
        ...(limit !== undefined ? { limit: limit as number } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
        ...(context.isPathInScope !== undefined ? { isPathAllowed: context.isPathInScope } : {}),
      });
    } catch {
      return { ok: false, code: "SEARCH_FAILED", message: "The Vault search failed." };
    }
    if (result.cancelled) {
      return { ok: false, code: "CANCELLED", message: "The Vault search was cancelled." };
    }
    return { ok: true, value: { query, ...result } };
  }
}

function invalidArgument(message: string): VaultSearchToolResult {
  return { ok: false, code: "INVALID_ARGUMENT", message };
}
