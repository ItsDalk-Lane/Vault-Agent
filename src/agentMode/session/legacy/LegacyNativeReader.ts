import { requireNodeModule } from "@/utils/desktopRuntime";
import type { AgentChatMessage } from "@/agentMode/session/types";

export interface LegacyNativeHistory {
  readonly messages: readonly AgentChatMessage[];
  readonly notice: string;
}

export function parseLegacyNativeHistory(content: string): AgentChatMessage[] {
  const records: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(content);
    const values: readonly unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    records.push(...values);
  } catch {
    for (const line of content.split(/\r?\n/)) {
      if (line.trim()) {
        try {
          records.push(JSON.parse(line));
        } catch {
          continue;
        }
      }
    }
  }
  const messages: AgentChatMessage[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const payload =
      record.type === "response_item" && record.payload && typeof record.payload === "object"
        ? (record.payload as Record<string, unknown>)
        : record;
    const message =
      payload.message && typeof payload.message === "object"
        ? (payload.message as Record<string, unknown>)
        : payload;
    const role = message.role ?? record.type;
    if (role !== "user" && role !== "assistant") continue;
    const content = message.content ?? message.text;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter(
                (block): block is { text: string } =>
                  !!block &&
                  typeof block === "object" &&
                  typeof (block as { text?: unknown }).text === "string"
              )
              .map((block) => block.text)
              .join("\n")
          : "";
    if (!text) continue;
    messages.push({
      id: `legacy-${messages.length}`,
      sender: role === "user" ? "user" : "ai",
      timestamp: null,
      isVisible: true,
      message: text,
    });
  }
  return messages;
}

export async function readLegacyNativeHistory(input: {
  backendId: string;
  sessionId: string;
  cwd: string;
  homeDir?: string;
}): Promise<LegacyNativeHistory> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.sessionId))
    throw new Error("Invalid historical session identifier.");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const os = requireNodeModule<typeof import("node:os")>("node:os");
  const home = input.homeDir ?? os.homedir();
  const paths: string[] = [];
  if (input.backendId === "claude")
    paths.push(
      path.join(
        home,
        ".claude",
        "projects",
        input.cwd.replace(/[^a-zA-Z0-9]/g, "-"),
        `${input.sessionId}.jsonl`
      )
    );
  if (input.backendId === "codex") {
    const directories = [path.join(home, ".codex", "sessions")];
    let scanned = 0;
    while (directories.length && scanned < 10000) {
      const directory = directories.shift();
      if (!directory) break;
      const entries = await fs
        .readdir(directory, { withFileTypes: true })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
      for (const entry of entries) {
        scanned += 1;
        if (entry.isDirectory()) directories.push(path.join(directory, entry.name));
        else if (entry.name.endsWith(`-${input.sessionId}.jsonl`))
          paths.push(path.join(directory, entry.name));
      }
    }
  }
  const messages: AgentChatMessage[] = [];
  for (const file of paths) {
    try {
      if ((await fs.stat(file)).size > 16 * 1024 * 1024)
        throw new Error(
          "The historical transcript exceeds the safe read limit; open its existing export instead."
        );
      messages.push(...parseLegacyNativeHistory(await fs.readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return {
    messages,
    notice: messages.length
      ? "此旧聊天以只读文字方式打开；原始工具记录和附件未被伪造。"
      : "未找到可读取的旧聊天文字。原记录保持不变，可打开已有的聊天笔记。",
  };
}
