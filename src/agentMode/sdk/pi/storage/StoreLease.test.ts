import {
  StoreLease,
  StoreLeaseError,
  StoreLeaseRegistry,
  leaseOwnerFile,
  type StoreLeaseFs,
  type StoreLeaseOwner,
  type StoreLeaseProcessPort,
} from "./StoreLease";

// A lease protects one private store from concurrent writers; it is created with mkdir,
// never stolen by age, and only released by the token that minted it:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const LEASE_DIR = "/fixture/state/v1/vaults/key/sessions/root-abc/lease";
const STORE_PATH = "/fixture/state/v1/vaults/key/sessions/root-abc/store";
const RECLAIM_DIR = `${LEASE_DIR}.reclaim`;

interface MemoryFs extends StoreLeaseFs {
  readonly directories: Set<string>;
  readonly files: Map<string, string>;
  readonly mkdirCalls: string[];
  readonly removeCalls: string[];
}

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function createMemoryFs(): MemoryFs {
  const directories = new Set<string>();
  const files = new Map<string, string>();
  const mkdirCalls: string[] = [];
  const removeCalls: string[] = [];
  return {
    directories,
    files,
    mkdirCalls,
    removeCalls,
    mkdir: async (directory) => {
      mkdirCalls.push(directory);
      if (directories.has(directory)) throw errno("EEXIST");
      directories.add(directory);
    },
    writeFile: async (file, content) => {
      const parent = file.slice(0, file.lastIndexOf("/"));
      if (!directories.has(parent)) throw errno("ENOENT");
      files.set(file, content);
    },
    readFile: async (file) => {
      const content = files.get(file);
      if (content === undefined) throw errno("ENOENT");
      return content;
    },
    remove: async (directory) => {
      removeCalls.push(directory);
      if (!directories.delete(directory)) throw errno("ENOENT");
      for (const file of [...files.keys()]) {
        if (file.startsWith(`${directory}/`)) files.delete(file);
      }
    },
  };
}

function seedLease(fs: MemoryFs, owner: Partial<StoreLeaseOwner> | null): void {
  fs.directories.add(LEASE_DIR);
  if (owner === null) return;
  fs.files.set(leaseOwnerFile(LEASE_DIR), JSON.stringify(owner));
}

interface FakeProcess extends StoreLeaseProcessPort {
  readonly alive: Set<number>;
  readonly boot: { value: string };
}

function createProcess(overrides: Partial<FakeProcess> = {}): FakeProcess {
  const alive = new Set<number>(overrides.alive ?? [4242]);
  const boot = overrides.boot ?? { value: "boot-a" };
  return {
    alive,
    boot,
    pid: () => 4242,
    bootId: () => boot.value,
    isAlive: (pid) => {
      if (overrides.isAlive) return overrides.isAlive(pid);
      return alive.has(pid);
    },
  };
}

function createLease(options: {
  fs: MemoryFs;
  process?: FakeProcess;
  registry?: StoreLeaseRegistry;
  token?: string;
  now?: number;
}): StoreLease {
  return new StoreLease({
    leaseDir: LEASE_DIR,
    storePath: STORE_PATH,
    fs: options.fs,
    process: options.process ?? createProcess(),
    registry: options.registry ?? new StoreLeaseRegistry(),
    token: () => options.token ?? "token-1",
    now: () => options.now ?? 1000,
  });
}

describe("StoreLease", () => {
  describe("acquire()", () => {
    it("creates the lease directory atomically and records a complete owner", async () => {
      const fs = createMemoryFs();
      const lease = createLease({ fs });

      const result = await lease.acquire();

      expect(result).toEqual({ kind: "acquired", token: "token-1" });
      expect(fs.mkdirCalls).toEqual([LEASE_DIR]);
      expect(fs.directories.has(LEASE_DIR)).toBe(true);
      expect(JSON.parse(fs.files.get(leaseOwnerFile(LEASE_DIR)) ?? "")).toEqual({
        token: "token-1",
        pid: 4242,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 1000,
      });
    });

    it("rejects a second writer in the same process before touching the disk", async () => {
      const fs = createMemoryFs();
      const registry = new StoreLeaseRegistry();
      const first = createLease({ fs, registry, token: "token-1" });
      const second = createLease({ fs, registry, token: "token-2" });

      await expect(first.acquire()).resolves.toEqual({ kind: "acquired", token: "token-1" });
      const blocked = await second.acquire();

      expect(blocked).toEqual({
        kind: "busy",
        code: "STORE_BUSY",
        reason: "in_process_writer",
        recoveryRequired: false,
        owner: JSON.parse(fs.files.get(leaseOwnerFile(LEASE_DIR)) ?? ""),
      });
      expect(fs.mkdirCalls).toEqual([LEASE_DIR]);
    });

    it("reports an active remote owner as busy without stealing the lease", async () => {
      const fs = createMemoryFs();
      const first = createLease({ fs, token: "token-1" });
      await first.acquire();

      const second = createLease({
        fs,
        process: createProcess({ alive: new Set([4242]) }),
        token: "token-2",
      });
      const blocked = await second.acquire();

      expect(blocked.kind).toBe("busy");
      expect(blocked).toMatchObject({
        kind: "busy",
        code: "STORE_BUSY",
        reason: "active_remote_owner",
        recoveryRequired: false,
      });
      expect(fs.removeCalls).toEqual([]);
    });

    it("does not steal a long-running approval just because the owner is old", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "token-old",
        pid: 9001,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 1000 - 24 * 60 * 60 * 1000,
      });
      const lease = createLease({
        fs,
        process: createProcess({ alive: new Set([9001]) }),
        now: 9_999_999,
        token: "token-new",
      });

      const result = await lease.acquire();

      expect(result).toMatchObject({ kind: "busy", reason: "active_remote_owner" });
      expect(fs.removeCalls).toEqual([]);
    });

    it("reclaims only an owner whose process is proven gone", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "token-dead",
        pid: 777,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 5,
      });
      const lease = createLease({
        fs,
        process: createProcess({ alive: new Set() }),
        token: "token-2",
      });

      const result = await lease.acquire();

      expect(result).toEqual({ kind: "acquired", token: "token-2" });
      expect(fs.removeCalls).toEqual([LEASE_DIR, RECLAIM_DIR]);
      expect(JSON.parse(fs.files.get(leaseOwnerFile(LEASE_DIR)) ?? "").token).toBe("token-2");
    });

    it("reclaims an owner with a different boot estimate only after proving its process is gone https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "token-previous-boot",
        pid: 4242,
        bootId: "boot-previous",
        storePath: STORE_PATH,
        createdAt: 5,
      });
      const lease = createLease({
        fs,
        process: createProcess({ alive: new Set() }),
        token: "token-2",
      });

      await expect(lease.acquire()).resolves.toEqual({ kind: "acquired", token: "token-2" });
      expect(fs.removeCalls).toEqual([LEASE_DIR, RECLAIM_DIR]);
    });

    it("keeps the original writer and requires recovery when its PID is alive despite a different boot estimate https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fs = createMemoryFs();
      const owner = {
        token: "live-owner",
        pid: 9001,
        bootId: "rounded-boot-a",
        storePath: STORE_PATH,
        createdAt: 1,
      };
      seedLease(fs, owner);
      const before = fs.files.get(leaseOwnerFile(LEASE_DIR));
      const lease = createLease({
        fs,
        process: createProcess({ boot: { value: "rounded-boot-b" }, alive: new Set([9001]) }),
      });
      await expect(lease.acquire()).resolves.toMatchObject({
        kind: "busy",
        code: "STORE_BUSY",
        reason: "owner_unverifiable",
        recoveryRequired: true,
        owner,
      });
      expect(fs.files.get(leaseOwnerFile(LEASE_DIR))).toBe(before);
      expect(fs.removeCalls).toEqual([]);
    });

    it("retains a new live writer when a competitor returns an earlier dead-owner read after replacement https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "dead-owner",
        pid: 777,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 1,
      });
      let entered!: () => void;
      let release!: () => void;
      const removing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      let held = false;
      const slowFs = {
        ...fs,
        readFile: async (file: string) => {
          const content = await fs.readFile(file);
          if (file === leaseOwnerFile(LEASE_DIR) && !held) {
            held = true;
            entered();
            await proceed;
          }
          return content;
        },
      };
      const first = createLease({ fs: slowFs, token: "replacement-first" });
      const second = createLease({ fs, token: "replacement-second" });
      const acquiring = first.acquire();
      await removing;
      const competing = await second.acquire();
      release();
      const acquired = await acquiring;
      expect(competing).toEqual({ kind: "acquired", token: "replacement-second" });
      expect(acquired).toMatchObject({ kind: "busy", code: "STORE_BUSY" });
      expect(JSON.parse(fs.files.get(leaseOwnerFile(LEASE_DIR)) ?? "").token).toBe(
        "replacement-second"
      );
    });

    it("never reclaims a different boot estimate when the process probe fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "uncertain-owner",
        pid: 9001,
        bootId: "rounded-boot-a",
        storePath: STORE_PATH,
        createdAt: 1,
      });
      const lease = createLease({
        fs,
        process: createProcess({
          boot: { value: "rounded-boot-b" },
          isAlive: () => {
            throw errno("EACCES");
          },
        }),
      });
      await expect(lease.acquire()).resolves.toMatchObject({
        kind: "busy",
        code: "STORE_BUSY",
        reason: "owner_unverifiable",
        recoveryRequired: true,
      });
      expect(fs.removeCalls).toEqual([]);
    });

    it("keeps replacement exclusive while the owner has been rechecked but its old directory removal is still pending https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "dead-owner",
        pid: 777,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 1,
      });
      let entered!: () => void;
      let release!: () => void;
      const removing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      let held = false;
      const slowFs = {
        ...fs,
        remove: async (directory: string) => {
          if (directory === LEASE_DIR && !held) {
            held = true;
            entered();
            await proceed;
          }
          await fs.remove(directory);
        },
      };
      const first = createLease({ fs: slowFs, token: "replacement-first" });
      const second = createLease({ fs, token: "replacement-second" });
      const acquiring = first.acquire();
      await removing;
      const competing = await second.acquire();
      release();
      const acquired = await acquiring;
      expect([acquired, competing].filter((result) => result.kind === "acquired")).toHaveLength(1);
      expect([acquired, competing].filter((result) => result.kind === "busy")).toHaveLength(1);
      const owner = JSON.parse(fs.files.get(leaseOwnerFile(LEASE_DIR)) ?? "") as StoreLeaseOwner;
      const winner = [acquired, competing].find((result) => result.kind === "acquired");
      expect(owner.token).toBe(winner?.kind === "acquired" ? winner.token : undefined);
    });

    it.each(["dead", "incomplete"])(
      "keeps the original lease and requires recovery when a %s reclaim guard remains https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (state) => {
        const fs = createMemoryFs();
        seedLease(fs, {
          token: "dead-owner",
          pid: 777,
          bootId: "boot-a",
          storePath: STORE_PATH,
          createdAt: 1,
        });
        const before = fs.files.get(leaseOwnerFile(LEASE_DIR));
        fs.directories.add(RECLAIM_DIR);
        if (state === "dead")
          fs.files.set(
            leaseOwnerFile(RECLAIM_DIR),
            JSON.stringify({
              token: "dead-guard",
              pid: 888,
              bootId: "boot-a",
              storePath: STORE_PATH,
              createdAt: 1,
            })
          );
        await expect(createLease({ fs }).acquire()).resolves.toMatchObject({
          kind: "busy",
          code: "STORE_BUSY",
          recoveryRequired: true,
        });
        expect(fs.files.get(leaseOwnerFile(LEASE_DIR))).toBe(before);
        expect(fs.removeCalls).toEqual([]);
        expect(fs.directories.has(RECLAIM_DIR)).toBe(true);
      }
    );

    it("does not remove another token's reclaim guard during its own cleanup https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "dead-owner",
        pid: 777,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 1,
      });
      const remove = fs.remove;
      fs.remove = async (directory) => {
        await remove(directory);
        if (directory === LEASE_DIR) {
          const owner = JSON.parse(
            fs.files.get(leaseOwnerFile(RECLAIM_DIR)) ?? ""
          ) as StoreLeaseOwner;
          fs.files.set(
            leaseOwnerFile(RECLAIM_DIR),
            JSON.stringify({ ...owner, token: "another-guard-token" })
          );
        }
      };
      await expect(createLease({ fs }).acquire()).resolves.toEqual({
        kind: "acquired",
        token: "token-1",
      });
      expect(fs.directories.has(RECLAIM_DIR)).toBe(true);
      expect(JSON.parse(fs.files.get(leaseOwnerFile(RECLAIM_DIR)) ?? "").token).toBe(
        "another-guard-token"
      );
      expect(fs.removeCalls).toEqual([LEASE_DIR]);
    });

    it("requires manual recovery for an incomplete owner instead of deleting it", async () => {
      const fs = createMemoryFs();
      seedLease(fs, { token: "only-a-token" });
      const lease = createLease({ fs });

      const result = await lease.acquire();

      expect(result).toMatchObject({
        kind: "busy",
        reason: "owner_incomplete",
        recoveryRequired: true,
      });
      expect(fs.removeCalls).toEqual([]);
      expect(fs.directories.has(LEASE_DIR)).toBe(true);
    });

    it("requires manual recovery when the owner file is missing", async () => {
      const fs = createMemoryFs();
      seedLease(fs, null);
      const lease = createLease({ fs });

      await expect(lease.acquire()).resolves.toMatchObject({
        kind: "busy",
        reason: "owner_incomplete",
        recoveryRequired: true,
      });
      expect(fs.removeCalls).toEqual([]);
    });

    it("requires manual recovery when liveness cannot be verified", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "token-unknown",
        pid: 9001,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 5,
      });
      const process = createProcess({
        alive: new Set([9001]),
        isAlive: () => {
          throw new Error("EPERM");
        },
      });
      const lease = createLease({ fs, process });

      await expect(lease.acquire()).resolves.toMatchObject({
        kind: "busy",
        reason: "owner_unverifiable",
        recoveryRequired: true,
      });
      expect(fs.removeCalls).toEqual([]);
    });

    it("fails closed when the lease directory cannot be created", async () => {
      const fs = createMemoryFs();
      fs.mkdir = async () => {
        throw errno("EACCES");
      };
      const lease = createLease({ fs });

      await expect(lease.acquire()).rejects.toMatchObject({
        name: "StoreLeaseError",
        code: "STORAGE_FAILED",
      });
    });
  });

  describe("release()", () => {
    it("releases the lease with the matching token and clears the in-process registry", async () => {
      const fs = createMemoryFs();
      const registry = new StoreLeaseRegistry();
      const first = createLease({ fs, registry, token: "token-1" });
      const second = createLease({ fs, registry, token: "token-2" });
      await first.acquire();

      await expect(first.release("token-1")).resolves.toEqual({ kind: "released" });
      expect(fs.removeCalls).toEqual([LEASE_DIR]);
      expect(fs.directories.has(LEASE_DIR)).toBe(false);

      await expect(second.acquire()).resolves.toEqual({ kind: "acquired", token: "token-2" });
    });

    it("refuses a different token and leaves the lease untouched", async () => {
      const fs = createMemoryFs();
      const lease = createLease({ fs, token: "token-1" });
      await lease.acquire();
      const ownerBefore = fs.files.get(leaseOwnerFile(LEASE_DIR));

      await expect(lease.release("token-other")).resolves.toEqual({ kind: "token_mismatch" });
      expect(fs.removeCalls).toEqual([]);
      expect(fs.directories.has(LEASE_DIR)).toBe(true);
      expect(fs.files.get(leaseOwnerFile(LEASE_DIR))).toBe(ownerBefore);
    });

    it("does not delete a lease directory owned by an unknown token", async () => {
      const fs = createMemoryFs();
      seedLease(fs, {
        token: "foreign-token",
        pid: 123456,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 5,
      });
      const lease = createLease({ fs, token: "my-token" });

      await expect(lease.release("my-token")).resolves.toEqual({ kind: "token_mismatch" });
      expect(fs.removeCalls).toEqual([]);
      expect(fs.files.has(leaseOwnerFile(LEASE_DIR))).toBe(true);
    });
  });

  describe("StoreLeaseRegistry", () => {
    it("tracks one holder per lease directory with its token", () => {
      const registry = new StoreLeaseRegistry();
      const owner: StoreLeaseOwner = {
        token: "token-1",
        pid: 4242,
        bootId: "boot-a",
        storePath: STORE_PATH,
        createdAt: 1000,
      };
      registry.register(LEASE_DIR, owner);

      expect(registry.find(LEASE_DIR)).toEqual(owner);
      registry.unregister(LEASE_DIR, "other-token");
      expect(registry.find(LEASE_DIR)).toEqual(owner);
      registry.unregister(LEASE_DIR, "token-1");
      expect(registry.find(LEASE_DIR)).toBeUndefined();
    });
  });

  it("exposes failures as StoreLeaseError with a stable code", () => {
    const error = new StoreLeaseError("STORAGE_FAILED", "disk unavailable");
    expect(error.name).toBe("StoreLeaseError");
    expect(error.code).toBe("STORAGE_FAILED");
    expect(error.message).toBe("disk unavailable");
  });
});
