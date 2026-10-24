// Slash commands are dispatched explicitly: /compact reaches the real compaction API, a skill command
// loads that skill through the catalog, stop and model switch call their own ports, an unknown slash
// command returns a readable error, and no command is ever handed to a shell:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface CommandPorts {
  compact(input: {
    readonly sessionId: string;
  }): Promise<{ readonly ok: boolean; readonly error?: string }>;
  loadSkill(input: {
    readonly sessionId: string;
    readonly skillId: string;
  }): Promise<{ readonly ok: boolean; readonly error?: string }>;
  stop(input: { readonly sessionId: string }): Promise<void>;
  switchModel(input: {
    readonly sessionId: string;
    readonly modelKey: string;
  }): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

export interface CommandResult {
  readonly handled: boolean;
  readonly ok: boolean;
  readonly command?: string;
  readonly message?: string;
  readonly errorCode?: "UNKNOWN_COMMAND" | "COMMAND_FAILED" | "COMMAND_ARGUMENT_MISSING";
}

export const COMMAND_NAMES = Object.freeze(["compact", "skill", "stop", "model"] as const);

export class CommandDispatcher {
  readonly #ports: CommandPorts;
  readonly #extra: ReadonlyMap<
    string,
    (input: { sessionId: string; args: string[] }) => Promise<CommandResult>
  >;

  constructor(options: {
    readonly ports: CommandPorts;
    readonly extraCommands?: ReadonlyMap<
      string,
      (input: {
        readonly sessionId: string;
        readonly args: readonly string[];
      }) => Promise<CommandResult>
    >;
  }) {
    this.#ports = options.ports;
    this.#extra = options.extraCommands ?? new Map();
  }

  async dispatch(input: {
    readonly sessionId: string;
    readonly text: string;
  }): Promise<CommandResult> {
    const trimmed = input.text.trim();
    if (!trimmed.startsWith("/")) {
      return Object.freeze({ handled: false, ok: false });
    }
    const [rawName = "", ...args] = trimmed.slice(1).split(/\s+/);
    const name = rawName.toLowerCase();
    const extra = this.#extra.get(name);
    if (extra !== undefined) {
      return extra({ sessionId: input.sessionId, args });
    }
    switch (name) {
      case "compact": {
        const result = await this.#ports.compact({ sessionId: input.sessionId });
        return Object.freeze({
          handled: true,
          ok: result.ok,
          command: name,
          ...(result.ok ? {} : { errorCode: "COMMAND_FAILED" as const }),
          ...(result.error !== undefined ? { message: result.error } : {}),
        });
      }
      case "skill": {
        const skillId = args[0];
        if (skillId === undefined || skillId.length === 0) {
          return Object.freeze({
            handled: true,
            ok: false,
            command: name,
            errorCode: "COMMAND_ARGUMENT_MISSING" as const,
            message: "Usage: /skill <skillId>",
          });
        }
        const result = await this.#ports.loadSkill({ sessionId: input.sessionId, skillId });
        return Object.freeze({
          handled: true,
          ok: result.ok,
          command: name,
          ...(result.ok ? {} : { errorCode: "COMMAND_FAILED" as const }),
          ...(result.error !== undefined ? { message: result.error } : {}),
        });
      }
      case "stop": {
        await this.#ports.stop({ sessionId: input.sessionId });
        return Object.freeze({ handled: true, ok: true, command: name });
      }
      case "model": {
        const modelKey = args[0];
        if (modelKey === undefined || modelKey.length === 0) {
          return Object.freeze({
            handled: true,
            ok: false,
            command: name,
            errorCode: "COMMAND_ARGUMENT_MISSING" as const,
            message: "Usage: /model <modelKey>",
          });
        }
        const result = await this.#ports.switchModel({ sessionId: input.sessionId, modelKey });
        return Object.freeze({
          handled: true,
          ok: result.ok,
          command: name,
          ...(result.ok ? {} : { errorCode: "COMMAND_FAILED" as const }),
          ...(result.error !== undefined ? { message: result.error } : {}),
        });
      }
      default:
        return Object.freeze({
          handled: true,
          ok: false,
          errorCode: "UNKNOWN_COMMAND" as const,
          message: `Unknown command "/${rawName}". Known commands: ${COMMAND_NAMES.map((command) => `/${command}`).join(", ")}.`,
        });
    }
  }
}
