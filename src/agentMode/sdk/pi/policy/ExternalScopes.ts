import { sha256 } from "@/utils/hash";
import { isPathWithin, type PathFileSystem } from "@/agentMode/sdk/pi/policy/PathResolver";
import { PlatformPathPolicy } from "@/agentMode/sdk/pi/policy/PlatformPathPolicy";

// External roots are user-owned grants, never model-created: they record the canonical root, the
// read/write permission set, a version and an expiry, must not overlap the vault/config/state/
// credential protection set, merge duplicate roots without expanding permissions, and a revoke (or
// any version bump) invalidates every earlier approval immediately:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type ExternalScopePermission = "read" | "write";

export type ExternalScopeCreator = "user" | "model" | "skill" | "mcp" | "system";

export type ExternalScopeStatus = "active" | "revoked" | "expired";

export interface ExternalScope {
  readonly id: string;
  readonly root: string;
  readonly canonicalRoot: string;
  readonly permissions: readonly ExternalScopePermission[];
  readonly version: number;
  readonly status: ExternalScopeStatus;
  readonly createdBy: "user";
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly expiresAtMs?: number;
}

export interface ExternalScopeFileSystem extends Pick<PathFileSystem, "stat"> {
  realpath(target: string): Promise<string>;
}

export interface ExternalScopePathOperations {
  isAbsolute(target: string): boolean;
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  basename(target: string): string;
  dirname(target: string): string;
  relative(from: string, to: string): string;
  readonly sep: string;
}

export interface ExternalScopesOptions {
  readonly fileSystem: ExternalScopeFileSystem;
  readonly path: ExternalScopePathOperations;
  readonly protectedRoots: readonly string[];
  readonly now?: () => number;
  readonly maxScopes?: number;
}

export interface CreateExternalScopeInput {
  readonly root: string;
  readonly permissions: readonly ExternalScopePermission[];
  readonly createdBy: ExternalScopeCreator;
  readonly expiresAtMs?: number;
}

export type ExternalScopeErrorCode =
  | "MODEL_CANNOT_CREATE_SCOPE"
  | "INVALID_ARGUMENT"
  | "ROOT_OVERLAPS_PROTECTED"
  | "TOO_MANY_SCOPES";

export class ExternalScopeError extends Error {
  readonly code: ExternalScopeErrorCode;

  constructor(code: ExternalScopeErrorCode, message: string) {
    super(message);
    this.name = "ExternalScopeError";
    this.code = code;
  }
}

export type ExternalScopeAccessCode =
  | "EXTERNAL_SCOPE_REQUIRED"
  | "EXTERNAL_SCOPE_REVOKED"
  | "EXTERNAL_SCOPE_EXPIRED"
  | "SCOPE_PERMISSION_DENIED"
  | "SCOPE_NOT_FOUND"
  | "ROOT_OVERLAPS_PROTECTED"
  | "INVALID_ARGUMENT";

export type ExternalScopeAccess =
  | { readonly allowed: true; readonly scope: ExternalScope; readonly version: number }
  | { readonly allowed: false; readonly code: ExternalScopeAccessCode; readonly message: string };

export interface ExternalScopeAccessOptions {
  readonly approvedVersion?: number;
  readonly now?: number;
}

const MAX_SCOPES = 32;

export class ExternalScopes {
  private readonly fileSystem: ExternalScopeFileSystem;
  private readonly path: ExternalScopePathOperations;
  private readonly protectedRoots: readonly string[];
  private readonly now: () => number;
  private readonly maxScopes: number;
  private readonly scopes = new Map<string, ExternalScope>();

  constructor(options: ExternalScopesOptions) {
    this.fileSystem = options.fileSystem;
    this.path = options.path;
    this.protectedRoots = options.protectedRoots;
    this.now = options.now ?? Date.now;
    this.maxScopes = options.maxScopes ?? MAX_SCOPES;
  }

  async createScope(input: CreateExternalScopeInput): Promise<ExternalScope> {
    if (input.createdBy !== "user") {
      throw new ExternalScopeError(
        "MODEL_CANNOT_CREATE_SCOPE",
        "Only a real user action can authorize an external root."
      );
    }
    if (typeof input.root !== "string" || input.root.length === 0) {
      throw new ExternalScopeError("INVALID_ARGUMENT", "An external root is required.");
    }
    if (!this.path.isAbsolute(input.root)) {
      throw new ExternalScopeError("INVALID_ARGUMENT", "The external root must be absolute.");
    }
    try {
      this.validate(input.root, [input.root]);
    } catch {
      throw new ExternalScopeError(
        "INVALID_ARGUMENT",
        "The external root uses an unsafe path alias."
      );
    }
    const permissions = normalizePermissions(input.permissions);
    if (permissions === null) {
      throw new ExternalScopeError(
        "INVALID_ARGUMENT",
        "Permissions must be a non-empty subset of read/write."
      );
    }
    const canonicalRoot = await this.canonicalize(input.root);
    for (const protectedRoot of this.protectedRoots) {
      const canonicalProtected = await this.canonicalize(protectedRoot);
      if (await this.overlaps(canonicalProtected, canonicalRoot)) {
        throw new ExternalScopeError(
          "ROOT_OVERLAPS_PROTECTED",
          "The external root overlaps a protected Vault/config/state root."
        );
      }
    }
    let existing: ExternalScope | undefined;
    for (const scope of this.scopes.values())
      if (
        (await this.isInside(scope.canonicalRoot, canonicalRoot)) &&
        (await this.isInside(canonicalRoot, scope.canonicalRoot))
      ) {
        existing = scope;
        break;
      }
    const timestamp = this.now();
    if (existing !== undefined) {
      const merged: ExternalScope = Object.freeze({
        ...existing,
        permissions: Object.freeze(
          normalizePermissions([...existing.permissions, ...permissions]) ?? permissions
        ),
        version: existing.version + 1,
        status: "active",
        updatedAtMs: timestamp,
        ...(input.expiresAtMs !== undefined ? { expiresAtMs: input.expiresAtMs } : {}),
      });
      this.scopes.set(merged.id, merged);
      return this.snapshot(merged);
    }
    if (this.scopes.size >= this.maxScopes) {
      throw new ExternalScopeError("TOO_MANY_SCOPES", "The external root limit was reached.");
    }
    const scope: ExternalScope = Object.freeze({
      id: `ext-${sha256(canonicalRoot).slice(0, 16)}`,
      root: input.root,
      canonicalRoot,
      permissions: Object.freeze(permissions),
      version: 1,
      status: "active",
      createdBy: "user",
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
      ...(input.expiresAtMs !== undefined ? { expiresAtMs: input.expiresAtMs } : {}),
    });
    this.scopes.set(scope.id, scope);
    return this.snapshot(scope);
  }

  async revokeScope(scopeId: string): Promise<boolean> {
    const scope = this.scopes.get(scopeId);
    if (scope === undefined || scope.status === "revoked") return false;
    this.scopes.set(
      scopeId,
      Object.freeze({
        ...scope,
        status: "revoked",
        version: scope.version + 1,
        updatedAtMs: this.now(),
      })
    );
    return true;
  }

  listScopes(): readonly ExternalScope[] {
    return Object.freeze([...this.scopes.values()].map((scope) => this.snapshot(scope)));
  }

  async checkAccess(
    scopeId: string,
    permission: ExternalScopePermission,
    options: ExternalScopeAccessOptions = {}
  ): Promise<ExternalScopeAccess> {
    const scope = this.scopes.get(scopeId);
    if (scope === undefined) {
      return denied("SCOPE_NOT_FOUND", "The external scope no longer exists.");
    }
    const status = this.effectiveStatus(scope, options.now ?? this.now());
    if (status === "revoked") {
      return denied("EXTERNAL_SCOPE_REVOKED", "The external scope was revoked.");
    }
    if (status === "expired") {
      return denied("EXTERNAL_SCOPE_EXPIRED", "The external scope expired.");
    }
    if (options.approvedVersion !== undefined && options.approvedVersion !== scope.version) {
      return denied("EXTERNAL_SCOPE_REVOKED", "The external scope changed since the approval.");
    }
    if (!scope.permissions.includes(permission)) {
      return denied("SCOPE_PERMISSION_DENIED", `The scope does not allow ${permission}.`);
    }
    return { allowed: true, scope: this.snapshot(scope), version: scope.version };
  }

  async checkRootAccess(
    root: string,
    permission: ExternalScopePermission,
    options: ExternalScopeAccessOptions = {}
  ): Promise<ExternalScopeAccess> {
    if (typeof root !== "string" || root.length === 0 || !this.path.isAbsolute(root)) {
      return denied("INVALID_ARGUMENT", "An absolute root is required.");
    }
    try {
      this.validate(
        root,
        [...this.scopes.values()].map((scope) => scope.canonicalRoot)
      );
    } catch {
      return denied("INVALID_ARGUMENT", "The target uses an unsafe or unauthorized path alias.");
    }
    try {
      const canonicalRoot = await this.canonicalize(root);
      for (const protectedRoot of this.protectedRoots) {
        const canonicalProtected = await this.canonicalize(protectedRoot);
        if (await this.overlaps(canonicalProtected, canonicalRoot)) {
          return denied(
            "ROOT_OVERLAPS_PROTECTED",
            "The root overlaps a protected Vault/config/state root."
          );
        }
      }
      let covering: ExternalScope | undefined;
      for (const scope of this.scopes.values())
        if (await this.isInside(scope.canonicalRoot, canonicalRoot)) {
          covering = scope;
          break;
        }
      if (covering === undefined) {
        return denied(
          "EXTERNAL_SCOPE_REQUIRED",
          "No external scope covers this root; ask the user to authorize it."
        );
      }
      return this.checkAccess(covering.id, permission, options);
    } catch {
      return denied("INVALID_ARGUMENT", "The filesystem cannot confirm this path alias.");
    }
  }

  private effectiveStatus(scope: ExternalScope, now: number): ExternalScopeStatus {
    if (scope.status === "revoked") return "revoked";
    if (scope.expiresAtMs !== undefined && now > scope.expiresAtMs) return "expired";
    return "active";
  }

  private snapshot(scope: ExternalScope): ExternalScope {
    return Object.freeze({
      ...scope,
      permissions: Object.freeze([...scope.permissions]),
      status: this.effectiveStatus(scope, this.now()),
    });
  }

  private async canonicalize(root: string): Promise<string> {
    try {
      return await this.fileSystem.realpath(this.path.resolve(root));
    } catch {
      return this.path.resolve(root);
    }
  }

  private async overlaps(left: string, right: string): Promise<boolean> {
    return (await this.isInside(left, right)) || this.isInside(right, left);
  }

  private isInside(root: string, target: string): Promise<boolean> {
    return isPathWithin(root, target, this.path, this.fileSystem);
  }

  private validate(target: string, authorizedUncRoots: readonly string[]): void {
    new PlatformPathPolicy({
      platform: this.path.sep === "\\" ? "win32" : "posix",
      authorizedUncRoots,
    }).validate(target);
  }
}

function normalizePermissions(permissions: unknown): ExternalScopePermission[] | null {
  if (!Array.isArray(permissions) || permissions.length === 0) return null;
  const set = new Set<ExternalScopePermission>();
  for (const value of permissions as unknown[]) {
    if (value !== "read" && value !== "write") return null;
    set.add(value);
  }
  return (["read", "write"] as const).filter((permission) => set.has(permission));
}

function denied(code: ExternalScopeAccessCode, message: string): ExternalScopeAccess {
  return { allowed: false, code, message };
}
