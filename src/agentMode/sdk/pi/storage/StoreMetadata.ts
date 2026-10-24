// The private store carries its own schema and runtime version header so an unsupported
// format is reported read-only instead of being rewritten or silently downgraded:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const STORE_SCHEMA_VERSION = 1;
export const STORE_METADATA_KIND = "va.store-meta";

export interface StoreMetadata {
  readonly kind: typeof STORE_METADATA_KIND;
  readonly schemaVersion: number;
  readonly runtimeVersion: string;
  readonly createdAt: number;
}

export interface CreateStoreMetadataOptions {
  readonly runtimeVersion: string;
  readonly createdAt: number;
}

export type ParsedStoreMetadata =
  | { kind: "missing" }
  | { kind: "ok"; metadata: StoreMetadata }
  | { kind: "unsupported"; foundVersion: number; metadata: StoreMetadata | null }
  | { kind: "invalid"; reason: "not-json" | "invalid-shape" };

export function createStoreMetadata(options: CreateStoreMetadataOptions): StoreMetadata {
  return {
    kind: STORE_METADATA_KIND,
    schemaVersion: STORE_SCHEMA_VERSION,
    runtimeVersion: options.runtimeVersion,
    createdAt: options.createdAt,
  };
}

export function serializeStoreMetadata(metadata: StoreMetadata): string {
  return JSON.stringify(metadata);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMetadata(value: Record<string, unknown>, schemaVersion: number): StoreMetadata | null {
  const { runtimeVersion, createdAt } = value;
  if (typeof runtimeVersion !== "string" || runtimeVersion.length === 0) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  return {
    kind: STORE_METADATA_KIND,
    schemaVersion,
    runtimeVersion,
    createdAt,
  };
}

export function parseStoreMetadata(raw: string | null): ParsedStoreMetadata {
  if (raw === null) return { kind: "missing" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "invalid", reason: "not-json" };
  }

  if (!isRecord(value) || value.kind !== STORE_METADATA_KIND) {
    return { kind: "invalid", reason: "invalid-shape" };
  }
  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { kind: "invalid", reason: "invalid-shape" };
  }

  const metadata = asMetadata(value, schemaVersion);
  if (schemaVersion !== STORE_SCHEMA_VERSION) {
    if (metadata === null) return { kind: "invalid", reason: "invalid-shape" };
    return { kind: "unsupported", foundVersion: schemaVersion, metadata };
  }
  if (metadata === null) return { kind: "invalid", reason: "invalid-shape" };
  return { kind: "ok", metadata };
}
