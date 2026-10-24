// Windows aliases are a security boundary: device namespaces, ADS colon streams, unauthorized UNC
// roots, reserved device names and trailing dot/space aliases are rejected; case folding follows
// the real volume instead of being applied to every platform; a hardlinked write target is refused:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type HostPlatform = "win32" | "posix";

export type PathCaseSensitivity = "sensitive" | "insensitive";

export type PlatformPathErrorCode = "INVALID_ARGUMENT" | "UNSAFE_FILE_ALIAS";

export class PlatformPathError extends Error {
  readonly code: PlatformPathErrorCode;

  constructor(code: PlatformPathErrorCode, message: string) {
    super(message);
    this.name = "PlatformPathError";
    this.code = code;
  }
}

export interface PlatformPathPolicyOptions {
  readonly platform: HostPlatform;
  /** The real volume behavior, not a platform default.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  readonly caseSensitivity?: PathCaseSensitivity;
  /** UNC roots the user explicitly authorized.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  readonly authorizedUncRoots?: readonly string[];
  /** "open" accepts any UNC path when the single-layer approval model has no pre-authorized
   * roots; device namespaces and ADS streams stay rejected either way.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
   */
  readonly uncAccess?: "authorized-roots" | "open";
}

const WINDOWS_DEVICE_NAMESPACE = /^\\\\[.?]\\/;
const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_ANY = /^[A-Za-z]:/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CONIN$",
  "CONOUT$",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

export class PlatformPathPolicy {
  private readonly platform: HostPlatform;
  private readonly caseSensitivity: PathCaseSensitivity;
  private readonly authorizedUncRoots: readonly string[];
  private readonly uncAccess: "authorized-roots" | "open";

  constructor(options: PlatformPathPolicyOptions) {
    this.platform = options.platform;
    this.caseSensitivity =
      options.caseSensitivity ?? (options.platform === "win32" ? "insensitive" : "sensitive");
    this.authorizedUncRoots = (options.authorizedUncRoots ?? []).map((root) =>
      normalizeSeparators(root, options.platform)
    );
    this.uncAccess = options.uncAccess ?? "authorized-roots";
  }

  validate(raw: string): string {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new PlatformPathError("INVALID_ARGUMENT", "A path must be a non-empty string.");
    }
    if (raw.includes("\0")) {
      throw new PlatformPathError("INVALID_ARGUMENT", "A path cannot contain NUL bytes.");
    }
    if (this.platform === "posix") return this.validatePosix(raw);
    return this.validateWindows(raw);
  }

  isWithin(root: string, target: string): boolean {
    const rootSegments = this.comparisonSegments(root);
    const targetSegments = this.comparisonSegments(target);
    // 文件系统根的分段为空仍覆盖绝对后代，不能因此漏掉与受保护目录的重叠。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (rootSegments.length === 0)
      return this.platform === "posix" && /^\/+$/u.test(root) && target.startsWith("/");
    if (rootSegments.length > targetSegments.length) return false;
    return rootSegments.every((segment, index) => segment === targetSegments[index]);
  }

  isSamePath(left: string, right: string): boolean {
    return this.comparisonSegments(left).join("\0") === this.comparisonSegments(right).join("\0");
  }

  assertWritableTarget(stats: { readonly nlink: number }): void {
    if (stats.nlink > 1) {
      throw new PlatformPathError(
        "UNSAFE_FILE_ALIAS",
        "A write target with more than one hard link is refused."
      );
    }
  }

  private validatePosix(raw: string): string {
    if (raw.includes("\\")) {
      throw new PlatformPathError(
        "INVALID_ARGUMENT",
        `The path "${raw}" uses a backslash alias instead of path separators.`
      );
    }
    if (URL_SCHEME.test(raw))
      throw new PlatformPathError("INVALID_ARGUMENT", "A filesystem path cannot be a URL.");
    return raw;
  }

  private validateWindows(raw: string): string {
    const normalized = normalizeSeparators(raw, "win32");
    if (WINDOWS_DEVICE_NAMESPACE.test(normalized)) {
      throw new PlatformPathError(
        "INVALID_ARGUMENT",
        `The path "${raw}" uses a Windows device namespace.`
      );
    }
    if (normalized.startsWith("\\\\")) {
      this.assertAuthorizedUnc(normalized, raw);
    } else if (
      (WINDOWS_DRIVE_ANY.test(normalized) && !WINDOWS_DRIVE_ABSOLUTE.test(normalized)) ||
      normalized.startsWith("\\")
    ) {
      throw new PlatformPathError(
        "INVALID_ARGUMENT",
        WINDOWS_DRIVE_ANY.test(normalized)
          ? `The path "${raw}" is drive-relative, not absolute.`
          : `The path "${raw}" is not an absolute Windows path.`
      );
    }
    const remainder = WINDOWS_DRIVE_ABSOLUTE.test(normalized) ? normalized.slice(2) : normalized;
    if (remainder.includes(":")) {
      throw new PlatformPathError(
        "INVALID_ARGUMENT",
        `The path "${raw}" uses an alternate data stream.`
      );
    }
    for (const segment of normalized.split(/[\\/]+/)) {
      if (segment.length === 0) continue;
      if (segment === "." || segment === "..") continue;
      if (segment.endsWith(".") || segment.endsWith(" ")) {
        throw new PlatformPathError(
          "INVALID_ARGUMENT",
          `The path "${raw}" ends a segment with a dot or space alias.`
        );
      }
      const base = segment.split(".")[0].toUpperCase();
      if (WINDOWS_RESERVED_NAMES.has(base)) {
        throw new PlatformPathError(
          "INVALID_ARGUMENT",
          `The path "${raw}" uses the reserved device name "${base}".`
        );
      }
    }
    return normalized;
  }

  private assertAuthorizedUnc(normalized: string, raw: string): void {
    if (this.uncAccess === "open") return;
    const authorized = this.authorizedUncRoots.some((root) => this.isWithin(root, normalized));
    if (!authorized) {
      throw new PlatformPathError(
        "INVALID_ARGUMENT",
        `The UNC path "${raw}" has no explicitly authorized root.`
      );
    }
  }

  private comparisonSegments(target: string): string[] {
    const segments = normalizeSeparators(target, this.platform)
      .split(/[\\/]+/)
      .filter((segment) => segment.length > 0 && segment !== ".");
    return this.caseSensitivity === "insensitive"
      ? segments.map((segment) => segment.toLowerCase())
      : segments;
  }
}

function normalizeSeparators(target: string, platform: HostPlatform): string {
  return platform === "win32" ? target.replace(/\//g, "\\") : target;
}
