import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";

// MCP progress arrives with a server progressToken, so the token is bound to the host toolCallId
// before any update is routed: two concurrent calls never cross cards, a token the host never bound
// is dropped, and a percentage is only reported when the server sent a usable total (an incomplete
// server report is not turned into a fake 100%). A finished call keeps bounded terminal facts for
// history and refuses late events, and repeated finishes are counted once:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface McpProgressNotification {
  readonly progressToken?: string | number;
  readonly progress: number;
  readonly total?: number;
  readonly message?: string;
}

export interface McpProgressBindingInput {
  readonly hostToolCallId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly progressToken: string | number;
}

export interface McpProgressUpdate {
  readonly toolCallId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly progress: number;
  readonly total?: number;
  readonly percent: number | null;
  readonly indeterminate: boolean;
  readonly sequence: number;
  readonly message?: string;
}

export type McpTerminalStatus = "completed" | "failed" | "cancelled" | "timed_out";

export interface McpTerminalInfo {
  readonly toolCallId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly status: McpTerminalStatus;
  readonly updates: number;
  readonly lastPercent: number | null;
  readonly truncatedOutput: boolean;
  readonly outputBytes: number;
  readonly durationMs: number;
  readonly note?: string;
}

export interface McpOutputWindowOptions {
  readonly maxBytes: number;
  readonly redactor: Redactor;
  readonly secretValues?: readonly string[];
}

export class McpOutputWindow {
  readonly #maxBytes: number;
  readonly #redactor: Redactor;
  readonly #secretWindow: number;
  #raw = "";
  #buffer = "";
  #bytes = 0;
  #truncated = false;

  constructor(options: McpOutputWindowOptions) {
    this.#maxBytes = options.maxBytes;
    this.#redactor = options.redactor;
    const longest = (options.secretValues ?? []).reduce(
      (max, secret) => Math.max(max, secret.length),
      0
    );
    this.#secretWindow = Math.max(0, longest);
  }

  append(chunk: string): void {
    if (chunk.length === 0) return;
    this.#raw += chunk;
    this.#trimRaw();
    this.#rebuild();
  }

  replace(text: string): void {
    this.#raw = text;
    this.#buffer = "";
    this.#bytes = 0;
    this.#truncated = false;
    this.#trimRaw();
    this.#rebuild();
  }

  flush(): string {
    this.#rebuild();
    return this.#buffer;
  }

  get text(): string {
    return this.#buffer;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  #trimRaw(): void {
    const cap = this.#maxBytes * 2 + this.#secretWindow + 64;
    if (this.#raw.length > cap) this.#raw = this.#raw.slice(-cap);
  }

  #rebuild(): void {
    this.#buffer = this.#redactor.redactText(this.#raw);
    this.#bytes = utf8Bytes(this.#buffer);
    while (this.#bytes > this.#maxBytes && this.#buffer.length > 0) {
      const overflow = this.#bytes - this.#maxBytes;
      const drop = Math.max(1, Math.ceil(overflow / 4));
      const removed = this.#buffer.slice(0, drop);
      this.#buffer = this.#buffer.slice(drop);
      this.#bytes -= utf8Bytes(removed);
      this.#truncated = true;
    }
  }
}

export interface McpProgressTrackerOptions {
  readonly now?: () => number;
  readonly maxOutputBytes?: number;
  readonly redactor?: Redactor;
  readonly secretValues?: readonly string[];
}

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

interface Binding {
  readonly hostToolCallId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly startedAtMs: number;
  updates: number;
  lastPercent: number | null;
  sequence: number;
  finished: McpTerminalInfo | null;
}

export class McpProgressTracker {
  readonly #now: () => number;
  readonly #maxOutputBytes: number;
  readonly #redactor: Redactor;
  readonly #secretValues: readonly string[];
  readonly #byToken = new Map<string, string>();
  readonly #byCall = new Map<string, Binding>();
  readonly #windows = new Map<string, McpOutputWindow>();

  constructor(options: McpProgressTrackerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.#redactor = options.redactor ?? new Redactor({ secretValues: options.secretValues ?? [] });
    this.#secretValues = options.secretValues ?? [];
  }

  bind(input: McpProgressBindingInput): void {
    this.#byToken.set(tokenKey(input.serverId, input.progressToken), input.hostToolCallId);
    const existing = this.#byCall.get(input.hostToolCallId);
    if (existing !== undefined && existing.finished === null) return;
    this.#byCall.set(input.hostToolCallId, {
      hostToolCallId: input.hostToolCallId,
      serverId: input.serverId,
      toolName: input.toolName,
      startedAtMs: this.#now(),
      updates: 0,
      lastPercent: null,
      sequence: 0,
      finished: null,
    });
    this.#windows.set(
      input.hostToolCallId,
      new McpOutputWindow({
        maxBytes: this.#maxOutputBytes,
        redactor: this.#redactor,
        secretValues: this.#secretValues,
      })
    );
  }

  unbind(hostToolCallId: string): void {
    for (const [key, callId] of this.#byToken) {
      if (callId === hostToolCallId) this.#byToken.delete(key);
    }
  }

  update(input: {
    readonly serverId: string;
    readonly toolName: string;
    readonly notification: McpProgressNotification;
  }): McpProgressUpdate | null {
    const token = input.notification.progressToken;
    if (token === undefined) return null;
    const callId = this.#byToken.get(tokenKey(input.serverId, token));
    if (callId === undefined) return null;
    const binding = this.#byCall.get(callId);
    if (binding === undefined || binding.finished !== null) return null;
    const percent = percentOf(input.notification);
    binding.updates += 1;
    binding.sequence += 1;
    binding.lastPercent = percent;
    return Object.freeze({
      toolCallId: binding.hostToolCallId,
      serverId: binding.serverId,
      toolName: binding.toolName,
      progress: input.notification.progress,
      ...(input.notification.total !== undefined ? { total: input.notification.total } : {}),
      percent,
      indeterminate: percent === null,
      sequence: binding.sequence,
      ...(input.notification.message !== undefined ? { message: input.notification.message } : {}),
    });
  }

  output(hostToolCallId: string): McpOutputWindow | undefined {
    return this.#windows.get(hostToolCallId);
  }

  terminalInfoFor(hostToolCallId: string): McpTerminalInfo | undefined {
    return this.#byCall.get(hostToolCallId)?.finished ?? undefined;
  }

  finish(
    hostToolCallId: string,
    status: McpTerminalStatus,
    options: { readonly note?: string } = {}
  ): McpTerminalInfo {
    const binding = this.#byCall.get(hostToolCallId);
    if (binding === undefined) {
      return Object.freeze({
        toolCallId: hostToolCallId,
        serverId: "unknown",
        toolName: "unknown",
        status,
        updates: 0,
        lastPercent: null,
        truncatedOutput: false,
        outputBytes: 0,
        durationMs: 0,
      });
    }
    if (binding.finished !== null) return binding.finished;
    const window = this.#windows.get(hostToolCallId);
    window?.flush();
    const note =
      options.note ??
      (status === "timed_out" || status === "cancelled"
        ? "The MCP call ended without a result; its side effects are unknown."
        : undefined);
    const info: McpTerminalInfo = Object.freeze({
      toolCallId: binding.hostToolCallId,
      serverId: binding.serverId,
      toolName: binding.toolName,
      status,
      updates: binding.updates,
      lastPercent: binding.lastPercent,
      truncatedOutput: window?.truncated ?? false,
      outputBytes: window?.bytes ?? 0,
      durationMs: Math.max(0, this.#now() - binding.startedAtMs),
      ...(note !== undefined ? { note } : {}),
    });
    binding.finished = info;
    this.unbind(hostToolCallId);
    return info;
  }

  get activeCount(): number {
    let active = 0;
    for (const binding of this.#byCall.values()) {
      if (binding.finished === null) active += 1;
    }
    return active;
  }
}

function percentOf(notification: McpProgressNotification): number | null {
  const total = notification.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(notification.progress)) return null;
  return Math.max(0, Math.min(100, Math.round((notification.progress / total) * 100)));
}

function tokenKey(serverId: string, token: string | number): string {
  return `${serverId}\u0000${String(token)}`;
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
