import type { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";

// A supervised command gets inheritEnv:false through CommandEnvironment, a hard timeout and output
// ceiling that terminate the real process, redaction before tail truncation, a private spill file
// for the full output, platform process-tree cleanup, and an explicit cleanup_incomplete outcome
// when the tree cannot be proven gone. Opaque execution stays replay:unsafe, so a crash or timeout
// is never auto-retried:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type ProcessTerminationReason = "timeout" | "cancelled" | "output_limit";

export type ProcessStatus =
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "output_limit"
  | "spawn_error"
  | "intent_failed";

export type ProcessCleanup = "clean" | "cleanup_incomplete";

export type ProcessErrorCode =
  | "NONZERO_EXIT"
  | "TIMEOUT"
  | "CANCELLED"
  | "OUTPUT_LIMIT"
  | "SPAWN_ERROR"
  | "INTENT_FAILED";

export interface ProcessStreamLike {
  on(event: "data", listener: (chunk: string | Uint8Array) => void): void;
}

export interface ProcessChildLike {
  readonly pid?: number;
  readonly stdout?: ProcessStreamLike;
  readonly stderr?: ProcessStreamLike;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  onError(listener: (error: Error) => void): void;
  kill(signal?: string): boolean;
}

export interface SpawnProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly inheritEnv: false;
  readonly timeoutMs: number;
}

export interface ProcessSpawner {
  spawn(request: SpawnProcessRequest): ProcessChildLike;
}

export interface ProcessTreeKiller {
  terminate(
    child: ProcessChildLike,
    reason: ProcessTerminationReason
  ): Promise<"confirmed" | "incomplete">;
}

export interface ProcessTimer {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SpillSink {
  write(content: string): Promise<string>;
}

export interface ProcessSupervisorOptions {
  readonly spawner: ProcessSpawner;
  readonly environment: CommandEnvironment;
  readonly killer?: ProcessTreeKiller;
  readonly timer?: ProcessTimer;
  readonly spill?: SpillSink;
  readonly recordIntent?: (request: SpawnProcessRequest) => Promise<void>;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly tailBytes?: number;
  readonly spillBytes?: number;
}

export interface RunCommandRequest {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface RunCommandContext {
  readonly signal?: AbortSignal;
}

export interface ProcessResult {
  readonly status: ProcessStatus;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly output: string;
  readonly truncated: boolean;
  readonly spillPath?: string;
  readonly cleanup: ProcessCleanup;
  readonly replay: "unsafe";
  readonly durationMs: number;
  readonly errorCode?: ProcessErrorCode;
  readonly intentRecorded: boolean;
  readonly message?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TAIL_BYTES = 64 * 1024;
const DEFAULT_SPILL_BYTES = 4 * 1024 * 1024;

const SYSTEM_TIMER: ProcessTimer = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

export class ProcessSupervisor {
  readonly #spawner: ProcessSpawner;
  readonly #environment: CommandEnvironment;
  readonly #killer: ProcessTreeKiller;
  readonly #timer: ProcessTimer;
  readonly #spill: SpillSink | undefined;
  readonly #recordIntent: ((request: SpawnProcessRequest) => Promise<void>) | undefined;
  readonly #defaultTimeoutMs: number;
  readonly #maxTimeoutMs: number;
  readonly #tailBytes: number;
  readonly #spillBytes: number;

  constructor(options: ProcessSupervisorOptions) {
    this.#spawner = options.spawner;
    this.#environment = options.environment;
    this.#killer =
      options.killer ??
      ({
        terminate: async (child) => {
          child.kill("SIGTERM");
          return "incomplete";
        },
      } satisfies ProcessTreeKiller);
    this.#timer = options.timer ?? SYSTEM_TIMER;
    this.#spill = options.spill;
    this.#recordIntent = options.recordIntent;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxTimeoutMs = options.maxTimeoutMs ?? MAX_TIMEOUT_MS;
    this.#tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
    this.#spillBytes = options.spillBytes ?? DEFAULT_SPILL_BYTES;
  }

  async run(request: RunCommandRequest, context: RunCommandContext = {}): Promise<ProcessResult> {
    const startedAt = this.#timer.now();
    const timeoutMs = this.#clampTimeout(request.timeoutMs);
    if (commandCancelled(context)) {
      return this.#result("cancelled", null, null, "", false, undefined, "clean", startedAt, {
        errorCode: "CANCELLED",
        intentRecorded: false,
      });
    }
    const built = this.#environment.build({ userEnv: request.env });
    const spawnRequest: SpawnProcessRequest = {
      command: request.command,
      args: Object.freeze([...(request.args ?? [])]),
      cwd: request.cwd,
      env: built.env,
      inheritEnv: false,
      timeoutMs,
    };
    let intentRecorded = false;
    if (this.#recordIntent !== undefined) {
      try {
        await this.#recordIntent(spawnRequest);
        intentRecorded = true;
      } catch (thrown) {
        return this.#result("intent_failed", null, null, "", false, undefined, "clean", startedAt, {
          errorCode: "INTENT_FAILED",
          intentRecorded: false,
          message: messageOf(thrown),
        });
      }
    }
    // 保存命令意图会等待磁盘，期间点击停止必须在创建进程前生效：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (commandCancelled(context)) {
      return this.#result("cancelled", null, null, "", false, undefined, "clean", startedAt, {
        errorCode: "CANCELLED",
        intentRecorded,
      });
    }
    const { promise, resolve: resolveFinal } = deferred<ProcessResult>();
    let child: ProcessChildLike;
    try {
      child = this.#spawner.spawn(spawnRequest);
    } catch (thrown) {
      return this.#result("spawn_error", null, null, "", false, undefined, "clean", startedAt, {
        errorCode: "SPAWN_ERROR",
        intentRecorded,
        message: messageOf(thrown),
      });
    }

    let full = "";
    let retainedBytes = 0;
    let totalBytes = 0;
    let limitExceeded = false;
    let terminationReason: ProcessTerminationReason | undefined;
    let cleanup: ProcessCleanup | undefined;
    let killerPromise: Promise<void> | undefined;
    let timeoutHandle: unknown;
    let settled = false;

    const terminate = (reason: ProcessTerminationReason): void => {
      if (terminationReason !== undefined || settled) return;
      terminationReason = reason;
      killerPromise = this.#killer
        .terminate(child, reason)
        .then((outcome) => {
          cleanup = outcome === "confirmed" ? "clean" : "cleanup_incomplete";
        })
        .catch(() => {
          cleanup = "cleanup_incomplete";
        });
    };
    const onData = (chunk: string | Uint8Array): void => {
      if (settled || limitExceeded) return;
      const rawText = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      totalBytes += new TextEncoder().encode(rawText).length;
      const text = this.#environment.redact(rawText);
      const remaining = this.#spillBytes - retainedBytes;
      if (remaining > 0) {
        const retained = new TextDecoder().decode(
          new TextEncoder().encode(text).subarray(0, remaining),
          { stream: true }
        );
        full += retained;
        retainedBytes += new TextEncoder().encode(retained).byteLength;
      }
      if (totalBytes > this.#spillBytes) {
        limitExceeded = true;
        terminate("output_limit");
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const onAbort = (): void => terminate("cancelled");
    const finish = (
      status: ProcessStatus,
      exitCode: number | null,
      signal: string | null
    ): void => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) this.#timer.clearTimeout(timeoutHandle);
      if (context.signal !== undefined) context.signal.removeEventListener("abort", onAbort);
      const run = async (): Promise<ProcessResult> => {
        if (killerPromise !== undefined) await killerPromise;
        // 进程可能把同一凭据分成多段输出，合并后再脱敏，且中文尾部按字节截取以免越限或乱码：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const sanitized = this.#environment.redact(full);
        const truncated = totalBytes > this.#tailBytes || limitExceeded;
        let spillPath: string | undefined;
        if (truncated && this.#spill !== undefined && sanitized.length > 0) {
          try {
            spillPath = await this.#spill.write(sanitized);
          } catch {
            spillPath = undefined;
          }
        }
        return this.#result(
          status,
          exitCode,
          signal,
          utf8Tail(sanitized, this.#tailBytes),
          truncated,
          spillPath,
          cleanup ?? "clean",
          startedAt,
          {
            ...(errorCodeOf(status) !== undefined ? { errorCode: errorCodeOf(status) } : {}),
            intentRecorded,
          }
        );
      };
      void run().then((result) => resolveFinal(result));
    };

    child.onError(() => {
      finish("spawn_error", null, null);
    });
    child.onExit((code, signal) => {
      const status: ProcessStatus = limitExceeded
        ? "output_limit"
        : terminationReason === "timeout"
          ? "timed_out"
          : terminationReason === "cancelled"
            ? "cancelled"
            : code === 0
              ? "completed"
              : "failed";
      finish(status, code, signal);
    });
    if (context.signal !== undefined) {
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
    }
    timeoutHandle = this.#timer.setTimeout(() => terminate("timeout"), timeoutMs);
    return promise;
  }

  #clampTimeout(value: number | undefined): number {
    const requested =
      typeof value === "number" && Number.isFinite(value) ? value : this.#defaultTimeoutMs;
    return Math.min(Math.max(Math.trunc(requested), 1_000), this.#maxTimeoutMs);
  }

  #result(
    status: ProcessStatus,
    exitCode: number | null,
    signal: string | null,
    output: string,
    truncated: boolean,
    spillPath: string | undefined,
    cleanup: ProcessCleanup,
    startedAt: number,
    extra: {
      errorCode?: ProcessErrorCode;
      intentRecorded: boolean;
      message?: string;
    }
  ): ProcessResult {
    return {
      status,
      exitCode,
      signal,
      output,
      truncated,
      ...(spillPath !== undefined ? { spillPath } : {}),
      cleanup,
      replay: "unsafe",
      durationMs: Math.max(0, this.#timer.now() - startedAt),
      ...(extra.errorCode !== undefined ? { errorCode: extra.errorCode } : {}),
      intentRecorded: extra.intentRecorded,
      ...(extra.message !== undefined ? { message: extra.message } : {}),
    };
  }
}

function errorCodeOf(status: ProcessStatus): ProcessErrorCode | undefined {
  switch (status) {
    case "completed":
      return undefined;
    case "failed":
      return "NONZERO_EXIT";
    case "timed_out":
      return "TIMEOUT";
    case "cancelled":
      return "CANCELLED";
    case "output_limit":
      return "OUTPUT_LIMIT";
    case "spawn_error":
      return "SPAWN_ERROR";
    case "intent_failed":
      return "INTENT_FAILED";
  }
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function commandCancelled(context: RunCommandContext): boolean {
  return context.signal?.aborted === true;
}

function utf8Tail(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  let start = Math.max(0, bytes.byteLength - maxBytes);
  while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start += 1;
  return new TextDecoder().decode(bytes.subarray(start));
}
