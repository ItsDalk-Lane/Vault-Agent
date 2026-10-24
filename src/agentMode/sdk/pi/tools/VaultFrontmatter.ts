import { sha256 } from "@/utils/hash";
import { PathResolver, PathResolverError } from "@/agentMode/sdk/pi/policy/PathResolver";
import { defineToolManifest, type ToolManifest } from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";

// Frontmatter edits use the public YAML codec only (no tag execution), accept only JSON values in
// set/remove, preserve the body byte-for-byte, show serialization/format changes in the proposed
// diff, create a missing block when requested, and go through the same full-text Vault.process CAS:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface YamlCodec {
  parse(text: string): unknown;
  stringify(value: unknown): string;
}

export interface VaultFrontmatterAdapter {
  read(path: string): Promise<string>;
  process(path: string, callback: (current: string) => string): Promise<void>;
}

export interface VaultFrontmatterReceipt {
  readonly operationId: string;
  readonly path: string;
  readonly kind: "frontmatter";
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly keys: readonly string[];
  readonly approvalRef?: string;
  readonly safe: true;
  readonly committedAtMs: number;
}

export interface VaultFrontmatterReceiptStore {
  save(receipt: VaultFrontmatterReceipt): Promise<void>;
  find(operationId: string): Promise<VaultFrontmatterReceipt | undefined>;
}

export interface VaultFrontmatterContext {
  readonly isPathInScope?: (relativePath: string) => boolean;
  readonly signal?: AbortSignal;
  readonly operationId?: string;
  readonly approvalRef?: string;
}

export interface VaultFrontmatterOptions {
  readonly vault: VaultFrontmatterAdapter;
  readonly pathResolver: PathResolver;
  readonly yaml: YamlCodec;
  readonly receipts?: VaultFrontmatterReceiptStore;
  readonly authorize?: (input: {
    readonly path: string;
    readonly keys: readonly string[];
    readonly operationId: string;
    readonly before: string;
    readonly proposedContent: string;
  }) => Promise<boolean>;
  readonly now?: () => number;
}

export type VaultFrontmatterErrorCode =
  | "INVALID_ARGUMENT"
  | "PATH_OUT_OF_SCOPE"
  | "PROTECTED_PATH"
  | "STALE_BASELINE"
  | "CANCELLED"
  | "PERMISSION_DENIED"
  | "INVALID_YAML"
  | "NON_JSON_VALUE"
  | "AFTER_HASH_MISMATCH"
  | "EFFECT_UNKNOWN"
  | "READ_FAILED"
  | "WRITE_FAILED";

export type VaultFrontmatterResult =
  | {
      readonly ok: true;
      readonly safe: true;
      readonly receipt: VaultFrontmatterReceipt;
      readonly alreadyApplied: true;
    }
  | {
      readonly ok: true;
      readonly safe: true;
      readonly receipt: VaultFrontmatterReceipt;
      readonly proposedContent: string;
      readonly beforeHash: string;
      readonly afterHash: string;
      readonly diff: string;
    }
  | {
      readonly ok: false;
      readonly code: VaultFrontmatterErrorCode;
      readonly message: string;
      readonly wrote?: boolean;
    };

const FRONTMATTER_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1, maxLength: 1_024 },
    fileVersion: {
      type: "string",
      minLength: 64,
      maxLength: 64,
      description: "Copy fileVersion from vault_read for this file; never use the range sha256.",
    },
    expectedHash: {
      type: "string",
      minLength: 64,
      maxLength: 64,
      description: "Legacy alias for fileVersion; must represent the whole file.",
    },
    set: { type: "object" },
    remove: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
  },
  required: ["path"],
  // 真实属性修改必需完整版本，声明也必须提前拒绝缺参，同时保留已有 expectedHash 调用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  anyOf: [{ required: ["fileVersion"] }, { required: ["expectedHash"] }],
  additionalProperties: false,
} as const;

type FrontmatterMap = Record<string, unknown>;

interface ParsedFrontmatter {
  readonly hasFrontmatter: boolean;
  readonly values: FrontmatterMap;
  readonly body: string;
}

interface ResolvedFrontmatterPath {
  readonly ok: boolean;
  readonly relative?: string;
  readonly code?: VaultFrontmatterErrorCode;
  readonly message?: string;
}

class StaleBaselineError extends Error {
  readonly code = "STALE_BASELINE";
}

export class VaultFrontmatter {
  readonly manifest: ToolManifest;
  private readonly vault: VaultFrontmatterAdapter;
  private readonly pathResolver: PathResolver;
  private readonly yaml: YamlCodec;
  private readonly receipts: VaultFrontmatterReceiptStore | undefined;
  private readonly authorize: VaultFrontmatterOptions["authorize"];
  private readonly now: () => number;

  constructor(options: VaultFrontmatterOptions) {
    this.vault = options.vault;
    this.pathResolver = options.pathResolver;
    this.yaml = options.yaml;
    this.receipts = options.receipts;
    this.authorize = options.authorize;
    this.now = options.now ?? Date.now;
    this.manifest = defineToolManifest({
      toolId: "vault_frontmatter",
      description:
        "Update structured note properties without replacing unrelated content. First read the note and pass its whole-file fileVersion. Respect conflicts and approvals; verify the returned receipt before claiming success.",
      family: "vault",
      effects: ["write"],
      parameters: FRONTMATTER_PARAMETERS,
      extractTargets: (args) => targetsOf(args),
      implementationVersion: 3,
      schemaVersion: 3,
      replayPolicy: "idempotent",
      allowedCallers: ["root", "subagent"],
      maxOutputBytes: 2 * 1_024 * 1_024,
    });
  }

  register(registry: ToolRegistry, gateway?: ToolGateway): void {
    registry.register(this.manifest, "host");
    gateway?.registerTool({
      toolId: this.manifest.toolId,
      manifest: this.manifest,
      execute: async (args, context) => {
        const result = await this.apply(args, context);
        return { content: JSON.stringify(result), isError: result.ok === false };
      },
    });
  }

  async apply(
    rawArgs: Record<string, unknown>,
    context: VaultFrontmatterContext
  ): Promise<VaultFrontmatterResult> {
    const requestedPath = rawArgs.path;
    const expectedHash = rawArgs.fileVersion ?? rawArgs.expectedHash;
    if (typeof requestedPath !== "string" || requestedPath.length === 0) {
      return invalid("path is required.");
    }
    if (typeof expectedHash !== "string" || expectedHash.length === 0) {
      return invalid("fileVersion is required.");
    }
    const setValue = rawArgs.set;
    const removeValue = rawArgs.remove;
    let set: FrontmatterMap | undefined;
    if (setValue !== undefined) {
      if (!isPlainObject(setValue)) return invalid("set must be an object.");
      set = setValue;
    }
    let remove: readonly string[] | undefined;
    if (removeValue !== undefined) {
      if (
        !Array.isArray(removeValue) ||
        removeValue.some((key) => typeof key !== "string" || key.length === 0)
      ) {
        return invalid("remove must be an array of strings.");
      }
      remove = removeValue as readonly string[];
    }
    if (
      (set === undefined || Object.keys(set).length === 0) &&
      (remove === undefined || remove.length === 0)
    ) {
      return invalid("set or remove must contain at least one entry.");
    }
    if (
      set !== undefined &&
      remove !== undefined &&
      Object.keys(set).some((key) => remove.includes(key))
    ) {
      return invalid("A key cannot be both set and removed.");
    }
    if (set !== undefined && !Object.values(set).every(isJsonValue)) {
      return { ok: false, code: "NON_JSON_VALUE", message: "set values must be JSON data." };
    }
    const keys = [...(set !== undefined ? Object.keys(set) : []), ...(remove ?? [])];
    const operationId =
      context.operationId ??
      sha256(
        `frontmatter\0${requestedPath}\0${expectedHash}\0${stableJson({
          set: set ?? {},
          remove: remove ?? [],
        })}`
      ).slice(0, 24);
    const replayed = await this.receipts?.find(operationId);
    if (replayed !== undefined) {
      return { ok: true, safe: true, receipt: replayed, alreadyApplied: true };
    }

    const resolved = await this.resolve(requestedPath, context);
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.code ?? "PATH_OUT_OF_SCOPE",
        message: resolved.message ?? `Cannot resolve "${requestedPath}".`,
      };
    }
    const relative = resolved.relative ?? requestedPath;
    let before: string;
    try {
      before = await this.vault.read(relative);
    } catch {
      return { ok: false, code: "READ_FAILED", message: `Cannot read "${requestedPath}".` };
    }
    if (sha256(before) !== expectedHash) {
      return {
        ok: false,
        code: "STALE_BASELINE",
        message: "The note changed since it was read; re-read and ask for a fresh diff.",
      };
    }

    let parsed: ParsedFrontmatter;
    try {
      parsed = this.parseFrontmatter(before);
    } catch (error) {
      const code = (error as { code?: string }).code;
      return {
        ok: false,
        code: code === "NON_JSON_VALUE" ? "NON_JSON_VALUE" : "INVALID_YAML",
        message: "The frontmatter is not valid JSON-compatible YAML.",
      };
    }
    const next: FrontmatterMap = { ...parsed.values };
    for (const key of remove ?? []) delete next[key];
    for (const [key, value] of Object.entries(set ?? {})) next[key] = value;
    let serialized: string;
    try {
      serialized = this.yaml.stringify(next);
    } catch {
      return {
        ok: false,
        code: "INVALID_YAML",
        message: "The frontmatter could not be serialized.",
      };
    }
    const yamlText = serialized.endsWith("\n") ? serialized : `${serialized}\n`;
    const proposedContent = `---\n${yamlText}---\n${parsed.body}`;

    if (context.signal?.aborted === true) {
      return {
        ok: false,
        code: "CANCELLED",
        message: "The operation was cancelled before writing.",
      };
    }
    if (this.authorize !== undefined) {
      const allowed = await this.authorize({
        path: relative,
        keys,
        operationId,
        before,
        proposedContent,
      });
      if (!allowed) {
        return {
          ok: false,
          code: "PERMISSION_DENIED",
          message: "The final gateway check denied this write.",
        };
      }
    }
    try {
      await this.vault.process(relative, (latest) => {
        if (sha256(latest) !== expectedHash) throw new StaleBaselineError();
        return proposedContent;
      });
    } catch (error) {
      // 全文已经交给宿主时，失去确认仍需沿用未知效果，不能误报没有修改属性：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if ((error as { code?: string }).code === "EFFECT_UNKNOWN")
        return {
          ok: false,
          code: "EFFECT_UNKNOWN",
          message: "属性修改结果尚未确认，请先核对文件。",
        };
      if (
        error instanceof StaleBaselineError ||
        (error as { code?: string }).code === "STALE_BASELINE"
      ) {
        return {
          ok: false,
          code: "STALE_BASELINE",
          message: "The note changed during approval; nothing was written.",
        };
      }
      return { ok: false, code: "WRITE_FAILED", message: "The Vault frontmatter write failed." };
    }
    let actual: string;
    try {
      actual = await this.vault.read(relative);
    } catch {
      return { ok: false, code: "READ_FAILED", message: "The written note could not be re-read." };
    }
    const afterHash = sha256(proposedContent);
    if (sha256(actual) !== afterHash) {
      return {
        ok: false,
        code: "AFTER_HASH_MISMATCH",
        message: "The written content does not match the approved after hash.",
        wrote: true,
      };
    }
    const receipt: VaultFrontmatterReceipt = Object.freeze({
      operationId,
      path: relative,
      kind: "frontmatter",
      beforeHash: expectedHash,
      afterHash,
      keys: Object.freeze([...keys]),
      ...(context.approvalRef !== undefined ? { approvalRef: context.approvalRef } : {}),
      safe: true,
      committedAtMs: this.now(),
    });
    if (this.receipts !== undefined) {
      try {
        await this.receipts.save(receipt);
      } catch {
        return {
          ok: false,
          code: "EFFECT_UNKNOWN",
          message:
            "The write succeeded but the receipt could not be saved; treat the effect as unknown.",
          wrote: true,
        };
      }
    }
    return {
      ok: true,
      safe: true,
      receipt,
      proposedContent,
      beforeHash: expectedHash,
      afterHash,
      diff: buildLineDiff(before, proposedContent),
    };
  }

  private parseFrontmatter(content: string): ParsedFrontmatter {
    const lines = content.split("\n");
    const hasFrontmatter = lines[0]?.trimEnd() === "---";
    if (!hasFrontmatter) {
      return { hasFrontmatter: false, values: {}, body: content };
    }
    const closeIndex = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
    if (closeIndex === -1) return { hasFrontmatter: false, values: {}, body: content };
    const raw = lines.slice(1, closeIndex).join("\n");
    let parsed: unknown;
    try {
      parsed = this.yaml.parse(raw);
    } catch {
      throw Object.assign(new Error("invalid yaml"), { code: "INVALID_YAML" });
    }
    if (!isPlainObject(parsed)) {
      throw Object.assign(new Error("non-object frontmatter"), { code: "INVALID_YAML" });
    }
    if (!Object.values(parsed).every(isJsonValue)) {
      throw Object.assign(new Error("non-json frontmatter"), { code: "NON_JSON_VALUE" });
    }
    return {
      hasFrontmatter: true,
      values: parsed,
      body: lines.slice(closeIndex + 1).join("\n"),
    };
  }

  private async resolve(
    requested: string,
    context: VaultFrontmatterContext
  ): Promise<ResolvedFrontmatterPath> {
    try {
      const resolved = await this.pathResolver.resolveVaultPath(requested);
      if (context.isPathInScope !== undefined && !context.isPathInScope(resolved.relative)) {
        return {
          ok: false,
          code: "PATH_OUT_OF_SCOPE",
          message: `The path "${requested}" is outside the approved Vault scope.`,
        };
      }
      return { ok: true, relative: resolved.relative };
    } catch (error) {
      if (error instanceof PathResolverError) {
        if (error.code === "PROTECTED_PATH") {
          return { ok: false, code: "PROTECTED_PATH", message: error.message };
        }
        if (error.code === "INVALID_ARGUMENT") {
          return { ok: false, code: "INVALID_ARGUMENT", message: error.message };
        }
        return {
          ok: false,
          code: "PATH_OUT_OF_SCOPE",
          message: `The path "${requested}" is outside the approved Vault scope.`,
        };
      }
      return { ok: false, code: "READ_FAILED", message: `Cannot resolve "${requested}".` };
    }
  }
}

function targetsOf(args: unknown): readonly { kind: "vault_path"; value: string }[] {
  if (typeof args !== "object" || args === null) return [];
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" ? [{ kind: "vault_path", value: path }] : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isPlainObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
}

function buildLineDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  const lines = [
    "--- before",
    "+++ after",
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ];
  return `${lines.join("\n")}\n`;
}

function invalid(message: string): VaultFrontmatterResult {
  return { ok: false, code: "INVALID_ARGUMENT", message };
}
