import {
  PlatformPathPolicy,
  PlatformPathError,
} from "@/agentMode/sdk/pi/policy/PlatformPathPolicy";

// Every target is classified before approval: Vault paths stay relative to the real Vault root,
// external paths require an explicit root, symlinks are judged by their real target, prefix
// lookalikes and `..` escapes are rejected, and host state/config/credential roots are protected:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type PathKind = "vault" | "external";

export interface PathResolution {
  readonly kind: PathKind;
  readonly requested: string;
  readonly canonical: string;
  readonly rootCanonical: string;
  readonly relative: string;
}

export type PathResolverErrorCode =
  | "INVALID_ARGUMENT"
  | "PATH_OUT_OF_SCOPE"
  | "PROTECTED_PATH"
  | "PATH_RESOLUTION_FAILED"
  | "UNSAFE_FILE_ALIAS";

export class PathResolverError extends Error {
  readonly code: PathResolverErrorCode;

  constructor(code: PathResolverErrorCode, message: string) {
    super(message);
    this.name = "PathResolverError";
    this.code = code;
  }
}

export interface PathFileSystem {
  realpath(target: string): Promise<string>;
  lstat?(target: string): Promise<{ readonly nlink: number }>;
  stat?(target: string): Promise<{ readonly dev: number | bigint; readonly ino: number | bigint }>;
}

export interface PathOperations {
  isAbsolute(target: string): boolean;
  normalize(target: string): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(target: string): string;
  basename(target: string): string;
  join(...parts: string[]): string;
  readonly sep: string;
}

export interface PathResolverOptions {
  readonly vaultRoot: string;
  /** Host-private roots (state/config/credential) that no tool may read or write.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  readonly protectedRoots?: readonly string[];
  readonly fileSystem: PathFileSystem;
  readonly path: PathOperations;
  readonly platformPolicy?: PlatformPathPolicy;
}

export class PathResolver {
  private readonly vaultRoot: string;
  private readonly protectedRoots: readonly string[];
  private readonly fileSystem: PathFileSystem;
  private readonly path: PathOperations;
  private readonly platformPolicy: PlatformPathPolicy;
  private vaultRootReal: Promise<string> | null = null;

  constructor(options: PathResolverOptions) {
    this.vaultRoot = options.vaultRoot;
    this.protectedRoots = options.protectedRoots ?? [];
    this.fileSystem = options.fileSystem;
    this.path = options.path;
    this.platformPolicy =
      options.platformPolicy ??
      new PlatformPathPolicy({
        platform: options.path.sep === "\\" ? "win32" : "posix",
        caseSensitivity: "sensitive",
        authorizedUncRoots: [options.vaultRoot],
      });
  }

  async resolveVaultPath(requested: string): Promise<PathResolution> {
    const normalized = this.validate(requested);
    if (this.path.isAbsolute(normalized)) {
      throw new PathResolverError(
        "INVALID_ARGUMENT",
        `The Vault tool expects a Vault-relative path, received "${requested}".`
      );
    }
    const root = await this.realVaultRoot();
    const canonical = await this.canonicalize(this.path.resolve(root, normalized));
    if (!(await this.isInside(root, canonical))) {
      throw new PathResolverError(
        "PATH_OUT_OF_SCOPE",
        `The path "${requested}" resolves outside the Vault.`
      );
    }
    await this.assertNotProtected(canonical);
    return this.resolution("vault", requested, canonical, root);
  }

  async resolveExternalPath(requested: string, externalRoot: string): Promise<PathResolution> {
    const policy = new PlatformPathPolicy({
      platform: this.path.sep === "\\" ? "win32" : "posix",
      caseSensitivity: "sensitive",
      authorizedUncRoots: [externalRoot],
    });
    const normalized = this.validate(requested, policy);
    const approvedRoot = this.validate(externalRoot, policy);
    if (!this.path.isAbsolute(approvedRoot))
      throw new PathResolverError("INVALID_ARGUMENT", "The external root must be absolute.");
    const root = await this.canonicalize(this.path.resolve(approvedRoot));
    const candidate = this.path.isAbsolute(normalized)
      ? this.path.resolve(normalized)
      : this.path.resolve(root, normalized);
    const canonical = await this.canonicalize(candidate);
    if (!(await this.isInside(root, canonical))) {
      throw new PathResolverError(
        "PATH_OUT_OF_SCOPE",
        `The path "${requested}" resolves outside the external root.`
      );
    }
    if (await this.isInside(await this.realVaultRoot(), canonical)) {
      throw new PathResolverError(
        "PATH_OUT_OF_SCOPE",
        `The external path "${requested}" resolves back into the Vault; use a Vault tool instead.`
      );
    }
    await this.assertNotProtected(canonical);
    return this.resolution("external", requested, canonical, root);
  }

  /** Re-resolves a decision right before execution; a changed real target fails closed.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  async revalidate(resolution: PathResolution): Promise<PathResolution> {
    const current =
      resolution.kind === "vault"
        ? await this.resolveVaultPath(resolution.requested)
        : await this.resolveExternalPath(resolution.requested, resolution.rootCanonical);
    if (current.canonical !== resolution.canonical) {
      throw new PathResolverError(
        "PATH_OUT_OF_SCOPE",
        `The target "${resolution.requested}" changed since it was approved.`
      );
    }
    return current;
  }

  /** Refuses to write through a hardlink alias; run right before the write.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  async assertWritableTarget(resolution: PathResolution): Promise<void> {
    if (this.fileSystem.lstat === undefined) {
      throw new PathResolverError(
        "PATH_RESOLUTION_FAILED",
        "The filesystem cannot report hard links."
      );
    }
    let stats: { readonly nlink: number };
    try {
      stats = await this.fileSystem.lstat(resolution.canonical);
    } catch {
      throw new PathResolverError(
        "PATH_RESOLUTION_FAILED",
        `Cannot stat "${resolution.canonical}".`
      );
    }
    if (stats.nlink > 1) {
      throw new PathResolverError(
        "UNSAFE_FILE_ALIAS",
        `The write target "${resolution.canonical}" has more than one hard link.`
      );
    }
  }

  private validate(requested: string, policy = this.platformPolicy): string {
    if (typeof requested !== "string" || requested.length === 0) {
      throw new PathResolverError("INVALID_ARGUMENT", "A path must be a non-empty string.");
    }
    if (requested.includes("\0")) {
      throw new PathResolverError("INVALID_ARGUMENT", "A path cannot contain NUL bytes.");
    }
    let candidate: string;
    try {
      candidate = policy.validate(requested);
    } catch (error) {
      if (error instanceof PlatformPathError)
        throw new PathResolverError(error.code, error.message);
      throw error;
    }
    for (const segment of candidate.split(/[\\/]+/)) {
      if (segment === "..") {
        throw new PathResolverError(
          "PATH_OUT_OF_SCOPE",
          `The path "${requested}" contains a parent escape.`
        );
      }
    }
    return this.path.normalize(candidate);
  }

  private async canonicalize(candidate: string): Promise<string> {
    let current = candidate;
    const missing: string[] = [];
    for (;;) {
      try {
        const real = await this.fileSystem.realpath(current);
        return missing.length === 0 ? real : this.path.join(real, ...missing);
      } catch {
        const parent = this.path.dirname(current);
        if (parent === current) {
          throw new PathResolverError(
            "PATH_RESOLUTION_FAILED",
            `Cannot resolve "${candidate}" through its existing parents.`
          );
        }
        missing.unshift(this.path.basename(current));
        current = parent;
      }
    }
  }

  private async assertNotProtected(canonical: string): Promise<void> {
    for (const protectedRoot of this.protectedRoots) {
      let protectedCanonical: string;
      try {
        protectedCanonical = await this.canonicalize(this.path.resolve(protectedRoot));
      } catch {
        protectedCanonical = this.path.resolve(protectedRoot);
      }
      if (await this.isInside(protectedCanonical, canonical)) {
        throw new PathResolverError(
          "PROTECTED_PATH",
          `The path "${canonical}" belongs to a protected host directory.`
        );
      }
    }
  }

  private async realVaultRoot(): Promise<string> {
    if (this.vaultRootReal === null) {
      this.vaultRootReal = this.canonicalize(this.path.resolve(this.vaultRoot));
    }
    return this.vaultRootReal;
  }

  private isInside(root: string, target: string): Promise<boolean> {
    return isPathWithin(root, target, this.path, this.fileSystem);
  }

  private async resolution(
    kind: PathKind,
    requested: string,
    canonical: string,
    rootCanonical: string
  ): Promise<PathResolution> {
    const boundary = await findPathBoundary(rootCanonical, canonical, this.path, this.fileSystem);
    if (boundary === undefined)
      throw new PathResolverError(
        "PATH_OUT_OF_SCOPE",
        "The approved root changed while resolving its relative path."
      );
    const relative = this.path.relative(boundary, canonical);
    return Object.freeze({
      kind,
      requested,
      canonical,
      rootCanonical,
      relative: kind === "vault" ? relative.split(this.path.sep).join("/") : relative,
    });
  }
}

// 系统的字符串 relative 可能擅自忽略大小写；只有真实文件身份才能确认不同拼写属于同一根。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function isPathWithin(
  root: string,
  target: string,
  path: Pick<PathOperations, "sep" | "dirname">,
  fileSystem: Pick<PathFileSystem, "stat">
): Promise<boolean> {
  return (await findPathBoundary(root, target, path, fileSystem)) !== undefined;
}

async function findPathBoundary(
  root: string,
  target: string,
  path: Pick<PathOperations, "sep" | "dirname">,
  fileSystem: Pick<PathFileSystem, "stat">
): Promise<string | undefined> {
  const platform = path.sep === "\\" ? "win32" : "posix";
  if (new PlatformPathPolicy({ platform, caseSensitivity: "sensitive" }).isWithin(root, target))
    return root;
  const possibleAlias = new PlatformPathPolicy({
    platform,
    caseSensitivity: "insensitive",
  }).isWithin(root.normalize("NFC"), target.normalize("NFC"));
  const rootInfo = await fileSystem.stat?.(root).catch(() => undefined);
  if (
    !rootInfo ||
    rootInfo.ino <= 0 ||
    (typeof rootInfo.ino === "number" && !Number.isSafeInteger(rootInfo.ino))
  ) {
    if (possibleAlias)
      throw new PathResolverError(
        "PATH_RESOLUTION_FAILED",
        "The filesystem cannot confirm this path alias."
      );
    return undefined;
  }
  let current = target;
  let boundaryKnown = false;
  const depth = (value: string) => value.split(path.sep).filter(Boolean).length;
  const rootDepth = depth(root);
  for (;;) {
    const info = await fileSystem.stat?.(current).catch(() => undefined);
    if (info && info.ino > 0 && (typeof info.ino === "bigint" || Number.isSafeInteger(info.ino))) {
      if (info.dev === rootInfo.dev && info.ino === rootInfo.ino) return current;
      if (depth(current) === rootDepth) boundaryKnown = true;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (possibleAlias && !boundaryKnown)
    throw new PathResolverError(
      "PATH_RESOLUTION_FAILED",
      "The filesystem cannot confirm this path alias."
    );
  return undefined;
}
