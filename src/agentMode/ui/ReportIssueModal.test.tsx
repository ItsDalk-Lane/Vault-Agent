import {
  createReportDir,
  discardReport,
  openIssuePageWith,
  openReportIssueModal,
  ReportIssueModal,
} from "@/agentMode/ui/ReportIssueModal";
import type {
  PreparedReport,
  ReportSourceId,
  ReportSourceOption,
} from "@/agentMode/ui/ReportIssueFlow";
import { logWarn } from "@/logger";
import { getSettings, setSettings } from "@/settings/model";
import type { ReportInput } from "@/utils/issueReport";
import { unzipSync } from "fflate";
import { Modal, Notice, type App, type PluginManifest } from "obsidian";
import nodeOs from "node:os";
import nodePath from "node:path";

const realFs = jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
const realIssueReport =
  jest.requireActual<typeof import("@/utils/issueReport")>("@/utils/issueReport");

const rm = jest.fn<Promise<void>, [string, unknown?]>();
const writeFile = jest.fn<Promise<void>, [string, Uint8Array]>();

jest.mock("fs/promises", () => ({
  ...jest.requireActual("fs/promises"),
  rm: (path: string, opts?: unknown) => rm(path, opts),
  writeFile: (path: string, data: Uint8Array) => writeFile(path, data),
}));

let mockDesktopRuntime = true;

jest.mock("@/utils/desktopRuntime", () => ({
  ...jest.requireActual("@/utils/desktopRuntime"),
  isDesktopRuntime: () => mockDesktopRuntime,
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const getValidatedPath = jest.fn<Promise<string | null>, []>();
const exportLogText = jest.fn<string, []>();

jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: { getValidatedPath: () => getValidatedPath() },
}));

jest.mock("@/logFileManager", () => ({
  logFileManager: { exportLogText: () => exportLogText() },
}));

const buildReportBundle = jest.fn<
  ReturnType<typeof realIssueReport.buildReportBundle>,
  Parameters<typeof realIssueReport.buildReportBundle>
>();

jest.mock("@/utils/issueReport", () => ({
  ...jest.requireActual("@/utils/issueReport"),
  buildReportBundle: (...args: Parameters<typeof realIssueReport.buildReportBundle>) =>
    buildReportBundle(...args),
}));

const captureWindowBehindDialogs = jest.fn<Promise<Uint8Array | null>, [Window]>();

jest.mock("@/agentMode/ui/reportScreenshot", () => ({
  captureWindowBehindDialogs: (win: Window) => captureWindowBehindDialogs(win),
}));

const openExternal = jest.fn<Promise<void>, [string]>();

jest.mock("electron", () => ({ shell: { openExternal: (url: string) => openExternal(url) } }), {
  virtual: true,
});

const noticeMock = Notice as unknown as jest.Mock;
const noticeText = (call = 0) => {
  const message = noticeMock.mock.calls[call][0] as string | DocumentFragment;
  return typeof message === "string" ? message : message.textContent;
};
const noticeLink = (call = 0) =>
  (noticeMock.mock.calls[call][0] as DocumentFragment).querySelector("a")?.getAttribute("href");

const prepared: PreparedReport = {
  zipDir: "/tmp/vault-agent-report-abc123",
  zipPath: "/tmp/vault-agent-report-abc123/copilot-report-20260615-101500-abcd.zip",
  zipName: "copilot-report-20260615-101500-abcd.zip",
  uploadAttempt: {
    body: new ArrayBuffer(4096),
    idempotencyKey: "5d41c9b2-7e3a-4f8b-9c1d-2a6e8f4b0d37",
  },
  issueDraft: { title: "it exploded", body: "## What went wrong" },
  manualIssueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new?title=manual",
  attachments: [],
};
const issueUrl = "https://github.com/logancyang/obsidian-copilot/issues/new?title=linked";

beforeEach(() => {
  noticeMock.mockClear();
  (logWarn as jest.Mock).mockClear();
  rm.mockReset();
  rm.mockImplementation((path, opts) =>
    realFs.rm(path, opts as { recursive?: boolean; force?: boolean })
  );
  writeFile.mockReset();
  writeFile.mockImplementation((path, data) => realFs.writeFile(path, data));
  openExternal.mockReset();
  openExternal.mockResolvedValue(undefined);
  buildReportBundle.mockReset();
  buildReportBundle.mockImplementation(realIssueReport.buildReportBundle);
  captureWindowBehindDialogs.mockReset();
  captureWindowBehindDialogs.mockResolvedValue(null);
  getValidatedPath.mockReset();
  getValidatedPath.mockResolvedValue(null);
  exportLogText.mockReset();
  exportLogText.mockReturnValue("");
});

describe("ReportIssueModal", () => {
  describe("createReportDir()", () => {
    const created: string[] = [];

    afterEach(async () => {
      for (const dir of created.splice(0)) {
        await realFs.rm(dir, { recursive: true, force: true });
      }
    });

    const create = async () => {
      const dir = await createReportDir();
      created.push(dir);
      return dir;
    };

    (process.platform === "win32" ? it.skip : it)(
      "hands back a directory no other local account can enter",
      async () => {
        const dir = await create();

        expect((await realFs.stat(dir)).mode & 0o777).toBe(0o700);
      }
    );

    it("never hands back the same directory twice", async () => {
      const [first, second] = [await create(), await create()];

      expect(second).not.toBe(first);
    });
  });

  describe("discardReport()", () => {
    it("removes the report's directory, recursively and without failing on an absent one", async () => {
      rm.mockResolvedValue(undefined);

      await discardReport(prepared);

      expect(rm).toHaveBeenCalledTimes(1);
      expect(rm).toHaveBeenCalledWith(prepared.zipDir, { recursive: true, force: true });
    });

    it("logs a directory that would not go and resolves anyway (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      rm.mockRejectedValue(new Error("EBUSY: resource busy or locked"));

      await expect(discardReport(prepared)).resolves.toBeUndefined();

      expect(logWarn).toHaveBeenCalledTimes(1);
      expect((logWarn as jest.Mock).mock.calls[0][0]).toContain(prepared.zipDir);
    });
  });

  describe("openIssuePageWith()", () => {
    it("resolves true once the browser has taken the page", async () => {
      await expect(openIssuePageWith({ openExternal }, issueUrl)).resolves.toBe(true);

      expect(openExternal).toHaveBeenCalledWith(issueUrl);
    });

    it("resolves false when there is no browser bridge", async () => {
      await expect(openIssuePageWith(null, issueUrl)).resolves.toBe(false);
    });

    it("resolves false when the bridge rejects its promise", async () => {
      openExternal.mockRejectedValue(new Error("no handler"));

      await expect(openIssuePageWith({ openExternal }, issueUrl)).resolves.toBe(false);
    });

    it("resolves false when the bridge throws before returning a promise", async () => {
      openExternal.mockImplementation(() => {
        throw new Error("bridge disposed");
      });

      await expect(openIssuePageWith({ openExternal }, issueUrl)).resolves.toBe(false);
    });
  });

  describe("openReportIssueModal()", () => {
    beforeAll(() => {
      Object.assign(Modal.prototype, { setTitle: jest.fn() });
    });

    it("opens the dialog with the plugin's version and the card's prefill", () => {
      const plugin = { app: {} as App, manifest: { version: "4.1.0" } as PluginManifest };
      const onReported = jest.fn();

      const modal = openReportIssueModal(plugin, {
        activeBackend: "codex",
        initialNote: "Replied in Swedish",
        preselectAllSources: true,
        onReported,
      }) as unknown as { open: jest.Mock; params: Record<string, unknown> };

      expect(modal.open).toHaveBeenCalledTimes(1);
      expect(modal.params).toMatchObject({
        activeBackend: "codex",
        pluginVersion: "4.1.0",
        initialNote: "Replied in Swedish",
        preselectAllSources: true,
        onReported,
      });
    });
  });

  describe("ReportIssueModal", () => {
    interface ModalUnderTest {
      close: jest.Mock;
      root: { unmount: jest.Mock } | null;
      prepared: PreparedReport | null;
      onOpen(): void;
      onClose(): void;
      buildSources(): ReportSourceOption[];
      prepare(note: string, selected: ReadonlySet<ReportSourceId>): Promise<PreparedReport>;
      discard(report: PreparedReport): Promise<void>;
      openIssuePage(url: string): Promise<void>;
    }

    function modalWith(fields: Record<string, unknown>): ModalUnderTest {
      return Object.assign(Object.create(ReportIssueModal.prototype), {
        contentEl: Object.assign(window.document.createElement("div"), { empty: jest.fn() }),
        containerEl: window.document.createElement("div"),
        close: jest.fn(),
        root: { unmount: jest.fn() },
        prepared: null,
        params: {},
        ...fields,
      }) as ModalUnderTest;
    }

    describe("onOpen()", () => {
      afterEach(() => {
        mockDesktopRuntime = true;
      });

      it("refuses to open where there is no Node runtime, instead of failing at the first disk write", () => {
        mockDesktopRuntime = false;
        const modal = modalWith({});

        modal.onOpen();

        expect(modal.close).toHaveBeenCalledTimes(1);
        expect(noticeText()).toContain("desktop only");
      });
    });

    describe("buildSources()", () => {
      const ids = (params: Record<string, unknown>) =>
        modalWith({
          params: { activeBackend: "claude", ...params },
        })
          .buildSources()
          .map((source) => source.id);

      it("offers a checked screenshot of the Obsidian window", () => {
        const screenshot = modalWith({ params: { activeBackend: "claude" } })
          .buildSources()
          .find((source) => source.id === "screenshot");

        expect(screenshot).toEqual({
          id: "screenshot",
          label: "Screenshot of the Obsidian window",
          defaultChecked: true,
        });
      });

      it("offers the opencode log only when opencode is the active backend", () => {
        expect(ids({})).not.toContain("opencodeLog");
        expect(ids({ activeBackend: "opencode" })).toContain("opencodeLog");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/672 pre-checks the opencode log when a feedback card opens the dialog", () => {
        const checked = modalWith({
          params: {
            activeBackend: "opencode",
            preselectAllSources: true,
          },
        })
          .buildSources()
          .filter((source) => source.defaultChecked)
          .map((source) => source.id);

        expect(checked).toEqual(expect.arrayContaining(["screenshot", "chatLog", "opencodeLog"]));
      });

      it("leaves the opencode log unchecked by default", () => {
        const opencodeLog = modalWith({
          params: { activeBackend: "opencode" },
        })
          .buildSources()
          .find((source) => source.id === "opencodeLog");

        expect(opencodeLog?.defaultChecked).toBe(false);
      });

      it("offers the Vault Agent log checked even with debug mode off, since OpenCode 2 server errors only reach that log (https://github.com/Brevilabs/obsidian-copilot-private/issues/649)", () => {
        setSettings({ debug: false });
        const copilotLog = modalWith({
          params: { activeBackend: "opencode" },
        })
          .buildSources()
          .find((source) => source.id === "chatLog");

        expect(copilotLog).toMatchObject({ label: "Vault Agent log", defaultChecked: true });
      });
    });

    describe("prepare()", () => {
      const created: string[] = [];

      afterEach(async () => {
        for (const dir of created.splice(0)) {
          await realFs.rm(dir, { recursive: true, force: true });
        }
      });

      const activeView = { containerEl: { win: window } };

      const prepare = (selected: ReadonlySet<ReportSourceId>) =>
        modalWith({
          app: { workspace: { getActiveViewOfType: () => activeView } },
          params: {
            pluginVersion: "9.9.9",
            activeBackend: "claude",
          },
        })
          .prepare("it broke\n\nwhile typing", selected)
          .then((report) => {
            created.push(report.zipDir);
            return report;
          });

      const bundleInput = (): ReportInput => buildReportBundle.mock.calls[0][0];

      it("writes the zip, and nothing else, into a fresh private directory", async () => {
        const report = await prepare(new Set());

        expect(nodePath.basename(report.zipDir)).toMatch(/^vault-agent-report-/);
        expect(await realFs.readdir(report.zipDir)).toEqual([report.zipName]);
        expect(report.zipPath).toBe(nodePath.join(report.zipDir, report.zipName));
        expect((await realFs.stat(report.zipPath)).size).toBe(report.uploadAttempt.body.byteLength);
      });

      it("hands back the manual issue URL and the manifest alongside the packed attempt", async () => {
        const report = await prepare(new Set());

        expect(report.manualIssueUrl).toContain("title=it+broke");
        expect(report.attachments.map((a) => a.name)).toContain("report.md");
        expect(report.uploadAttempt.idempotencyKey).not.toBe("");
      });

      it("removes the directory and rethrows when the zip cannot be written (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        writeFile.mockRejectedValue(new Error("ENOSPC: no space left on device"));

        await expect(prepare(new Set())).rejects.toThrow("ENOSPC");

        expect(rm).toHaveBeenCalledTimes(1);
        const [dir] = rm.mock.calls[0];
        expect(nodePath.basename(dir)).toMatch(/^vault-agent-report-/);
        await expect(realFs.stat(dir)).rejects.toThrow();
      });

      it("goes on without the screenshot when the capture fails, and says so in the manifest (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        captureWindowBehindDialogs.mockRejectedValue(new Error("the pane went away"));

        const report = await prepare(new Set(["screenshot"]));

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(bundleInput().screenshotPng).toBeNull();
        expect(report.attachments.find((a) => a.id === "screenshot")).toMatchObject({
          included: false,
          note: "no screenshot was captured",
        });
      });

      it("hands the assembler the captured bytes when the screenshot was selected", async () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        captureWindowBehindDialogs.mockResolvedValue(png);

        await prepare(new Set(["screenshot"]));

        expect(bundleInput().screenshotPng).toBe(png);
      });

      it("photographs the window of the pane the user was last working in, not a Settings window the dialog opened over", async () => {
        const settingsWindow = { name: "settings popout" } as unknown as Window;
        const modal = modalWith({
          app: { workspace: { getActiveViewOfType: () => activeView } },
          containerEl: { win: settingsWindow },
          params: { pluginVersion: "9.9.9", activeBackend: "claude" },
        });

        created.push((await modal.prepare("", new Set(["screenshot"]))).zipDir);

        expect(captureWindowBehindDialogs).toHaveBeenCalledWith(window);
      });

      it("hands the assembler null when the screenshot was selected but nothing was captured", async () => {
        captureWindowBehindDialogs.mockResolvedValue(null);

        await prepare(new Set(["screenshot"]));

        expect(bundleInput().screenshotPng).toBeNull();
      });

      it("leaves the screenshot out of the assembler's input entirely when it was not selected (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        await prepare(new Set());

        expect(captureWindowBehindDialogs).not.toHaveBeenCalled();
        expect(bundleInput().screenshotPng).toBeUndefined();
      });

      it("packs the activity log and the Vault Agent log it was asked for into the zip (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const frameDir = await realFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "acp-frames-"));
        created.push(frameDir);
        const framePath = nodePath.join(frameDir, "acp-frames.ndjson");
        const frames = '{"dir":"out","method":"session/prompt"}\n';
        const chatLog = "2026-06-15 10:15:00 INFO chain ran\n";
        await realFs.writeFile(framePath, frames);
        getValidatedPath.mockResolvedValue(framePath);
        exportLogText.mockReturnValue(chatLog);

        const report = await prepare(new Set(["activityLog", "chatLog"]));

        const entries = unzipSync(new Uint8Array(await realFs.readFile(report.zipPath)));
        const entryText = (name: string) => new TextDecoder().decode(entries[name]);
        expect(entryText("acp-frames.ndjson.txt")).toBe(frames);
        expect(entryText("vault-agent-log.md")).toBe(chatLog);
      });

      it("asks for the logs smallest-growing first, so a heavy session's frames cannot crowd the others out (https://github.com/Brevilabs/obsidian-copilot-private/issues/538)", async () => {
        await prepare(new Set(["activityLog", "chatLog", "opencodeLog"]));

        expect(bundleInput().logs.map((log) => log.id)).toEqual([
          "chatLog",
          "opencodeLog",
          "activityLog",
        ]);
      });

      it("reads no activity log, and says why, when it was selected while turned off (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const agentMode = getSettings().agentMode;
        setSettings({ agentMode: { ...agentMode, debugFullFrames: false } });
        try {
          await prepare(new Set(["activityLog"]));
        } finally {
          setSettings({ agentMode });
        }

        expect(getValidatedPath).not.toHaveBeenCalled();
        const [request] = bundleInput().logs;
        expect(request.id).toBe("activityLog");
        expect(request.path).toBeUndefined();
        expect(request.unavailableReason).toContain("turned off");
      });
    });

    describe("openIssuePage()", () => {
      it.each(["resolved", "rejected", "pending"])(
        "preserves the manually handed-off zip through Cancel and close with a %s browser call (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
        async (browserState) => {
          let finish: () => void = () => {};
          if (browserState === "rejected") openExternal.mockRejectedValue(new Error("no handler"));
          if (browserState === "pending") {
            openExternal.mockImplementation(
              () =>
                new Promise<void>((resolve) => {
                  finish = resolve;
                })
            );
          }
          const modal = modalWith({ params: {}, prepared });
          const opening = modal.openIssuePage(prepared.manualIssueUrl);

          await modal.discard(prepared);
          modal.onClose();
          finish();
          await opening;

          expect(rm).not.toHaveBeenCalled();
        }
      );

      it("reminds the user to attach the zip once the browser takes the manual issue page", async () => {
        const onReported = jest.fn();
        const modal = modalWith({ params: { onReported } });

        await modal.openIssuePage(prepared.manualIssueUrl);

        expect(openExternal).toHaveBeenCalledWith(prepared.manualIssueUrl);
        expect(onReported).toHaveBeenCalledWith({
          reportId: "",
          issueUrl: prepared.manualIssueUrl,
        });
        expect(noticeText()).toContain("attach the report zip");
        expect(modal.close).toHaveBeenCalledTimes(1);
      });

      it("hands over the link when the browser cannot be opened", async () => {
        openExternal.mockRejectedValue(new Error("no handler"));

        await modalWith({ params: {} }).openIssuePage(prepared.manualIssueUrl);

        expect(noticeLink()).toBe(prepared.manualIssueUrl);
      });
    });

    describe("onClose()", () => {
      it("cleans nothing up while the user is still on the details page", () => {
        modalWith({}).onClose();

        expect(rm).not.toHaveBeenCalled();
      });

      it("discards a prepared report the user closed the dialog on instead of uploading (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const modal = modalWith({ prepared });

        modal.onClose();
        await Promise.resolve();

        expect(rm).toHaveBeenCalledWith(prepared.zipDir, { recursive: true, force: true });
      });

      it("removes the report once, not again, after the flow's Cancel already discarded it", async () => {
        const modal = modalWith({ prepared });

        await modal.discard(prepared);
        modal.onClose();
        await Promise.resolve();

        expect(rm).toHaveBeenCalledTimes(1);
      });
    });
  });
});
