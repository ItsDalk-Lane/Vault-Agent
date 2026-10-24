import { sha256 } from "@/utils/hash";

// The legacy compatibility layer is a pure file reader: it parses the Markdown and JSON shapes earlier
// builds wrote, keeps the original backendId/sessionId/title and unknown fields, honours the session
// index tombstone so a deleted chat is never resurrected by a scan, has no process or binary capability
// at all, and states plainly when only a text import is possible instead of claiming a full restore:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const LEGACY_TEXT_ONLY_NOTICE =
  "Text-only import: the original tool history is not available, so only the visible messages were restored.";

export interface LegacyChatMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
}

export interface LegacyChatEntry {
  readonly backendId: string;
  readonly sessionId: string;
  readonly title: string | null;
  readonly titleSource?: "user" | "agent";
  readonly createdAtMs: number;
  readonly lastAccessedAtMs: number;
  readonly projectId?: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly messages: readonly LegacyChatMessage[];
  readonly unknownFields: Readonly<Record<string, unknown>>;
  readonly importMode: "full" | "text_only";
  readonly notice?: string;
}

export interface LegacySkippedFile {
  readonly path: string;
  readonly reason: "tombstoned" | "duplicate_source" | "unparsable";
}

export interface LegacyHistoryReaderPorts {
  listFiles(): Promise<readonly { readonly path: string; readonly content: string }[]>;
  isTombstoned(backendId: string, sessionId: string): Promise<boolean>;
}

export interface LegacyHistoryReadResult {
  readonly entries: readonly LegacyChatEntry[];
  readonly skipped: readonly LegacySkippedFile[];
}

const FRONTMATTER_KEYS = new Set([
  "backendid",
  "sessionid",
  "title",
  "titlesource",
  "createdatms",
  "createdat",
  "lastaccessedatms",
  "projectid",
  "mode",
]);

export class LegacyHistoryReader {
  readonly #ports: LegacyHistoryReaderPorts;

  constructor(options: { readonly ports: LegacyHistoryReaderPorts }) {
    this.#ports = options.ports;
  }

  async readAll(): Promise<LegacyHistoryReadResult> {
    const files = await this.#ports.listFiles();
    const entries: LegacyChatEntry[] = [];
    const skipped: LegacySkippedFile[] = [];
    const seenHashes = new Set<string>();
    for (const file of files) {
      const sourceHash = sha256(file.content);
      if (seenHashes.has(sourceHash)) {
        skipped.push({ path: file.path, reason: "duplicate_source" });
        continue;
      }
      const parsed = this.parse(file.path, file.content);
      if (parsed === undefined) {
        skipped.push({ path: file.path, reason: "unparsable" });
        continue;
      }
      seenHashes.add(sourceHash);
      if (await this.#ports.isTombstoned(parsed.backendId, parsed.sessionId)) {
        skipped.push({ path: file.path, reason: "tombstoned" });
        continue;
      }
      entries.push(parsed);
    }
    return Object.freeze({
      entries: Object.freeze(entries),
      skipped: Object.freeze(skipped),
    });
  }

  parse(path: string, content: string): LegacyChatEntry | undefined {
    const trimmed = content.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed.startsWith("{")) return this.#parseJson(path, content);
    return this.#parseMarkdown(path, content);
  }

  needsTextOnlyNotice(content: string): boolean {
    const parsed = this.parse("inline.md", content);
    return parsed !== undefined && parsed.importMode === "text_only";
  }

  #parseJson(path: string, content: string): LegacyChatEntry | undefined {
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return undefined;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    const backendId = typeof record.backendId === "string" ? record.backendId : undefined;
    const sessionId = typeof record.sessionId === "string" ? record.sessionId : undefined;
    if (backendId === undefined || sessionId === undefined) return undefined;
    const createdAtMs = readNumber(record.createdAtMs) ?? readNumber(record.createdAt) ?? 0;
    const lastAccessedAtMs = readNumber(record.lastAccessedAtMs) ?? createdAtMs;
    const messages: LegacyChatMessage[] = [];
    let structuredToolHistory = true;
    const rawMessages = record.messages;
    if (Array.isArray(rawMessages)) {
      for (const message of rawMessages) {
        if (typeof message !== "object" || message === null) {
          structuredToolHistory = false;
          continue;
        }
        const entry = message as Record<string, unknown>;
        const role =
          entry.role === "user" || entry.role === "assistant" || entry.role === "system"
            ? entry.role
            : undefined;
        if (role === undefined) {
          structuredToolHistory = false;
          continue;
        }
        const text = typeof entry.content === "string" ? entry.content : "";
        if (entry.toolCalls !== undefined && !Array.isArray(entry.toolCalls)) {
          structuredToolHistory = false;
        }
        messages.push(Object.freeze({ role, text }));
      }
    } else if (rawMessages !== undefined) {
      structuredToolHistory = false;
    }
    const title =
      typeof record.title === "string" && record.title.trim() ? record.title.trim() : null;
    const entry: LegacyChatEntry = {
      backendId,
      sessionId,
      title,
      ...(record.titleSource === "user" || record.titleSource === "agent"
        ? { titleSource: record.titleSource }
        : {}),
      createdAtMs,
      lastAccessedAtMs,
      ...(typeof record.projectId === "string" && record.projectId.trim()
        ? { projectId: record.projectId }
        : {}),
      sourcePath: path,
      sourceHash: sha256(content),
      messages: Object.freeze(messages),
      unknownFields: Object.freeze(
        collectUnknown(record, [
          "backendId",
          "sessionId",
          "title",
          "titleSource",
          "createdAtMs",
          "createdAt",
          "lastAccessedAtMs",
          "projectId",
          "messages",
        ])
      ),
      importMode: structuredToolHistory ? "full" : "text_only",
      ...(structuredToolHistory ? {} : { notice: LEGACY_TEXT_ONLY_NOTICE }),
    };
    return Object.freeze(entry);
  }

  #parseMarkdown(path: string, content: string): LegacyChatEntry | undefined {
    const frontmatter = readFrontmatter(content);
    const body = frontmatter.body;
    const messages = readMarkdownMessages(body);
    const backendId =
      readFrontmatterString(frontmatter.values, "backendid") ??
      (body.trim().length > 0 ? "legacy-unknown" : undefined);
    const sessionId =
      readFrontmatterString(frontmatter.values, "sessionid") ??
      (path.split("/").pop()?.replace(/\.md$/i, "") || undefined);
    if (backendId === undefined || sessionId === undefined) return undefined;
    if (messages.length === 0 && body.trim().length === 0) return undefined;
    const title = readFrontmatterString(frontmatter.values, "title") ?? null;
    const createdAtMs =
      readFrontmatterNumber(frontmatter.values, "createdatms") ??
      readDateMs(readFrontmatterString(frontmatter.values, "createdat")) ??
      0;
    const lastAccessedAtMs =
      readFrontmatterNumber(frontmatter.values, "lastaccessedatms") ?? createdAtMs;
    const projectId = readFrontmatterString(frontmatter.values, "projectid");
    const unknown: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter.values)) {
      if (!FRONTMATTER_KEYS.has(key.toLowerCase())) unknown[key] = value;
    }
    const entry: LegacyChatEntry = {
      backendId,
      sessionId,
      title,
      createdAtMs,
      lastAccessedAtMs,
      ...(projectId !== undefined ? { projectId } : {}),
      sourcePath: path,
      sourceHash: sha256(content),
      messages: Object.freeze(
        messages.length > 0
          ? messages
          : [{ role: "assistant" as const, text: body.trim() }].map((message) =>
              Object.freeze(message)
            )
      ),
      unknownFields: Object.freeze(unknown),
      importMode: "text_only",
      notice: LEGACY_TEXT_ONLY_NOTICE,
    };
    return Object.freeze(entry);
  }
}

function readFrontmatter(content: string): {
  readonly values: Record<string, string>;
  readonly body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (match === null) return { values: {}, body: content };
  const values: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return { values, body: content.slice(match[0].length) };
}

function readFrontmatterString(values: Record<string, string>, key: string): string | undefined {
  const entry = Object.entries(values).find(([name]) => name.toLowerCase() === key);
  return entry !== undefined && entry[1].trim().length > 0 ? entry[1].trim() : undefined;
}

function readMarkdownMessages(body: string): LegacyChatMessage[] {
  const messages: LegacyChatMessage[] = [];
  const pattern =
    /^\*\*(user|ai|assistant|system)\*\*:\s*([\s\S]*?)(?=\n\*\*(?:user|ai|assistant|system)\*\*: |$)/gm;
  for (const match of body.matchAll(pattern)) {
    const role =
      match[1] === "user" ? "user" : match[1] === "system" ? "system" : ("assistant" as const);
    const text = (match[2] ?? "").trim();
    if (text.length === 0) continue;
    messages.push(Object.freeze({ role, text }));
  }
  return messages;
}

function collectUnknown(
  record: Record<string, unknown>,
  known: readonly string[]
): Record<string, unknown> {
  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (known.includes(key)) continue;
    unknown[key] = value;
  }
  return unknown;
}

function readFrontmatterNumber(values: Record<string, string>, key: string): number | undefined {
  return readNumber(readFrontmatterString(values, key));
}

function readDateMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
