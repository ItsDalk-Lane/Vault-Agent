// Interpreters are chosen only from absolute paths that actually exist on this host, or from a
// user-configured absolute path. There is no PATH search, no download and no use of
// process.execPath as a Node shim; Windows uses its system PowerShell and does not require Git Bash.
// A missing interpreter disables only that command capability:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type HostPlatform = "darwin" | "linux" | "win32" | "other";

export type InterpreterId = "bash" | "powershell";

export interface InterpreterFileSystem {
  exists(target: string): Promise<boolean>;
}

export interface InterpreterResolverOptions {
  readonly platform: HostPlatform;
  readonly fileSystem: InterpreterFileSystem;
  readonly path: { isAbsolute(target: string): boolean };
  readonly configured?: {
    readonly bash?: string;
    readonly powershell?: string;
  };
}

export type InterpreterErrorCode = "INTERPRETER_UNAVAILABLE" | "UNSUPPORTED_INTERPRETER";

export interface ResolvedInterpreterAvailable {
  readonly available: true;
  readonly id: InterpreterId;
  readonly path: string;
  readonly source: "system" | "configured";
}

export interface ResolvedInterpreterUnavailable {
  readonly available: false;
  readonly id: string;
  readonly code: InterpreterErrorCode;
  readonly reason: string;
}

export type ResolvedInterpreter = ResolvedInterpreterAvailable | ResolvedInterpreterUnavailable;

export interface CommandCapabilityStatus {
  readonly chat: true;
  readonly vault: true;
  readonly nativeFiles: true;
  readonly commands: {
    readonly bash: ResolvedInterpreter;
    readonly powershell: ResolvedInterpreter;
  };
}

const SYSTEM_PATHS: Readonly<
  Record<InterpreterId, Partial<Record<HostPlatform, readonly string[]>>>
> = {
  bash: {
    darwin: ["/bin/bash", "/usr/bin/bash"],
    linux: ["/bin/bash", "/usr/bin/bash"],
    other: ["/bin/bash"],
  },
  powershell: {
    darwin: ["/usr/local/bin/pwsh", "/opt/microsoft/powershell/7/pwsh"],
    linux: ["/usr/bin/pwsh", "/opt/microsoft/powershell/7/pwsh"],
    win32: [
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    ],
    other: [],
  },
};

export class InterpreterResolver {
  readonly #platform: HostPlatform;
  readonly #fileSystem: InterpreterFileSystem;
  readonly #path: { isAbsolute(target: string): boolean };
  readonly #configured: { readonly bash?: string; readonly powershell?: string };

  constructor(options: InterpreterResolverOptions) {
    this.#platform = options.platform;
    this.#fileSystem = options.fileSystem;
    this.#path = options.path;
    this.#configured = options.configured ?? {};
  }

  candidatePaths(id: string): readonly string[] {
    if (id !== "bash" && id !== "powershell") return Object.freeze([]);
    const configured = this.#configured[id];
    const configuredCandidates =
      configured !== undefined && this.#path.isAbsolute(configured) ? [configured] : [];
    return Object.freeze([...configuredCandidates, ...(SYSTEM_PATHS[id][this.#platform] ?? [])]);
  }

  async resolve(id: string): Promise<ResolvedInterpreter> {
    if (id !== "bash" && id !== "powershell") {
      return unavailable(String(id), "UNSUPPORTED_INTERPRETER", `Unsupported interpreter "${id}".`);
    }
    const configured = this.#configured[id];
    if (configured !== undefined && this.#path.isAbsolute(configured)) {
      if (await this.#fileSystem.exists(configured)) {
        return { available: true, id, path: configured, source: "configured" };
      }
    }
    for (const candidate of SYSTEM_PATHS[id][this.#platform] ?? []) {
      if (await this.#fileSystem.exists(candidate)) {
        return { available: true, id, path: candidate, source: "system" };
      }
    }
    return unavailable(
      id,
      "INTERPRETER_UNAVAILABLE",
      `No ${id} interpreter exists at a known absolute path on this system; only ${id} execution is disabled.`
    );
  }

  async resolveAll(): Promise<{
    readonly bash: ResolvedInterpreter;
    readonly powershell: ResolvedInterpreter;
  }> {
    return {
      bash: await this.resolve("bash"),
      powershell: await this.resolve("powershell"),
    };
  }

  async capabilityStatus(): Promise<CommandCapabilityStatus> {
    return {
      chat: true,
      vault: true,
      nativeFiles: true,
      commands: await this.resolveAll(),
    };
  }
}

function unavailable(
  id: string,
  code: InterpreterErrorCode,
  reason: string
): ResolvedInterpreterUnavailable {
  return { available: false, id, code, reason };
}
