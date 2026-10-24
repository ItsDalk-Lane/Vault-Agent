import { err2String } from "@/errorFormat";
import { t } from "@/i18n";
import { Notice } from "obsidian";
import { getSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import type { LocalDataPaths } from "@/services/localDataStatus";
import { isSensitiveKey } from "@/services/settingsSecretTransforms";

type LogLevel = "INFO" | "WARN" | "ERROR";

class LogFileManager {
  private static instance: LogFileManager;

  private readonly maxLines = 500;
  private readonly maxLineChars = 8000;
  private buffer: string[] = [];
  private flushing = false;
  private resolveStoragePaths:
    | (() => Promise<Pick<LocalDataPaths, "logsRoot" | "tempRoot">>)
    | null = null;
  private logPath: string | null = null;
  private logFileCreated = false;

  static getInstance(): LogFileManager {
    if (!LogFileManager.instance) {
      LogFileManager.instance = new LogFileManager();
    }
    return LogFileManager.instance;
  }

  setStoragePaths(
    resolvePaths: () => Promise<Pick<LocalDataPaths, "logsRoot" | "tempRoot">>
  ): void {
    this.resolveStoragePaths = resolvePaths;
    this.logPath = null;
    this.logFileCreated = false;
  }

  private async storagePaths(): Promise<Pick<LocalDataPaths, "logsRoot" | "tempRoot">> {
    if (!this.resolveStoragePaths) throw new Error(t("localData.storageUnavailable"));
    return this.resolveStoragePaths();
  }

  async getLogPath(): Promise<string> {
    if (this.logPath) return this.logPath;
    const paths = await this.storagePaths();
    const path = requireNodeModule<typeof import("node:path")>("node:path");
    this.logPath = path.join(paths.logsRoot, "vault-agent-log.md");
    return this.logPath;
  }

  async getTempRoot(): Promise<string> {
    return (await this.storagePaths()).tempRoot;
  }

  private sanitizeForSingleLine(value: unknown): string {
    if (value instanceof Error) {
      const withStack = err2String(value, true);
      return this.escapeAngleBrackets(this.collapseToSingleLine(withStack));
    }

    if (typeof value === "string") {
      return this.escapeAngleBrackets(this.collapseToSingleLine(value));
    }

    try {
      const json = JSON.stringify(value);
      return this.escapeAngleBrackets(this.collapseToSingleLine(json ?? String(value)));
    } catch {
      return this.escapeAngleBrackets(this.collapseToSingleLine(String(value)));
    }
  }

  private collapseToSingleLine(s: string): string {
    const oneLine = s.replace(/[\r\n]+/g, "\\n").replace(/\t/g, " ");
    if (oneLine.length <= this.maxLineChars) return oneLine;
    return (
      oneLine.slice(0, this.maxLineChars) +
      ` … [truncated ${oneLine.length - this.maxLineChars} chars]`
    );
  }

  async append(level: LogLevel, ...args: unknown[]) {
    const ts = new Date().toISOString();
    const parts = args.map((a) => this.sanitizeForSingleLine(a));
    const line = `${ts} ${level} ${parts.join(" ")}`.trim();

    this.buffer.push(line);
    if (this.buffer.length > this.maxLines) {
      this.buffer.splice(0, this.buffer.length - this.maxLines);
    }
  }

  private escapeAngleBrackets(s: string): string {
    return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async appendMarkdownBlock(lines: string[]): Promise<void> {
    if (!Array.isArray(lines) || lines.length === 0) return;

    for (const line of lines) {
      const s = typeof line === "string" ? line : String(line ?? "");
      this.buffer.push(s);
      if (this.buffer.length > this.maxLines) {
        this.buffer.splice(0, this.buffer.length - this.maxLines);
      }
    }
  }

  exportLogText(): string {
    if (this.buffer.length === 0) return "";
    return this.buffer.join("\n") + "\n";
  }

  async flush(): Promise<void> {
    // 日志只在用户主动打开后落盘；卸载时不能为写日志重新启动后端。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (!this.logFileCreated || !this.logPath || this.flushing) return;
    this.flushing = true;
    try {
      const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
      await fs.access(this.logPath);
      await fs.writeFile(this.logPath, this.exportLogText(), { encoding: "utf8", mode: 0o600 });
    } catch {
      return;
    } finally {
      this.flushing = false;
    }
  }

  async clear(): Promise<void> {
    this.buffer = [];
    try {
      const path = await this.getLogPath();
      const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
      await fs.rm(path, { force: true });
      this.logFileCreated = false;
    } catch {
      return;
    }
  }

  private sanitizeSettingsForLog(): Record<string, unknown> {
    const settings = getSettings();
    return this.removeKeysRecursive(settings) as Record<string, unknown>;
  }

  private removeKeysRecursive(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.removeKeysRecursive(item));
    }

    if (typeof value === "object" && value.constructor === Object) {
      const result: Record<string, unknown> = {};
      const obj = value as Record<string, unknown>;

      for (const [key, val] of Object.entries(obj)) {
        if (
          isSensitiveKey(key) ||
          /orgId$/i.test(key) ||
          /instanceName$/i.test(key) ||
          /deploymentName$/i.test(key) ||
          /apiVersion$/i.test(key)
        ) {
          continue;
        }
        result[key] = this.removeKeysRecursive(val);
      }

      return result;
    }

    return value;
  }

  async openLogFile(): Promise<void> {
    const bufferSnapshot = [...this.buffer];
    try {
      const settingsJson = JSON.stringify(this.sanitizeSettingsForLog(), null, 2);
      bufferSnapshot.push("", "## Settings", "```json", ...settingsJson.split("\n"), "```");
    } catch (error) {
      bufferSnapshot.push("", "## Settings", `Settings could not be serialized: ${String(error)}`);
    }

    let logPath: string;
    try {
      logPath = await this.getLogPath();
      const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
      const path = requireNodeModule<typeof import("node:path")>("node:path");
      await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
      await fs.writeFile(logPath, bufferSnapshot.join("\n") + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      this.logFileCreated = true;
    } catch (error) {
      // 日志自身的保存错误只能通过界面提示，避免递归记录失败。https://github.com/Brevilabs/obsidian-copilot-private/issues/647
      new Notice(t("notice.logWriteFailed", { error: String(error) }));
      return;
    }

    try {
      const electron = requireNodeModule<{ shell?: LogShell; remote?: { shell?: LogShell } }>(
        "electron"
      );
      const shell = electron.shell ?? electron.remote?.shell;
      if (shell?.openPath) {
        const error = await shell.openPath(logPath);
        if (error) throw new Error(error);
      } else if (shell?.showItemInFolder) {
        shell.showItemInFolder(logPath);
      } else {
        throw new Error(t("localData.locationUnavailable"));
      }
    } catch (failure) {
      new Notice(
        t("localData.pathActionFailed", {
          error: failure instanceof Error ? failure.message : String(failure),
        })
      );
    }
  }
}

interface LogShell {
  openPath?: (path: string) => Promise<string | void>;
  showItemInFolder?: (path: string) => void;
}

export const logFileManager = LogFileManager.getInstance();
