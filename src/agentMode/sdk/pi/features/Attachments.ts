import { sha256 } from "@/utils/hash";

// Image attachments keep their MIME and either a blob reference or a controlled vault path, are
// re-checked for scope and size on every read, are only handed to a model that really accepts that
// image type, are exported through the existing vault-agent-image receipt format so a reload restores
// them, and a missing attachment leaves an explicit placeholder with its original path instead of
// blocking the rest of the history:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const ATTACHMENT_RECEIPT_PATTERN =
  /<!-- vault-agent-image:([a-f0-9]{64}) -->\r?\n([\s\S]*?)\r?\n<!-- \/vault-agent-image -->/g;

export const SUPPORTED_IMAGE_MIME = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

export type AttachmentErrorCode =
  | "ATTACHMENT_PATH_DENIED"
  | "ATTACHMENT_MISSING"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_MIME_UNSUPPORTED"
  | "ATTACHMENT_SIZE_MISMATCH"
  | "ATTACHMENT_INVALID";

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode;

  constructor(code: AttachmentErrorCode, message: string) {
    super(message);
    this.name = "AttachmentError";
    this.code = code;
  }
}

export interface AttachmentRecord {
  readonly attachmentId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly contentHash: string;
  readonly blobRef?: string;
  readonly vaultPath?: string;
  readonly originalPath?: string;
}

export interface ModelImageCapability {
  readonly modelKey: string;
  readonly acceptsImages: boolean;
  readonly supportedMime: readonly string[];
  readonly maxImageBytes: number;
  readonly maxImages: number;
}

export interface AttachmentPorts {
  store: {
    save(input: {
      readonly attachmentId: string;
      readonly mime: string;
      readonly data: Uint8Array;
    }): Promise<{ readonly blobRef: string }>;
    load(
      blobRef: string
    ): Promise<{ readonly mime: string; readonly data: Uint8Array } | undefined>;
  };
  vault: {
    isPathAllowed(path: string): boolean;
    read(path: string): Promise<Uint8Array | undefined>;
  };
  modelCapability(modelKey: string): ModelImageCapability | undefined;
}

export interface AttachmentInput {
  readonly attachmentId: string;
  readonly mime: string;
  readonly data?: Uint8Array;
  readonly blobRef?: string;
  readonly vaultPath?: string;
  readonly declaredBytes?: number;
  readonly originalPath?: string;
}

export interface ResolvedAttachment {
  readonly attachmentId: string;
  readonly status: "ready" | "missing";
  readonly record?: AttachmentRecord;
  readonly placeholder?: string;
  readonly errorCode?: AttachmentErrorCode;
}

export interface ModelMessagePart {
  readonly type: "text" | "image";
  readonly text?: string;
  readonly mime?: string;
  readonly data?: Uint8Array;
}

export class Attachments {
  readonly #ports: AttachmentPorts;
  readonly #maxBytes: number;

  constructor(options: { readonly ports: AttachmentPorts; readonly maxBytes?: number }) {
    this.#ports = options.ports;
    this.#maxBytes = options.maxBytes ?? ATTACHMENT_MAX_BYTES;
  }

  async save(input: AttachmentInput): Promise<AttachmentRecord> {
    if (!SUPPORTED_IMAGE_MIME.includes(input.mime)) {
      throw new AttachmentError(
        "ATTACHMENT_MIME_UNSUPPORTED",
        `The image type "${input.mime}" is not supported.`
      );
    }
    const data = input.data;
    if (data === undefined || data.byteLength === 0) {
      throw new AttachmentError("ATTACHMENT_INVALID", "An attachment needs image data.");
    }
    if (data.byteLength > this.#maxBytes) {
      throw new AttachmentError(
        "ATTACHMENT_TOO_LARGE",
        `The attachment is ${data.byteLength} bytes; the limit is ${this.#maxBytes}.`
      );
    }
    if (input.declaredBytes !== undefined && input.declaredBytes !== data.byteLength) {
      throw new AttachmentError(
        "ATTACHMENT_SIZE_MISMATCH",
        `The attachment declared ${input.declaredBytes} bytes but carries ${data.byteLength}.`
      );
    }
    const stored = await this.#ports.store.save({
      attachmentId: input.attachmentId,
      mime: input.mime,
      data,
    });
    return Object.freeze({
      attachmentId: input.attachmentId,
      mime: input.mime,
      bytes: data.byteLength,
      contentHash: sha256(base64(data)),
      blobRef: stored.blobRef,
      ...(input.vaultPath !== undefined ? { vaultPath: input.vaultPath } : {}),
      ...(input.originalPath !== undefined ? { originalPath: input.originalPath } : {}),
    });
  }

  async resolve(input: AttachmentInput): Promise<ResolvedAttachment> {
    try {
      const record = await this.#read(input);
      return Object.freeze({
        attachmentId: input.attachmentId,
        status: "ready" as const,
        record,
      });
    } catch (thrown) {
      const code = thrown instanceof AttachmentError ? thrown.code : "ATTACHMENT_INVALID";
      return Object.freeze({
        attachmentId: input.attachmentId,
        status: "missing" as const,
        errorCode: code,
        placeholder: `[missing attachment: ${input.originalPath ?? input.vaultPath ?? input.blobRef ?? input.attachmentId}]`,
      });
    }
  }

  async toModelMessage(input: {
    readonly modelKey: string;
    readonly attachments: readonly AttachmentInput[];
    readonly text: string;
  }): Promise<readonly ModelMessagePart[]> {
    const capability = this.#ports.modelCapability(input.modelKey);
    const parts: ModelMessagePart[] = [{ type: "text", text: input.text }];
    if (input.attachments.length === 0) return Object.freeze(parts);
    if (capability === undefined || !capability.acceptsImages) {
      parts.push({
        type: "text",
        text: `[${input.attachments.length} image(s) not shown: the model "${input.modelKey}" cannot see images.]`,
      });
      return Object.freeze(parts);
    }
    let included = 0;
    for (const attachment of input.attachments) {
      if (included >= capability.maxImages) {
        parts.push({
          type: "text",
          text: `[${input.attachments.length - included} image(s) omitted: at most ${capability.maxImages} are sent.]`,
        });
        break;
      }
      const resolved = await this.resolve(attachment);
      if (resolved.status !== "ready" || resolved.record === undefined) {
        parts.push({ type: "text", text: resolved.placeholder ?? "[missing attachment]" });
        continue;
      }
      const record = resolved.record;
      if (!capability.supportedMime.includes(record.mime)) {
        parts.push({
          type: "text",
          text: `[image ${record.attachmentId} (${record.mime}) not shown: the model does not accept that type.]`,
        });
        continue;
      }
      if (record.bytes > capability.maxImageBytes) {
        parts.push({
          type: "text",
          text: `[image ${record.attachmentId} not shown: ${record.bytes} bytes exceed ${capability.maxImageBytes}.]`,
        });
        continue;
      }
      const data = await this.#loadData(record);
      if (data === undefined) {
        parts.push({
          type: "text",
          text: `[missing attachment: ${record.originalPath ?? record.vaultPath ?? record.blobRef ?? record.attachmentId}]`,
        });
        continue;
      }
      parts.push({ type: "image", mime: record.mime, data });
      included += 1;
    }
    return Object.freeze(parts);
  }

  exportReceipts(records: readonly AttachmentRecord[]): string {
    return records
      .map((record) => {
        const reference =
          record.vaultPath !== undefined
            ? `![[${record.vaultPath}]]`
            : `![${record.mime}](${record.blobRef ?? ""})`;
        return `<!-- vault-agent-image:${record.contentHash} -->\n${reference}\n<!-- /vault-agent-image -->`;
      })
      .join("\n");
  }

  importReceipts(text: string): readonly AttachmentRecord[] {
    const records: AttachmentRecord[] = [];
    const pattern = new RegExp(ATTACHMENT_RECEIPT_PATTERN.source, "g");
    for (const match of text.matchAll(pattern)) {
      const contentHash = match[1] ?? "";
      const reference = (match[2] ?? "").trim();
      const wiki = /^!\[\[([^\]]+)\]\]$/.exec(reference);
      const markdown = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(reference);
      const vaultPath = wiki?.[1];
      const blobRef = markdown?.[2];
      if (vaultPath === undefined && blobRef === undefined) continue;
      const declaredMime = markdown?.[1] ?? "";
      records.push(
        Object.freeze({
          attachmentId: wiki !== null ? `vault:${vaultPath ?? ""}` : `blob:${blobRef ?? ""}`,
          mime: declaredMime.startsWith("image/")
            ? declaredMime
            : mimeForPath(vaultPath ?? blobRef ?? ""),
          bytes: 0,
          contentHash,
          ...(blobRef !== undefined ? { blobRef } : {}),
          ...(vaultPath !== undefined ? { vaultPath, originalPath: vaultPath } : {}),
        })
      );
    }
    return Object.freeze(records);
  }

  async #read(input: AttachmentInput): Promise<AttachmentRecord> {
    if (input.blobRef !== undefined) {
      const stored = await this.#ports.store.load(input.blobRef);
      if (stored === undefined) {
        throw new AttachmentError("ATTACHMENT_MISSING", `No stored blob for "${input.blobRef}".`);
      }
      return Object.freeze({
        attachmentId: input.attachmentId,
        mime: stored.mime,
        bytes: stored.data.byteLength,
        contentHash: sha256(base64(stored.data)),
        blobRef: input.blobRef,
        ...(input.originalPath !== undefined ? { originalPath: input.originalPath } : {}),
      });
    }
    if (input.vaultPath !== undefined) {
      if (!this.#ports.vault.isPathAllowed(input.vaultPath)) {
        throw new AttachmentError(
          "ATTACHMENT_PATH_DENIED",
          `The attachment path "${input.vaultPath}" is outside the allowed scopes.`
        );
      }
      const data = await this.#ports.vault.read(input.vaultPath);
      if (data === undefined) {
        throw new AttachmentError(
          "ATTACHMENT_MISSING",
          `The attachment "${input.vaultPath}" does not exist.`
        );
      }
      if (data.byteLength > this.#maxBytes) {
        throw new AttachmentError(
          "ATTACHMENT_TOO_LARGE",
          `The attachment is ${data.byteLength} bytes; the limit is ${this.#maxBytes}.`
        );
      }
      return Object.freeze({
        attachmentId: input.attachmentId,
        mime: input.mime,
        bytes: data.byteLength,
        contentHash: sha256(base64(data)),
        vaultPath: input.vaultPath,
        originalPath: input.originalPath ?? input.vaultPath,
      });
    }
    if (input.data !== undefined) {
      return this.save(input);
    }
    throw new AttachmentError("ATTACHMENT_INVALID", "An attachment needs a blobRef or a path.");
  }

  async #loadData(record: AttachmentRecord): Promise<Uint8Array | undefined> {
    if (record.blobRef !== undefined) {
      return (await this.#ports.store.load(record.blobRef))?.data;
    }
    if (record.vaultPath !== undefined) {
      if (!this.#ports.vault.isPathAllowed(record.vaultPath)) return undefined;
      return await this.#ports.vault.read(record.vaultPath);
    }
    return undefined;
  }
}

function mimeForPath(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  return "application/octet-stream";
}

function base64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return binary;
}
