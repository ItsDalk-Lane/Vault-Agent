import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";

// The Test button only connects, lists and closes: it never calls a tool, so a test can never cause
// a side effect. A single request is bounded to 15 s, the whole test to 20 s and the closing wait to
// 2 s; clicks on the same fingerprint share one real test; when the last waiter cancels, the real
// test is aborted; and error/stderr text is redacted before it is truncated, so a secret crossing the
// cut is still covered:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const MCP_TEST_REQUEST_TIMEOUT_MS = 15_000;
export const MCP_TEST_TOTAL_TIMEOUT_MS = 20_000;
export const MCP_TEST_CLOSE_WAIT_MS = 2_000;
export const MCP_TEST_MAX_TOOLS = 500;
export const MCP_TEST_MAX_ERROR_CHARS = 2_000;

export type McpTestStatus = "connected" | "auth_required" | "error" | "timed_out" | "cancelled";

export interface McpTestTool {
  readonly name: string;
}

export interface McpTestConnection {
  readonly serverInfo?: { readonly name: string; readonly version?: string };
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly stderrTail?: string;
  listTools(options: {
    readonly signal?: AbortSignal;
    readonly timeoutMs: number;
  }): Promise<readonly McpTestTool[]>;
  close(): Promise<void>;
}

export interface McpTestReport {
  readonly status: McpTestStatus;
  readonly serverInfo?: { readonly name: string; readonly version?: string };
  readonly capabilities: readonly string[];
  readonly toolCount: number;
  readonly toolSample: readonly string[];
  readonly toolsTruncated: boolean;
  readonly durationMs: number;
  readonly closeTimedOut: boolean;
  readonly error?: string;
  readonly stderrTail?: string;
}

export interface McpTestTimerHandle {
  readonly id: number;
}

export interface McpTestTimerPort {
  setTimeout(callback: () => void, ms: number): McpTestTimerHandle;
  clearTimeout(handle: McpTestTimerHandle): void;
}

export interface McpConnectionTestOptions {
  readonly fingerprint: string;
  readonly connect: (options: { readonly signal: AbortSignal }) => Promise<McpTestConnection>;
  readonly redactor?: Redactor;
  readonly timer?: McpTestTimerPort;
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly closeWaitMs?: number;
  readonly maxTools?: number;
  readonly maxErrorChars?: number;
}

type CancelReason = "timeout" | "waiters" | null;

interface TestRun {
  readonly controller: AbortController;
  done: Promise<McpTestReport>;
  readonly waiters: Set<AbortSignal | undefined>;
  cancelReason: CancelReason;
  requestTimedOut: boolean;
  finished: boolean;
}

export class McpConnectionTester {
  readonly #fingerprint: string;
  readonly #connect: McpConnectionTestOptions["connect"];
  readonly #redactor: Redactor;
  readonly #timer: McpTestTimerPort;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #totalTimeoutMs: number;
  readonly #closeWaitMs: number;
  readonly #maxTools: number;
  readonly #maxErrorChars: number;
  #active: TestRun | null = null;

  constructor(options: McpConnectionTestOptions) {
    this.#fingerprint = options.fingerprint;
    this.#connect = options.connect;
    this.#redactor = options.redactor ?? new Redactor();
    this.#timer = options.timer ?? defaultTimerPort();
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? MCP_TEST_REQUEST_TIMEOUT_MS;
    this.#totalTimeoutMs = options.totalTimeoutMs ?? MCP_TEST_TOTAL_TIMEOUT_MS;
    this.#closeWaitMs = options.closeWaitMs ?? MCP_TEST_CLOSE_WAIT_MS;
    this.#maxTools = options.maxTools ?? MCP_TEST_MAX_TOOLS;
    this.#maxErrorChars = options.maxErrorChars ?? MCP_TEST_MAX_ERROR_CHARS;
  }

  get fingerprint(): string {
    return this.#fingerprint;
  }

  get inFlight(): boolean {
    return this.#active !== null;
  }

  get waiterCount(): number {
    return this.#active?.waiters.size ?? 0;
  }

  run(options: { readonly signal?: AbortSignal } = {}): Promise<McpTestReport> {
    const entry = this.#active ?? this.#start();
    this.#addWaiter(entry, options.signal);
    return entry.done;
  }

  #start(): TestRun {
    const run: TestRun = {
      controller: new AbortController(),
      waiters: new Set(),
      cancelReason: null,
      requestTimedOut: false,
      finished: false,
      done: Promise.resolve(emptyReport()),
    };
    this.#active = run;
    run.done = this.#execute(run);
    return run;
  }

  #addWaiter(entry: TestRun, signal: AbortSignal | undefined): void {
    if (entry.finished) return;
    if (signal?.aborted === true) {
      this.#cancelIfNoWaiters(entry);
      return;
    }
    entry.waiters.add(signal);
    signal?.addEventListener(
      "abort",
      () => {
        entry.waiters.delete(signal);
        this.#cancelIfNoWaiters(entry);
      },
      { once: true }
    );
  }

  #cancelIfNoWaiters(entry: TestRun): void {
    if (entry.finished || entry.waiters.size > 0) return;
    entry.cancelReason = "waiters";
    entry.controller.abort();
  }

  async #execute(entry: TestRun): Promise<McpTestReport> {
    const startedAt = this.#now();
    let connection: McpTestConnection | null = null;
    let status: McpTestStatus = "error";
    let error: string | undefined;
    let toolCount = 0;
    let toolSample: readonly string[] = Object.freeze([]);
    let toolsTruncated = false;
    let capabilities: readonly string[] = Object.freeze([]);
    let closeTimedOut = false;
    let serverInfo: McpTestReport["serverInfo"];
    let stderrTail: string | undefined;
    const totalTimer = this.#timer.setTimeout(() => {
      entry.cancelReason ??= "timeout";
      entry.controller.abort();
    }, this.#totalTimeoutMs);
    try {
      connection = await this.#request(entry, (signal) => this.#connect({ signal }));
      serverInfo = connection.serverInfo;
      capabilities = capabilityNames(connection.capabilities);
      const tools = await this.#request(entry, (signal) =>
        connection?.listTools({ signal, timeoutMs: this.#requestTimeoutMs })
      );
      toolCount = tools.length;
      toolSample = Object.freeze(tools.slice(0, this.#maxTools).map((tool) => tool.name));
      toolsTruncated = tools.length > this.#maxTools;
      closeTimedOut = await this.#closeWithinWait(connection);
      status = this.#statusAfter(entry);
    } catch (thrown) {
      stderrTail = this.#redact(connection?.stderrTail);
      error = this.#redact(messageOf(thrown));
      status = this.#statusAfter(entry, thrown);
      if (connection !== null) {
        closeTimedOut = await this.#closeWithinWait(connection);
      }
    } finally {
      this.#timer.clearTimeout(totalTimer);
      entry.finished = true;
      if (this.#active === entry) this.#active = null;
    }
    return Object.freeze({
      status,
      ...(serverInfo !== undefined ? { serverInfo } : {}),
      capabilities,
      toolCount,
      toolSample,
      toolsTruncated,
      durationMs: Math.max(0, this.#now() - startedAt),
      closeTimedOut,
      ...(error !== undefined ? { error } : {}),
      ...(stderrTail !== undefined ? { stderrTail } : {}),
    });
  }

  async #request<T>(
    entry: TestRun,
    operation: (signal: AbortSignal) => Promise<T> | undefined
  ): Promise<T> {
    const request = new AbortController();
    const onParentAbort = (): void => request.abort();
    entry.controller.signal.addEventListener("abort", onParentAbort, { once: true });
    const timer = this.#timer.setTimeout(() => {
      entry.requestTimedOut = true;
      request.abort();
    }, this.#requestTimeoutMs);
    try {
      const result = operation(request.signal);
      if (result === undefined) throw new Error("The MCP connection is unavailable.");
      return await result;
    } finally {
      this.#timer.clearTimeout(timer);
      entry.controller.signal.removeEventListener("abort", onParentAbort);
    }
  }

  async #closeWithinWait(connection: McpTestConnection): Promise<boolean> {
    let timedOut = false;
    await new Promise<void>((resolve) => {
      const timer = this.#timer.setTimeout(() => {
        timedOut = true;
        resolve();
      }, this.#closeWaitMs);
      void Promise.resolve(connection.close()).then(
        () => {
          this.#timer.clearTimeout(timer);
          resolve();
        },
        () => {
          this.#timer.clearTimeout(timer);
          resolve();
        }
      );
    });
    return timedOut;
  }

  #statusAfter(entry: TestRun, thrown?: unknown): McpTestStatus {
    if (entry.cancelReason === "waiters") return "cancelled";
    if (entry.cancelReason === "timeout" || entry.requestTimedOut) return "timed_out";
    if (thrown === undefined) return "connected";
    return isAuthRequired(thrown) ? "auth_required" : "error";
  }

  #redact(text: string | undefined): string | undefined {
    if (text === undefined) return undefined;
    const redacted = this.#redactor.redactText(text);
    return redacted.length > this.#maxErrorChars
      ? redacted.slice(0, this.#maxErrorChars)
      : redacted;
  }
}

function capabilityNames(
  capabilities: Readonly<Record<string, unknown>> | undefined
): readonly string[] {
  if (capabilities === undefined) return Object.freeze([]);
  return Object.freeze(Object.keys(capabilities).sort());
}

function isAuthRequired(thrown: unknown): boolean {
  if (!(thrown instanceof Error)) return false;
  const status = (thrown as { status?: unknown }).status;
  return thrown.name === "McpAuthRequiredError" || status === 401 || status === 403;
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function emptyReport(): McpTestReport {
  return Object.freeze({
    status: "error",
    capabilities: Object.freeze([]),
    toolCount: 0,
    toolSample: Object.freeze([]),
    toolsTruncated: false,
    durationMs: 0,
    closeTimedOut: false,
  });
}

function defaultTimerPort(): McpTestTimerPort {
  let nextId = 1;
  const handles = new Map<number, number>();
  return {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      handles.set(
        id,
        window.setTimeout(() => {
          handles.delete(id);
          callback();
        }, ms)
      );
      return { id };
    },
    clearTimeout: (handle) => {
      const native = handles.get(handle.id);
      if (native === undefined) return;
      handles.delete(handle.id);
      window.clearTimeout(native);
    },
  };
}
