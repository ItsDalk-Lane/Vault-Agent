import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

import type {
  HostCommandApprovalToken,
  HostCommandRequest,
  HostExecutionPolicy,
} from "@/agentMode/sdk/pi/policy/HostExecutionPolicy";
import type {
  InterpreterResolver,
  ResolvedInterpreter,
} from "@/agentMode/sdk/pi/tools/InterpreterResolver";
import type {
  NativeToolApiLike,
  NativeToolRegistrationLike,
  NativeToolResult,
} from "@/agentMode/sdk/pi/tools/NativeTools";

// Native bash/powershell are only offered through the native execution environment; strict never
// spawns, trusted_host needs a fresh concrete approval for every command, the resolver's absolute
// interpreter path is injected into the actual process invocation, overlong timeouts are clamped,
// and a missing interpreter disables only commands (chat/vault/native files keep working):
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type NativeCommandId = "bash" | "powershell";

export interface NativeCommandRegistrations {
  readonly bash: NativeToolRegistrationLike;
  readonly powershell: NativeToolRegistrationLike;
}

export interface NativeCommandPathOperations {
  isAbsolute(target: string): boolean;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  readonly sep: string;
}

export interface NativeCommandsOptions {
  readonly registrations: NativeCommandRegistrations;
  readonly policy: HostExecutionPolicy;
  readonly interpreter: InterpreterResolver;
  readonly env: ExecutionEnv;
  readonly path: NativeCommandPathOperations;
  readonly defaultCwd?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly outputLimitBytes?: number;
  readonly now?: () => number;
}

export interface NativeCommandContext {
  readonly approvalToken?: HostCommandApprovalToken;
  readonly autoApproved?: boolean;
  readonly signal?: AbortSignal;
  readonly abortSignal?: AbortSignal;
}

export interface NativeCommandsCapabilityStatus {
  readonly chat: true;
  readonly vault: true;
  readonly nativeFiles: true;
  readonly commands: {
    readonly bash: ResolvedInterpreter;
    readonly powershell: ResolvedInterpreter;
  };
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;

export async function loadOfficialNativeCommandRegistrations(): Promise<NativeCommandRegistrations> {
  const tools = await import("@earendil-works/pi-durable/tools");
  return {
    bash: tools.createBashTool() as unknown as NativeToolRegistrationLike,
    powershell: tools.createPowerShellTool() as unknown as NativeToolRegistrationLike,
  };
}

export class NativeCommands {
  readonly tools: Readonly<Record<NativeCommandId, NativeToolRegistrationLike>>;
  readonly #registrations: NativeCommandRegistrations;
  readonly #policy: HostExecutionPolicy;
  readonly #interpreter: InterpreterResolver;
  readonly #env: ExecutionEnv;
  readonly #defaultCwd: string;
  readonly #defaultTimeoutMs: number;
  readonly #maxTimeoutMs: number;
  readonly #outputLimitBytes: number;

  constructor(options: NativeCommandsOptions) {
    this.#registrations = options.registrations;
    this.#policy = options.policy;
    this.#interpreter = options.interpreter;
    this.#env = options.env;
    this.#defaultCwd = options.defaultCwd ?? options.env.cwd;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxTimeoutMs = options.maxTimeoutMs ?? MAX_TIMEOUT_MS;
    this.#outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    this.tools = Object.freeze({
      bash: wrapRegistration("bash", options.registrations.bash, (args, api, context) =>
        this.execute("bash", args, api, context)
      ),
      powershell: wrapRegistration(
        "powershell",
        options.registrations.powershell,
        (args, api, context) => this.execute("powershell", args, api, context)
      ),
    });
  }

  async capabilityStatus(): Promise<NativeCommandsCapabilityStatus> {
    const status = await this.#interpreter.capabilityStatus();
    return {
      chat: status.chat,
      vault: status.vault,
      nativeFiles: status.nativeFiles,
      commands: status.commands,
    };
  }

  async execute(
    id: NativeCommandId,
    args: Record<string, unknown>,
    api: NativeToolApiLike,
    context: NativeCommandContext
  ): Promise<NativeToolResult> {
    if (id !== "bash" && id !== "powershell") {
      return errorResult("INVALID_ARGUMENT", `Unknown command tool "${String(id)}".`);
    }
    const command = args.command;
    if (typeof command !== "string" || command.length === 0) {
      return errorResult("INVALID_ARGUMENT", "A command string is required.");
    }
    const interpreter = await this.#interpreter.resolve(id);
    if (!interpreter.available) {
      return errorResult(interpreter.code, interpreter.reason);
    }
    const timeoutMs = this.#clampTimeout(args.timeout);
    const request: HostCommandRequest = {
      command,
      cwd: this.#defaultCwd,
      interpreter: interpreter.path,
      timeoutMs,
      outputLimitBytes: this.#outputLimitBytes,
    };
    const decision = await this.#policy.evaluate(request, {
      ...(context.approvalToken !== undefined ? { approvalToken: context.approvalToken } : {}),
      ...(context.autoApproved !== undefined ? { autoApproved: context.autoApproved } : {}),
    });
    if (!decision.allowed) {
      return errorResult(decision.code, decision.message);
    }
    if (context.abortSignal?.aborted === true || context.signal?.aborted === true) {
      return errorResult("CANCELLED", "The command was cancelled after approval.");
    }
    const constrainedApi = Object.create(api) as NativeToolApiLike;
    Object.defineProperty(constrainedApi, "env", {
      value: createConstrainedEnv(
        this.#env,
        interpreter.path,
        id,
        this.#defaultTimeoutMs,
        this.#maxTimeoutMs
      ),
      enumerable: true,
    });
    try {
      return await this.#registration(id).execute(args, constrainedApi, context);
    } catch (thrown) {
      return errorResult(
        "EXECUTION_FAILED",
        thrown instanceof Error ? thrown.message : String(thrown)
      );
    }
  }

  #registration(id: NativeCommandId): NativeToolRegistrationLike {
    return this.#registrations[id];
  }

  #clampTimeout(value: unknown): number {
    const requested =
      typeof value === "number" && Number.isFinite(value) ? value * 1_000 : this.#defaultTimeoutMs;
    return Math.min(Math.max(Math.trunc(requested), 1_000), this.#maxTimeoutMs);
  }
}

function wrapRegistration(
  name: NativeCommandId,
  registration: NativeToolRegistrationLike,
  execute: (
    args: Record<string, unknown>,
    api: NativeToolApiLike,
    context: NativeCommandContext
  ) => Promise<NativeToolResult>
): NativeToolRegistrationLike {
  return {
    name,
    description: registration.description,
    parameters: registration.parameters,
    execute: async (args, api, context) =>
      execute(args, api, isNativeCommandContext(context) ? context : {}),
  };
}

function isNativeCommandContext(value: unknown): value is NativeCommandContext {
  return typeof value === "object" && value !== null;
}

function createConstrainedEnv(
  base: ExecutionEnv,
  interpreterPath: string,
  id: NativeCommandId,
  defaultTimeoutMs: number,
  maxTimeoutMs: number
): ExecutionEnv {
  const env = new Proxy(base, {
    get(target, property, receiver) {
      if (property === "exec") {
        return async (
          command: string | readonly string[],
          options?: unknown,
          context?: unknown
        ) => {
          // 官方工具的 timeout 使用秒，PowerShell 已把完整脚本放在最后一个参数；保留两者可避免预览和实际执行不一致：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const script = typeof command === "string" ? command : command[command.length - 1];
          const invocation =
            id === "bash"
              ? [interpreterPath, "-lc", script]
              : [interpreterPath, "-NoProfile", "-NonInteractive", "-Command", script];
          const baseOptions = (typeof options === "object" && options !== null ? options : {}) as {
            timeout?: number;
          };
          const timeout = Math.min(
            baseOptions.timeout ?? defaultTimeoutMs / 1_000,
            maxTimeoutMs / 1_000
          );
          return target.exec(
            invocation,
            { ...baseOptions, inheritEnv: false, timeout },
            context as never
          );
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value === "function") {
        const fn = value as unknown as (...args: unknown[]) => unknown;
        const bound: (...args: unknown[]) => unknown = fn.bind(target);
        return bound;
      }
      return value;
    },
  });
  return env;
}

function errorResult(code: string, message: string): NativeToolResult {
  return {
    output: [{ type: "text", text: `${code}: ${message}` }],
    isError: true,
  };
}
