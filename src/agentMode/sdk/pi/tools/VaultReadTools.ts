import { PathResolver, PathResolverError } from "@/agentMode/sdk/pi/policy/PathResolver";
import {
  defineToolManifest,
  type ToolManifest,
  type ToolTarget,
} from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import { sha256 } from "@/utils/hash";

// The read tools use the Vault API for content and MetadataCache only for link candidates. Reads are
// paged with a range hash, truncation flag and next cursor; listing is sorted and cursor-based; a
// stale link cache never invents content; protected and out-of-scope paths are excluded; and no
// matches is an empty result, not an error:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface VaultListEntry {
  readonly path: string;
  readonly size: number;
}

export interface VaultListValue {
  readonly files: readonly VaultListEntry[];
  readonly total: number;
  readonly truncated: boolean;
  readonly nextCursor?: string;
}

export interface VaultReadValue {
  readonly path: string;
  readonly content: string;
  readonly startLine: number;
  readonly lineCount: number;
  readonly totalLines: number;
  readonly sha256: string;
  readonly fileVersion: string;
  readonly nextCursor?: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly nextStartLine?: number;
}

export interface VaultLinksValue {
  readonly path: string;
  readonly direction: VaultLinkDirection;
  readonly incoming: readonly string[];
  readonly outgoing: readonly string[];
  readonly unresolvedOutgoing: readonly string[];
  readonly cacheStale: boolean;
}

export type VaultLinkDirection = "in" | "out" | "both";

export type VaultToolErrorCode =
  | "INVALID_ARGUMENT"
  | "PATH_OUT_OF_SCOPE"
  | "PROTECTED_PATH"
  | "VAULT_READ_FAILED"
  | "STALE_BASELINE";

export type VaultToolResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: VaultToolErrorCode;
      readonly message: string;
      readonly suggestedTool?: string;
    };

export interface VaultToolContext {
  readonly isPathInScope?: (relativePath: string) => boolean;
}

export interface VaultReadAdapter {
  listMarkdownFiles(folder?: string): Promise<readonly VaultListEntry[]>;
  read(path: string): Promise<string>;
}

export interface VaultLinkCache {
  readonly resolvedLinks: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly unresolvedLinks: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly isStale?: () => boolean;
}

export interface VaultReadToolsOptions {
  readonly vault: VaultReadAdapter;
  readonly linkCache: VaultLinkCache;
  readonly pathResolver: PathResolver;
  readonly maxReadBytes?: number;
  readonly maxLineCount?: number;
  readonly maxListLimit?: number;
}

const DEFAULT_MAX_READ_BYTES = 64 * 1_024;
const DEFAULT_MAX_LINE_COUNT = 400;
const DEFAULT_MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 100;

const LIST_PARAMETERS = {
  type: "object",
  properties: {
    folder: { type: "string", maxLength: 512 },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: DEFAULT_MAX_LIST_LIMIT,
      default: DEFAULT_LIST_LIMIT,
    },
    cursor: { type: "string", maxLength: 32 },
  },
  additionalProperties: false,
} as const;

const READ_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    cursor: {
      type: "string",
      maxLength: 256,
      description: "Opaque nextCursor from the previous read; rejects changed files.",
    },
    startLine: { type: "integer", minimum: 1, default: 1 },
    lineCount: {
      type: "integer",
      minimum: 1,
      maximum: DEFAULT_MAX_LINE_COUNT,
      default: DEFAULT_MAX_LINE_COUNT,
    },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

const LINKS_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    direction: { type: "string", enum: ["in", "out", "both"] },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

export class VaultReadTools {
  readonly manifests: readonly ToolManifest[];
  private readonly vault: VaultReadAdapter;
  private readonly linkCache: VaultLinkCache;
  private readonly pathResolver: PathResolver;
  private readonly maxReadBytes: number;
  private readonly maxLineCount: number;
  private readonly maxListLimit: number;

  constructor(options: VaultReadToolsOptions) {
    this.vault = options.vault;
    this.linkCache = options.linkCache;
    this.pathResolver = options.pathResolver;
    this.maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
    this.maxLineCount = options.maxLineCount ?? DEFAULT_MAX_LINE_COUNT;
    this.maxListLimit = options.maxListLimit ?? DEFAULT_MAX_LIST_LIMIT;
    // 多模型候选要读取既有库资料，仍由只读策略和路径范围限制实际访问。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    this.manifests = Object.freeze([
      defineToolManifest({
        toolId: "vault_list",
        description:
          "List visible Markdown notes in an authorized vault folder, recursively. Results exclude protected and out-of-scope notes; an empty result does not prove a folder or configuration does not exist. Follow nextCursor when truncated.",
        family: "vault",
        effects: ["read"],
        parameters: LIST_PARAMETERS,
        extractTargets: () => [],
        implementationVersion: 2,
        schemaVersion: 2,
        replayPolicy: "read_only",
        allowedCallers: ["root", "subagent", "fanout"],
        maxOutputBytes: 64 * 1_024,
      }),
      defineToolManifest({
        toolId: "vault_read",
        description:
          "Read a vault note before describing or modifying it. fileVersion identifies the whole file and is the baseline for edits; sha256 identifies only the returned range. Follow nextCursor to read all content, including long lines. Restart without cursor after STALE_BASELINE. Never infer unread content.",
        family: "vault",
        effects: ["read"],
        parameters: READ_PARAMETERS,
        extractTargets: (args) => targetsOf(args),
        implementationVersion: 2,
        schemaVersion: 2,
        replayPolicy: "read_only",
        allowedCallers: ["root", "subagent", "fanout"],
        maxOutputBytes: 64 * 1_024,
      }),
      defineToolManifest({
        toolId: "vault_links",
        description:
          "Inspect incoming, outgoing and unresolved vault links. A stale metadata cache is reported; links are candidates, not evidence of note contents. Read notes with vault_read.",
        family: "vault",
        effects: ["read"],
        parameters: LINKS_PARAMETERS,
        extractTargets: (args) => targetsOf(args),
        implementationVersion: 2,
        schemaVersion: 2,
        replayPolicy: "read_only",
        allowedCallers: ["root", "subagent", "fanout"],
        maxOutputBytes: 64 * 1_024,
      }),
    ]);
  }

  register(registry: ToolRegistry, gateway?: ToolGateway): void {
    for (const manifest of this.manifests) {
      registry.register(manifest, "host");
      gateway?.registerTool({
        toolId: manifest.toolId,
        manifest,
        execute: async (args) => {
          const result = await this.execute(manifest.toolId, args);
          return { content: JSON.stringify(result), isError: result.ok === false };
        },
      });
    }
  }

  async list(
    rawArgs: Record<string, unknown>,
    context: VaultToolContext
  ): Promise<VaultToolResult<VaultListValue>> {
    const folder = rawArgs.folder;
    if (folder !== undefined && typeof folder !== "string") {
      return invalidArgument("folder must be a string.");
    }
    const limit = rawArgs.limit;
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > this.maxListLimit)
    ) {
      return invalidArgument(`limit must be an integer between 1 and ${this.maxListLimit}.`);
    }
    const pageSize = (limit as number | undefined) ?? DEFAULT_LIST_LIMIT;
    const offset = parseCursor(rawArgs.cursor);
    if (offset === null) return invalidArgument("cursor is invalid.");
    let entries: readonly VaultListEntry[];
    try {
      entries = await this.vault.listMarkdownFiles(folder);
    } catch {
      return { ok: false, code: "VAULT_READ_FAILED", message: "The Vault listing failed." };
    }
    const visible: VaultListEntry[] = [];
    for (const entry of entries) {
      const resolved = await this.resolve(entry.path);
      if (!resolved.ok) continue;
      if (!isInScope(context, resolved.value.relative)) continue;
      visible.push({ path: resolved.value.relative, size: entry.size });
    }
    visible.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const page = visible.slice(offset, offset + pageSize);
    const truncated = offset + page.length < visible.length;
    return {
      ok: true,
      value: {
        files: Object.freeze(page),
        total: visible.length,
        truncated,
        ...(truncated ? { nextCursor: String(offset + page.length) } : {}),
      },
    };
  }

  async read(
    rawArgs: Record<string, unknown>,
    context: VaultToolContext
  ): Promise<VaultToolResult<VaultReadValue>> {
    const filePath = rawArgs.path;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return invalidArgument("path is required.");
    }
    const startLine = rawArgs.startLine ?? 1;
    if (!Number.isInteger(startLine) || (startLine as number) < 1) {
      return invalidArgument("startLine must be an integer greater than or equal to 1.");
    }
    const requestedLineCount = rawArgs.lineCount ?? this.maxLineCount;
    if (
      !Number.isInteger(requestedLineCount) ||
      (requestedLineCount as number) < 1 ||
      (requestedLineCount as number) > this.maxLineCount
    ) {
      return invalidArgument(`lineCount must be an integer between 1 and ${this.maxLineCount}.`);
    }
    const resolved = await this.resolve(filePath);
    if (!resolved.ok) return resolved;
    if (!isInScope(context, resolved.value.relative)) {
      return outOfScope(filePath);
    }
    let content: string;
    try {
      content = await this.vault.read(resolved.value.relative);
    } catch {
      return { ok: false, code: "VAULT_READ_FAILED", message: `Cannot read "${filePath}".` };
    }
    const fileVersion = sha256(content);
    const lines = content.split("\n");
    const totalLines = content.endsWith("\n") ? Math.max(0, lines.length - 1) : lines.length;
    let offset = lines
      .slice(0, (startLine as number) - 1)
      .reduce((size, line) => size + line.length + 1, 0);
    if (rawArgs.cursor !== undefined) {
      try {
        if (typeof rawArgs.cursor !== "string") return invalidArgument("cursor must be a string.");
        const cursor = JSON.parse(rawArgs.cursor) as { version: string; offset: number };
        if (cursor.version !== fileVersion)
          return {
            ok: false,
            code: "STALE_BASELINE",
            message: "The file changed; restart reading without a cursor.",
          };
        if (
          !Number.isSafeInteger(cursor.offset) ||
          cursor.offset < 0 ||
          cursor.offset > content.length
        )
          return invalidArgument("cursor offset is invalid.");
        offset = cursor.offset;
      } catch {
        return invalidArgument("cursor is invalid.");
      }
    }
    const firstIndex = content.slice(0, offset).split("\n").length - 1;
    const selected = content
      .slice(offset)
      .split("\n")
      .slice(0, requestedLineCount as number);
    let candidate = selected.join("\n");
    if (content.endsWith("\n") && offset + candidate.length === content.length - 1)
      candidate += "\n";
    let rangeContent = "";
    let bytes = 0;
    let encodedBytes = 0;
    // 路径与游标也占输出空间，按完整结果预留，避免 SDK 裁掉读后修改所需的版本和下一页。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const envelopeBytes = utf8Bytes(
      JSON.stringify({
        ok: true,
        value: {
          path: resolved.value.relative,
          content: "",
          startLine: totalLines + 1,
          lineCount: totalLines + 1,
          totalLines,
          sha256: fileVersion,
          fileVersion,
          bytes: this.maxReadBytes,
          truncated: true,
          nextStartLine: totalLines + 1,
          nextCursor: JSON.stringify({ version: fileVersion, offset: content.length }),
        },
      })
    );
    const encodedLimit =
      this.maxReadBytes > 1024
        ? Math.max(0, this.maxReadBytes - Math.max(1024, envelopeBytes))
        : this.maxReadBytes;
    for (const character of candidate) {
      const size = utf8Bytes(character);
      const encodedSize = utf8Bytes(JSON.stringify(character)) - 2;
      if (bytes + size > this.maxReadBytes || encodedBytes + encodedSize > encodedLimit) break;
      rangeContent += character;
      bytes += size;
      encodedBytes += encodedSize;
    }
    const end = offset + rangeContent.length;
    const truncated = end < content.length;
    return {
      ok: true,
      value: {
        path: resolved.value.relative,
        content: rangeContent,
        startLine: firstIndex + 1,
        lineCount: rangeContent.split("\n").length - (rangeContent.endsWith("\n") ? 1 : 0),
        totalLines,
        sha256: sha256(rangeContent),
        fileVersion,
        bytes,
        truncated,
        ...(truncated
          ? {
              nextStartLine: firstIndex + selected.length + 1,
              nextCursor: JSON.stringify({ version: fileVersion, offset: end }),
            }
          : {}),
      },
    };
  }

  async links(
    rawArgs: Record<string, unknown>,
    context: VaultToolContext
  ): Promise<VaultToolResult<VaultLinksValue>> {
    const filePath = rawArgs.path;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return invalidArgument("path is required.");
    }
    const direction = (rawArgs.direction ?? "both") as VaultLinkDirection;
    if (direction !== "in" && direction !== "out" && direction !== "both") {
      return invalidArgument("direction must be one of in/out/both.");
    }
    const resolved = await this.resolve(filePath);
    if (!resolved.ok) return resolved;
    if (!isInScope(context, resolved.value.relative)) return outOfScope(filePath);
    const cacheStale = this.linkCache.isStale?.() ?? false;
    if (cacheStale) {
      return {
        ok: true,
        value: {
          path: resolved.value.relative,
          direction,
          incoming: Object.freeze([]),
          outgoing: Object.freeze([]),
          unresolvedOutgoing: Object.freeze([]),
          cacheStale: true,
        },
      };
    }
    const relative = resolved.value.relative;
    const incoming = Object.entries(this.linkCache.resolvedLinks)
      .filter(([, targets]) => Object.prototype.hasOwnProperty.call(targets, relative))
      .map(([source]) => source)
      .sort();
    const outgoing = Object.keys(this.linkCache.resolvedLinks[relative] ?? {}).sort();
    const unresolvedOutgoing = Object.keys(this.linkCache.unresolvedLinks[relative] ?? {}).sort();
    return {
      ok: true,
      value: {
        path: relative,
        direction,
        incoming: Object.freeze(direction === "out" ? [] : incoming),
        outgoing: Object.freeze(direction === "in" ? [] : outgoing),
        unresolvedOutgoing: Object.freeze(direction === "in" ? [] : unresolvedOutgoing),
        cacheStale: false,
      },
    };
  }

  private async execute(
    toolId: string,
    args: Record<string, unknown>
  ): Promise<VaultToolResult<unknown>> {
    const context: VaultToolContext = {};
    if (toolId === "vault_list") return this.list(args, context);
    if (toolId === "vault_read") return this.read(args, context);
    return this.links(args, context);
  }

  private async resolve(
    requested: string
  ): Promise<VaultToolResult<{ readonly relative: string; readonly canonical: string }>> {
    try {
      const resolved = await this.pathResolver.resolveVaultPath(requested);
      return { ok: true, value: { relative: resolved.relative, canonical: resolved.canonical } };
    } catch (error) {
      if (error instanceof PathResolverError) {
        if (error.code === "PROTECTED_PATH") {
          return { ok: false, code: "PROTECTED_PATH", message: error.message };
        }
        if (error.code === "INVALID_ARGUMENT") {
          return { ok: false, code: "INVALID_ARGUMENT", message: error.message };
        }
        return outOfScope(requested);
      }
      return { ok: false, code: "VAULT_READ_FAILED", message: `Cannot resolve "${requested}".` };
    }
  }
}

function targetsOf(args: unknown): readonly ToolTarget[] {
  if (typeof args !== "object" || args === null) return [];
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" ? [{ kind: "vault_path", value: path }] : [];
}

function isInScope(context: VaultToolContext, relative: string): boolean {
  return context.isPathInScope === undefined || context.isPathInScope(relative);
}

function parseCursor(cursor: unknown): number | null {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) return null;
  return Number.parseInt(cursor, 10);
}

function invalidArgument(message: string): VaultToolResult<never> {
  return { ok: false, code: "INVALID_ARGUMENT", message };
}

function outOfScope(requested: string): VaultToolResult<never> {
  return {
    ok: false,
    code: "PATH_OUT_OF_SCOPE",
    message: `The path "${requested}" is outside the approved Vault scope.`,
    suggestedTool: "vault_list",
  };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}
