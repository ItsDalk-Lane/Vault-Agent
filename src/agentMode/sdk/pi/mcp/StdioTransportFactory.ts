import type { McpTransport } from "@earendil-works/pi-mcp";
import type { HostExecutionMode } from "@/agentMode/sdk/pi/policy/HostExecutionPolicy";
import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import type { McpStdioTransport } from "@/agentMode/sdk/pi/mcp/McpConfig";

// A stdio MCP server is an opaque local process: strict mode never starts it, trusted_host additionally
// requires the config-level risk authorization, the command and cwd must be absolute and exist (no PATH
// fallback), the child inherits no environment and only receives the secrets this server was granted,
// and a missing interpreter disables just this server instead of downloading anything. Closing asks the
// injected terminator to clean the real process and reports whether that cleanup was proven:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type StdioFactoryErrorCode =
  | "MCP_STDIO_STRICT_DENIED"
  | "MCP_STDIO_NOT_TRUSTED"
  | "MCP_STDIO_INTERPRETER_UNAVAILABLE"
  | "MCP_STDIO_COMMAND_MISSING"
  | "MCP_STDIO_CWD_MISSING"
  | "MCP_STDIO_SECRET_MISSING"
  | "MCP_STDIO_INVALID_CONFIG";

export class StdioFactoryError extends Error {
  readonly code: StdioFactoryErrorCode;

  constructor(code: StdioFactoryErrorCode, message: string) {
    super(message);
    this.name = "StdioFactoryError";
    this.code = code;
  }
}

export interface StdioLaunchPlan {
  readonly serverId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly inheritEnv: false;
  readonly secretEnvKeys: readonly string[];
  readonly timeoutMs: number;
}

export interface StdioProcessTerminator {
  terminate(
    plan: StdioLaunchPlan,
    reason: "closed" | "cancelled"
  ): Promise<"confirmed" | "incomplete">;
}

export interface StdioCloseResult {
  readonly status: "closed";
  readonly cleanup: "clean" | "cleanup_incomplete";
}

export interface StdioTransportHandle {
  readonly plan: StdioLaunchPlan;
  readonly transport: McpTransport;
  close(): Promise<StdioCloseResult>;
}

export interface StdioTransportRequest {
  readonly serverId: string;
  readonly config: McpStdioTransport;
  readonly mode: HostExecutionMode;
  readonly riskAuthorized: boolean;
  readonly interpreterAvailable?: boolean;
  readonly signal?: AbortSignal;
}

export interface StdioTransportFactoryOptions {
  readonly environment: CommandEnvironment;
  readonly exists: (path: string) => Promise<boolean>;
  readonly createTransport: (plan: StdioLaunchPlan) => McpTransport;
  readonly terminate: StdioProcessTerminator;
  readonly resolveSecret: (ref: string) => Promise<string | undefined>;
  readonly defaultMode?: HostExecutionMode;
  readonly defaultRiskAuthorized?: boolean;
  readonly defaultInterpreterAvailable?: boolean;
  readonly timeoutMs?: number;
}

const DOWNLOAD_LAUNCHERS = new Set(["npx", "uvx", "uv", "pnpm", "yarn", "npm", "bunx"]);
const INTERPRETERS = new Set([
  "node",
  "nodejs",
  "python",
  "python3",
  "deno",
  "bun",
  "ruby",
  "perl",
  "php",
  "java",
]);

export class StdioTransportFactory {
  readonly #environment: CommandEnvironment;
  readonly #exists: (path: string) => Promise<boolean>;
  readonly #createTransport: (plan: StdioLaunchPlan) => McpTransport;
  readonly #terminate: StdioProcessTerminator;
  readonly #resolveSecret: (ref: string) => Promise<string | undefined>;
  readonly #defaultMode: HostExecutionMode;
  readonly #defaultRiskAuthorized: boolean;
  readonly #defaultInterpreterAvailable: boolean;
  readonly #timeoutMs: number;

  constructor(options: StdioTransportFactoryOptions) {
    this.#environment = options.environment;
    this.#exists = options.exists;
    this.#createTransport = options.createTransport;
    this.#terminate = options.terminate;
    this.#resolveSecret = options.resolveSecret;
    this.#defaultMode = options.defaultMode ?? "strict";
    this.#defaultRiskAuthorized = options.defaultRiskAuthorized ?? false;
    this.#defaultInterpreterAvailable = options.defaultInterpreterAvailable ?? true;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async create(request: StdioTransportRequest): Promise<StdioTransportHandle> {
    const mode = request.mode ?? this.#defaultMode;
    if (mode !== "trusted_host") {
      throw new StdioFactoryError(
        "MCP_STDIO_STRICT_DENIED",
        "strict mode keeps opaque local MCP servers stopped."
      );
    }
    const riskAuthorized = request.riskAuthorized ?? this.#defaultRiskAuthorized;
    if (!riskAuthorized) {
      throw new StdioFactoryError(
        "MCP_STDIO_NOT_TRUSTED",
        "This stdio server needs its own configuration risk authorization."
      );
    }
    const config = request.config;
    const command = config.commandPath;
    if (!isAbsolutePath(command) || !isAbsolutePath(config.cwd)) {
      throw new StdioFactoryError(
        "MCP_STDIO_INVALID_CONFIG",
        "The stdio command and cwd must be absolute paths."
      );
    }
    const base = basename(command).toLowerCase();
    if (DOWNLOAD_LAUNCHERS.has(base)) {
      throw new StdioFactoryError(
        "MCP_STDIO_INVALID_CONFIG",
        `The stdio command must not be the auto-downloading launcher "${base}".`
      );
    }
    const interpreterAvailable = request.interpreterAvailable ?? this.#defaultInterpreterAvailable;
    if (INTERPRETERS.has(base) && !interpreterAvailable) {
      throw new StdioFactoryError(
        "MCP_STDIO_INTERPRETER_UNAVAILABLE",
        `No interpreter is available for "${base}"; only this server is disabled.`
      );
    }
    if (!(await this.#exists(command))) {
      throw new StdioFactoryError(
        "MCP_STDIO_COMMAND_MISSING",
        `The absolute command "${command}" does not exist; PATH lookup is not used.`
      );
    }
    if (!(await this.#exists(config.cwd))) {
      throw new StdioFactoryError(
        "MCP_STDIO_CWD_MISSING",
        `The absolute cwd "${config.cwd}" does not exist.`
      );
    }
    if (request.signal?.aborted === true) {
      throw new StdioFactoryError("MCP_STDIO_INVALID_CONFIG", "The stdio launch was cancelled.");
    }
    const built = this.#environment.build({ userEnv: config.env });
    const env: Record<string, string> = { ...built.env };
    const secretEnvKeys: string[] = [];
    for (const [key, ref] of Object.entries(config.envSecretRefs)) {
      const value = await this.#resolveSecret(ref);
      if (typeof value !== "string" || value.length === 0) {
        throw new StdioFactoryError(
          "MCP_STDIO_SECRET_MISSING",
          `No credential is stored for the stdio env "${key}".`
        );
      }
      env[key] = value;
      secretEnvKeys.push(key);
    }
    const plan: StdioLaunchPlan = Object.freeze({
      serverId: request.serverId,
      command,
      args: Object.freeze([...config.args]),
      cwd: config.cwd,
      env: Object.freeze(env),
      inheritEnv: false as const,
      secretEnvKeys: Object.freeze(secretEnvKeys),
      timeoutMs: this.#timeoutMs,
    });
    const transport = this.#createTransport(plan);
    return Object.freeze({
      plan,
      transport,
      close: async (): Promise<StdioCloseResult> => {
        await transport.close();
        const cleanup = await this.#terminate.terminate(plan, "closed");
        return {
          status: "closed" as const,
          cleanup: cleanup === "confirmed" ? ("clean" as const) : ("cleanup_incomplete" as const),
        };
      },
    });
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function basename(value: string): string {
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] ?? value;
}
