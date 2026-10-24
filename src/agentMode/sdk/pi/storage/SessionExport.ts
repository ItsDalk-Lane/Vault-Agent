import { sha256 } from "@/utils/hash";

export const SESSION_EXPORT_SCHEMA = "vault-agent.session-export";
export const SESSION_EXPORT_VERSION = 1;

export interface SessionExportMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly timestampMs?: number;
  readonly attachments?: readonly string[];
}

export interface SessionExportAttachment {
  readonly attachmentId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly contentHash: string;
  readonly name?: string;
  readonly data?: string;
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
  now?(): number;
}

export interface SessionExportSuccess {
  readonly ok: true;
  readonly path: string;
  readonly bytes: number;
  readonly contentHash: string;
}

export class SessionExport {
  readonly #ports: SessionExportPorts;

  constructor(options: { readonly ports: SessionExportPorts }) {
    this.#ports = options.ports;
  }

  async exportSession(input: SessionExportInput): Promise<SessionExportSuccess> {
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
    const path = `exports/${input.sessionId}.json`;
    await this.#ports.writeFile(path, content);
    return Object.freeze({ ok: true, path, bytes, contentHash: document.contentHash });
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
      return `**${label}**: ${message.text}${(message.attachments ?? []).map((name) => `\n\n![${name}](${name})`).join("")}`;
    });
    const files = (input.attachments ?? [])
      .filter((file) => file.mime === "text/plain" && file.name)
      .map((file) => `[${file.name}](${file.name})`);
    return `${frontmatter.join("\n")}${[...turns, ...files].join("\n\n")}\n`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
