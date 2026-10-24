import { logFileManager } from "@/logFileManager";
import { getSettings } from "@/settings/model";
import { collectLocalData } from "@/services/localDataStatus";
import { Notice } from "obsidian";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/1";
const mockOpenPath = jest.fn<Promise<string>, [string]>().mockResolvedValue("");
jest.mock("electron", () => ({ shell: { openPath: (path: string) => mockOpenPath(path) } }), {
  virtual: true,
});
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ debug: true, openAIApiKey: "sk-should-never-be-exported" })),
}));

let root: string;
let resolvePaths: jest.Mock;
describe("logFileManager", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "va-log-test-"));
    resolvePaths = jest
      .fn()
      .mockResolvedValue({ logsRoot: join(root, "logs"), tempRoot: join(root, "tmp") });
    logFileManager.setStoragePaths(resolvePaths);
    await logFileManager.clear();
    resolvePaths.mockClear();
    mockOpenPath.mockClear();
    jest.mocked(Notice).mockClear();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  describe("LogFileManager", () => {
    describe("setStoragePaths()", () => {
      it(`changes only the storage resolver without opening the backend or creating files (${ISSUE})`, () => {
        logFileManager.setStoragePaths(resolvePaths);
        expect(resolvePaths).not.toHaveBeenCalled();
      });
    });
    describe("getLogPath()", () => {
      it(`uses the backend's log folder instead of a vault note path (${ISSUE})`, async () => {
        expect(await logFileManager.getLogPath()).toBe(join(root, "logs", "vault-agent-log.md"));
      });
    });
    describe("getTempRoot()", () => {
      it(`uses the same temporary folder shown on the local data page (${ISSUE})`, async () => {
        expect(await logFileManager.getTempRoot()).toBe(join(root, "tmp"));
      });
    });
    describe("append()", () => {
      it("keeps timestamps and levels and escapes multiline HTML in a bounded buffer", async () => {
        await logFileManager.append("ERROR", "<note>\nsecret\ttext", { count: 1 });
        expect(logFileManager.exportLogText()).toMatch(
          /\d{4}-.* ERROR &lt;note&gt;\\nsecret text {"count":1}\n$/
        );
        for (let index = 0; index < 510; index++) await logFileManager.append("INFO", index);
        expect(logFileManager.exportLogText().trimEnd().split("\n")).toHaveLength(500);
      });
    });
    describe("appendMarkdownBlock()", () => {
      it("preserves the supplied Markdown without timestamps", async () => {
        await logFileManager.appendMarkdownBlock(["| a | b |", "| - | - |"]);
        expect(logFileManager.exportLogText()).toBe("| a | b |\n| - | - |\n");
      });
    });
    describe("exportLogText()", () => {
      it(`exports buffered entries without creating files or adding settings (${ISSUE})`, async () => {
        expect(logFileManager.exportLogText()).toBe("");
        await logFileManager.append("INFO", "hello");
        expect(logFileManager.exportLogText()).toContain("INFO hello\n");
        expect(logFileManager.exportLogText()).not.toContain("## Settings");
        expect(resolvePaths).not.toHaveBeenCalled();
      });
    });
    describe("flush()", () => {
      it(`updates a previously opened private log without scanning the vault (${ISSUE})`, async () => {
        await logFileManager.openLogFile();
        await logFileManager.append("INFO", "fresh entry");
        await logFileManager.flush();
        expect(await readFile(join(root, "logs", "vault-agent-log.md"), "utf8")).toContain(
          "fresh entry"
        );
      });
      it(`does not start the backend or create a log while unloading before a log was opened (${ISSUE})`, async () => {
        logFileManager.setStoragePaths(resolvePaths);
        await logFileManager.append("INFO", "buffer only");
        await logFileManager.flush();
        expect(resolvePaths).not.toHaveBeenCalled();
        await expect(stat(join(root, "logs"))).rejects.toMatchObject({ code: "ENOENT" });
      });
    });
    describe("clear()", () => {
      it(`clears memory and only removes the current private log (${ISSUE})`, async () => {
        await logFileManager.append("INFO", "hello");
        await logFileManager.openLogFile();
        await logFileManager.clear();
        expect(logFileManager.exportLogText()).toBe("");
        await expect(stat(join(root, "logs", "vault-agent-log.md"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      });
    });
    describe("openLogFile()", () => {
      it(`writes a private log with sanitized settings, opens it in the system and includes its bytes in local data (${ISSUE})`, async () => {
        await logFileManager.append("INFO", "hello");
        await logFileManager.openLogFile();
        const path = join(root, "logs", "vault-agent-log.md");
        const content = await readFile(path, "utf8");
        expect(content).toContain("hello");
        expect(content).toContain("## Settings");
        expect(content).not.toContain("sk-should-never-be-exported");
        expect(logFileManager.exportLogText()).not.toContain("## Settings");
        expect(mockOpenPath).toHaveBeenCalledWith(path);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        const status = await collectLocalData(
          {
            dataRoot: root,
            sessionsRoot: join(root, "sessions"),
            indexPath: join(root, "index.json"),
            deletionsRoot: join(root, "deletions"),
            logsRoot: join(root, "logs"),
            tempRoot: join(root, "tmp"),
          },
          join(root, "data.json")
        );
        expect(status.logsBytes).toBe(Buffer.byteLength(content));
        expect(status.totalBytes).toBe(status.logsBytes);
      });
      it("keeps the buffered log when settings cannot be serialized", async () => {
        jest.mocked(getSettings).mockReturnValueOnce({ debug: true, big: BigInt(1) } as never);
        await logFileManager.append("INFO", "hello");
        await logFileManager.openLogFile();
        const content = await readFile(join(root, "logs", "vault-agent-log.md"), "utf8");
        expect(content).toContain("hello");
        expect(content).toContain("Settings could not be serialized: TypeError");
      });
      it(`shows a notice if local storage or the system opener fails (${ISSUE})`, async () => {
        logFileManager.setStoragePaths(async () => {
          throw new Error("Storage unavailable");
        });
        await logFileManager.openLogFile();
        expect(Notice).toHaveBeenCalledWith(
          "Could not write the Vault Agent log file: Error: Storage unavailable"
        );
      });
    });
  });
});
