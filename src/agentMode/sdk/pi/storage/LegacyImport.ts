import type { LegacyChatEntry } from "@/agentMode/session/legacy/LegacyHistoryReader";

// Importing a legacy chat creates a new Pi root and records its sourceHash mapping, so clicking the same
// source twice returns the existing mapping instead of building a second session; the imported history is
// appended as labelled material (never as a new user instruction), only the fields that really exist are
// copied, missing tool results are never fabricated, attachments and the material budget are validated,
// and the old file itself is only ever read:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const LEGACY_IMPORT_MAX_MATERIAL_BYTES = 128 * 1024;

export interface LegacyImportMapping {
  readonly sourceHash: string;
  readonly rootId: string;
  readonly sessionId: string;
  readonly importedAtMs: number;
  readonly status?: "pending_material" | "completed";
  readonly messageId?: string;
}

export interface LegacyImportPorts {
  findMapping(sourceHash: string): Promise<LegacyImportMapping | undefined>;
  createRoot(input: {
    readonly title: string | null;
    readonly backendId: string;
    readonly sourcePath: string;
    readonly sourceHash: string;
    readonly projectId?: string;
  }): Promise<{ readonly rootId: string; readonly sessionId: string }>;
  saveMapping(mapping: LegacyImportMapping): Promise<void>;
  appendMaterial(input: {
    readonly requestId: string;
    readonly sessionId: string;
    readonly text: string;
    readonly origin: "legacy_session";
    readonly sourcePath: string;
    readonly contentHash: string;
    readonly importMode: "full" | "text_only";
    readonly truncated: boolean;
  }): Promise<{ readonly messageId: string }>;
  loadAttachment?(
    ref: string
  ): Promise<{ readonly mime: string; readonly bytes: number } | undefined>;
  now?(): number;
}

export interface LegacyImportAttachmentInput {
  readonly ref: string;
}

export interface LegacyImportResult {
  readonly status: "created" | "already_imported";
  readonly rootId: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly materialBytes: number;
  readonly truncated: boolean;
  readonly notices: readonly string[];
}

export class LegacyImport {
  readonly #ports: LegacyImportPorts;
  readonly #maxMaterialBytes: number;
  readonly #mappings = new Map<string, LegacyImportMapping>();
  readonly #inFlight = new Map<string, Promise<LegacyImportResult>>();

  constructor(options: { readonly ports: LegacyImportPorts; readonly maxMaterialBytes?: number }) {
    this.#ports = options.ports;
    this.#maxMaterialBytes = options.maxMaterialBytes ?? LEGACY_IMPORT_MAX_MATERIAL_BYTES;
  }

  async importEntry(
    entry: LegacyChatEntry,
    options: { readonly attachments?: readonly LegacyImportAttachmentInput[] } = {}
  ): Promise<LegacyImportResult> {
    const active = this.#inFlight.get(entry.sourceHash);
    if (active)
      return active.then((result) =>
        Object.freeze({ ...result, status: "already_imported" as const })
      );
    const work = this.#importEntry(entry, options);
    this.#inFlight.set(entry.sourceHash, work);
    try {
      return await work;
    } finally {
      if (this.#inFlight.get(entry.sourceHash) === work) this.#inFlight.delete(entry.sourceHash);
    }
  }

  async #importEntry(
    entry: LegacyChatEntry,
    options: { readonly attachments?: readonly LegacyImportAttachmentInput[] }
  ): Promise<LegacyImportResult> {
    const cached = this.#mappings.get(entry.sourceHash);
    const existing = cached ?? (await this.#ports.findMapping(entry.sourceHash));
    if (existing?.status === "completed") {
      this.#mappings.set(entry.sourceHash, existing);
      return Object.freeze({
        status: "already_imported" as const,
        rootId: existing.rootId,
        sessionId: existing.sessionId,
        materialBytes: 0,
        truncated: false,
        notices: Object.freeze([]),
      });
    }
    const notices: string[] = [];
    const attachmentLines: string[] = [];
    for (const attachment of options.attachments ?? []) {
      const loaded = await this.#ports.loadAttachment?.(attachment.ref);
      if (loaded === undefined) {
        attachmentLines.push(`[missing attachment: ${attachment.ref}]`);
        notices.push(`The attachment "${attachment.ref}" is missing and was not imported.`);
        continue;
      }
      attachmentLines.push(
        `[attachment: ${attachment.ref} (${loaded.mime}, ${loaded.bytes} bytes)]`
      );
    }
    const body = renderMaterial(entry, attachmentLines);
    const bytes = utf8Bytes(body);
    const truncated = bytes > this.#maxMaterialBytes;
    const text = truncated ? truncateToBytes(body, this.#maxMaterialBytes) : body;
    if (truncated) {
      notices.push(
        `The imported history exceeded ${this.#maxMaterialBytes} bytes and was truncated; read the original at ${entry.sourcePath} on demand.`
      );
    }
    if (entry.importMode === "text_only") {
      notices.push(
        "Only the visible messages were imported; the original tool history is unavailable and was not invented."
      );
    }
    const root =
      existing ??
      (await this.#ports.createRoot({
        title: entry.title,
        backendId: entry.backendId,
        sourcePath: entry.sourcePath,
        sourceHash: entry.sourceHash,
        ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
      }));
    const now = this.#ports.now?.() ?? Date.now();
    const mapping: LegacyImportMapping =
      existing ??
      Object.freeze({
        sourceHash: entry.sourceHash,
        rootId: root.rootId,
        sessionId: root.sessionId,
        importedAtMs: now,
        status: "pending_material" as const,
      });
    if (!existing) await this.#ports.saveMapping(mapping);
    this.#mappings.set(entry.sourceHash, mapping);
    // 映射和材料分步提交时，重开必须补写尚未完成的材料，且使用稳定请求号防止重复：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const appended = await this.#ports.appendMaterial({
      requestId: `legacy-import:${entry.sourceHash}`,
      sessionId: root.sessionId,
      text,
      origin: "legacy_session",
      sourcePath: entry.sourcePath,
      contentHash: entry.sourceHash,
      importMode: entry.importMode,
      truncated,
    });
    const completed: LegacyImportMapping = Object.freeze({
      ...mapping,
      status: "completed",
      messageId: appended.messageId,
    });
    await this.#ports.saveMapping(completed);
    this.#mappings.set(entry.sourceHash, completed);
    return Object.freeze({
      status: existing ? ("already_imported" as const) : ("created" as const),
      rootId: root.rootId,
      sessionId: root.sessionId,
      messageId: appended.messageId,
      materialBytes: utf8Bytes(text),
      truncated,
      notices: Object.freeze(notices),
    });
  }

  mappingFor(sourceHash: string): LegacyImportMapping | undefined {
    return this.#mappings.get(sourceHash);
  }
}

export function renderMaterial(
  entry: LegacyChatEntry,
  attachmentLines: readonly string[] = []
): string {
  const lines = [
    `[Imported legacy chat: backend=${entry.backendId}, source=${entry.sourcePath}, hash=${entry.sourceHash}]`,
    "[This is historical material from an earlier chat, not a new user instruction.]",
  ];
  if (entry.title !== null) lines.push(`Title: ${entry.title}`);
  for (const message of entry.messages) {
    lines.push(`**${message.role}**: ${message.text}`);
  }
  lines.push(...attachmentLines);
  return lines.join("\n");
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function truncateToBytes(value: string, limit: number): string {
  let bytes = 0;
  let output = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > limit) break;
    bytes += size;
    output += char;
  }
  return output;
}
