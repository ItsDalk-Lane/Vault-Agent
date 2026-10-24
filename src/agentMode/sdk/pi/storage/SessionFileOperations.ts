import {
  StoreLocator,
  HOST_ROOT_ID_PATTERN,
  assertHostRootId,
} from "@/agentMode/sdk/pi/storage/StoreLocator";
import { StoreLease } from "@/agentMode/sdk/pi/storage/StoreLease";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { t } from "@/i18n";
import type { LocalStoragePaths } from "@/agentMode/session/types";

export class SessionFileOperations {
  readonly paths: LocalStoragePaths;
  private readonly fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  private readonly path = requireNodeModule<typeof import("node:path")>("node:path");

  constructor(private readonly locator: StoreLocator) {
    const vaultStoreRoot = locator.vaultStoreRoot;
    this.paths = {
      dataRoot: locator.dataRoot,
      vaultStoreRoot,
      sessionsRoot: this.path.join(vaultStoreRoot, "sessions"),
      indexPath: this.path.join(vaultStoreRoot, "agent-chat-index.json"),
      deletionsRoot: this.path.join(vaultStoreRoot, "deletions"),
      logsRoot: this.path.join(locator.dataRoot, "logs", this.path.basename(vaultStoreRoot)),
      tempRoot: this.path.join(locator.dataRoot, "tmp"),
    };
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.fs.mkdir(this.paths.sessionsRoot, { recursive: true, mode: 0o700 }),
      this.fs.mkdir(this.path.join(this.paths.vaultStoreRoot, "locks"), {
        recursive: true,
        mode: 0o700,
      }),
      this.fs.mkdir(this.paths.deletionsRoot, { recursive: true, mode: 0o700 }),
    ]);
  }

  async rootIds(): Promise<string[]> {
    const entries = await this.fs
      .readdir(this.paths.sessionsRoot, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as import("node:fs").Dirent[];
        throw error;
      });
    return entries
      .filter((entry) => entry.isDirectory() && HOST_ROOT_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  }

  async ownerId(sessionId: string): Promise<string> {
    assertHostRootId(sessionId);
    try {
      await this.fs.access(this.path.join(this.paths.sessionsRoot, sessionId, "session.json"));
      return sessionId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const ownerId of await this.rootIds()) {
      try {
        await this.fs.access(
          this.path.join(this.paths.sessionsRoot, ownerId, "children", sessionId, "session.json")
        );
        return ownerId;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return sessionId;
  }

  async withLease<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    await this.initialize();
    const paths = this.locator.sessionStorePaths(sessionId);
    const lease = new StoreLease({ leaseDir: paths.leaseDir, storePath: paths.storeDir });
    const acquired = await lease.acquire();
    if (acquired.kind !== "acquired")
      throw Object.assign(new Error(t("localData.sessionBusy")), { code: "STORE_BUSY" });
    try {
      return await operation();
    } finally {
      await lease.release(acquired.token);
    }
  }

  async remove(sessionId: string): Promise<void> {
    assertHostRootId(sessionId);
    await this.withLease(sessionId, async () => {
      const source = this.path.join(this.paths.sessionsRoot, sessionId);
      const pending = this.path.join(this.paths.deletionsRoot, sessionId);
      // 删除标记与写入租约都在会话外，崩溃或旧窗口迟到都不能把半删记录重新打开。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      try {
        await this.fs.rename(source, pending);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await this.fs.rm(pending, { recursive: true, force: true });
      } catch (cause) {
        throw Object.assign(new Error(t("localData.deletionIncomplete")), {
          code: "SESSION_DELETE_INCOMPLETE",
          cause,
        });
      }
    });
  }

  async finishPendingDeletes(): Promise<void> {
    await this.initialize();
    const entries = await this.fs.readdir(this.paths.deletionsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !HOST_ROOT_ID_PATTERN.test(entry.name)) continue;
      try {
        await this.remove(entry.name);
      } catch (error) {
        if ((error as { code?: string }).code !== "STORE_BUSY") throw error;
      }
    }
  }

  /** 逐轮分叉沿用整聊分叉的附件副本：源无附件时静默跳过。https://github.com/ItsDalk-Lane/Vault-Agent/issues/12 */
  async copyAttachments(sourceId: string, targetId: string): Promise<void> {
    assertHostRootId(sourceId);
    assertHostRootId(targetId);
    const source = this.path.join(this.paths.sessionsRoot, sourceId, "attachments");
    try {
      await this.fs.access(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return;
    }
    await this.fs.cp(source, this.path.join(this.paths.sessionsRoot, targetId, "attachments"), {
      recursive: true,
    });
  }

  async fork(
    sourceId: string,
    targetId: string,
    metadata: string,
    sourceLeaseHeld = false
  ): Promise<void> {
    assertHostRootId(sourceId);
    assertHostRootId(targetId);
    const copy = () =>
      this.withLease(targetId, async () => {
        const source = this.path.join(this.paths.sessionsRoot, sourceId);
        const target = this.path.join(this.paths.sessionsRoot, targetId);
        const temporary = this.path.join(this.paths.sessionsRoot, `.fork-${targetId}`);
        await this.fs.access(this.path.join(source, "session.json")).catch((cause) => {
          throw Object.assign(new Error(t("localData.sessionMissing")), {
            code: "SESSION_NOT_FOUND",
            cause,
          });
        });
        try {
          await this.fs.cp(source, temporary, {
            recursive: true,
            errorOnExist: true,
            force: false,
            filter: (file) => !file.endsWith(".tmp") && !file.endsWith(".reclaim"),
          });
          const forkMetadata = JSON.parse(metadata) as Record<string, unknown> & {
            forkChildSessionIds?: Record<string, string>;
          };
          const childSessionIds: Record<string, string> = {};
          await this.fs.rm(this.path.join(temporary, "recovery-view.json"), { force: true });
          const children = await this.fs
            .readdir(this.path.join(temporary, "children"))
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return [];
              throw error;
            });
          for (const childId of children) {
            const file = this.path.join(
              temporary,
              "children",
              assertHostRootId(childId),
              "session.json"
            );
            const child = JSON.parse(await this.fs.readFile(file, "utf8")) as Record<
              string,
              unknown
            >;
            const nextId = `root-${requireNodeModule<typeof import("node:crypto")>("node:crypto").randomUUID()}`;
            childSessionIds[childId] = nextId;
            await this.fs.writeFile(
              file,
              JSON.stringify({ ...child, sessionId: nextId, parentSessionId: targetId }),
              { mode: 0o600 }
            );
            await this.fs.rename(
              this.path.dirname(file),
              this.path.join(temporary, "children", nextId)
            );
          }
          // 历史中的候选标识保持原样；副本用附属映射定位自己的子会话，连续分叉也不能回指祖先。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          if (children.length)
            forkMetadata.forkChildSessionIds = {
              ...Object.fromEntries(
                Object.entries(forkMetadata.forkChildSessionIds ?? {}).map(
                  ([ancestor, current]) => [ancestor, childSessionIds[current] ?? current]
                )
              ),
              ...childSessionIds,
            };
          await this.fs.writeFile(
            this.path.join(temporary, "session.json"),
            JSON.stringify(forkMetadata),
            { mode: 0o600 }
          );
          await this.fs.rename(temporary, target);
        } finally {
          await this.fs.rm(temporary, { recursive: true, force: true });
        }
      });
    if (sourceLeaseHeld) await copy();
    else await this.withLease(sourceId, copy);
  }
}
