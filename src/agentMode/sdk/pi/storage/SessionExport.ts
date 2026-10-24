import { sha256 } from "@/utils/hash";

export const SESSION_EXPORT_SCHEMA = "vault-agent.session-export";
export const SESSION_EXPORT_VERSION = 1;
export const SESSION_EXPORT_MAX_BYTES = 8 * 1024 * 1024;

export type SessionExportErrorCode =
  | "SESSION_EXPORT_TOO_LARGE"
  | "SESSION_EXPORT_HASH_MISMATCH"
  | "SESSION_EXPORT_FUTURE_VERSION"
  | "SESSION_EXPORT_UNREADABLE";

export interface SessionExportMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly timestampMs?: number;
}

export interface SessionExportAttachment {
  readonly attachmentId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly contentHash: string;
  readonly blobRef?: string;
  readonly vaultPath?: string;
}

export interface SessionExportInput {
  readonly sessionId: string;
  readonly backendId: string;
  readonly title: string | null;
  readonly projectId?: string;
  readonly createdAtMs: number;
  readonly lastAccessedAtMs: number;
  readonly messages: readonly SessionExportMessage[];
  readonly attachments?: readonly SessionExportAttachment[];
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface SessionExportDocument {
  readonly schema: string;
  readonly version: number;
  readonly exportedAtMs: number;
  readonly contentHash: string;
  readonly session: SessionExportInput;
}

export interface SessionExportPorts {
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  now?(): number;
}

export interface SessionExportSuccess {
  readonly ok: true;
  readonly path: string;
  readonly bytes: number;
  readonly contentHash: string;
}

export interface SessionExportFailure {
  readonly ok: false;
  readonly errorCode: SessionExportErrorCode;
  readonly message: string;
  readonly bytes?: number;
  readonly limit?: number;
}

export interface SessionImportSuccess {
  readonly ok: true;
  readonly document: SessionExportDocument;
  readonly readOnly: true;
  readonly requiresAuthorization: true;
  readonly notices: readonly string[];
}

export class SessionExport {
  readonly #ports: SessionExportPorts;
  readonly #maxBytes: number;

  constructor(options: { readonly ports: SessionExportPorts; readonly maxBytes?: number }) {
    this.#ports = options.ports;
    this.#maxBytes = options.maxBytes ?? SESSION_EXPORT_MAX_BYTES;
  }

  async exportSession(
    input: SessionExportInput
  ): Promise<SessionExportSuccess | SessionExportFailure> {
    const session = redactSecrets({ ...input }) as SessionExportInput;
    const document: SessionExportDocument = Object.freeze({
      schema: SESSION_EXPORT_SCHEMA,
      version: SESSION_EXPORT_VERSION,
      exportedAtMs: this.#ports.now?.() ?? Date.now(),
      contentHash: sha256(canonicalJson(session)),
      session,
    });
    const content = `${canonicalJson(document)}\n`;
    const bytes = utf8Bytes(content);
    if (bytes > this.#maxBytes) {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_TOO_LARGE" as const,
        message: `The export is ${bytes} bytes and exceeds the ${this.#maxBytes} byte limit.`,
        bytes,
        limit: this.#maxBytes,
      });
    }
    const path = `exports/${input.sessionId}.json`;
    await this.#ports.writeFile(path, content);
    return Object.freeze({ ok: true, path, bytes, contentHash: document.contentHash });
  }

  async importDocument(path: string): Promise<SessionImportSuccess | SessionExportFailure> {
    let raw: string;
    try {
      raw = await this.#ports.readFile(path);
    } catch (thrown) {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_UNREADABLE" as const,
        message: thrown instanceof Error ? thrown.message : "The export could not be read.",
      });
    }
    const bytes = utf8Bytes(raw);
    if (bytes > this.#maxBytes) {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_TOO_LARGE" as const,
        message: `The export is ${bytes} bytes and exceeds the ${this.#maxBytes} byte limit.`,
        bytes,
        limit: this.#maxBytes,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_UNREADABLE" as const,
        message: "The export is not valid JSON.",
      });
    }
    if (
      !isRecord(parsed) ||
      parsed.schema !== SESSION_EXPORT_SCHEMA ||
      !Number.isSafeInteger(parsed.version) ||
      (parsed.version as number) < 1
    ) {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_UNREADABLE" as const,
        message: "The export has an unsupported document schema or version.",
      });
    }
    if ((parsed.version as number) > SESSION_EXPORT_VERSION) {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_FUTURE_VERSION" as const,
        message: `The export uses version ${String(parsed.version)}; this build only reads up to ${SESSION_EXPORT_VERSION}.`,
      });
    }
    if (
      !isTimestamp(parsed.exportedAtMs) ||
      typeof parsed.contentHash !== "string" ||
      !isSessionInput(parsed.session)
    ) {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_UNREADABLE" as const,
        message: "The export has invalid session fields.",
      });
    }
    let contentHash: string;
    try {
      contentHash = sha256(canonicalJson(parsed.session));
    } catch {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_UNREADABLE" as const,
        message: "The export is too deeply nested to read safely.",
      });
    }
    if (contentHash !== parsed.contentHash) {
      return Object.freeze({
        ok: false,
        errorCode: "SESSION_EXPORT_HASH_MISMATCH" as const,
        message: "The export content does not match its recorded hash.",
      });
    }
    const document = parsed as unknown as SessionExportDocument;
    return Object.freeze({
      ok: true,
      document,
      readOnly: true as const,
      requiresAuthorization: true as const,
      notices: Object.freeze([
        "The export was read without changing anything; the session needs authorization before it runs.",
      ]),
    });
  }

  toMarkdown(input: SessionExportInput): string {
    const frontmatter = [
      "---",
      `epoch: ${input.createdAtMs}`,
      "mode: agent",
      `backendId: ${input.backendId}`,
      ...(input.title !== null ? [`title: ${input.title}`] : []),
      ...(input.projectId !== undefined ? [`projectId: ${input.projectId}`] : []),
      "---",
      "",
    ];
    const turns = input.messages.map((message) => {
      const label = message.role === "user" ? "user" : "ai";
      return `**${label}**: ${message.text}`;
    });
    return `${frontmatter.join("\n")}${turns.join("\n\n")}\n`;
  }

  fromMarkdown(content: string): readonly SessionExportMessage[] {
    const messages: SessionExportMessage[] = [];
    const pattern =
      /^\*\*(user|ai|assistant|system)\*\*:\s*([\s\S]*?)(?=\n\*\*(?:user|ai|assistant|system)\*\*: |$)/gm;
    for (const match of content.matchAll(pattern)) {
      const role =
        match[1] === "user" ? "user" : match[1] === "system" ? "system" : ("assistant" as const);
      const text = (match[2] ?? "").trim();
      if (text.length === 0) continue;
      messages.push(Object.freeze({ role, text }));
    }
    return Object.freeze(messages);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSessionInput(value: unknown): value is SessionExportInput {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    typeof value.backendId !== "string" ||
    !value.backendId ||
    (value.title !== null && typeof value.title !== "string") ||
    !isTimestamp(value.createdAtMs) ||
    !isTimestamp(value.lastAccessedAtMs)
  )
    return false;
  if (value.projectId !== undefined && typeof value.projectId !== "string") return false;
  if (
    !Array.isArray(value.messages) ||
    !value.messages.every(
      (message: unknown) =>
        isRecord(message) &&
        (message.role === "user" || message.role === "assistant" || message.role === "system") &&
        typeof message.text === "string" &&
        (message.timestampMs === undefined || isTimestamp(message.timestampMs))
    )
  )
    return false;
  if (
    value.attachments !== undefined &&
    (!Array.isArray(value.attachments) ||
      !value.attachments.every(
        (attachment: unknown) =>
          isRecord(attachment) &&
          typeof attachment.attachmentId === "string" &&
          !!attachment.attachmentId &&
          typeof attachment.mime === "string" &&
          !!attachment.mime &&
          Number.isSafeInteger(attachment.bytes) &&
          (attachment.bytes as number) >= 0 &&
          typeof attachment.contentHash === "string" &&
          /^[a-f0-9]{64}$/.test(attachment.contentHash) &&
          (attachment.blobRef === undefined || typeof attachment.blobRef === "string") &&
          (attachment.vaultPath === undefined || typeof attachment.vaultPath === "string")
      ))
  )
    return false;
  return value.extras === undefined || isRecord(value.extras);
}

const SECRET_KEY =
  /(apikey|api_key|token|secret|password|passphrase|credential|authorization|cookie)/i;

export function redactSecrets(value: unknown): unknown {
  // 可分享备份只保留公开思考，不能把供应商遮蔽内容或不透明签名带出会话：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  if (Array.isArray(value))
    return value
      .filter(
        (entry: unknown) => !isRecord(entry) || entry.type !== "thinking" || entry.redacted !== true
      )
      .map((entry) => redactSecrets(entry));
  if (typeof value !== "object" || value === null) return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key) || key === "thinkingSignature") continue;
    output[key] = redactSecrets(entry);
  }
  return output;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
