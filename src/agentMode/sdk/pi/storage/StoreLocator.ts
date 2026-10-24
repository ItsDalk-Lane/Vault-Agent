import { requireNodeModule } from "@/utils/desktopRuntime";

// Host-owned private storage: fixed per-platform root, keyed by the real Vault root plus
// the existing Keychain vault id, and never merged by display name:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type StorePlatform = "darwin" | "win32" | "linux" | NodeJS.Platform;

export type StoreLocatorErrorCode =
  | "INVALID_VAULT_ROOT"
  | "INVALID_VAULT_ID"
  | "INVALID_ROOT_ID"
  | "VAULT_UNAVAILABLE"
  | "PRIVATE_ROOT_INSIDE_VAULT";

export class StoreLocatorError extends Error {
  readonly code: StoreLocatorErrorCode;

  constructor(code: StoreLocatorErrorCode, message: string) {
    super(message);
    this.name = "StoreLocatorError";
    this.code = code;
  }
}

export interface ResolveDataRootOptions {
  platform: StorePlatform;
  homeDir: string;
  env?: NodeJS.ProcessEnv;
}

export interface StoreLocatorOptions {
  platform: StorePlatform;
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  vaultRoot?: string | null;
  vaultId?: string | null;
  sha256?: (input: string) => string;
}

export interface SessionStorePaths {
  readonly storeDir: string;
  readonly metaPath: string;
  readonly leaseDir: string;
  readonly attachmentsDir: string;
}

export type VaultStoreRelation =
  | { kind: "same"; vaultKey: string }
  | { kind: "new"; vaultKey: string }
  | { kind: "requires_reassociation"; vaultKey: string; previousVaultKey: string };

export const HOST_ROOT_ID_PATTERN = /^root-[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function separatorFor(platform: StorePlatform): "\\" | "/" {
  return platform === "win32" ? "\\" : "/";
}

function isWindows(platform: StorePlatform): boolean {
  return platform === "win32";
}

function stripTrailingSeparators(value: string, platform: StorePlatform): string {
  const separator = separatorFor(platform);
  const collapsed = value.replace(isWindows(platform) ? /[\\/]+/g : /\/+/g, separator);
  const isRoot =
    collapsed === separator || (isWindows(platform) && /^[A-Za-z]:\\$/.test(collapsed));
  if (isRoot) return collapsed;
  return collapsed.replace(new RegExp(`\\${separator}+$`), "");
}

function normalizeJoinedSegment(segment: string, first: boolean, platform: StorePlatform): string {
  const windows = isWindows(platform);
  const trimmedEnd = windows ? segment.replace(/[\\/]+$/, "") : segment.replace(/\/+$/, "");
  if (first) return trimmedEnd;
  return windows ? trimmedEnd.replace(/^[\\/]+/, "") : trimmedEnd.replace(/^\/+/, "");
}

export function joinStorePath(platform: StorePlatform, ...segments: string[]): string {
  const separator = separatorFor(platform);
  const parts = segments.filter((segment) => segment.length > 0);
  if (parts.length === 0) return "";
  let result = normalizeJoinedSegment(parts[0], true, platform);
  if (result.length === 0) result = separator;
  for (const part of parts.slice(1)) {
    const normalized = normalizeJoinedSegment(part, false, platform);
    if (normalized.length === 0) continue;
    result = result.endsWith(separator)
      ? `${result}${normalized}`
      : `${result}${separator}${normalized}`;
  }
  return result;
}

function isAbsoluteStorePath(value: string, platform: StorePlatform): boolean {
  if (isWindows(platform)) return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
  return value.startsWith("/");
}

export function normalizeVaultRoot(vaultRoot: string, platform: StorePlatform): string {
  const trimmed = vaultRoot.trim();
  if (trimmed.length === 0) {
    throw new StoreLocatorError("INVALID_VAULT_ROOT", "The Vault root path is empty.");
  }
  let normalized = stripTrailingSeparators(trimmed, platform);
  if (!isAbsoluteStorePath(normalized, platform)) {
    throw new StoreLocatorError(
      "INVALID_VAULT_ROOT",
      `The Vault root must be an absolute path: ${vaultRoot}`
    );
  }
  if (isWindows(platform)) normalized = normalized.toLowerCase();
  return normalized;
}

export function resolveDataRoot(options: ResolveDataRootOptions): string {
  const { platform, homeDir, env = {} } = options;
  if (platform === "darwin") {
    return joinStorePath(platform, homeDir, "Library", "Application Support", "VaultAgent");
  }
  if (platform === "win32") {
    const base = env.LOCALAPPDATA?.trim() || joinStorePath(platform, homeDir, "AppData", "Local");
    return joinStorePath(platform, base, "VaultAgent");
  }
  const base = env.XDG_STATE_HOME?.trim() || joinStorePath(platform, homeDir, ".local", "state");
  return joinStorePath(platform, base, "vault-agent");
}

function defaultSha256(input: string): string {
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function computeVaultKey(
  normalizedVaultRoot: string,
  vaultId: string,
  sha256: (input: string) => string = defaultSha256
): string {
  if (!VAULT_ID_PATTERN.test(vaultId)) {
    throw new StoreLocatorError("INVALID_VAULT_ID", "The Keychain vault id is not usable.");
  }
  return sha256(`${normalizedVaultRoot}\u0000${vaultId}`);
}

export function assertHostRootId(rootId: string): string {
  if (!HOST_ROOT_ID_PATTERN.test(rootId)) {
    throw new StoreLocatorError(
      "INVALID_ROOT_ID",
      `Root ids must be host-minted "root-..." ids: ${rootId}`
    );
  }
  return rootId;
}

export function isPathInsideStoreRoot(
  candidate: string,
  root: string,
  platform: StorePlatform
): boolean {
  if (!isAbsoluteStorePath(candidate, platform) || !isAbsoluteStorePath(root, platform)) {
    return false;
  }
  const normalizedCandidate = stripTrailingSeparators(candidate, platform);
  const normalizedRoot = stripTrailingSeparators(root, platform);
  const compareCandidate = isWindows(platform)
    ? normalizedCandidate.toLowerCase()
    : normalizedCandidate;
  const compareRoot = isWindows(platform) ? normalizedRoot.toLowerCase() : normalizedRoot;
  return (
    compareCandidate === compareRoot ||
    compareCandidate.startsWith(`${compareRoot}${separatorFor(platform)}`)
  );
}

export class StoreLocator {
  readonly platform: StorePlatform;
  readonly dataRoot: string;
  private readonly vaultRoot: string | null;
  private readonly vaultId: string | null;
  private readonly sha256: (input: string) => string;

  constructor(options: StoreLocatorOptions) {
    this.platform = options.platform;
    this.dataRoot = resolveDataRoot(options);
    this.sha256 = options.sha256 ?? defaultSha256;
    const vaultRoot = options.vaultRoot?.trim() ? options.vaultRoot : null;
    if (vaultRoot === null) {
      if (options.vaultRoot?.trim() === "") {
        throw new StoreLocatorError("INVALID_VAULT_ROOT", "The Vault root path is empty.");
      }
      this.vaultRoot = null;
      this.vaultId = null;
      return;
    }
    this.vaultRoot = normalizeVaultRoot(vaultRoot, this.platform);
    if (isPathInsideStoreRoot(this.dataRoot, this.vaultRoot, this.platform)) {
      throw new StoreLocatorError(
        "PRIVATE_ROOT_INSIDE_VAULT",
        "Private Vault Agent data must not live inside the user's Vault."
      );
    }
    const vaultId = options.vaultId?.trim();
    if (!vaultId || !VAULT_ID_PATTERN.test(vaultId)) {
      throw new StoreLocatorError(
        "INVALID_VAULT_ID",
        "A Keychain vault id is required to key the private store."
      );
    }
    this.vaultId = vaultId;
  }

  get vaultKey(): string | null {
    if (this.vaultRoot === null || this.vaultId === null) return null;
    return computeVaultKey(this.vaultRoot, this.vaultId, this.sha256);
  }

  get vaultStoreRoot(): string {
    return joinStorePath(this.platform, this.dataRoot, "v1", "vaults", this.requireVaultKey());
  }

  sessionStorePaths(rootId: string): SessionStorePaths {
    const hostRootId = assertHostRootId(rootId);
    const sessionRoot = joinStorePath(this.platform, this.vaultStoreRoot, "sessions", hostRootId);
    return {
      storeDir: joinStorePath(this.platform, sessionRoot, "store"),
      metaPath: joinStorePath(this.platform, sessionRoot, "meta.json"),
      leaseDir: joinStorePath(this.platform, sessionRoot, "lease"),
      attachmentsDir: joinStorePath(this.platform, sessionRoot, "attachments"),
    };
  }

  protectedPaths(): readonly string[] {
    return Object.freeze([this.dataRoot]);
  }

  isProtectedPath(candidate: string): boolean {
    return isPathInsideStoreRoot(candidate, this.dataRoot, this.platform);
  }

  relationTo(previousVaultKey: string | null): VaultStoreRelation {
    const vaultKey = this.requireVaultKey();
    if (previousVaultKey === null) return { kind: "new", vaultKey };
    if (previousVaultKey === vaultKey) return { kind: "same", vaultKey };
    return { kind: "requires_reassociation", previousVaultKey, vaultKey };
  }

  private requireVaultKey(): string {
    const vaultKey = this.vaultKey;
    if (vaultKey === null) {
      throw new StoreLocatorError(
        "VAULT_UNAVAILABLE",
        "The Vault root is unavailable on this platform; no private store can be opened."
      );
    }
    return vaultKey;
  }
}
