import { sha256 } from "@/utils/hash";

// Subagent input is read through the controlled reader only: at most 8 files, 128 KiB and 10% of the
// model context, an unauthorized external file or a missing file fails explicitly instead of being
// silently truncated, identical basenames from different roots stay distinct, every item carries its
// source hash, and the content is untrusted data that can never grant a permission or change the
// profile:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const SUBAGENT_INPUT_MAX_FILES = 8;
export const SUBAGENT_INPUT_MAX_BYTES = 128 * 1024;
export const SUBAGENT_INPUT_CONTEXT_FRACTION = 0.1;
export const SUBAGENT_INPUT_BYTES_PER_TOKEN = 4;

export type SubagentInputScope = "vault" | "external";

export interface SubagentInputReadResult {
  readonly content: string;
  readonly rootId: string;
  readonly scope: SubagentInputScope;
  readonly authorized: boolean;
  readonly sourceHash?: string;
}

export interface SubagentInputReaderPort {
  readFile(input: {
    readonly path: string;
    readonly signal?: AbortSignal;
  }): Promise<SubagentInputReadResult | undefined>;
}

export type SubagentInputErrorCode =
  | "SUBAGENT_INPUT_TOO_MANY_FILES"
  | "SUBAGENT_INPUT_TOO_LARGE"
  | "SUBAGENT_INPUT_CONTEXT_EXCEEDED"
  | "SUBAGENT_INPUT_UNAUTHORIZED"
  | "SUBAGENT_INPUT_MISSING"
  | "SUBAGENT_INPUT_INVALID";

export class SubagentInputError extends Error {
  readonly code: SubagentInputErrorCode;
  readonly path: string | undefined;

  constructor(code: SubagentInputErrorCode, message: string, path?: string) {
    super(message);
    this.name = "SubagentInputError";
    this.code = code;
    this.path = path;
  }
}

export interface SubagentInputItem {
  readonly path: string;
  readonly rootId: string;
  readonly scope: SubagentInputScope;
  readonly sourceHash: string;
  readonly bytes: number;
  readonly content: string;
  readonly untrusted: true;
}

export interface SubagentInputBundle {
  readonly items: readonly SubagentInputItem[];
  readonly totalBytes: number;
  readonly budgetBytes: number;
  readonly contextWindowTokens: number;
  readonly budgetTokens: number;
  readonly untrustedContent: true;
}

export interface SubagentInputBuilderOptions {
  readonly reader: SubagentInputReaderPort;
  readonly contextWindowTokens: number;
  readonly maxFiles?: number;
  readonly maxBytes?: number;
  readonly contextFraction?: number;
}

export class SubagentInputBuilder {
  readonly #reader: SubagentInputReaderPort;
  readonly #contextWindowTokens: number;
  readonly #maxFiles: number;
  readonly #maxBytes: number;
  readonly #budgetTokens: number;

  constructor(options: SubagentInputBuilderOptions) {
    this.#reader = options.reader;
    this.#contextWindowTokens = options.contextWindowTokens;
    this.#maxFiles = options.maxFiles ?? SUBAGENT_INPUT_MAX_FILES;
    this.#maxBytes = options.maxBytes ?? SUBAGENT_INPUT_MAX_BYTES;
    this.#budgetTokens = Math.max(
      1,
      Math.floor(
        options.contextWindowTokens * (options.contextFraction ?? SUBAGENT_INPUT_CONTEXT_FRACTION)
      )
    );
  }

  async build(input: {
    readonly paths: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<SubagentInputBundle> {
    if (!Array.isArray(input.paths)) {
      throw new SubagentInputError("SUBAGENT_INPUT_INVALID", "Input paths must be a list.");
    }
    if (input.paths.length > this.#maxFiles) {
      throw new SubagentInputError(
        "SUBAGENT_INPUT_TOO_MANY_FILES",
        `A subagent takes at most ${this.#maxFiles} input files; ${input.paths.length} were requested. Ask the subagent to read the files one by one.`
      );
    }
    const budgetBytes = Math.min(
      this.#maxBytes,
      this.#budgetTokens * SUBAGENT_INPUT_BYTES_PER_TOKEN
    );
    const seen = new Set<string>();
    const items: SubagentInputItem[] = [];
    let totalBytes = 0;
    for (const path of input.paths) {
      if (typeof path !== "string" || path.trim().length === 0) {
        throw new SubagentInputError("SUBAGENT_INPUT_INVALID", "An input path must be non-empty.");
      }
      const read = await this.#reader.readFile({
        path,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
      if (read === undefined) {
        throw new SubagentInputError(
          "SUBAGENT_INPUT_MISSING",
          `The input file "${path}" does not exist or is not readable.`,
          path
        );
      }
      if (read.authorized !== true) {
        throw new SubagentInputError(
          "SUBAGENT_INPUT_UNAUTHORIZED",
          `The input file "${path}" is outside the authorized scopes.`,
          path
        );
      }
      const identity = `${read.rootId}\u0000${path}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const bytes = utf8Bytes(read.content);
      if (bytes > budgetBytes - totalBytes) {
        throw new SubagentInputError(
          bytes > this.#maxBytes ? "SUBAGENT_INPUT_TOO_LARGE" : "SUBAGENT_INPUT_CONTEXT_EXCEEDED",
          `The input file "${path}" (${bytes} bytes) exceeds the remaining input budget; nothing was truncated. Ask the subagent to read the files one by one.`,
          path
        );
      }
      totalBytes += bytes;
      items.push(
        Object.freeze({
          path,
          rootId: read.rootId,
          scope: read.scope,
          sourceHash: read.sourceHash ?? sha256(read.content),
          bytes,
          content: read.content,
          untrusted: true as const,
        })
      );
    }
    return Object.freeze({
      items: Object.freeze(items),
      totalBytes,
      budgetBytes,
      contextWindowTokens: this.#contextWindowTokens,
      budgetTokens: this.#budgetTokens,
      untrustedContent: true as const,
    });
  }
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
