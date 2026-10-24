import { frameSink } from "@/agentMode/session/debugSink";
import type { BackendProcess } from "@/agentMode/session/types";
import { logError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { t } from "@/i18n";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";
import { formatBytes } from "@/utils/formatBytes";
import {
  buildManualIssueUrl,
  buildReportBundle,
  getNodeReportRuntime,
  type ReportLogRequest,
} from "@/utils/issueReport";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { captureWindowBehindDialogs } from "./reportScreenshot";
import { getSettings } from "@/settings/model";
import { App, ItemView, Modal, Notice, Plugin, apiVersion } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import {
  ReportIssueFlow,
  type PreparedReport,
  type ReportSourceId,
  type ReportSourceOption,
} from "./ReportIssueFlow";

const FRAME_LOG_NAME = "runtime.ndjson.txt";
const CHAT_LOG_NAME = "vault-agent-log.md";

export interface ReportIssueModalParams {
  app: App;
  activeBackend: string;
  pluginVersion: string;
  initialNote?: string;
  saveReport?: (
    name: string,
    content: Uint8Array
  ) => Promise<Pick<PreparedReport, "zipDir" | "zipPath">>;
  onReported?: (report: { reportId: string; issueUrl: string }) => void;
}

export type OpenReportIssueOptions = Pick<
  ReportIssueModalParams,
  "activeBackend" | "initialNote" | "onReported" | "saveReport"
>;

export function createSessionReportSaver(
  sessionId: string | null | undefined,
  getBackend: () => Promise<Pick<BackendProcess, "writeSessionDiagnostic">>
): NonNullable<ReportIssueModalParams["saveReport"]> {
  // 点击后切换聊天不能改变报告归属；未创建或已删除的会话也不能落入公共临时目录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  return async (name, content) => {
    if (!sessionId) throw new Error(t("localData.sessionMissing"));
    const backend = await getBackend();
    if (!backend.writeSessionDiagnostic) throw new Error(t("localData.storageUnavailable"));
    return backend.writeSessionDiagnostic({ sessionId, name, content });
  };
}

export function openReportIssueModal(
  plugin: Pick<Plugin, "app" | "manifest">,
  options: OpenReportIssueOptions
): ReportIssueModal {
  const { app, manifest } = plugin;
  const modal = new ReportIssueModal({
    ...options,
    app,
    pluginVersion: manifest.version,
  });
  modal.open();
  return modal;
}

interface ElectronShell {
  openExternal?: (url: string) => Promise<void>;
  showItemInFolder?: (path: string) => void;
}
function getElectronShell(): ElectronShell | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell is optional and loaded lazily so reporting can degrade gracefully
    const electron = require("electron") as
      | { shell?: ElectronShell; remote?: { shell?: ElectronShell } }
      | undefined;
    return electron?.shell ?? electron?.remote?.shell ?? null;
  } catch {
    return null;
  }
}

export async function createReportDir(): Promise<string> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const tempRoot = await logFileManager.getTempRoot();
  // 报告也属于本版本管理的数据，必须与状态页列出的临时目录一致。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  await fs.mkdir(tempRoot, { recursive: true, mode: 0o700 });
  return fs.mkdtemp(path.join(tempRoot, "vault-agent-report-"));
}

export async function discardReport(report: Pick<PreparedReport, "zipDir">): Promise<void> {
  try {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    await fs.rm(report.zipDir, { recursive: true, force: true });
  } catch (err) {
    logWarn(`[ReportIssue] could not remove the abandoned report at ${report.zipDir}:`, err);
  }
}

function formatBundleId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${date.getTime().toString(36).slice(-4)}`;
}

export async function openIssuePageWith(
  shell: Pick<ElectronShell, "openExternal"> | null,
  url: string
): Promise<boolean> {
  if (!shell?.openExternal) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    logError("[ReportIssue] could not open the issue page:", err);
    return false;
  }
}

export class ReportIssueModal extends Modal {
  private root: Root | null = null;
  private prepared: PreparedReport | null = null;

  constructor(private readonly params: ReportIssueModalParams) {
    super(params.app);
    // @ts-ignore — setTitle exists at runtime (see ConfirmModal).
    this.setTitle(t("report.title"));
  }

  onOpen() {
    if (!isDesktopRuntime()) {
      new Notice(t("report.desktopOnly"));
      this.close();
      return;
    }
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(
      <ReportIssueFlow
        initialNote={this.params.initialNote}
        sources={this.buildSources()}
        prepare={(note, selected) => this.prepare(note, selected)}
        discardReport={(report) => this.discard(report)}
        onCancel={() => this.close()}
        openIssuePage={(url) => void this.openIssuePage(url)}
        revealFile={(path) => this.revealFile(path)}
      />
    );
  }

  onClose() {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    // 未交给用户的明文报告随窗口取消清理，无论它属于会话还是普通临时目录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (this.prepared) void this.discard(this.prepared);
  }

  private discard(report: PreparedReport): Promise<void> {
    // A manual handoff releases ownership even while the dialog stays open;
    // Cancel must not delete the attachment the user is about to send
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if (this.prepared !== report) return Promise.resolve();
    this.prepared = null;
    return discardReport(report);
  }

  private buildSources(): ReportSourceOption[] {
    const settings = getSettings();
    const activityLogOn = settings.agentMode.debugFullFrames;
    const sources: ReportSourceOption[] = [
      { id: "screenshot", label: t("report.source.screenshot"), defaultChecked: true },
      {
        id: "activityLog",
        label: t("report.source.activityLog"),
        description: activityLogOn ? undefined : t("report.source.activityLogOff"),
        defaultChecked: activityLogOn,
      },
      {
        id: "chatLog",
        label: t("report.source.chatLog"),
        description: t("report.source.chatLogDesc"),
        defaultChecked: true,
      },
    ];
    return sources;
  }

  private async prepare(
    note: string,
    selected: ReadonlySet<ReportSourceId>
  ): Promise<PreparedReport> {
    // Two absences the manifest tells apart: `undefined` for a screenshot never
    // selected, which gets no line at all, and `null` for one selected but not
    // captured (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    let screenshotPng: Uint8Array | null | undefined;
    if (selected.has("screenshot")) {
      screenshotPng = null;
      try {
        const workspaceWindow =
          this.app.workspace.getActiveViewOfType(ItemView)?.containerEl.win ?? this.containerEl.win;
        screenshotPng = await captureWindowBehindDialogs(workspaceWindow);
      } catch (err) {
        logWarn("[ReportIssue] the screenshot failed; the report goes without it:", err);
      }
    }

    // `buildReportBundle` gives each log an even share of the room left, so a log
    // smaller than its share passes the rest on. Asking in ascending order of how
    // large the source gets hands that room to the logs most likely to need it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/538
    const logs: ReportLogRequest[] = [];
    if (selected.has("chatLog")) logs.push(await chatLogRequest());
    if (selected.has("activityLog")) logs.push(await activityLogRequest());

    const bundle = await buildReportBundle(
      {
        bundleId: formatBundleId(new Date()),
        note,
        env: {
          pluginVersion: this.params.pluginVersion,
          platform: process.platform,
          obsidianVersion: apiVersion,
          activeBackend: this.params.activeBackend,
        },
        screenshotPng,
        logs,
      },
      getNodeReportRuntime()
    );

    let zipDir: string;
    let zipPath: string;
    // 聊天报告必须随所属会话删除；保存失败时不能改存到公共临时目录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (this.params.saveReport) {
      ({ zipDir, zipPath } = await this.params.saveReport(bundle.zipName, bundle.zip));
    } else {
      zipDir = await createReportDir();
      const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      const path = requireNodeModule<typeof import("node:path")>("path");
      zipPath = path.join(zipDir, bundle.zipName);
      try {
        await fs.writeFile(zipPath, bundle.zip);
      } catch (err) {
        // 写到一半的明文报告不会再被使用，失败时清理目录并保留原始错误。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        await discardReport({ zipDir });
        throw err;
      }
    }

    logInfo(`[ReportIssue] bundle ready at ${zipPath} (${formatBytes(bundle.zip.byteLength)})`);
    this.prepared = {
      zipDir,
      zipPath,
      zipName: bundle.zipName,
      bytes: bundle.zip.byteLength,
      issueDraft: bundle.issueDraft,
      manualIssueUrl: buildManualIssueUrl(bundle.issueDraft),
      attachments: bundle.attachments,
    };
    return this.prepared;
  }

  private async openIssuePage(url: string): Promise<void> {
    // The browser or fallback link hands the zip to the user. Release it before
    // waiting so closing the dialog cannot remove their manual attachment
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    this.prepared = null;
    this.params.onReported?.({ reportId: "", issueUrl: url });
    const opened = await openIssuePageWith(getElectronShell(), url);
    this.close();
    if (!opened) {
      this.issueLinkNotice(t("report.browserFailed"), url);
    } else {
      new Notice(t("report.attachReminder"));
    }
  }

  private issueLinkNotice(text: string, url: string): void {
    const fragment = this.contentEl.doc.win.createFragment();
    fragment.append(`${text} `);
    fragment.createEl("a", { href: url, text: t("report.linkText") });
    new Notice(fragment, 0);
  }

  private revealFile(path: string): void {
    const shell = getElectronShell();
    if (!shell?.showItemInFolder) {
      new Notice(t("report.folderFailed", { path }));
      return;
    }
    try {
      shell.showItemInFolder(path);
    } catch (err) {
      logError("[ReportIssue] could not reveal the report:", err);
      new Notice(t("report.folderFailed", { path }));
    }
  }
}

async function activityLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "activityLog", name: FRAME_LOG_NAME };
  if (!getSettings().agentMode.debugFullFrames) {
    return { ...base, unavailableReason: t("report.unavailable.activityOff") };
  }
  const path = await frameSink.getValidatedPath();
  return path === null
    ? { ...base, unavailableReason: t("report.unavailable.activityPath") }
    : { ...base, path };
}

async function chatLogRequest(): Promise<ReportLogRequest> {
  const base = { id: "chatLog", name: CHAT_LOG_NAME };
  const text = logFileManager.exportLogText();
  return text.length > 0
    ? { ...base, text }
    : { ...base, unavailableReason: t("report.unavailable.noChatLog") };
}
