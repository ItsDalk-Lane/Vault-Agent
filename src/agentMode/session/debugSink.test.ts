import { collectLocalData } from "@/services/localDataStatus";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  FrameRecord,
  FrameSink,
  getFrameLogPaths,
  NodeRuntime,
  setFrameSinkLogsRoot,
} from "./debugSink";

function makeFrame(overrides: Partial<FrameRecord> = {}): FrameRecord {
  return {
    ts: "2026-05-12T00:00:00.000Z",
    dir: "→",
    tag: "codex",
    kind: "notif",
    method: "session/update",
    id: null,
    payload: { ok: true },
    ...overrides,
  };
}

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

interface FakeRuntime extends NodeRuntime {
  dataRoot: string;
  files: Map<string, string>;
  directories: Set<string>;
  removedPaths: string[];
}

function makeRuntime(tmpDir = "/tmp", tempRootMode = 0o1755): FakeRuntime {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const removedPaths: string[] = [];
  const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
  return {
    files,
    directories,
    removedPaths,
    dataRoot: tmpDir,
    join,
    dirname: (path) => path.slice(0, path.lastIndexOf("/")) || "/",
    mkdir: jest.fn(async (path) => {
      directories.add(path);
    }),
    appendFile: jest.fn(async (path, data) => {
      files.set(path, (files.get(path) ?? "") + data);
    }),
    writeFile: jest.fn(async (path, data) => {
      files.set(path, data);
    }),
    rm: jest.fn(async (path) => {
      removedPaths.push(path);
      files.delete(path);
      directories.delete(path);
    }),
    stat: jest.fn(async (path) => {
      const data = files.get(path);
      if (data === undefined) throw errno("ENOENT");
      return { size: data.length };
    }),
    rename: jest.fn(async (oldPath, newPath) => {
      const data = files.get(oldPath);
      if (data === undefined) throw errno("ENOENT");
      files.set(newPath, data);
      files.delete(oldPath);
    }),
    chmod: jest.fn(async () => undefined),
    lstat: jest.fn(async (path: string) => {
      if (path === "/") {
        return { uid: 0, mode: 0o755, isDirectory: true, isSymbolicLink: false };
      }
      if (path === tmpDir) {
        return { uid: 1000, mode: tempRootMode, isDirectory: true, isSymbolicLink: false };
      }
      if (files.has(path)) {
        return { uid: 1000, mode: 0o600, isDirectory: false, isSymbolicLink: false };
      }
      if (directories.has(path)) {
        return { uid: 1000, mode: 0o700, isDirectory: true, isSymbolicLink: false };
      }
      throw errno("ENOENT");
    }),
    getuid: () => 1000,
    openPath: jest.fn(async () => ""),
  };
}

function makeRealRuntime(tmpBase: string): NodeRuntime & { dataRoot: string } {
  return {
    dataRoot: tmpBase,
    join: (...segs: string[]) => path.join(...segs),
    dirname: (p: string) => path.dirname(p),
    mkdir: async (dirPath, opts) => {
      await fs.mkdir(dirPath, opts);
    },
    appendFile: fs.appendFile,
    writeFile: fs.writeFile,
    rm: fs.rm,
    stat: fs.stat,
    rename: fs.rename,
    chmod: fs.chmod,
    lstat: async (p) => {
      const st = await fs.lstat(p);
      return {
        uid: st.uid,
        mode: st.mode,
        isDirectory: st.isDirectory(),
        isSymbolicLink: st.isSymbolicLink(),
      };
    },
    getuid: process.getuid ? () => process.getuid() : undefined,
    openPath: async () => "",
  };
}

const logsRoot = (runtime: { dataRoot: string; join: (...parts: string[]) => string }): string =>
  runtime.join(runtime.dataRoot, "logs", "vault");

const modeOf = (p: string): number => fsSync.statSync(p).mode & 0o777;
const exists = (p: string): boolean => fsSync.existsSync(p);
const describePosix = process.platform === "win32" ? describe.skip : describe;

describe("debugSink", () => {
  afterEach(() => {
    setFrameSinkLogsRoot(null);
  });
  describe("setFrameSinkLogsRoot()", () => {
    it("seeds the singleton root without looking up any old temporary logs https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const runtime = makeRuntime();
      setFrameSinkLogsRoot(logsRoot(runtime));
      expect(new FrameSink({ runtime }).getPath()).toBe(
        getFrameLogPaths(logsRoot(runtime), runtime).logPath
      );
      expect(runtime.lstat).not.toHaveBeenCalled();
    });
  });
  describe("getFrameLogPaths()", () => {
    it("uses only the supplied private log root for active and rotated logs https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const runtime = makeRuntime("C:/Users/zero/AppData/Local/Temp");
      const first = getFrameLogPaths("C:/Users/zero/.vault-agent/v2/logs/one", runtime);
      const second = getFrameLogPaths("C:/Users/zero/.vault-agent/v2/logs/two", runtime);

      expect(first.logPath).toBe("C:/Users/zero/.vault-agent/v2/logs/one/runtime/runtime.ndjson");
      expect(first.logPath).toMatch(/\/runtime\.ndjson$/);
      expect(first.rotatedPath).toMatch(/\/runtime\.old\.ndjson$/);
      expect(first.dirPath).not.toBe(second.dirPath);
    });
  });

  describe("FrameSink", () => {
    describe("append()", () => {
      it("summarizes oversized frames before appending", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
        const paths = getFrameLogPaths(logsRoot(runtime), runtime);

        sink.append(
          makeFrame({
            dir: "←",
            payload: {
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "call-1",
              },
              content: "x".repeat(100_000),
            },
          })
        );
        await sink.flush();

        const log = runtime.files.get(paths.logPath) ?? "";
        expect(log.length).toBeLessThan(5_000);
        expect(log).toContain('"__truncated":true');
        expect(log).toContain("sessionUpdate=tool_call_update");
        expect(log).toContain("toolCallId=call-1");
      });

      describePosix("storage root validation", () => {
        it.each([
          {
            condition: "a symlink",
            entry: { uid: 1000, mode: 0o1777, isDirectory: true, isSymbolicLink: true },
          },
          {
            condition: "not a directory",
            entry: { uid: 1000, mode: 0o600, isDirectory: false, isSymbolicLink: false },
          },
          {
            condition: "owned by another user",
            entry: { uid: 2000, mode: 0o1777, isDirectory: true, isSymbolicLink: false },
          },
          {
            condition: "group-writable without a sticky bit",
            entry: { uid: 1000, mode: 0o770, isDirectory: true, isSymbolicLink: false },
          },
        ])(
          "writes nothing while the storage root is $condition, then logs once it is safe (https://github.com/logancyang/obsidian-copilot-preview/issues/250)",
          async ({ entry }) => {
            const runtime = makeRuntime();
            const paths = getFrameLogPaths(logsRoot(runtime), runtime);
            const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
            const safeLstat = lstat.getMockImplementation()!;
            lstat.mockImplementation(async (path: string) =>
              path === runtime.dataRoot ? entry : safeLstat(path)
            );
            const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });

            sink.append(makeFrame({ id: "first" }));
            await sink.flush();
            sink.append(makeFrame({ id: "second" }));
            await sink.flush();

            expect(runtime.appendFile).not.toHaveBeenCalled();
            expect(runtime.files.size).toBe(0);

            lstat.mockImplementation(safeLstat);
            sink.append(makeFrame({ id: "third" }));
            await sink.flush();
            expect(runtime.files.get(paths.logPath)).toContain('"id":"third"');
          }
        );

        it("logs under a safe root-owned storage parent (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRuntime();
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
          const safeLstat = lstat.getMockImplementation()!;
          lstat.mockImplementation(async (target: string) =>
            target === runtime.dataRoot
              ? { uid: 0, mode: 0o1777, isDirectory: true, isSymbolicLink: false }
              : safeLstat(target)
          );
          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });

          sink.append(makeFrame({ id: "linux-tmp" }));
          await sink.flush();

          expect(runtime.files.get(paths.logPath)).toContain('"id":"linux-tmp"');
        });
      });

      it("refuses a level that is still not a real directory after creating it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const paths = getFrameLogPaths(logsRoot(runtime), runtime);
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        const safeLstat = lstat.getMockImplementation()!;
        lstat.mockImplementation(async (target: string) =>
          target === paths.dirPath && runtime.directories.has(target)
            ? { uid: 1000, mode: 0o700, isDirectory: false, isSymbolicLink: true }
            : safeLstat(target)
        );
        const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });

        sink.append(makeFrame());
        await sink.flush();

        expect(runtime.appendFile).not.toHaveBeenCalled();
        expect(runtime.files.size).toBe(0);
      });

      it("refuses to write when a directory occupies the log file path (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const paths = getFrameLogPaths(logsRoot(runtime), runtime);
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        const safeLstat = lstat.getMockImplementation()!;
        lstat.mockImplementation(async (target: string) =>
          target === paths.logPath
            ? { uid: 1000, mode: 0o700, isDirectory: true, isSymbolicLink: false }
            : safeLstat(target)
        );
        const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });

        sink.append(makeFrame());
        await sink.flush();

        expect(runtime.appendFile).not.toHaveBeenCalled();
        expect(runtime.rm).not.toHaveBeenCalled();
      });

      it("drops the frame instead of writing when path validation fails, then recovers (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        lstat.mockRejectedValueOnce(errno("EACCES"));
        const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
        const paths = getFrameLogPaths(logsRoot(runtime), runtime);

        sink.append(makeFrame({ id: "first" }));
        await sink.flush();
        expect(runtime.appendFile).not.toHaveBeenCalled();
        expect(runtime.writeFile).not.toHaveBeenCalled();

        sink.append(makeFrame({ id: "second" }));
        await sink.flush();
        expect(runtime.files.get(paths.logPath)).toContain('"id":"second"');
      });
    });

    describe("getValidatedPath()", () => {
      it("returns the log path once the location passes the sink's own checks", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ runtime, logsRoot: logsRoot(runtime) });

        await expect(sink.getValidatedPath()).resolves.toBe(
          getFrameLogPaths(logsRoot(runtime), runtime).logPath
        );
      });

      it("returns null when there is no vault to key the location off (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ runtime });

        await expect(sink.getValidatedPath()).resolves.toBeNull();
      });

      it("returns null rather than throwing when the storage root cannot be trusted (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { value: "linux" });
        try {
          const runtime = makeRuntime("/tmp", 0o0777);
          const sink = new FrameSink({ runtime, logsRoot: logsRoot(runtime) });

          await expect(sink.getValidatedPath()).resolves.toBeNull();
        } finally {
          Object.defineProperty(process, "platform", platform);
        }
      });

      it("resolves only once frames queued before the call have landed in the log", async () => {
        const runtime = makeRuntime();
        const paths = getFrameLogPaths(logsRoot(runtime), runtime);
        let releaseWrite!: () => void;
        const held = new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
        const queuedWrite = runtime.appendFile;
        runtime.appendFile = async (target, data, opts) => {
          await held;
          await queuedWrite(target, data, opts);
        };
        const sink = new FrameSink({ runtime, logsRoot: logsRoot(runtime) });

        sink.append(makeFrame({ id: "queued" }));
        let resolvedEarly = true;
        const pending = sink.getValidatedPath().then((value) => {
          resolvedEarly = false;
          return value;
        });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        expect(resolvedEarly).toBe(true);

        releaseWrite();
        await expect(pending).resolves.toBe(paths.logPath);
        expect(runtime.files.get(paths.logPath)).toContain('"id":"queued"');
      });

      it("leaves the sink usable after refusing a location, so a later flush still settles", async () => {
        const runtime = makeRuntime("/tmp", 0o0777);
        const sink = new FrameSink({ runtime, logsRoot: logsRoot(runtime) });

        await sink.getValidatedPath();

        await expect(sink.flush()).resolves.toBeUndefined();
      });
    });

    describe("clear()", () => {
      it("clears active and rotated log files", async () => {
        const runtime = makeRuntime();
        const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
        const paths = getFrameLogPaths(logsRoot(runtime), runtime);
        runtime.files.set(paths.logPath, "active");
        runtime.files.set(paths.rotatedPath, "old");

        await sink.clear();

        expect(runtime.files.has(paths.logPath)).toBe(false);
        expect(runtime.files.has(paths.rotatedPath)).toBe(false);
        expect(runtime.removedPaths).toEqual(
          expect.arrayContaining([paths.logPath, paths.rotatedPath])
        );
      });

      it("deletes nothing when path validation fails (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
        const runtime = makeRuntime();
        const lstat = runtime.lstat as jest.MockedFunction<NodeRuntime["lstat"]>;
        lstat.mockRejectedValueOnce(errno("EACCES"));
        const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
        const paths = getFrameLogPaths(logsRoot(runtime), runtime);
        runtime.files.set(paths.logPath, "active");

        await expect(sink.clear()).rejects.toThrow("EACCES");

        expect(runtime.rm).not.toHaveBeenCalled();
        expect(runtime.files.has(paths.logPath)).toBe(true);
      });
    });

    // Real-filesystem groups: the in-memory runtime cannot prove the owner-only permission
    // boundary. They need a per-test mkdtemp sandbox, umask save/restore and a POSIX-only skip.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/250
    describePosix("on the real filesystem (POSIX)", () => {
      let tmpBase: string;
      let prevUmask: number;

      beforeEach(async () => {
        tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "frame-sink-realfs-"));
        prevUmask = process.umask(0o022);
      });

      afterEach(async () => {
        process.umask(prevUmask);
        await fs.rm(tmpBase, { recursive: true, force: true });
      });

      describe("append()", () => {
        it.each([[0o000], [0o022], [0o077]])(
          "creates the directory chain 0700 and the log file 0600 under umask %o (https://github.com/logancyang/obsidian-copilot-preview/issues/250)",
          async (umask) => {
            process.umask(umask);
            const runtime = makeRealRuntime(tmpBase);
            const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
            const paths = getFrameLogPaths(logsRoot(runtime), runtime);

            sink.append(makeFrame());
            await sink.flush();

            expect(exists(paths.logPath)).toBe(true);
            expect(modeOf(paths.dirPath)).toBe(0o700);
            expect(modeOf(path.dirname(paths.dirPath))).toBe(0o700);
            expect(modeOf(path.dirname(path.dirname(paths.dirPath)))).toBe(0o700);
            expect(modeOf(paths.logPath)).toBe(0o600);
            const status = await collectLocalData(
              {
                dataRoot: tmpBase,
                sessionsRoot: path.join(tmpBase, "sessions"),
                indexPath: path.join(tmpBase, "index.json"),
                deletionsRoot: path.join(tmpBase, "deletions"),
                logsRoot: logsRoot(runtime),
                tempRoot: path.join(tmpBase, "tmp"),
              },
              path.join(tmpBase, "data.json")
            );
            expect(status.logsBytes).toBe((await fs.stat(paths.logPath)).size);
            expect(status.totalBytes).toBe(status.logsBytes);
          }
        );

        it("narrows a pre-existing permissive directory and both log generations at the current storage location (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          process.umask(0o000);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "old-active\n", { mode: 0o644 });
          await fs.writeFile(paths.rotatedPath, "old-rotated\n", { mode: 0o644 });
          expect(modeOf(paths.dirPath)).toBe(0o777);

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(paths.logPath)).toBe(0o600);
          expect(modeOf(paths.rotatedPath)).toBe(0o600);
          const content = await fs.readFile(paths.logPath, "utf8");
          expect(content).toContain("old-active");
          expect(content).toContain('"session/update"');
        });

        it("removes a symlink squatting the leaf directory and never writes through it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          const victim = path.join(tmpBase, "victim");
          await fs.mkdir(victim, { recursive: true });
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          await fs.symlink(victim, paths.dirPath);

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(exists(path.join(victim, "runtime.ndjson"))).toBe(false);
          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isSymbolicLink()).toBe(false);
          expect(leaf.isDirectory()).toBe(true);
          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(paths.logPath)).toBe(0o600);
        });

        it("refuses a plain file squatting a directory level without deleting it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          await fs.writeFile(paths.dirPath, "someone's data", { mode: 0o644 });

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          sink.append(makeFrame());
          await sink.flush();

          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isFile()).toBe(true);
          expect(await fs.readFile(paths.dirPath, "utf8")).toBe("someone's data");
          expect(modeOf(paths.dirPath)).toBe(0o644);
          expect(exists(paths.logPath)).toBe(false);
        });

        it("removes a dangling symlink squatting the leaf directory path (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          await fs.symlink(path.join(tmpBase, "nowhere"), paths.dirPath);

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          sink.append(makeFrame());
          await sink.flush();

          const leaf = await fs.lstat(paths.dirPath);
          expect(leaf.isSymbolicLink()).toBe(false);
          expect(leaf.isDirectory()).toBe(true);
          expect(modeOf(paths.dirPath)).toBe(0o700);
          expect(modeOf(paths.logPath)).toBe(0o600);
        });

        it("removes a symlink squatting the log file itself and leaves its target untouched (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          const victimFile = path.join(tmpBase, "victim.txt");
          await fs.writeFile(victimFile, "victim-content", { mode: 0o644 });
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.symlink(victimFile, paths.logPath);

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(await fs.readFile(victimFile, "utf8")).toBe("victim-content");
          expect(modeOf(victimFile)).toBe(0o644);
          const log = await fs.lstat(paths.logPath);
          expect(log.isSymbolicLink()).toBe(false);
          expect(modeOf(paths.logPath)).toBe(0o600);
        });

        it("refuses to write into a directory owned by another user instead of falling back (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          const realLstat = runtime.lstat;
          runtime.lstat = async (target: string) => {
            const entry = await realLstat(target);
            return target === paths.dirPath ? { ...entry, uid: entry.uid + 1 } : entry;
          };

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(exists(paths.logPath)).toBe(false);
          expect(exists(paths.rotatedPath)).toBe(false);
        });

        it("leaves a log file owned by another user unread and unnarrowed (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "someone else's frames\n", { mode: 0o644 });
          const realLstat = runtime.lstat;
          runtime.lstat = async (target: string) => {
            const entry = await realLstat(target);
            return target === paths.logPath ? { ...entry, uid: entry.uid + 1 } : entry;
          };

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          sink.append(makeFrame());
          await sink.flush();

          expect(await fs.readFile(paths.logPath, "utf8")).toBe("someone else's frames\n");
          expect(modeOf(paths.logPath)).toBe(0o644);
        });

        it("creates the fresh post-rotation file 0600 (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          await fs.mkdir(paths.dirPath, { recursive: true });
          await fs.writeFile(paths.logPath, "", { mode: 0o644 });
          await fs.truncate(paths.logPath, 51 * 1024 * 1024);

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          for (let i = 0; i < 26; i++) sink.append(makeFrame({ id: String(i) }));
          await sink.flush();

          expect(exists(paths.rotatedPath)).toBe(true);
          expect(modeOf(paths.rotatedPath)).toBe(0o600);
          expect(modeOf(paths.logPath)).toBe(0o600);
        });
      });

      describe("getValidatedPath()", () => {
        it("unlinks a same-name symlink planted at the log path instead of vouching for its target (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          const decoyDir = path.join(tmpBase, "decoy");
          await fs.mkdir(decoyDir, { recursive: true });
          const decoy = path.join(decoyDir, path.basename(paths.logPath));
          await fs.writeFile(decoy, "planted\n");
          await fs.mkdir(paths.dirPath, { recursive: true, mode: 0o700 });
          await fs.symlink(decoy, paths.logPath);

          const resolved = await new FrameSink({
            logsRoot: logsRoot(runtime),
            runtime,
          }).getValidatedPath();

          expect(resolved).toBe(paths.logPath);
          expect(fsSync.lstatSync(decoy).isFile()).toBe(true);
          expect(await fs.readFile(decoy, "utf8")).toBe("planted\n");
          expect(exists(paths.logPath)).toBe(false);
        });

        it("refuses a log file another account owns (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          await fs.mkdir(paths.dirPath, { recursive: true, mode: 0o700 });
          await fs.writeFile(paths.logPath, "someone else's\n", { mode: 0o600 });
          const foreign: NodeRuntime = {
            ...runtime,
            lstat: async (p) =>
              p === paths.logPath
                ? { uid: 4242, mode: 0o600, isDirectory: false, isSymbolicLink: false }
                : runtime.lstat(p),
          };

          const resolved = await new FrameSink({
            logsRoot: logsRoot(runtime),
            runtime: foreign,
          }).getValidatedPath();

          expect(resolved).toBeNull();
        });
      });

      describe("open()", () => {
        it("creates a missing log file 0600 before opening it (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });

          await sink.open();

          expect(exists(paths.logPath)).toBe(true);
          expect(modeOf(paths.logPath)).toBe(0o600);
          expect(modeOf(paths.dirPath)).toBe(0o700);
        });
      });

      describe("clear()", () => {
        it("does not delete through a symlink squatting the leaf directory (https://github.com/logancyang/obsidian-copilot-preview/issues/250)", async () => {
          const runtime = makeRealRuntime(tmpBase);
          const paths = getFrameLogPaths(logsRoot(runtime), runtime);
          const victim = path.join(tmpBase, "victim");
          await fs.mkdir(victim, { recursive: true });
          const victimLog = path.join(victim, "runtime.ndjson");
          await fs.writeFile(victimLog, "victim-data");
          await fs.mkdir(path.dirname(paths.dirPath), { recursive: true });
          await fs.symlink(victim, paths.dirPath);

          const sink = new FrameSink({ logsRoot: logsRoot(runtime), runtime });
          await sink.clear();

          expect(exists(victimLog)).toBe(true);
        });
      });
    });
  });
});
