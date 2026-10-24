import { sha256 } from "@/utils/hash";
import type { TAbstractFile } from "obsidian";
import {
  prepareChatImagesForSave,
  stripChatImageReceipts,
  updateChatTranscript,
} from "@/utils/chatImagePersistence";
import { serializeFanoutComposite } from "@/agentMode/session/fanout/fanoutTypes";
import {
  LEGACY_TEXT_ONLY_NOTICE,
  LegacyHistoryReader,
} from "@/agentMode/session/legacy/LegacyHistoryReader";
import { AGENT_CHAT_MODE, AI_SENDER, VAULT_AGENT_CONVERSATION_TAG, USER_SENDER } from "@/constants";
import { logError, logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { getEffectiveConversationsFolder } from "@/settings/vaultAgentFolder";
import { FormattedDateTime } from "@/types/message";
import {
  ensureFolderExists,
  formatDateTime,
  getUtf8ByteLength,
  truncateToByteLimit,
} from "@/utils";
import {
  isFileAlreadyExistsError,
  isNameTooLongError,
  listMarkdownFiles,
  patchFrontmatter,
  trashFile,
} from "@/utils/vaultAdapterUtils";
import { joinPosix } from "@/utils/pathUtils";
import { TFile, type App } from "obsidian";
import {
  coerceProjectId,
  escapeYamlString,
  type FrontmatterUpdates,
  mergeFrontmatter,
  unescapeYamlString,
} from "./agentChatYaml";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage, BackendId, SessionUsage } from "./types";

const SAFE_FILENAME_BYTE_LIMIT = 100;
const AGENT_FILENAME_PREFIX = "agent__";

function parseUsageJson(raw: unknown): SessionUsage | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SessionUsage).usedTokens === "number" &&
      typeof (parsed as SessionUsage).updatedAt === "number"
    ) {
      return parsed as SessionUsage;
    }
  } catch {
    return undefined;
  }
}

export interface LoadedAgentChat {
  messages: AgentChatMessage[];
  backendId: BackendId;
  topic?: string;
  label?: string;
  sessionId?: string;
  projectId: string;
  usage?: SessionUsage;
}

const TRANSCRIPT_EMBED = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;

/** A missing attachment must not block the rest of the history: a resolvable embed stays as it is,
 * while an unavailable one becomes an explicit placeholder that still names its original path.
 * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
 */
export function placeholderMissingAttachments(
  text: string,
  isAvailable: (target: string) => boolean
): string {
  return text.replace(TRANSCRIPT_EMBED, (embed, wiki?: string, markdown?: string) => {
    const target = wiki ?? markdown ?? "";
    if (target.length === 0 || isAvailable(target)) return embed;
    return `[missing attachment: ${target}]`;
  });
}

export class AgentChatPersistenceManager {
  private readonly loadedTranscripts = new Map<TAbstractFile | string, string>();

  constructor(private readonly app: App) {}

  private async updateTranscript(
    path: string,
    render: (current: string) => string,
    finalize?: (text: string) => string
  ): Promise<void> {
    const key = this.app.vault.getAbstractFileByPath(path) ?? path;
    const baseline = await updateChatTranscript(
      this.app,
      path,
      render,
      this.loadedTranscripts.get(key),
      finalize
    );
    this.loadedTranscripts.set(key, baseline);
  }

  async saveSession(
    messages: AgentChatMessage[],
    backendId: BackendId,
    options?: {
      label?: string | null;
      modelKey?: string;
      existingPath?: string;
      sessionId?: string | null;
      projectId?: string;
      usage?: SessionUsage;
    }
  ): Promise<{ path: string } | null> {
    if (messages.length === 0) return null;

    try {
      const firstMessageEpoch = messages[0].timestamp?.epoch ?? Date.now();

      const conversationsFolder = getEffectiveConversationsFolder();

      await ensureFolderExists(this.app.vault, conversationsFolder);

      const canonicalKey =
        backendId === "pi" && options?.sessionId
          ? sha256(JSON.stringify([backendId, options.sessionId]))
          : undefined;
      const requestedFile = options?.existingPath
        ? this.resolveExistingFile(options.existingPath)
        : null;
      let existingFile =
        requestedFile &&
        (!canonicalKey ||
          (await this.writableSessionPath(requestedFile, backendId, options!.sessionId!)))
          ? requestedFile
          : null;
      // 冷开沿原有聊天目录查找同根正式副本，首次仍使用用户的文件名模板，避免把设置变成无效项。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (canonicalKey && !existingFile) {
        for (const file of listMarkdownFiles(this.app, conversationsFolder).sort((a, b) =>
          a.path.localeCompare(b.path)
        )) {
          if (await this.writableSessionPath(file, backendId, options!.sessionId!)) {
            existingFile = file;
            break;
          }
        }
      }
      const preferredFileName =
        existingFile?.path ??
        this.generateFileName(messages, firstMessageEpoch, conversationsFolder);

      const preferredFile = existingFile ?? this.resolveExistingFile(preferredFileName);
      const imageBaseline =
        preferredFile &&
        (existingFile ||
          (canonicalKey &&
            (await this.writableSessionPath(preferredFile, backendId, options!.sessionId!))))
          ? await this.app.vault.read(preferredFile)
          : "";
      const preparedMessages = await prepareChatImagesForSave(
        this.app,
        messages,
        conversationsFolder,
        imageBaseline,
        preferredFileName
      );
      const chatContent = this.formatChatContent(preparedMessages);

      const updates = this.frontmatterUpdates({
        firstMessageEpoch,
        backendId,
        label: options?.label,
        modelKey: options?.modelKey,
        sessionId: options?.sessionId,
        projectId: options?.projectId,
        usage: options?.usage,
      });
      const finalize = canonicalKey
        ? (content: string) => {
            const { body } = this.splitFrontmatter(content);
            return `${mergeFrontmatter(content, [
              ["canonicalCopyFor", `canonicalCopyFor: "${canonicalKey}"`],
              ["canonicalBodyHash", `canonicalBodyHash: "${sha256(body)}"`],
            ])}\n\n${body}`;
          }
        : undefined;
      const renderNote = (current: string) =>
        `${mergeFrontmatter(current, updates)}\n\n${chatContent}`;
      const rewriteNote = async (path: string) => {
        await this.updateTranscript(
          path,
          (current) => {
            // 副本归属与正文校验必须在实际写入时重验，不能覆盖附件准备期间被用户修改的文件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            if (canonicalKey && !this.ownsCanonicalCopy(current, backendId, options!.sessionId!))
              throw new Error("聊天副本已被修改，原件已保留，未覆盖内容。");
            return renderNote(current);
          },
          finalize
        );
      };
      if (existingFile) {
        await rewriteNote(existingFile.path);
        return { path: existingFile.path };
      }
      const createCopy = async (preferred: string): Promise<{ path: string }> => {
        for (let suffix = 0; ; suffix++) {
          const target = suffix === 0 ? preferred : preferred.replace(/\.md$/, `-${suffix}.md`);
          const occupied = this.app.vault.getAbstractFileByPath(target);
          const existing = occupied instanceof TFile ? occupied : null;
          if (occupied) {
            if (
              existing &&
              canonicalKey &&
              (await this.writableSessionPath(existing, backendId, options!.sessionId!))
            ) {
              await rewriteNote(target);
              return { path: target };
            }
            continue;
          }
          try {
            const content = renderNote("");
            const created = await this.app.vault.create(
              target,
              finalize ? finalize(content) : content
            );
            return { path: created.path };
          } catch (error) {
            if (!isFileAlreadyExistsError(error)) throw error;
            // 同名目录或尚未进入索引的文件也必须保留，碰撞后只核对一次，再选择下一名称。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            const raced = this.resolveExistingFile(target);
            if (
              raced &&
              canonicalKey &&
              (await this.writableSessionPath(raced, backendId, options!.sessionId!))
            ) {
              await rewriteNote(target);
              return { path: target };
            }
          }
        }
      };
      try {
        return await createCopy(preferredFileName);
      } catch (error) {
        if (!isNameTooLongError(error)) throw error;
        return await createCopy(
          `${conversationsFolder}/${AGENT_FILENAME_PREFIX}chat-${firstMessageEpoch}.md`
        );
      }
    } catch (error) {
      logError("[AgentChatPersistenceManager] Error saving session:", error);
      return null;
    }
  }

  async writableSessionPath(
    file: TFile,
    backendId: BackendId,
    sessionId: string
  ): Promise<string | undefined> {
    return this.ownsCanonicalCopy(await this.app.vault.read(file), backendId, sessionId)
      ? file.path
      : undefined;
  }

  private ownsCanonicalCopy(content: string, backendId: BackendId, sessionId: string): boolean {
    const { frontmatter, body } = this.splitFrontmatter(content);
    return (
      frontmatter.backendId === backendId &&
      frontmatter.sessionId === sessionId &&
      frontmatter.canonicalCopyFor === sha256(JSON.stringify([backendId, sessionId])) &&
      frontmatter.canonicalBodyHash === sha256(body)
    );
  }

  async loadFile(file: TFile): Promise<LoadedAgentChat> {
    const content = await this.app.vault.read(file);
    const key = this.app.vault.getAbstractFileByPath(file.path) ?? file.path;
    this.loadedTranscripts.set(key, content);
    const { frontmatter, body } = this.splitFrontmatter(content);
    const backendId = (frontmatter.backendId ?? "").trim();
    if (!backendId) {
      throw new Error(`Missing backendId in agent chat frontmatter: ${file.path}`);
    }
    const topic = frontmatter.topic?.trim() || undefined;
    const label = frontmatter.agentLabel?.trim() || undefined;
    const sessionId = frontmatter.sessionId?.trim() || undefined;
    const projectId = frontmatter.projectId?.trim() || GLOBAL_SCOPE;
    const usage = parseUsageJson(frontmatter.usage);
    const epoch = Number(frontmatter.epoch);
    const messages = this.parseChatBody(
      body,
      Number.isSafeInteger(epoch) && epoch > 0 ? epoch : undefined
    );

    logInfo(
      `[AgentChatPersistenceManager] Loaded ${messages.length} messages from ${file.path} (backend=${backendId}, sessionId=${sessionId ?? "none"}, projectId=${projectId})`
    );
    return { messages, backendId, topic, label, sessionId, projectId, usage };
  }

  async getAgentChatHistoryFiles(): Promise<TFile[]> {
    const files = listMarkdownFiles(this.app, getEffectiveConversationsFolder());
    return files.filter((file) => file.basename.startsWith(AGENT_FILENAME_PREFIX));
  }

  async updateTopic(fileId: string, newTopic: string): Promise<void> {
    await patchFrontmatter(this.app, fileId, { topic: newTopic.trim() });
  }

  async setPinnedAt(fileId: string, pinnedAt: number | null): Promise<void> {
    // A row whose note was moved or deleted must fail the pin instead of showing a pin that was never written.
    // https://github.com/logancyang/obsidian-copilot/issues/3195
    if (!(this.app.vault.getAbstractFileByPath(fileId) instanceof TFile)) {
      throw new Error(`Chat note not found: ${fileId}`);
    }
    await patchFrontmatter(this.app, fileId, { pinnedAt });
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (!file) throw new Error("Chat file not found.");
    await trashFile(this.app, file);
  }

  private resolveExistingFile(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private formatChatContent(messages: AgentChatMessage[]): string {
    return messages
      .map((m) => {
        const ts = m.timestamp ? m.timestamp.display : "Unknown time";
        const body =
          m.message.length === 0 && m.fanout
            ? serializeFanoutComposite(m.fanout, (id) => id)
            : m.message;
        return `**${m.sender}**: ${body}\n[Timestamp: ${ts}]`;
      })
      .join("\n\n");
  }

  private parseChatBody(body: string, conversationEpoch?: number): AgentChatMessage[] {
    const messages: AgentChatMessage[] = [];
    const pattern = /\*\*(user|ai)\*\*: ([\s\S]*?)(?=(?:\n\*\*(?:user|ai)\*\*: )|$)/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const sender = match[1] === "user" ? USER_SENDER : AI_SENDER;
      const fullContent = match[2].trim();

      const lines = fullContent.split("\n");
      let endIndex = lines.length;
      let timestampStr = "Unknown time";

      if (lines[endIndex - 1]?.startsWith("[Timestamp: ")) {
        const tsMatch = lines[endIndex - 1].match(/\[Timestamp: (.*?)\]/);
        if (tsMatch) {
          timestampStr = tsMatch[1];
          endIndex--;
        }
      }

      const messageText = lines.slice(0, endIndex).join("\n").trim();

      let timestamp: FormattedDateTime | null = null;
      if (timestampStr !== "Unknown time") {
        const date = new Date(timestampStr);
        if (!isNaN(date.getTime())) {
          timestamp = {
            epoch: date.getTime(),
            display: timestampStr,
            fileName: "",
          };
        }
      }
      // Display timestamps omit milliseconds but chat links match the frontmatter epoch exactly, so keep it across reloads.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/661
      if (messages.length === 0 && conversationEpoch !== undefined) {
        timestamp = { epoch: conversationEpoch, display: timestampStr, fileName: "" };
      }

      const id = timestamp
        ? `loaded-${messages.length}-${timestamp.epoch}`
        : `loaded-${messages.length}`;
      messages.push({
        id,
        message: this.renderLoadedMessage(messageText),
        sender,
        isVisible: true,
        timestamp,
      });
    }
    return messages;
  }

  /** Off by default: the Pi runtime enables placeholders so a missing persisted attachment shows its
   * original path instead of a broken embed.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  /** Legacy Markdown carries no tool history; the Pi runtime enables this so the loaded chat says so
   * instead of implying a full restore.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  setLegacyTextOnlyNoticeEnabled(value: boolean): void {
    this.legacyTextOnlyNoticeEnabled = value;
  }

  setMissingAttachmentPlaceholders(value: boolean): void {
    this.missingAttachmentPlaceholders = value;
  }

  private renderLoadedMessage(text: string): string {
    const stripped = stripChatImageReceipts(text);
    if (this.legacyTextOnlyNoticeEnabled && this.legacyReader.needsTextOnlyNotice(text)) {
      return `${stripped}\n\n[${LEGACY_TEXT_ONLY_NOTICE}]`;
    }
    if (!this.missingAttachmentPlaceholders) return stripped;
    const vault = this.app?.vault as
      | { getAbstractFileByPath?: (path: string) => unknown }
      | undefined;
    if (typeof vault?.getAbstractFileByPath !== "function") return stripped;
    const lookup = vault.getAbstractFileByPath.bind(vault);
    return placeholderMissingAttachments(stripped, (target) => {
      try {
        return lookup(target) !== null && lookup(target) !== undefined;
      } catch {
        return true;
      }
    });
  }

  private missingAttachmentPlaceholders = false;
  private legacyTextOnlyNoticeEnabled = false;
  private readonly legacyReader = new LegacyHistoryReader({
    ports: { listFiles: async () => [], isTombstoned: async () => false },
  });

  private splitFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { frontmatter: {}, body: content };
    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)/);
      if (!m) continue;
      const raw = m[2].trim();
      let value: string;
      if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        value = unescapeYamlString(raw.slice(1, -1));
      } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
        value = raw.slice(1, -1);
      } else {
        value = raw;
      }
      frontmatter[m[1]] = value;
    }
    return { frontmatter, body: content.slice(match[0].length).trim() };
  }

  private generateFileName(
    messages: AgentChatMessage[],
    firstMessageEpoch: number,
    folder: string
  ): string {
    const settings = getSettings();
    const formatted = formatDateTime(new Date(firstMessageEpoch));
    const timestampFileName = formatted.fileName;

    const firstUser = messages.find((m) => m.sender === USER_SENDER);
    const topicForFilename = firstUser
      ? firstUser.message
          .replace(/\[\[([^\]]+)\]\]/g, "$1")
          .replace(/[{}[\]]/g, "")
          .split(/\s+/)
          .slice(0, 10)
          .join(" ")
          // eslint-disable-next-line no-control-regex -- serialized frontmatter must reject embedded control bytes
          .replace(/[\\/:*?"<>|\x00-\x1F]/g, "")
          .trim() || "Untitled Agent Chat"
      : "Untitled Agent Chat";

    let customFileName = settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}";
    const filePrefix = AGENT_FILENAME_PREFIX;

    const extensionBytes = getUtf8ByteLength(".md");
    const filePrefixBytes = getUtf8ByteLength(filePrefix);

    const formatOverhead = customFileName
      .replace("{$topic}", "")
      .replace("{$date}", timestampFileName.split("_")[0])
      .replace("{$time}", timestampFileName.split("_")[1]);
    const formatOverheadBytes = getUtf8ByteLength(formatOverhead);

    const topicByteBudget = Math.max(
      20,
      SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes - formatOverheadBytes
    );

    const topicWithUnderscores = topicForFilename.replace(/\s+/g, "_");
    const truncatedTopic = truncateToByteLimit(topicWithUnderscores, topicByteBudget);

    customFileName = customFileName
      .replace("{$topic}", truncatedTopic)
      .replace("{$date}", timestampFileName.split("_")[0])
      .replace("{$time}", timestampFileName.split("_")[1]);

    const sanitizedFileName = customFileName
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/[{}[\]]/g, "_")
      // eslint-disable-next-line no-control-regex -- serialized frontmatter must reject embedded control bytes
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_");

    const baseNameWithPrefix = `${filePrefix}${sanitizedFileName}.md`;
    if (getUtf8ByteLength(baseNameWithPrefix) > SAFE_FILENAME_BYTE_LIMIT) {
      const availableForBasename = SAFE_FILENAME_BYTE_LIMIT - extensionBytes - filePrefixBytes;
      const truncatedBasename = truncateToByteLimit(sanitizedFileName, availableForBasename);
      return joinPosix(folder, `${filePrefix}${truncatedBasename}.md`);
    }

    return joinPosix(folder, baseNameWithPrefix);
  }

  private frontmatterUpdates(args: {
    firstMessageEpoch: number;
    backendId: BackendId;
    label?: string | null;
    modelKey?: string;
    sessionId?: string | null;
    projectId?: string;
    usage?: SessionUsage;
  }): FrontmatterUpdates {
    const projectId = coerceProjectId(args.projectId);
    const quoted = (key: string, value: string | null | undefined) =>
      value ? `${key}: "${escapeYamlString(value)}"` : undefined;
    // A merged save keeps keys it omits, so leaving global scope must delete the stale projectId explicitly.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/698
    return [
      ["epoch", `epoch: ${args.firstMessageEpoch}`],
      ["mode", `mode: ${AGENT_CHAT_MODE}`],
      ["backendId", `backendId: ${args.backendId}`],
      ["projectId", projectId === GLOBAL_SCOPE ? null : quoted("projectId", projectId)],
      ["sessionId", quoted("sessionId", args.sessionId)],
      ["agentLabel", quoted("agentLabel", args.label)],
      ["modelKey", quoted("modelKey", args.modelKey)],
      ["usage", args.usage ? `usage: '${JSON.stringify(args.usage)}'` : undefined],
      ["tags", `tags:\n  - ${VAULT_AGENT_CONVERSATION_TAG}`],
    ];
  }
}
