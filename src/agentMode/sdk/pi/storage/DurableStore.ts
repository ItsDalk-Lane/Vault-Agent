import type { Context } from "@earendil-works/chord";

import { requireNodeModule } from "@/utils/desktopRuntime";

import {
  createStoreMetadata,
  parseStoreMetadata,
  serializeStoreMetadata,
  type StoreMetadata,
} from "./StoreMetadata";
import type { LeaseAcquireResult, StoreLease } from "./StoreLease";

// One leased JSONL directory is the durable store: lease first, open with fsync, record the
// schema/runtime header, close by flushing then releasing, and never fall back to an
// in-memory store on failure: https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export {
  STORE_SCHEMA_VERSION,
  createStoreMetadata,
  parseStoreMetadata,
  serializeStoreMetadata,
} from "./StoreMetadata";
export type { StoreMetadata, ParsedStoreMetadata } from "./StoreMetadata";
export type { LeaseAcquireResult, LeaseReleaseResult } from "./StoreLease";

export interface JsonlStoragePort {
  close(context: Context): Promise<void>;
}

export type OpenJsonlStoragePort = (
  directory: string,
  context: Context,
  options: { readonly fsync: true }
) => Promise<JsonlStoragePort>;

export interface StoreMetadataPort {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

export type StoreLeasePort = Pick<StoreLease, "acquire" | "release">;

export type DurableStoreErrorCode = "STORAGE_FAILED";

export class DurableStoreError extends Error {
  readonly code: DurableStoreErrorCode;

  constructor(code: DurableStoreErrorCode, message: string) {
    super(message);
    this.name = "DurableStoreError";
    this.code = code;
  }
}

export type DurableStoreOpenResult =
  | { kind: "open"; store: DurableStoreHandle }
  | Extract<LeaseAcquireResult, { kind: "busy" }>
  | {
      kind: "unsupported_version";
      code: "STORE_VERSION_UNSUPPORTED";
      foundVersion: number;
      metadata: StoreMetadata | null;
      message: string;
    };

export interface DurableStoreOptions {
  storeDir: string;
  metaPath: string;
  runtimeVersion: string;
  context: Context;
  lease: StoreLeasePort;
  metadata?: StoreMetadataPort;
  openStorage?: OpenJsonlStoragePort;
  now?: () => number;
}

export async function openPiJsonlStorage(
  directory: string,
  context: Context,
  options: { readonly fsync: true }
): Promise<JsonlStoragePort> {
  const { openNodeJsonlStorage } = await import("@earendil-works/pi-durable/storage/jsonl/node");
  return openNodeJsonlStorage(directory, context, options);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createNodeMetadataPort(metaPath: string): StoreMetadataPort {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    read: async () => {
      try {
        return await fs.readFile(metaPath, "utf8");
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error) {
          if ((error as { code?: unknown }).code === "ENOENT") return null;
        }
        throw error;
      }
    },
    write: async (content) => {
      await fs.writeFile(metaPath, content, { encoding: "utf8", flag: "wx" });
    },
  };
}

export class DurableStoreHandle {
  readonly storeDir: string;
  readonly storage: JsonlStoragePort;
  readonly metadata: StoreMetadata;
  private readonly context: Context;
  private readonly lease: StoreLeasePort;
  private readonly token: string;
  private closed = false;

  constructor(options: {
    storeDir: string;
    storage: JsonlStoragePort;
    metadata: StoreMetadata;
    context: Context;
    lease: StoreLeasePort;
    token: string;
  }) {
    this.storeDir = options.storeDir;
    this.storage = options.storage;
    this.metadata = options.metadata;
    this.context = options.context;
    this.lease = options.lease;
    this.token = options.token;
  }

  isClosed(): boolean {
    return this.closed;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    let closeError: unknown = null;
    try {
      await this.storage.close(this.context);
    } catch (error) {
      closeError = error;
    }

    let releaseError: unknown = null;
    try {
      const releaseResult = await this.lease.release(this.token);
      if (releaseResult.kind === "token_mismatch") {
        releaseError = new Error("The store lease no longer belongs to this writer.");
      }
    } catch (error) {
      releaseError = error;
    }

    if (closeError) {
      throw new DurableStoreError(
        "STORAGE_FAILED",
        `Could not close the durable store: ${errorMessage(closeError)}`
      );
    }
    if (releaseError) {
      throw new DurableStoreError(
        "STORAGE_FAILED",
        `Could not release the store lease: ${errorMessage(releaseError)}`
      );
    }
  }
}

export class DurableStore {
  private readonly storeDir: string;
  private readonly metaPath: string;
  private readonly runtimeVersion: string;
  private readonly context: Context;
  private readonly lease: StoreLeasePort;
  private readonly metadata: StoreMetadataPort;
  private readonly openStorage: OpenJsonlStoragePort;
  private readonly now: () => number;

  constructor(options: DurableStoreOptions) {
    if (!options.storeDir || !options.metaPath) {
      throw new DurableStoreError(
        "STORAGE_FAILED",
        "A store directory and metadata path are required."
      );
    }
    this.storeDir = options.storeDir;
    this.metaPath = options.metaPath;
    this.runtimeVersion = options.runtimeVersion;
    this.context = options.context;
    this.lease = options.lease;
    this.metadata = options.metadata ?? createNodeMetadataPort(this.metaPath);
    this.openStorage = options.openStorage ?? openPiJsonlStorage;
    this.now = options.now ?? Date.now;
  }

  async open(): Promise<DurableStoreOpenResult> {
    const leaseResult = await this.lease.acquire();
    if (leaseResult.kind === "busy") return leaseResult;
    const token = leaseResult.token;

    let raw: string | null;
    try {
      raw = await this.metadata.read();
    } catch (error) {
      await this.releaseQuietly(token);
      throw new DurableStoreError(
        "STORAGE_FAILED",
        `Could not read the store metadata: ${errorMessage(error)}`
      );
    }

    const parsed = parseStoreMetadata(raw);
    if (parsed.kind === "invalid") {
      await this.releaseQuietly(token);
      throw new DurableStoreError("STORAGE_FAILED", "The store metadata header is corrupt.");
    }
    if (parsed.kind === "unsupported") {
      await this.releaseQuietly(token);
      return {
        kind: "unsupported_version",
        code: "STORE_VERSION_UNSUPPORTED",
        foundVersion: parsed.foundVersion,
        metadata: parsed.metadata,
        message: `Store schema version ${parsed.foundVersion} is not supported by this runtime; opening read-only.`,
      };
    }

    let storage: JsonlStoragePort;
    try {
      storage = await this.openStorage(this.storeDir, this.context, { fsync: true });
    } catch (error) {
      await this.releaseQuietly(token);
      throw new DurableStoreError(
        "STORAGE_FAILED",
        `Could not open the durable store: ${errorMessage(error)}`
      );
    }

    let metadata: StoreMetadata;
    if (parsed.kind === "ok") {
      metadata = parsed.metadata;
    } else {
      metadata = createStoreMetadata({
        runtimeVersion: this.runtimeVersion,
        createdAt: this.now(),
      });
      try {
        await this.metadata.write(serializeStoreMetadata(metadata));
      } catch (error) {
        try {
          await storage.close(this.context);
        } catch {
          void 0;
        }
        await this.releaseQuietly(token);
        throw new DurableStoreError(
          "STORAGE_FAILED",
          `Could not write the store metadata header: ${errorMessage(error)}`
        );
      }
    }

    return {
      kind: "open",
      store: new DurableStoreHandle({
        storeDir: this.storeDir,
        storage,
        metadata,
        context: this.context,
        lease: this.lease,
        token,
      }),
    };
  }

  private async releaseQuietly(token: string): Promise<void> {
    try {
      await this.lease.release(token);
    } catch {
      return;
    }
  }
}
