import type {
  BinaryReader,
  DirReader,
  ExecutionEnv,
  ExecutionError,
  FileError,
  FileInfo,
  FileListing,
  FileWatcher,
  ListFilesOptions,
  Result,
  ShellExecOptions,
  ShellExecResult,
  TextLineReader,
  WatchChange,
  WatchTarget,
} from "@earendil-works/pi-durable/env";

import { isPathWithin, type PathFileSystem } from "@/agentMode/sdk/pi/policy/PathResolver";
import { PlatformPathPolicy } from "@/agentMode/sdk/pi/policy/PlatformPathPolicy";

// GuardedExternalEnv implements the locked ExecutionEnv surface while checking every public I/O
// method against the protected roots only — external targets need no pre-authorized scope since the
// per-call approval is the only authorization layer: an indirect stat/read through a symlink, a new
// file below a symlinked parent, a hard-linked write, or leaking the raw environment could all
// bypass a protected boundary. Temp paths live under one private root outside the vault and exec
// goes through a separate command gate instead of the raw shell:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
export type GuardedFileKind = "file" | "directory" | "symlink" | "missing";

export interface GuardedInspectorEntry {
  readonly kind: GuardedFileKind;
  readonly nlink?: number;
}

export interface GuardedInspector extends Pick<PathFileSystem, "stat"> {
  lstat(target: string): Promise<GuardedInspectorEntry>;
  realpath(target: string): Promise<string>;
}

export type GuardedFileErrorFactory = (
  code: FileError["code"],
  message: string,
  path?: string
) => FileError;

export type GuardedExecutionErrorFactory = (
  code: ExecutionError["code"],
  message: string
) => ExecutionError;

export interface GuardedCommandRequest {
  readonly command: string | readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeout?: number;
}

export type GuardedCommandDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: string; readonly message: string };

export interface GuardedCommandGate {
  authorize(request: GuardedCommandRequest): Promise<GuardedCommandDecision>;
}

export interface GuardedPathOperations {
  isAbsolute(target: string): boolean;
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  basename(target: string): string;
  dirname(target: string): string;
  relative(from: string, to: string): string;
  readonly sep: string;
}

export interface GuardedExternalEnvOptions {
  readonly raw: ExecutionEnv;
  readonly inspector: GuardedInspector;
  readonly path: GuardedPathOperations;
  readonly protectedRoots: readonly string[];
  readonly isAccessCurrent?: () => boolean;
  readonly commandGate?: GuardedCommandGate;
  readonly fileError?: GuardedFileErrorFactory;
  readonly executionError?: GuardedExecutionErrorFactory;
  readonly privateTempPrefix?: string;
}

type SdkContext = Parameters<ExecutionEnv["readTextFile"]>[1];

const SECRET_ENV_KEY = /(api[_-]?key|token|secret|password|credential|authorization)/i;

export class GuardedExternalEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  #raw: ExecutionEnv;
  readonly #inspector: GuardedInspector;
  readonly #path: GuardedPathOperations;
  readonly #protectedRoots: readonly string[];
  readonly #isAccessCurrent: (() => boolean) | undefined;
  readonly #commandGate: GuardedCommandGate | undefined;
  readonly #fileError: GuardedFileErrorFactory;
  readonly #executionError: GuardedExecutionErrorFactory;
  readonly #privateTempPrefix: string;
  #privateRoot: string | undefined;
  #privateRootPromise: Promise<Result<string, FileError>> | undefined;
  #tempCounter = 0;

  constructor(options: GuardedExternalEnvOptions) {
    this.#raw = options.raw;
    this.#inspector = options.inspector;
    this.#path = options.path;
    this.#protectedRoots = options.protectedRoots;
    this.#isAccessCurrent = options.isAccessCurrent;
    this.#commandGate = options.commandGate;
    this.#fileError =
      options.fileError ??
      ((code, message, target) => {
        const error = new Error(message) as Error & { code: string; path?: string };
        error.name = "FileError";
        error.code = code;
        if (target !== undefined) error.path = target;
        return error as FileError;
      });
    this.#executionError =
      options.executionError ??
      ((code, message) => {
        const error = new Error(message) as Error & { code: string };
        error.name = "ExecutionError";
        error.code = code;
        return error as ExecutionError;
      });
    this.#privateTempPrefix = options.privateTempPrefix ?? "vault-agent-pi";
    this.id = options.raw.id;
    this.cwd = options.raw.cwd;
  }

  async absolutePath(target: string, context: SdkContext): Promise<Result<string, FileError>> {
    return this.#raw.absolutePath(target, context);
  }

  async joinPath(parts: string[], context: SdkContext): Promise<Result<string, FileError>> {
    return this.#raw.joinPath(parts, context);
  }

  async readTextFile(target: string, context: SdkContext): Promise<Result<string, FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.readTextFile(guarded.value, context);
  }

  async openTextLineReader(
    target: string,
    context: SdkContext
  ): Promise<Result<TextLineReader, FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.openTextLineReader(guarded.value, context);
  }

  async readTextLines(
    target: string,
    options: { maxLines?: number } | undefined,
    context: SdkContext
  ): Promise<Result<string[], FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.readTextLines(guarded.value, options, context);
  }

  async readBinaryFile(
    target: string,
    context: SdkContext
  ): Promise<Result<Uint8Array, FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.readBinaryFile(guarded.value, context);
  }

  async openBinaryReader(
    target: string,
    options: { noFollow?: boolean } | undefined,
    context: SdkContext
  ): Promise<Result<BinaryReader, FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.openBinaryReader(guarded.value, options, context);
  }

  async writeFile(
    target: string,
    content: string | Uint8Array,
    context: SdkContext
  ): Promise<Result<void, FileError>> {
    const guarded = await this.#guardWrite(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.writeFile(guarded.value, content, context);
  }

  async appendFile(
    target: string,
    content: string | Uint8Array,
    context: SdkContext
  ): Promise<Result<void, FileError>> {
    const guarded = await this.#guardWrite(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.appendFile(guarded.value, content, context);
  }

  async truncateFile(
    target: string,
    size: number,
    context: SdkContext
  ): Promise<Result<void, FileError>> {
    const guarded = await this.#guardWrite(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.truncateFile(guarded.value, size, context);
  }

  async flushFile(target: string, context: SdkContext): Promise<Result<void, FileError>> {
    const guarded = await this.#guardWrite(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.flushFile(guarded.value, context);
  }

  async renameFile(
    source: string,
    destination: string,
    context: SdkContext
  ): Promise<Result<void, FileError>> {
    const guardedSource = await this.#guardRead(source);
    if (!guardedSource.ok) return guardedSource;
    const guardedDestination = await this.#guardWrite(destination);
    if (!guardedDestination.ok) return guardedDestination;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.renameFile(guardedSource.value, guardedDestination.value, context);
  }

  async fileInfo(target: string, context: SdkContext): Promise<Result<FileInfo, FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.fileInfo(guarded.value, context);
  }

  async listDir(target: string, context: SdkContext): Promise<Result<FileInfo[], FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.listDir(guarded.value, context);
  }

  async listFiles(
    target: string,
    options: ListFilesOptions | undefined,
    context: SdkContext
  ): Promise<Result<FileListing, FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    if (this.#raw.listFiles === undefined) {
      return err(this.#fileError("not_supported", "Listing is not supported here.", target));
    }
    return this.#raw.listFiles(guarded.value, options, context);
  }

  async openDirReader(target: string, context: SdkContext): Promise<Result<DirReader, FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.openDirReader(guarded.value, context);
  }

  async watch(
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    context: SdkContext
  ): Promise<Result<FileWatcher, FileError>> {
    const guardedTargets: WatchTarget[] = [];
    for (const target of targets) {
      const guarded = await this.#guardRead(target.path);
      if (!guarded.ok) return guarded;
      if (this.#isAccessCurrent?.() === false)
        return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
      guardedTargets.push({ ...target, path: guarded.value });
    }
    return this.#raw.watch(guardedTargets, onChange, context);
  }

  async canonicalPath(target: string, context: SdkContext): Promise<Result<string, FileError>> {
    void context;
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return ok(guarded.value);
  }

  async exists(target: string, context: SdkContext): Promise<Result<boolean, FileError>> {
    const guarded = await this.#guardRead(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.exists(guarded.value, context);
  }

  async createDir(
    target: string,
    options: { recursive?: boolean } | undefined,
    context: SdkContext
  ): Promise<Result<void, FileError>> {
    const guarded = await this.#guardWrite(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.createDir(guarded.value, options, context);
  }

  async remove(
    target: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: SdkContext
  ): Promise<Result<void, FileError>> {
    const guarded = await this.#guardWrite(target);
    if (!guarded.ok) return guarded;
    if (this.#isAccessCurrent?.() === false)
      return err(this.#fileError("permission_denied", "外部文件授权已变化，请重新核对。"));
    return this.#raw.remove(guarded.value, options, context);
  }

  async createTempDir(
    prefix: string | undefined,
    context: SdkContext
  ): Promise<Result<string, FileError>> {
    const root = await this.#ensurePrivateRoot(context);
    if (!root.ok) return root;
    const target = this.#path.join(
      root.value,
      `${this.#safeSegment(prefix ?? "dir")}-${this.#tempCounter++}`
    );
    const created = await this.#raw.createDir(target, { recursive: true }, context);
    if (!created.ok) return created;
    return ok(target);
  }

  async createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: SdkContext
  ): Promise<Result<string, FileError>> {
    const root = await this.#ensurePrivateRoot(context);
    if (!root.ok) return root;
    const target = this.#path.join(
      root.value,
      `${this.#safeSegment(options?.prefix ?? "tmp")}-${this.#tempCounter++}${options?.suffix ?? ""}`
    );
    const created = await this.#raw.writeFile(target, new Uint8Array(), context);
    if (!created.ok) return created;
    return ok(target);
  }

  async cleanup(context: SdkContext): Promise<void> {
    this.#privateRoot = undefined;
    this.#privateRootPromise = undefined;
    await this.#raw.cleanup(context);
  }

  async exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: SdkContext
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const cwd = options?.cwd ?? this.cwd;
    const guardedCwd = await this.#guardWrite(cwd);
    if (!guardedCwd.ok) {
      return err(this.#executionError("spawn_error", guardedCwd.error.message));
    }
    const request: GuardedCommandRequest = {
      command,
      cwd: guardedCwd.value,
      env: sanitizeEnv(options?.env),
      ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
    };
    const decision =
      this.#commandGate === undefined
        ? {
            allowed: false as const,
            code: "OPAQUE_EXECUTION_DISABLED",
            message: "Opaque shell execution is disabled in strict mode.",
          }
        : await this.#commandGate.authorize(request);
    if (!decision.allowed) {
      return err(
        this.#executionError("shell_unavailable", `${decision.code}: ${decision.message}`)
      );
    }
    return this.#raw.exec(
      command,
      {
        ...options,
        cwd: guardedCwd.value,
        env: { ...request.env },
        inheritEnv: false,
      },
      context
    );
  }

  async #guardRead(target: string): Promise<Result<string, FileError>> {
    try {
      const resolved = this.#resolve(target);
      const info = await this.#canonicalForCheck(resolved);
      if (await this.#isPrivateTemp(info.canonical)) return ok(info.canonical);
      if (await this.#isProtected(info.canonical)) {
        return err(this.#fileError("permission_denied", "PROTECTED_PATH_DENIED", target));
      }
      return ok(info.canonical);
    } catch (error) {
      return err(
        this.#fileError(
          "permission_denied",
          `EXTERNAL_PATH_DENIED: ${error instanceof Error ? error.message : String(error)}`,
          target
        )
      );
    }
  }

  async #guardWrite(target: string): Promise<Result<string, FileError>> {
    try {
      const resolved = this.#resolve(target);
      const info = await this.#canonicalForCheck(resolved);
      if (await this.#isPrivateTemp(info.canonical)) return ok(info.canonical);
      if (await this.#isProtected(info.canonical)) {
        return err(this.#fileError("permission_denied", "PROTECTED_PATH_DENIED", target));
      }
      if (info.kind === "symlink") {
        return err(
          this.#fileError(
            "permission_denied",
            "EXTERNAL_SYMLINK_WRITE_DENIED: refusing to write through a symbolic link.",
            target
          )
        );
      }
      if (info.kind === "file" && (info.nlink ?? 1) > 1) {
        return err(
          this.#fileError(
            "permission_denied",
            "EXTERNAL_HARDLINK_DENIED: refusing to write a file with multiple hard links.",
            target
          )
        );
      }
      return ok(info.canonical);
    } catch (error) {
      return err(
        this.#fileError(
          "permission_denied",
          `EXTERNAL_PATH_DENIED: ${error instanceof Error ? error.message : String(error)}`,
          target
        )
      );
    }
  }

  async #canonicalForCheck(
    target: string
  ): Promise<{ canonical: string; kind: GuardedFileKind; nlink?: number }> {
    const tail: string[] = [];
    let current = target;
    for (;;) {
      const info = await this.#inspector
        .lstat(current)
        .catch((): GuardedInspectorEntry => ({ kind: "missing" }));
      if (info.kind !== "missing") {
        const real = await this.#inspector.realpath(current).catch(() => current);
        const canonical = tail.length === 0 ? real : this.#path.join(real, ...tail.reverse());
        return {
          canonical,
          kind: tail.length === 0 ? info.kind : "missing",
          ...(info.nlink !== undefined && tail.length === 0 ? { nlink: info.nlink } : {}),
        };
      }
      const parent = this.#path.join(current, "..");
      const normalizedParent = this.#path.resolve(parent);
      if (normalizedParent === current) return { canonical: target, kind: "missing" };
      tail.push(this.#path.basename(current));
      current = normalizedParent;
    }
  }

  async #ensurePrivateRoot(context: SdkContext): Promise<Result<string, FileError>> {
    if (this.#privateRoot !== undefined) return ok(this.#privateRoot);
    if (this.#privateRootPromise !== undefined) return this.#privateRootPromise;
    this.#privateRootPromise = (async () => {
      const created = await this.#raw.createTempDir(this.#privateTempPrefix, context);
      if (!created.ok) return created;
      const canonical = await this.#inspector.realpath(created.value).catch(() => created.value);
      for (const protectedRoot of this.#protectedRoots) {
        const canonicalProtected = await this.#inspector
          .realpath(protectedRoot)
          .catch(() => protectedRoot);
        if (await this.#isInside(canonicalProtected, canonical)) {
          await this.#raw.remove(created.value, { recursive: true, force: true }, context);
          return err(
            this.#fileError(
              "permission_denied",
              "PRIVATE_TEMP_OVERLAPS_PROTECTED: the temp root is inside a protected root.",
              created.value
            )
          );
        }
      }
      this.#privateRoot = canonical;
      return ok(canonical);
    })();
    const result = await this.#privateRootPromise;
    if (!result.ok) this.#privateRootPromise = undefined;
    return result;
  }

  async #isPrivateTemp(candidate: string): Promise<boolean> {
    return (
      this.#privateRoot !== undefined &&
      (await this.#isInside(this.#privateRoot, this.#path.resolve(candidate)))
    );
  }

  async #isProtected(canonical: string): Promise<boolean> {
    for (const protectedRoot of this.#protectedRoots) {
      if (await this.#isInside(protectedRoot, canonical)) return true;
    }
    return false;
  }

  #isInside(root: string, candidate: string): Promise<boolean> {
    return isPathWithin(root, candidate, this.#path, this.#inspector);
  }

  #resolve(target: string): string {
    new PlatformPathPolicy({
      platform: this.#path.sep === "\\" ? "win32" : "posix",
      uncAccess: "open",
    }).validate(target);
    return this.#path.isAbsolute(target)
      ? this.#path.resolve(target)
      : this.#path.resolve(this.cwd, target);
  }

  #safeSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, "-");
  }
}

function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (SECRET_ENV_KEY.test(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}
