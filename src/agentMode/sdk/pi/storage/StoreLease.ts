import { requireNodeModule } from "@/utils/desktopRuntime";

// One store has exactly one writer: the lease is mkdir-atomic, never expires by age, can
// only be released by the token that minted it, and yields to manual recovery whenever
// ownership cannot be proven:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface StoreLeaseOwner {
  readonly token: string;
  readonly pid: number;
  readonly bootId: string;
  readonly storePath: string;
  readonly createdAt: number;
}

export interface StoreLeaseFs {
  mkdir(directory: string): Promise<void>;
  writeFile(file: string, content: string): Promise<void>;
  readFile(file: string): Promise<string>;
  remove(directory: string): Promise<void>;
}

export interface StoreLeaseProcessPort {
  pid(): number;
  bootId(): string;
  isAlive(pid: number): boolean | Promise<boolean>;
}

export type LeaseBusyReason =
  | "in_process_writer"
  | "active_remote_owner"
  | "owner_incomplete"
  | "owner_unverifiable";

export type LeaseAcquireResult =
  | { kind: "acquired"; token: string }
  | {
      kind: "busy";
      code: "STORE_BUSY";
      reason: LeaseBusyReason;
      recoveryRequired: boolean;
      owner: StoreLeaseOwner | null;
    };

export type LeaseReleaseResult =
  | { kind: "released" }
  | { kind: "not_held" }
  | { kind: "token_mismatch" };

export type StoreLeaseErrorCode = "STORAGE_FAILED";

export class StoreLeaseError extends Error {
  readonly code: StoreLeaseErrorCode;

  constructor(code: StoreLeaseErrorCode, message: string) {
    super(message);
    this.name = "StoreLeaseError";
    this.code = code;
  }
}

export interface StoreLeaseOptions {
  leaseDir: string;
  storePath: string;
  fs?: StoreLeaseFs;
  process?: StoreLeaseProcessPort;
  registry?: StoreLeaseRegistry;
  token?: () => string;
  now?: () => number;
  maxReclaimAttempts?: number;
}

const OWNER_FILE_NAME = "owner.json";
const DEFAULT_MAX_RECLAIM_ATTEMPTS = 2;

export function leaseOwnerFile(leaseDir: string): string {
  return `${leaseDir.replace(/[\\/]+$/, "")}/${OWNER_FILE_NAME}`;
}

export class StoreLeaseRegistry {
  private readonly holders = new Map<string, StoreLeaseOwner>();

  find(leaseDir: string): StoreLeaseOwner | undefined {
    return this.holders.get(leaseDir);
  }

  register(leaseDir: string, owner: StoreLeaseOwner): void {
    this.holders.set(leaseDir, owner);
  }

  unregister(leaseDir: string, token: string): void {
    if (this.holders.get(leaseDir)?.token === token) this.holders.delete(leaseDir);
  }
}

type OwnerInspection =
  | { kind: "active"; owner: StoreLeaseOwner }
  | { kind: "reclaimable"; owner: StoreLeaseOwner }
  | { kind: "recovery"; reason: LeaseBusyReason; owner: StoreLeaseOwner | null };

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseOwner(raw: string): StoreLeaseOwner | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.token !== "string" || value.token.length === 0) return null;
    if (!isPositiveInteger(value.pid)) return null;
    if (typeof value.bootId !== "string" || value.bootId.length === 0) return null;
    if (typeof value.storePath !== "string" || value.storePath.length === 0) return null;
    if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return null;
    return {
      token: value.token,
      pid: value.pid,
      bootId: value.bootId,
      storePath: value.storePath,
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

function createNodeStoreLeaseFs(): StoreLeaseFs {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    mkdir: async (directory) => {
      await fs.mkdir(directory);
    },
    writeFile: async (file, content) => {
      await fs.writeFile(file, content, { encoding: "utf8", flag: "wx" });
    },
    readFile: async (file) => fs.readFile(file, "utf8"),
    remove: async (directory) => {
      await fs.rm(directory, { recursive: true, force: false });
    },
  };
}

function createNodeStoreLeaseProcess(): StoreLeaseProcessPort {
  const os = requireNodeModule<typeof import("node:os")>("node:os");
  const processModule = requireNodeModule<typeof import("node:process")>("node:process");
  return {
    pid: () => processModule.pid,
    bootId: () => String(Math.round((Date.now() - os.uptime() * 1000) / 1000)),
    isAlive: (pid) => {
      try {
        processModule.kill(pid, 0);
        return true;
      } catch (error) {
        return errorCode(error) === "EPERM";
      }
    },
  };
}

function createNodeToken(): string {
  const crypto = requireNodeModule<typeof import("node:crypto")>("node:crypto");
  return crypto.randomUUID();
}

export class StoreLease {
  private readonly leaseDir: string;
  private readonly storePath: string;
  private readonly fs: StoreLeaseFs;
  private readonly process: StoreLeaseProcessPort;
  private readonly registry: StoreLeaseRegistry;
  private readonly mintToken: () => string;
  private readonly now: () => number;
  private readonly maxReclaimAttempts: number;

  constructor(options: StoreLeaseOptions) {
    if (!options.leaseDir || !options.storePath) {
      throw new StoreLeaseError("STORAGE_FAILED", "A lease directory and store path are required.");
    }
    this.leaseDir = options.leaseDir.replace(/[\\/]+$/, "");
    this.storePath = options.storePath;
    this.fs = options.fs ?? createNodeStoreLeaseFs();
    this.process = options.process ?? createNodeStoreLeaseProcess();
    this.registry = options.registry ?? new StoreLeaseRegistry();
    this.mintToken = options.token ?? createNodeToken;
    this.now = options.now ?? Date.now;
    this.maxReclaimAttempts = options.maxReclaimAttempts ?? DEFAULT_MAX_RECLAIM_ATTEMPTS;
  }

  async acquire(): Promise<LeaseAcquireResult> {
    const inProcessHolder = this.registry.find(this.leaseDir);
    if (inProcessHolder) {
      return this.busy("in_process_writer", false, inProcessHolder);
    }

    for (let attempt = 0; attempt <= this.maxReclaimAttempts; attempt += 1) {
      try {
        await this.fs.mkdir(this.leaseDir);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") {
          throw new StoreLeaseError(
            "STORAGE_FAILED",
            `Could not create the store lease: ${errorMessage(error)}`
          );
        }
        const inspection = await this.inspectOwner();
        if (inspection.kind === "active") {
          return this.busy("active_remote_owner", false, inspection.owner);
        }
        if (inspection.kind === "recovery") {
          return this.busy(inspection.reason, true, inspection.owner);
        }
        if (attempt === this.maxReclaimAttempts) {
          return this.busy("owner_unverifiable", true, inspection.owner);
        }
        // 两个进程可能都读到旧的死进程；短锁下重查才能避免后到的回收者删除新写入者。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const reclaim = new StoreLease({
          leaseDir: `${this.leaseDir}.reclaim`,
          storePath: this.storePath,
          fs: this.fs,
          process: this.process,
          registry: this.registry,
          token: this.mintToken,
          now: this.now,
          maxReclaimAttempts: 0,
        });
        const claim = await reclaim.acquire();
        if (claim.kind !== "acquired") return claim;
        try {
          const latest = await this.inspectOwner();
          if (latest.kind === "active")
            return this.busy("active_remote_owner", false, latest.owner);
          if (latest.kind === "recovery") return this.busy(latest.reason, true, latest.owner);
          try {
            await this.fs.remove(this.leaseDir);
          } catch (removeError) {
            if (errorCode(removeError) !== "ENOENT") {
              throw new StoreLeaseError(
                "STORAGE_FAILED",
                `Could not reclaim the stale store lease: ${errorMessage(removeError)}`
              );
            }
          }
        } finally {
          await reclaim.release(claim.token);
        }
        continue;
      }

      const owner: StoreLeaseOwner = {
        token: this.mintToken(),
        pid: this.process.pid(),
        bootId: this.process.bootId(),
        storePath: this.storePath,
        createdAt: this.now(),
      };
      try {
        await this.fs.writeFile(leaseOwnerFile(this.leaseDir), JSON.stringify(owner));
      } catch (error) {
        await this.removeOwnLeaseDirQuietly();
        throw new StoreLeaseError(
          "STORAGE_FAILED",
          `Could not record the store lease owner: ${errorMessage(error)}`
        );
      }
      this.registry.register(this.leaseDir, owner);
      return { kind: "acquired", token: owner.token };
    }

    throw new StoreLeaseError("STORAGE_FAILED", "Could not acquire the store lease.");
  }

  async release(token: string): Promise<LeaseReleaseResult> {
    const holder = this.registry.find(this.leaseDir);
    if (holder && holder.token !== token) return { kind: "token_mismatch" };

    let owner: StoreLeaseOwner | null;
    try {
      owner = parseOwner(await this.fs.readFile(leaseOwnerFile(this.leaseDir)));
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        this.registry.unregister(this.leaseDir, token);
        return { kind: "not_held" };
      }
      return { kind: "token_mismatch" };
    }

    if (owner?.token !== token) return { kind: "token_mismatch" };

    try {
      await this.fs.remove(this.leaseDir);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        this.registry.unregister(this.leaseDir, token);
        return { kind: "not_held" };
      }
      throw new StoreLeaseError(
        "STORAGE_FAILED",
        `Could not release the store lease: ${errorMessage(error)}`
      );
    }
    this.registry.unregister(this.leaseDir, token);
    return { kind: "released" };
  }

  private async inspectOwner(): Promise<OwnerInspection> {
    let raw: string;
    try {
      raw = await this.fs.readFile(leaseOwnerFile(this.leaseDir));
    } catch (error) {
      return {
        kind: "recovery",
        reason: errorCode(error) === "ENOENT" ? "owner_incomplete" : "owner_unverifiable",
        owner: null,
      };
    }

    const owner = parseOwner(raw);
    if (!owner) return { kind: "recovery", reason: "owner_incomplete", owner: null };
    if (owner.storePath !== this.storePath) {
      return { kind: "recovery", reason: "owner_unverifiable", owner };
    }

    let currentBootId: string;
    try {
      currentBootId = this.process.bootId();
    } catch {
      return { kind: "recovery", reason: "owner_unverifiable", owner };
    }
    try {
      if (!(await this.process.isAlive(owner.pid))) return { kind: "reclaimable", owner };
      // 启动时间估算会取整漂移，重启也可能复用 PID；活进程不能仅因估算不同而被抢走存储。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      return owner.bootId === currentBootId
        ? { kind: "active", owner }
        : { kind: "recovery", reason: "owner_unverifiable", owner };
    } catch {
      return { kind: "recovery", reason: "owner_unverifiable", owner };
    }
  }

  private busy(
    reason: LeaseBusyReason,
    recoveryRequired: boolean,
    owner: StoreLeaseOwner | null
  ): LeaseAcquireResult {
    return { kind: "busy", code: "STORE_BUSY", reason, recoveryRequired, owner };
  }

  private async removeOwnLeaseDirQuietly(): Promise<void> {
    try {
      await this.fs.remove(this.leaseDir);
    } catch {
      return;
    }
  }
}
