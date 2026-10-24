import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Context } from "@earendil-works/chord";

jest.mock("@earendil-works/pi-durable/storage/jsonl/node", () => ({
  openNodeJsonlStorage: jest.fn(),
}));

import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";

import {
  DurableStore,
  DurableStoreError,
  STORE_SCHEMA_VERSION,
  createStoreMetadata,
  openPiJsonlStorage,
  parseStoreMetadata,
  serializeStoreMetadata,
  type JsonlStoragePort,
  type LeaseAcquireResult,
  type LeaseReleaseResult,
  type OpenJsonlStoragePort,
  type StoreLeasePort,
  type StoreMetadataPort,
} from "./DurableStore";

// The Durable store wraps one leased JSONL directory: lease before open, fsync on, an
// explicit schema/runtime header, close that flushes then releases, and no silent
// MemoryStorage fallback: https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const STORE_DIR = "/fixture/state/v1/vaults/key/sessions/root-abc/store";
const META_PATH = "/fixture/state/v1/vaults/key/sessions/root-abc/meta.json";
const CONTEXT = { cancellation: "test" } as unknown as Context;
const RUNTIME_VERSION = "pi-durable@1.3.0";

type FakeStorage = JsonlStoragePort & {
  readonly directory: string;
  readonly records: string[];
  closeCalls: number;
  closeFailure: Error | null;
};

type FakeEngine = OpenJsonlStoragePort & {
  readonly storages: Map<string, FakeStorage>;
  readonly openCalls: { directory: string; context: Context; options: { fsync: true } }[];
  nextOpenFailure: Error | null;
};

function createFakeEngine(): FakeEngine {
  const storages = new Map<string, FakeStorage>();
  const openCalls: FakeEngine["openCalls"] = [];
  const openStorage: OpenJsonlStoragePort = async (directory, context, options) => {
    openCalls.push({ directory, context, options });
    if (engine.nextOpenFailure) {
      const failure = engine.nextOpenFailure;
      engine.nextOpenFailure = null;
      throw failure;
    }
    const existing = storages.get(directory);
    if (existing) return existing;
    const storage: FakeStorage = {
      directory,
      records: [],
      closeCalls: 0,
      closeFailure: null,
      close: async () => {
        storage.closeCalls += 1;
        if (storage.closeFailure) throw storage.closeFailure;
      },
    };
    storages.set(directory, storage);
    return storage;
  };
  const engine: FakeEngine = Object.assign(openStorage, {
    storages,
    openCalls,
    nextOpenFailure: null as Error | null,
  });
  return engine;
}

interface FakeLease extends StoreLeasePort {
  readonly events: string[];
  readonly releasedTokens: string[];
  acquireResult: LeaseAcquireResult;
}

function createFakeLease(
  acquireResult: LeaseAcquireResult = { kind: "acquired", token: "t1" }
): FakeLease {
  const releasedTokens: string[] = [];
  const lease: FakeLease = {
    events: releasedTokens,
    releasedTokens,
    acquireResult,
    acquire: async () => lease.acquireResult,
    release: async (token): Promise<LeaseReleaseResult> => {
      releasedTokens.push(token);
      return token === "t1" ? { kind: "released" } : { kind: "token_mismatch" };
    },
  };
  return lease;
}

interface FakeMetadata extends StoreMetadataPort {
  content: string | null;
  readonly writes: string[];
  readFailure: Error | null;
  writeFailure: Error | null;
}

function createFakeMetadata(initial: string | null = null): FakeMetadata {
  const metadata: FakeMetadata = {
    content: initial,
    writes: [],
    readFailure: null,
    writeFailure: null,
    read: async () => {
      if (metadata.readFailure) throw metadata.readFailure;
      return metadata.content;
    },
    write: async (content) => {
      if (metadata.writeFailure) throw metadata.writeFailure;
      metadata.writes.push(content);
      metadata.content = content;
    },
  };
  return metadata;
}

function createStore(options: {
  engine?: FakeEngine;
  lease?: FakeLease;
  metadata?: FakeMetadata;
  runtimeVersion?: string;
}): DurableStore {
  return new DurableStore({
    storeDir: STORE_DIR,
    metaPath: META_PATH,
    runtimeVersion: options.runtimeVersion ?? RUNTIME_VERSION,
    context: CONTEXT,
    lease: options.lease ?? createFakeLease(),
    openStorage: options.engine ?? createFakeEngine(),
    metadata: options.metadata ?? createFakeMetadata(),
    now: () => 1700000000000,
  });
}

const currentMetadata = (): string =>
  serializeStoreMetadata({
    kind: "va.store-meta",
    schemaVersion: STORE_SCHEMA_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    createdAt: 5,
  });

const STORAGE_DIR = __dirname;
const SOURCE_ROOT = path.resolve(__dirname, "../../../../..");
const SOURCE_SRC_DIR = path.join(SOURCE_ROOT, "src");
const tempDirectories: string[] = [];

function readJsonlSmokeSource(): string {
  return [
    'import { mkdtemp, readdir, rm } from "node:fs/promises";',
    'import { tmpdir } from "node:os";',
    'import { join } from "node:path";',
    'import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";',
    'import { openPiJsonlStorage } from "./DurableStore";',
    "",
    "async function main() {",
    '  const directory = await mkdtemp(join(tmpdir(), "pi-jsonl-"));',
    "  const storage = await openPiJsonlStorage(directory, BACKGROUND_CONTEXT, { fsync: true });",
    "  await storage.close(BACKGROUND_CONTEXT);",
    "  const files = await readdir(directory);",
    "  await rm(directory, { recursive: true, force: true });",
    "  process.stdout.write(JSON.stringify({ opened: true, closed: true, fileCount: files.length }));",
    "}",
    "",
    "main().catch((error) => {",
    "  process.stderr.write(String(error && error.stack ? error.stack : error));",
    "  process.exitCode = 1;",
    "});",
    "",
  ].join("\n");
}

function runJsonlSmoke(): { opened: boolean; closed: boolean; fileCount: number } {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-jsonl-smoke-"));
  tempDirectories.push(outputDirectory);
  const bundlePath = path.join(outputDirectory, "jsonlSmoke.cjs");
  const obsidianStubPath = path.join(outputDirectory, "obsidianStub.ts");
  fs.writeFileSync(
    obsidianStubPath,
    "export const Platform = { isDesktopApp: true, isMobile: false };\n"
  );
  const buildScript = [
    'const { buildSync } = require("esbuild");',
    "buildSync({",
    "  stdin: {",
    "    contents: process.env.SMOKE_SOURCE,",
    "    resolveDir: process.env.SMOKE_RESOLVE_DIR,",
    '    sourcefile: "jsonlSmoke.ts",',
    '    loader: "ts",',
    "  },",
    "  bundle: true,",
    '  platform: "node",',
    '  format: "cjs",',
    '  target: "node22",',
    "  outfile: process.env.SMOKE_OUTFILE,",
    "  alias: { '@': process.env.SRC_DIR, 'obsidian': process.env.OBSIDIAN_STUB },",
    '  logLevel: "silent",',
    "});",
  ].join("\n");
  execFileSync(process.execPath, ["-e", buildScript], {
    cwd: SOURCE_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      SMOKE_SOURCE: readJsonlSmokeSource(),
      SMOKE_RESOLVE_DIR: STORAGE_DIR,
      SMOKE_OUTFILE: bundlePath,
      SRC_DIR: SOURCE_SRC_DIR,
      OBSIDIAN_STUB: obsidianStubPath,
    },
  });
  const stdout = execFileSync(process.execPath, [bundlePath], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NODE_ENV: "test" },
  });
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

afterAll(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("DurableStore", () => {
  describe("StoreMetadata", () => {
    it("creates a version header carrying the schema and runtime versions", () => {
      expect(createStoreMetadata({ runtimeVersion: RUNTIME_VERSION, createdAt: 123 })).toEqual({
        kind: "va.store-meta",
        schemaVersion: STORE_SCHEMA_VERSION,
        runtimeVersion: RUNTIME_VERSION,
        createdAt: 123,
      });
    });

    it("round-trips the current schema through serialize and parse", () => {
      const metadata = createStoreMetadata({ runtimeVersion: RUNTIME_VERSION, createdAt: 123 });
      expect(parseStoreMetadata(serializeStoreMetadata(metadata))).toEqual({
        kind: "ok",
        metadata,
      });
    });

    it("reports a missing header instead of inventing a version", () => {
      expect(parseStoreMetadata(null)).toEqual({ kind: "missing" });
    });

    it("reports an unknown schema version without accepting it", () => {
      expect(
        parseStoreMetadata(
          JSON.stringify({
            kind: "va.store-meta",
            schemaVersion: 2,
            runtimeVersion: RUNTIME_VERSION,
            createdAt: 1,
          })
        )
      ).toEqual({
        kind: "unsupported",
        foundVersion: 2,
        metadata: {
          kind: "va.store-meta",
          schemaVersion: 2,
          runtimeVersion: RUNTIME_VERSION,
          createdAt: 1,
        },
      });
    });

    it("treats corrupt or foreign headers as invalid", () => {
      expect(parseStoreMetadata("not json")).toEqual({ kind: "invalid", reason: "not-json" });
      expect(parseStoreMetadata(JSON.stringify({ kind: "other" }))).toEqual({
        kind: "invalid",
        reason: "invalid-shape",
      });
    });
  });

  describe("DurableStore", () => {
    describe("open()", () => {
      it("acquires the lease before opening the JSONL store with fsync and writes the header", async () => {
        const engine = createFakeEngine();
        const lease = createFakeLease();
        const metadata = createFakeMetadata();
        const store = createStore({ engine, lease, metadata });

        const result = await store.open();

        expect(result.kind).toBe("open");
        expect(engine.openCalls).toEqual([
          { directory: STORE_DIR, context: CONTEXT, options: { fsync: true } },
        ]);
        expect(metadata.writes).toHaveLength(1);
        expect(JSON.parse(metadata.writes[0])).toMatchObject({
          kind: "va.store-meta",
          schemaVersion: STORE_SCHEMA_VERSION,
          runtimeVersion: RUNTIME_VERSION,
          createdAt: 1700000000000,
        });
        if (result.kind !== "open") throw new Error("expected an open store");
        expect(result.store.storeDir).toBe(STORE_DIR);
        expect(result.store.metadata.schemaVersion).toBe(STORE_SCHEMA_VERSION);
      });

      it("keeps an existing current header instead of rewriting it", async () => {
        const engine = createFakeEngine();
        const metadata = createFakeMetadata(currentMetadata());
        const store = createStore({ engine, metadata });

        const result = await store.open();

        expect(result.kind).toBe("open");
        expect(metadata.writes).toEqual([]);
      });

      it("returns busy without opening the store when the lease is held", async () => {
        const engine = createFakeEngine();
        const metadata = createFakeMetadata();
        const lease = createFakeLease({
          kind: "busy",
          code: "STORE_BUSY",
          reason: "active_remote_owner",
          recoveryRequired: false,
          owner: null,
        });
        const store = createStore({ engine, lease, metadata });

        const result = await store.open();

        expect(result).toMatchObject({ kind: "busy", code: "STORE_BUSY" });
        expect(engine.openCalls).toEqual([]);
        expect(metadata.writes).toEqual([]);
      });

      it("reports an unsupported version read-only and never writes", async () => {
        const engine = createFakeEngine();
        const lease = createFakeLease();
        const metadata = createFakeMetadata(
          JSON.stringify({
            kind: "va.store-meta",
            schemaVersion: 9,
            runtimeVersion: RUNTIME_VERSION,
            createdAt: 1,
          })
        );
        const store = createStore({ engine, lease, metadata });

        const result = await store.open();

        expect(result).toMatchObject({
          kind: "unsupported_version",
          code: "STORE_VERSION_UNSUPPORTED",
          foundVersion: 9,
        });
        expect(engine.openCalls).toEqual([]);
        expect(metadata.writes).toEqual([]);
        expect(lease.releasedTokens).toEqual(["t1"]);
      });

      it("cleans up its own lease when opening the store fails, without falling back", async () => {
        const engine = createFakeEngine();
        engine.nextOpenFailure = new Error("disk full");
        const lease = createFakeLease();
        const metadata = createFakeMetadata();
        const store = createStore({ engine, lease, metadata });

        await expect(store.open()).rejects.toBeInstanceOf(DurableStoreError);
        expect(engine.openCalls).toHaveLength(1);
        expect(metadata.writes).toEqual([]);
        expect(lease.releasedTokens).toEqual(["t1"]);
      });

      it.each(["SESSION_NOT_FOUND", "SESSION_TRANSCRIPT_MISSING"])(
        "preserves %s after releasing the lease so restoration cannot treat missing data as a recoverable store failure https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        async (code) => {
          const engine = createFakeEngine();
          const failure = Object.assign(new Error("Saved session data is missing"), { code });
          engine.nextOpenFailure = failure;
          const lease = createFakeLease();
          const metadata = createFakeMetadata();
          const store = createStore({ engine, lease, metadata });

          await expect(store.open()).rejects.toBe(failure);
          expect(metadata.writes).toEqual([]);
          expect(lease.releasedTokens).toEqual(["t1"]);
        }
      );

      it("fails closed on an invalid header and releases the lease", async () => {
        const engine = createFakeEngine();
        const lease = createFakeLease();
        const metadata = createFakeMetadata("{oops");
        const store = createStore({ engine, lease, metadata });

        await expect(store.open()).rejects.toMatchObject({ code: "STORAGE_FAILED" });
        expect(engine.openCalls).toEqual([]);
        expect(lease.releasedTokens).toEqual(["t1"]);
      });

      it("cleans up the lease when the version header cannot be written", async () => {
        const engine = createFakeEngine();
        const lease = createFakeLease();
        const metadata = createFakeMetadata();
        metadata.writeFailure = new Error("read-only volume");
        const store = createStore({ engine, lease, metadata });

        await expect(store.open()).rejects.toMatchObject({ code: "STORAGE_FAILED" });
        expect(lease.releasedTokens).toEqual(["t1"]);
        const storage = engine.storages.get(STORE_DIR);
        expect(storage?.closeCalls).toBe(1);
      });
    });

    describe("close()", () => {
      it("flushes the store before releasing the lease, and is idempotent", async () => {
        const engine = createFakeEngine();
        const lease = createFakeLease();
        const metadata = createFakeMetadata();
        const store = createStore({ engine, lease, metadata });
        const events: string[] = [];
        const result = await store.open();
        if (result.kind !== "open") throw new Error("expected an open store");
        const storage = engine.storages.get(STORE_DIR);
        if (!storage) throw new Error("expected an opened storage");
        const originalClose = storage.close;
        storage.close = async (context) => {
          events.push("storage.close");
          await originalClose(context);
        };
        const originalRelease = lease.release;
        lease.release = async (token) => {
          events.push(`lease.release:${token}`);
          return originalRelease(token);
        };

        await result.store.close();
        await result.store.close();

        expect(events).toEqual(["storage.close", "lease.release:t1"]);
        expect(result.store.isClosed()).toBe(true);
      });

      it("releases the lease even when closing the storage fails", async () => {
        const engine = createFakeEngine();
        const lease = createFakeLease();
        const store = createStore({ engine, lease, metadata: createFakeMetadata() });
        const result = await store.open();
        if (result.kind !== "open") throw new Error("expected an open store");
        const storage = engine.storages.get(STORE_DIR);
        if (!storage) throw new Error("expected an opened storage");
        storage.closeFailure = new Error("flush failed");

        await expect(result.store.close()).rejects.toMatchObject({ code: "STORAGE_FAILED" });
        expect(lease.releasedTokens).toEqual(["t1"]);
      });
    });

    describe("reopening", () => {
      it("keeps committed records and the existing header across close and reopen", async () => {
        const engine = createFakeEngine();
        const metadata = createFakeMetadata();
        const first = createStore({ engine, metadata });
        const firstOpen = await first.open();
        if (firstOpen.kind !== "open") throw new Error("expected an open store");
        const storage = engine.storages.get(STORE_DIR) as FakeStorage & { append(r: string): void };
        storage.records.push("committed-record");
        await firstOpen.store.close();

        const second = createStore({ engine, metadata });
        const secondOpen = await second.open();

        expect(secondOpen.kind).toBe("open");
        expect(engine.openCalls.map((call) => call.options)).toEqual([
          { fsync: true },
          { fsync: true },
        ]);
        expect(engine.storages.get(STORE_DIR)?.records).toEqual(["committed-record"]);
        expect(metadata.writes).toHaveLength(1);
        if (secondOpen.kind !== "open") throw new Error("expected an open store");
        expect(secondOpen.store.metadata.runtimeVersion).toBe(RUNTIME_VERSION);
      });
    });
  });

  describe("openPiJsonlStorage()", () => {
    it("passes the real opener the store directory, context and fsync option", async () => {
      const storage = { close: jest.fn() } as unknown as JsonlStoragePort;
      const mockedOpen = openNodeJsonlStorage as jest.MockedFunction<typeof openNodeJsonlStorage>;
      mockedOpen.mockResolvedValue(storage as never);

      const opened = await openPiJsonlStorage(STORE_DIR, CONTEXT, { fsync: true });

      expect(opened).toBe(storage);
      expect(mockedOpen).toHaveBeenCalledWith(STORE_DIR, CONTEXT, { fsync: true });
    });

    it("opens and closes a real on-disk JSONL store through the actual pi-durable opener", () => {
      const report = runJsonlSmoke();
      expect(report.opened).toBe(true);
      expect(report.closed).toBe(true);
      expect(report.fileCount).toBeGreaterThanOrEqual(0);
    });
  });
});
