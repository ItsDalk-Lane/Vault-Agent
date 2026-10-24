import type {
  ExecutionEnv,
  ExecutionError,
  FileError,
  FileInfo,
  Result,
} from "@earendil-works/pi-durable/env";
import * as path from "node:path";

import {
  GuardedExternalEnv,
  type GuardedCommandGate,
  type GuardedInspector,
} from "@/agentMode/sdk/pi/tools/GuardedExternalEnv";

// GuardedExternalEnv must check every public ExecutionEnv I/O path, not only the tool arguments:
// an indirect stat/read through a symlink, a new file under a symlinked parent, a hard link, or a
// leaked raw env could all bypass a user-approved external root. It also keeps a private temp root
// and routes exec through the command gate instead of exposing the raw environment:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeFileError extends Error {
  readonly code: FileError["code"];
  readonly path?: string;

  constructor(code: FileError["code"], message: string, filePath?: string) {
    super(message);
    this.name = "FileError";
    this.code = code;
    this.path = filePath;
  }
}

class FakeExecutionError extends Error {
  readonly code: ExecutionError["code"];
  spillPath?: string;

  constructor(code: ExecutionError["code"], message: string) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
  }
}

type InspectorEntry = {
  kind: "file" | "directory" | "symlink" | "missing";
  nlink?: number;
  realpath?: string;
};

class FakeInspector implements GuardedInspector {
  readonly entries = new Map<string, InspectorEntry>();

  async lstat(target: string): Promise<{ kind: InspectorEntry["kind"]; nlink?: number }> {
    const entry = this.entries.get(path.resolve(target));
    return entry === undefined
      ? { kind: "missing" }
      : { kind: entry.kind, ...(entry.nlink !== undefined ? { nlink: entry.nlink } : {}) };
  }

  async realpath(target: string): Promise<string> {
    const resolved = path.resolve(target);
    const entry = this.entries.get(resolved);
    return entry?.realpath ?? resolved;
  }
}

class FakeRawEnv {
  readonly files = new Map<string, string>();
  readonly execCalls: Array<{ command: string | readonly string[]; options: unknown }> = [];
  readonly written: string[] = [];
  execResult: Result<{ exitCode: number }, ExecutionError> = { ok: true, value: { exitCode: 0 } };

  async absolutePath(target: string): Promise<Result<string, FileError>> {
    return { ok: true, value: path.resolve(target) };
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return { ok: true, value: path.join(...parts) };
  }

  async readTextFile(target: string): Promise<Result<string, FileError>> {
    const content = this.files.get(path.resolve(target));
    if (content === undefined) {
      return { ok: false, error: new FakeFileError("not_found", "missing", target) };
    }
    return { ok: true, value: content };
  }

  async fileInfo(target: string): Promise<Result<FileInfo, FileError>> {
    const resolved = path.resolve(target);
    return {
      ok: true,
      value: {
        name: path.basename(resolved),
        path: resolved,
        kind: "file",
        size: (this.files.get(resolved) ?? "").length,
        mtimeMs: 1,
      },
    };
  }

  async listDir(target: string): Promise<Result<FileInfo[], FileError>> {
    void target;
    return { ok: true, value: [] };
  }

  async exists(target: string): Promise<Result<boolean, FileError>> {
    return { ok: true, value: this.files.has(path.resolve(target)) };
  }

  async createDir(): Promise<Result<void, FileError>> {
    return { ok: true, value: undefined };
  }

  async canonicalPath(target: string): Promise<Result<string, FileError>> {
    return { ok: true, value: path.resolve(target) };
  }

  async writeFile(target: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    this.files.set(path.resolve(target), String(content));
    this.written.push(path.resolve(target));
    return { ok: true, value: undefined };
  }

  async appendFile(target: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    return this.writeFile(target, content);
  }

  async renameFile(source: string, destination: string): Promise<Result<void, FileError>> {
    const content = this.files.get(path.resolve(source)) ?? "";
    this.files.delete(path.resolve(source));
    return this.writeFile(destination, content);
  }

  async remove(): Promise<Result<void, FileError>> {
    return { ok: true, value: undefined };
  }

  async createTempDir(prefix?: string): Promise<Result<string, FileError>> {
    return { ok: true, value: path.join("/tmp", `${prefix ?? "tmp"}-${this.tempCounter++}`) };
  }

  async createTempFile(options?: {
    prefix?: string;
    suffix?: string;
  }): Promise<Result<string, FileError>> {
    return {
      ok: true,
      value: path.join(
        "/tmp",
        `${options?.prefix ?? "tmp"}-${this.tempCounter++}${options?.suffix ?? ""}`
      ),
    };
  }

  async exec(
    command: string | readonly string[],
    options?: unknown
  ): Promise<Result<{ exitCode: number }, ExecutionError>> {
    this.execCalls.push({ command, options });
    return this.execResult;
  }

  async cleanup(): Promise<void> {
    return undefined;
  }

  tempCounter = 1;
}

class FakeCommandGate implements GuardedCommandGate {
  readonly requests: unknown[] = [];
  decision: { allowed: true } | { allowed: false; code: string; message: string } = {
    allowed: true,
  };

  async authorize(
    request: unknown
  ): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
    this.requests.push(request);
    return this.decision;
  }
}

interface Harness {
  readonly env: GuardedExternalEnv;
  readonly raw: FakeRawEnv;
  readonly inspector: FakeInspector;
  readonly gate: FakeCommandGate;
}

function createHarness({
  withGate = true,
  now = 1_000,
  isAccessCurrent,
}: { withGate?: boolean; now?: number; isAccessCurrent?: () => boolean } = {}): Harness {
  const raw = new FakeRawEnv();
  const inspector = new FakeInspector();
  const gate = new FakeCommandGate();
  const env = new GuardedExternalEnv({
    raw: raw as unknown as ExecutionEnv,
    inspector,
    path,
    protectedRoots: ["/vault", "/home/user/.config", "/home/user/.vault-agent"],
    isAccessCurrent,
    ...(withGate ? { commandGate: gate } : {}),
    fileError: (code, message, target) => new FakeFileError(code, message, target),
    executionError: (code, message) => new FakeExecutionError(code, message),
    privateTempPrefix: "vault-agent-pi",
  });
  return { env, raw, inspector, gate };
}

describe("GuardedExternalEnv", () => {
  describe("read guards", () => {
    it.each(["read", "write"])(
      "refuses %s when the grant snapshot is withdrawn during asynchronous path checking https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (operation) => {
        let current = true;
        const fixture = createHarness({ isAccessCurrent: () => current });
        const target = "/home/user/docs/note.md";
        fixture.inspector.entries.set(target, { kind: "file" });
        fixture.raw.files.set(target, "original");
        const read = jest.spyOn(fixture.raw, "readTextFile");
        const write = jest.spyOn(fixture.raw, "writeFile");
        const realpath = fixture.inspector.realpath.bind(fixture.inspector);
        jest.spyOn(fixture.inspector, "realpath").mockImplementation(async (path) => {
          current = false;
          return realpath(path);
        });
        const result =
          operation === "read"
            ? await fixture.env.readTextFile(target, {} as never)
            : await fixture.env.writeFile(target, "changed", {} as never);
        expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(fixture.raw.files.get(target)).toBe("original");
      }
    );
    it("reads a case-aliased sibling directory that is a genuinely different directory (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", async () => {
      const raw = {
        cwd: "C:\\Private",
        id: "fixture",
        createTempDir: jest.fn(async () => ({ ok: true, value: "C:\\Private" })),
        createDir: jest.fn(async () => ({ ok: true, value: undefined })),
        readTextFile: jest.fn(async () => ({ ok: true, value: "different directory" })),
      };
      const inspector = {
        realpath: async (target: string) => target,
        lstat: async () => ({ kind: "directory" as const }),
        stat: async (target: string) => ({
          dev: 1,
          ino: target === "C:\\Private" ? 2 : target === "C:\\PRIVATE" ? 3 : 1,
        }),
      };
      const env = new GuardedExternalEnv({
        raw: raw as unknown as ExecutionEnv,
        inspector,
        path: path.win32,
        protectedRoots: [],
      });
      expect((await env.createTempDir("fixture", {} as never)).ok).toBe(true);
      const aliased = await env.readTextFile("C:\\PRIVATE\\secret", {} as never);
      // 单层权限模型下另一个真实目录不再因缺少预授权被拒：https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
      expect(aliased).toMatchObject({ ok: true, value: "different directory" });
    });
    it("rejects an indirect stat/read that escapes into a protected root through a symlink (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", async () => {
      const harnessed = createHarness();
      harnessed.inspector.entries.set("/home/user/docs/link", {
        kind: "symlink",
        realpath: "/vault/notes",
      });
      harnessed.inspector.entries.set("/vault/notes/secret.md", { kind: "file" });
      harnessed.raw.files.set("/vault/notes/secret.md", "vault secret");

      const read = await harnessed.env.readTextFile("/home/user/docs/link/secret.md", {} as never);
      const stat = await harnessed.env.fileInfo("/home/user/docs/link/secret.md", {} as never);

      expect(read.ok).toBe(false);
      expect(stat.ok).toBe(false);
      if (!read.ok) expect(read.error.message).toContain("PROTECTED_PATH_DENIED");
      if (!stat.ok) expect(stat.error.message).toContain("PROTECTED_PATH_DENIED");
      expect(harnessed.raw.files.get("/vault/notes/secret.md")).toBe("vault secret");
    });
  });

  describe("write guards", () => {
    it("rejects a new file under a symlinked parent that points into a protected root (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", async () => {
      const harnessed = createHarness();
      harnessed.inspector.entries.set("/home/user/docs/out", {
        kind: "symlink",
        realpath: "/vault/notes",
      });

      const result = await harnessed.env.writeFile(
        "/home/user/docs/out/new.md",
        "new",
        {} as never
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("PROTECTED_PATH_DENIED");
      expect(harnessed.raw.written).toEqual([]);
    });

    it("rejects an external write to a hard-linked file", async () => {
      const harnessed = createHarness();
      harnessed.inspector.entries.set("/home/user/docs/hard.md", { kind: "file", nlink: 2 });
      harnessed.raw.files.set("/home/user/docs/hard.md", "shared");

      const result = await harnessed.env.writeFile(
        "/home/user/docs/hard.md",
        "overwrite",
        {} as never
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("EXTERNAL_HARDLINK_DENIED");
      expect(harnessed.raw.files.get("/home/user/docs/hard.md")).toBe("shared");
    });

    it("allows a normal read/write on an unprotected external path (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", async () => {
      const harnessed = createHarness();
      harnessed.inspector.entries.set("/home/user/docs/note.md", { kind: "file" });
      harnessed.raw.files.set("/home/user/docs/note.md", "hello");

      const read = await harnessed.env.readTextFile("/home/user/docs/note.md", {} as never);
      const write = await harnessed.env.writeFile(
        "/home/user/docs/note.md",
        "updated",
        {} as never
      );

      expect(read).toMatchObject({ ok: true, value: "hello" });
      expect(write.ok).toBe(true);
      expect(harnessed.raw.files.get("/home/user/docs/note.md")).toBe("updated");
    });
  });

  describe("private temp and env", () => {
    it("creates temp paths under a private root outside the vault and scopes", async () => {
      const harnessed = createHarness();

      const tempDir = await harnessed.env.createTempDir("spill", {} as never);

      expect(tempDir.ok).toBe(true);
      if (!tempDir.ok) return;
      expect(tempDir.value.startsWith("/tmp/vault-agent-pi")).toBe(true);
      expect(tempDir.value.startsWith("/vault")).toBe(false);
      expect(harnessed.inspector.entries.size).toBe(0);
      harnessed.raw.files.set(`${tempDir.value}/out.txt`, "spill");
      expect(
        await harnessed.env.readTextFile(`${tempDir.value}/out.txt`, {} as never)
      ).toMatchObject({ ok: true, value: "spill" });
    });

    it("does not expose the raw environment or process env", () => {
      const harnessed = createHarness();

      const exposed = harnessed.env as unknown as Record<string, unknown>;
      expect("rawNodeEnv" in harnessed.env).toBe(false);
      expect("raw" in harnessed.env).toBe(false);
      expect("processEnv" in harnessed.env).toBe(false);
      expect(exposed["rawNodeEnv"]).toBeUndefined();
    });
  });

  describe("exec gate", () => {
    it("denies execution without an injected command gate", async () => {
      const harnessed = createHarness({ withGate: false });
      harnessed.env.cwd = "/home/user/docs";

      const result = await harnessed.env.exec("echo hi", undefined, {} as never);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("OPAQUE_EXECUTION_DISABLED");
      expect(harnessed.raw.execCalls).toEqual([]);
    });

    it("runs only through an allowed command gate with sanitized env and inheritEnv false", async () => {
      const harnessed = createHarness();
      harnessed.env.cwd = "/home/user/docs";

      const result = await harnessed.env.exec(
        "echo hi",
        { env: { SAFE: "1", API_KEY: "secret", GITHUB_TOKEN: "secret" }, timeout: 5_000 },
        {} as never
      );

      expect(result.ok).toBe(true);
      expect(harnessed.gate.requests).toHaveLength(1);
      expect(harnessed.gate.requests[0]).toMatchObject({
        command: "echo hi",
        cwd: "/home/user/docs",
        env: { SAFE: "1" },
      });
      const execCall = harnessed.raw.execCalls[0];
      expect(execCall.options).toMatchObject({ cwd: "/home/user/docs", inheritEnv: false });
    });
  });
});
