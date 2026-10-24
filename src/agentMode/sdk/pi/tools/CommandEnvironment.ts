import type { HostPlatform } from "@/agentMode/sdk/pi/tools/InterpreterResolver";

// Child commands run with inheritEnv:false: only host-minimal keys and values the user explicitly
// chose for this command, with secret-like keys/values and secretRef-style values removed rather
// than expanded. Known secret values are redacted from output before any truncation:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const SECRET_KEY_PATTERN =
  /(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|credential|authorization|private[_-]?key)/i;

const SECRET_VALUE_PATTERN = /^secret(ref)?:/i;

const MINIMAL_KEYS: Readonly<Record<HostPlatform, readonly string[]>> = {
  darwin: ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM"],
  linux: ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "LANG", "LC_ALL", "TERM"],
  win32: [
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "SystemDrive",
    "ComSpec",
    "WINDIR",
    "USERPROFILE",
    "USERNAME",
    "TEMP",
    "TMP",
    "OS",
  ],
  other: ["PATH", "HOME", "TMPDIR", "LANG"],
};

const MIN_SECRET_LENGTH = 4;

export interface CommandEnvironmentOptions {
  readonly platform: HostPlatform;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly knownSecrets?: readonly string[];
  readonly minimalKeys?: readonly string[];
}

export interface CommandEnvironmentBuildInput {
  readonly userEnv?: Readonly<Record<string, string>>;
}

export interface MinimalCommandEnvironment {
  readonly env: Record<string, string>;
  readonly inheritEnv: false;
  readonly filteredParentKeys: readonly string[];
  readonly filteredUserKeys: readonly string[];
}

export class CommandEnvironment {
  readonly #parentEnv: Readonly<Record<string, string | undefined>>;
  readonly #minimalKeys: readonly string[];
  readonly #secrets: string[];

  constructor(options: CommandEnvironmentOptions) {
    this.#parentEnv = options.parentEnv;
    this.#minimalKeys = options.minimalKeys ?? MINIMAL_KEYS[options.platform];
    this.#secrets = collectSecrets(options.parentEnv, options.knownSecrets ?? []);
  }

  build(input: CommandEnvironmentBuildInput = {}): MinimalCommandEnvironment {
    const env: Record<string, string> = {};
    for (const key of this.#minimalKeys) {
      const value = this.#parentEnv[key];
      if (typeof value === "string" && value.length > 0) env[key] = value;
    }
    const filteredParentKeys = Object.keys(this.#parentEnv).filter(
      (key) => SECRET_KEY_PATTERN.test(key) && !(key in env)
    );
    const filteredUserKeys: string[] = [];
    for (const [key, value] of Object.entries(input.userEnv ?? {})) {
      if (SECRET_KEY_PATTERN.test(key) || SECRET_VALUE_PATTERN.test(value)) {
        filteredUserKeys.push(key);
        continue;
      }
      env[key] = value;
    }
    return {
      env,
      inheritEnv: false,
      filteredParentKeys,
      filteredUserKeys,
    };
  }

  redact(text: string): string {
    let redacted = text;
    for (const secret of this.#secrets) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
    return redacted.replace(/secret(?:ref)?:[^\s"']+/gi, "[REDACTED]");
  }

  knownSecrets(): readonly string[] {
    return Object.freeze([...this.#secrets]);
  }
}

function collectSecrets(
  parentEnv: Readonly<Record<string, string | undefined>>,
  knownSecrets: readonly string[]
): string[] {
  const secrets = new Set<string>(
    knownSecrets.filter((value) => value.length >= MIN_SECRET_LENGTH)
  );
  for (const [key, value] of Object.entries(parentEnv)) {
    if (
      typeof value === "string" &&
      value.length >= MIN_SECRET_LENGTH &&
      SECRET_KEY_PATTERN.test(key)
    ) {
      secrets.add(value);
    }
  }
  return [...secrets].sort((left, right) => right.length - left.length);
}
