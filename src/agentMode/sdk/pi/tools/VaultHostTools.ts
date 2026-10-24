import type { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import { createToolOutcome, type ToolOutcomePhase } from "@/agentMode/sdk/pi/tools/ToolOutcome";
import { durableToolCallId } from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { TFile, type App, type EventRef, type WorkspaceLeaf } from "obsidian";
import { parse, stringify } from "yaml";
import { logError } from "@/logger";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { sha256 } from "@/utils/hash";
import { trashFile } from "@/utils/vaultAdapterUtils";
import { compileHostToolDefinition } from "@/agentMode/sdk/pi/tools/HostToolDefinition";
import type {
  PermissionDecision,
  PermissionPrompt,
  ToolCallContent,
  TurnFileChange,
  VaultAgentMode,
} from "@/agentMode/session/types";
import { PathResolver, type PathResolution } from "@/agentMode/sdk/pi/policy/PathResolver";
import {
  PolicyEngine,
  type PolicyTargetFact,
  type PolicyCaller,
} from "@/agentMode/sdk/pi/policy/PolicyEngine";
import { defineToolManifest, type ToolManifest } from "@/agentMode/sdk/pi/policy/ToolManifest";
import {
  MutationRecovery,
  type RecoveryResult,
  type RecoveryDecision,
} from "@/agentMode/sdk/pi/storage/MutationRecovery";
import {
  MutationProjection,
  type MutationReceiptForProjection,
} from "@/agentMode/sdk/pi/events/MutationProjection";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway, type GatewayApprovalRequest } from "@/agentMode/sdk/pi/tools/ToolGateway";
import {
  VaultReadTools,
  type VaultReadToolsOptions,
} from "@/agentMode/sdk/pi/tools/VaultReadTools";
import { VaultSearch } from "@/agentMode/sdk/pi/tools/VaultSearch";
import {
  VaultSearchIndex,
  type VaultSearchFileEvent,
} from "@/agentMode/sdk/pi/tools/VaultSearchIndex";
import { VaultWriteTools } from "@/agentMode/sdk/pi/tools/VaultWriteTools";
import { VaultFrontmatter } from "@/agentMode/sdk/pi/tools/VaultFrontmatter";
import { VaultMoveTools } from "@/agentMode/sdk/pi/tools/VaultMoveTools";
import { ObsidianActions, type ObsidianLeaf } from "@/agentMode/sdk/pi/tools/ObsidianActions";
import {
  MutationCoordinator,
  type MutationIntent,
  type MutationReceipt,
} from "@/agentMode/sdk/pi/tools/MutationCoordinator";
import type {
  MutationJournal,
  MutationJournalStore,
  StoredMutation,
} from "@/agentMode/sdk/pi/storage/MutationJournal";
import { PathLockPool } from "@/agentMode/sdk/pi/tools/PathLockPool";
import {
  RevertMutation,
  type RevertReceipt,
  type RevertResult,
  type RevertSourceReceipt,
} from "@/agentMode/sdk/pi/tools/RevertMutation";
import { prepareExactPatch, type ExactPatchEdit } from "@/agentMode/sdk/pi/tools/ExactPatch";
import { type AuditLog, toSafeError } from "@/agentMode/sdk/pi/policy/AuditLog";

export interface VaultHostToolsOptions {
  readonly capabilities?: CapabilityCatalog;
  readonly audit?: Pick<AuditLog, "record">;
  readonly app: App;
  readonly vaultRoot: string;
  readonly privateDir: string;
  readonly sessionId: string;
  readonly getMode: () => VaultAgentMode;
  readonly beforeMutation?: (signal?: AbortSignal) => Promise<void>;
  readonly getModeForConversation?: (conversationId: string) => VaultAgentMode;
  readonly getCaller?: (conversationId: string) => PolicyCaller;
  readonly isReadOnly?: (conversationId: string) => boolean;
  readonly isPathInScope?: (
    path: string,
    conversationId?: string,
    access?: "read" | "write"
  ) => boolean;
  readonly requestPermission?: (prompt: PermissionPrompt) => Promise<PermissionDecision>;
  readonly onUnknownEffect?: () => Promise<void>;
  readonly onFileChanges?: (changes: readonly TurnFileChange[]) => void;
  readonly getRunId?: (conversationId?: string) => string | null;
  readonly persistFileChanges?: (
    changes: readonly TurnFileChange[],
    source: { readonly operationId: string; readonly runId?: string }
  ) => Promise<boolean>;
}

export interface VaultHostTools {
  readonly registrations: readonly ToolRegistration[];
  readonly recovery: RecoveryResult;
  reconcile(): Promise<RecoveryResult>;
  bindMutationJournal(store: MutationJournalStore): Promise<void>;
  drain(): Promise<void>;
  replayFileChanges(): Promise<void>;
  revertOperations(operationIds: readonly string[], signal?: AbortSignal): Promise<RevertResult>;
  revert(operationId: string, signal?: AbortSignal): Promise<RevertResult>;
  dispose(): void;
}

interface RenameSnapshot {
  readonly source: string;
  readonly destination: string;
  readonly before: string;
  readonly linked: readonly { readonly path: string; readonly content: string }[];
}

interface Invocation {
  readonly operationId: string;
  readonly conversationId?: string;
  readonly signal?: AbortSignal;
  readonly kind: RevertSourceReceipt["kind"];
  readonly validateBeforeWrite?: (current: string) => void;
  readonly renameSnapshot?: RenameSnapshot;
}

const VAULT_PATH_LOCKS = new PathLockPool();
const EMPTY_RECOVERY: RecoveryResult = Object.freeze({ decisions: Object.freeze([]) });

// 工具的真实读写、审批与恢复在同一入口组装，避免独立模块测试通过却没有产品调用链：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function createVaultHostTools(
  options: VaultHostToolsOptions
): Promise<VaultHostTools> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const privateDir = path.join(options.privateDir, "mutations");
  const vaultRootCanonical = await fs.realpath(options.vaultRoot);
  const relation = path.relative(path.resolve(options.vaultRoot), path.resolve(privateDir));
  if (
    relation === "" ||
    (relation !== ".." && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation))
  ) {
    throw new Error("Mutation backups must be stored outside the Vault.");
  }
  await fs.mkdir(path.join(privateDir, "blobs"), { recursive: true, mode: 0o700 });
  let journal: MutationJournal = { version: 1, mutations: {}, reverts: {} };
  let journalStore: MutationJournalStore | undefined;
  let journalBound = false;
  let saved = Promise.resolve();
  let recovery = EMPTY_RECOVERY;
  const persist = (): Promise<void> => {
    if (!journalBound) return Promise.reject(new Error("The mutation journal is not bound."));
    const snapshot = JSON.stringify(journal);
    const next = saved.then(async () => {
      if (!journalStore) throw new Error("The mutation journal is not bound.");
      await journalStore.save(JSON.parse(snapshot) as MutationJournal);
    });
    saved = next.catch(() => undefined);
    return next;
  };
  const blobWrites = new Map<string, Promise<string>>();
  const blobs = {
    put: (content: string): Promise<string> => {
      const ref = sha256(content);
      const existing = blobWrites.get(ref);
      if (existing) return existing;
      const writing = (async (): Promise<string> => {
        const blobPath = path.join(privateDir, "blobs", ref);
        try {
          const persisted = await fs.readFile(blobPath, "utf8");
          if (sha256(persisted) !== ref) throw new Error("The mutation backup is damaged.");
          return ref;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const handle = await fs.open(blobPath, "wx", 0o600);
        try {
          await handle.writeFile(content);
          await handle.sync();
        } finally {
          await handle.close();
        }
        return ref;
      })();
      blobWrites.set(ref, writing);
      void writing.then(
        () => {
          blobWrites.delete(ref);
        },
        () => {
          blobWrites.delete(ref);
        }
      );
      return writing;
    },
    flush: async (): Promise<void> => undefined,
    read: async (ref: string): Promise<string | null> => {
      if (!/^[a-f0-9]{64}$/.test(ref)) return null;
      try {
        return await fs.readFile(path.join(privateDir, "blobs", ref), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
  };
  const pathResolver = new PathResolver({
    vaultRoot: options.vaultRoot,
    protectedRoots: [path.resolve(options.vaultRoot, options.app.vault.configDir), privateDir],
    fileSystem: {
      realpath: (target) => fs.realpath(target),
      lstat: (target) => fs.lstat(target),
      stat: (target) => fs.stat(target, { bigint: true }),
    },
    path,
  });
  let disposed = false;
  const operations = new Set<Promise<void>>();
  const inScope = (
    target: string,
    conversationId?: string,
    access: "read" | "write" = "read"
  ): boolean => !disposed && (options.isPathInScope?.(target, conversationId, access) ?? true);
  const callerOf = (conversationId: string): PolicyCaller =>
    options.getCaller?.(conversationId) ??
    (conversationId === options.sessionId ? "root" : "subagent");
  const modeOf = (conversationId: string): VaultAgentMode =>
    options.getModeForConversation?.(conversationId) ??
    (callerOf(conversationId) === "root" ? options.getMode() : "plan");
  const readOnlyOf = (conversationId: string): boolean =>
    options.isReadOnly?.(conversationId) ?? callerOf(conversationId) !== "root";
  const assertCurrentAccess = (
    relative: string,
    signal?: AbortSignal,
    write = false,
    conversationId?: string
  ): void => {
    if (disposed)
      throw Object.assign(new Error("The tool session is closed."), { code: "SESSION_CLOSED" });
    if (signal?.aborted)
      throw Object.assign(new Error("The operation was cancelled."), { code: "CANCELLED" });
    if (!inScope(relative, conversationId, write ? "write" : "read"))
      throw Object.assign(new Error("The target is outside the selected scope."), {
        code: "PATH_OUT_OF_SCOPE",
      });
    if (
      write &&
      (conversationId
        ? readOnlyOf(conversationId) || modeOf(conversationId) === "plan"
        : options.getMode() === "plan")
    )
      throw Object.assign(new Error("This conversation is read-only."), { code: "READ_ONLY_MODE" });
  };
  const assertTarget = async (
    target: string,
    signal?: AbortSignal,
    write = false,
    conversationId?: string
  ): Promise<PathResolution> => {
    if (!journalBound) throw new Error("The mutation journal is not bound.");
    if (disposed)
      throw Object.assign(new Error("The tool session is closed."), { code: "SESSION_CLOSED" });
    if (signal?.aborted)
      throw Object.assign(new Error("The operation was cancelled."), { code: "CANCELLED" });
    const resolved = await pathResolver.resolveVaultPath(target);
    assertCurrentAccess(resolved.relative, signal, write, conversationId);
    if (write && options.app.vault.getAbstractFileByPath(target))
      await pathResolver.assertWritableTarget(resolved);
    assertCurrentAccess(resolved.relative, signal, write, conversationId);
    return resolved;
  };
  const fileOf = (target: string): TFile => {
    const file = options.app.vault.getAbstractFileByPath(target);
    if (!(file instanceof TFile)) throw new Error(`The note "${target}" does not exist.`);
    return file;
  };
  const read = async (target: string): Promise<string> => {
    await assertTarget(target);
    return options.app.vault.read(fileOf(target));
  };
  const exists = async (target: string): Promise<boolean> => {
    await assertTarget(target);
    return options.app.vault.getAbstractFileByPath(target) instanceof TFile;
  };
  const projection = new MutationProjection({ blobs });
  const delivered = new Set<string>();
  const publish = async (source: StoredMutation): Promise<void> => {
    if (delivered.has(source.operationId)) return;
    const receipts: MutationReceiptForProjection[] =
      source.kind === "rename"
        ? [
            {
              operationId: source.operationId,
              kind: "trash" as const,
              path: source.path,
              beforeBlobRef: source.beforeBlobRef,
              afterBlobRef: null,
              effectState: "committed" as const,
            },
            {
              operationId: source.operationId,
              kind: "create" as const,
              path: source.newPath!,
              beforeBlobRef: null,
              afterBlobRef: source.afterBlobRef,
              effectState: "committed" as const,
            },
          ]
        : [{ ...source, effectState: "committed" as const }];
    for (const file of source.files ?? [])
      receipts.push({
        operationId: source.operationId,
        kind: "write",
        path: file.path,
        beforeBlobRef: file.beforeBlobRef,
        afterBlobRef: source.linkedAfterBlobs?.[file.path] ?? null,
        effectState: "committed",
      });
    const projected = await projection.project(receipts);
    // 展示事件也要先保存；进程在 receipt 后退出时，重开只补同一事件，不再执行文件操作：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (
      options.persistFileChanges &&
      !(await options.persistFileChanges(projected.fileChanges, {
        operationId: source.operationId,
        ...(source.runId ? { runId: source.runId } : {}),
      }))
    )
      return;
    try {
      options.onFileChanges?.(projected.fileChanges);
      delivered.add(source.operationId);
    } catch (error) {
      logError("[VaultHostTools] file-change listener failed", error);
    }
  };
  const markCommitted = async (operationId: string): Promise<void> => {
    const source = journal.mutations[operationId];
    if (!source) throw new Error("Missing mutation intent.");
    journal.mutations[operationId] = {
      ...source,
      committed: true,
      state: "committed",
      effect: "applied",
      commitOrder:
        source.commitOrder ??
        Math.max(0, ...Object.values(journal.mutations).map((entry) => entry.commitOrder ?? 0)) + 1,
    };
    try {
      await persist();
    } catch (error) {
      journal.mutations[operationId] = source;
      throw error;
    }
    await publish(journal.mutations[operationId]);
  };
  const recordState = async (
    operationId: string,
    state: import("@/agentMode/sdk/pi/tools/MutationCoordinator").MutationState,
    errorCode?: string
  ): Promise<void> => {
    const source = journal.mutations[operationId];
    if (!source) throw new Error("Missing mutation intent.");
    const effect =
      state === "applying" || state === "effect_unknown" || state === "needs_reconciliation"
        ? "unknown"
        : (source.createdFolders?.length ?? 0) > 0
          ? "partially_applied"
          : "not_applied";
    journal.mutations[operationId] = {
      ...source,
      state,
      effect,
      ...(errorCode ? { errorCode } : {}),
    };
    try {
      await persist();
    } catch (error) {
      journal.mutations[operationId] = source;
      throw error;
    }
  };
  const recordUnknown = async (operationId: string): Promise<void> => {
    const source = journal.mutations[operationId];
    if (!source || source.committed) return;
    // 当前回合的确认记录丢失必须立即关闭调度入口，不能等下次打开才发现已有文件副作用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    recovery = {
      decisions: Object.freeze([
        ...recovery.decisions.filter((decision) => decision.operationId !== operationId),
        {
          operationId,
          path: source.path,
          state: "needs_reconciliation",
          action: "manual",
          canReapprove: false,
          canContinue: false,
          receiptWritten: false,
        },
      ]),
    };
    await options.onUnknownEffect?.();
  };
  const coordinatorFor = (invocation: Invocation) =>
    new MutationCoordinator({
      locks: VAULT_PATH_LOCKS,
      blobs,
      ledger: {
        saveIntent: async (intent: MutationIntent) => {
          const runId = options.getRunId?.(invocation.conversationId);
          journal.mutations[intent.operationId] = {
            operationId: intent.operationId,
            ...(runId ? { runId } : {}),
            path: path.relative(vaultRootCanonical, intent.targetPath).split(path.sep).join("/"),
            kind: invocation.kind,
            beforeHash: invocation.kind === "create" ? null : intent.beforeHash,
            beforeBlobRef: invocation.kind === "create" ? null : intent.beforeBlobRef,
            afterBlobRef: intent.afterBlobRef,
            afterHash: intent.afterHash,
            committed: false,
            state: "prepared",
            effect: "not_applied",
          };
          await persist();
        },
        saveReceipt: async (receipt: MutationReceipt) => markCommitted(receipt.operationId),
        saveState: recordState,
      },
    });
  const processContent = async (
    target: string,
    update: (content: string) => string,
    invocation: Invocation
  ): Promise<void> => {
    const resolved = await assertTarget(target, invocation.signal, true, invocation.conversationId);
    const file = fileOf(target);
    const before = await options.app.vault.read(file);
    const after = update(before);
    const coordinator = coordinatorFor(invocation);
    const prepared = await coordinator.prepare({
      operationId: invocation.operationId,
      targetPath: resolved.canonical,
      before,
      after,
    });
    if (!prepared.ok) throw Object.assign(new Error(prepared.message), { code: prepared.code });
    await coordinator.beginApproval(invocation.operationId);
    await coordinator.approve(invocation.operationId, invocation.operationId);
    const result = await coordinator.apply(invocation.operationId, {
      write: async ({ content, expectedBeforeHash }) => {
        await assertTarget(target, invocation.signal, true, invocation.conversationId);
        await pathResolver.revalidate(resolved);
        const buffer = await actions.checkOpenBuffer(target);
        if (!buffer.ok) throw Object.assign(new Error(buffer.message), { code: buffer.code });
        if (invocation.signal?.aborted)
          throw Object.assign(new Error("Cancelled before writing."), { code: "CANCELLED" });
        let accepted = false;
        try {
          await options.app.vault.process(file, (current) => {
            // 宿主等待文件锁后才调用回调，实时撤权必须在返回新内容前同步复查。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            assertCurrentAccess(target, invocation.signal, true, invocation.conversationId);
            if (invocation.signal?.aborted)
              throw Object.assign(new Error("Cancelled before writing."), { code: "CANCELLED" });
            if (sha256(current) !== expectedBeforeHash)
              throw Object.assign(new Error("The note changed."), { code: "STALE_BASELINE" });
            invocation.validateBeforeWrite?.(current);
            accepted = true;
            return content;
          });
          return { afterHash: sha256(await options.app.vault.read(fileOf(target))) };
        } catch (error) {
          if (!accepted) throw error;
          // 已把新内容交给宿主后，拒绝或验证读取失败都不能证明文件没有改变：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          throw Object.assign(new Error("无法确认宿主写入结果。"), { code: "EFFECT_UNKNOWN" });
        }
      },
    });
    if (!result.ok) {
      if (result.code === "EFFECT_UNKNOWN" || result.code === "AFTER_HASH_MISMATCH")
        await recordUnknown(invocation.operationId);
      throw Object.assign(new Error(result.message), { code: result.code });
    }
  };
  const prepareParentFolders = async (target: string, invocation: Invocation): Promise<void> => {
    const parts = target.split("/").slice(0, -1);
    for (let count = 1; count <= parts.length; count++) {
      await assertTarget(target, invocation.signal, true, invocation.conversationId);
      const folder = parts.slice(0, count).join("/");
      const resolvedFolder = await pathResolver.resolveVaultPath(folder);
      try {
        const stat = await fs.stat(resolvedFolder.canonical);
        if (stat.isDirectory()) continue;
        throw Object.assign(new Error(`父路径不是文件夹：${folder}`), { code: "PATH_CONFLICT" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await pathResolver.revalidate(resolvedFolder);
      try {
        assertCurrentAccess(target, invocation.signal, true, invocation.conversationId);
        await options.app.vault.createFolder(folder);
      } catch (error) {
        // 另一个调用可能先创建同一目录；只接受已核实的目录，不能把所有宿主异常当成功。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        try {
          if (!(await fs.stat(resolvedFolder.canonical)).isDirectory()) throw error;
        } catch (inspectionError) {
          if ((inspectionError as NodeJS.ErrnoException).code !== "ENOENT")
            throw Object.assign(new Error(`无法核实父目录：${folder}`), { code: "EFFECT_UNKNOWN" });
          throw Object.assign(
            new Error(
              `无法创建父目录 ${folder}：${error instanceof Error ? error.message : String(error)}`
            ),
            { code: (error as NodeJS.ErrnoException).code ?? "DIRECTORY_CREATE_FAILED" }
          );
        }
      }
      const source = journal.mutations[invocation.operationId];
      journal.mutations[invocation.operationId] = {
        ...source,
        createdFolders: [...(source.createdFolders ?? []), folder],
      };
      try {
        await persist();
      } catch {
        throw Object.assign(new Error("父目录已建立，但无法保存操作记录。"), {
          code: "EFFECT_UNKNOWN",
        });
      }
    }
  };
  const createContent = async (
    target: string,
    content: string,
    invocation: Invocation
  ): Promise<void> => {
    const resolved = await assertTarget(target, invocation.signal, true, invocation.conversationId);
    const coordinator = coordinatorFor(invocation);
    const prepared = await coordinator.prepare({
      operationId: invocation.operationId,
      targetPath: resolved.canonical,
      before: "",
      after: content,
    });
    if (!prepared.ok) throw Object.assign(new Error(prepared.message), { code: prepared.code });
    await coordinator.beginApproval(invocation.operationId);
    await coordinator.approve(invocation.operationId, invocation.operationId);
    const result = await coordinator.apply(invocation.operationId, {
      write: async () => {
        await assertTarget(target, invocation.signal, true, invocation.conversationId);
        await pathResolver.revalidate(resolved);
        if (options.app.vault.getAbstractFileByPath(target))
          throw Object.assign(new Error("The note already exists."), { code: "EEXIST" });
        await prepareParentFolders(target, invocation);
        await assertTarget(target, invocation.signal, true, invocation.conversationId);
        const finalTarget = await pathResolver.resolveVaultPath(target);
        await pathResolver.revalidate(finalTarget);
        assertCurrentAccess(target, invocation.signal, true, invocation.conversationId);
        try {
          await options.app.vault.create(target, content);
          return { afterHash: sha256(await options.app.vault.read(fileOf(target))) };
        } catch {
          // 创建调用一旦开始就可能已有文件，即使宿主尚未返回成功确认也必须先对账：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          throw Object.assign(new Error("无法确认宿主创建结果。"), { code: "EFFECT_UNKNOWN" });
        }
      },
    });
    if (!result.ok) {
      if (result.code === "EFFECT_UNKNOWN" || result.code === "AFTER_HASH_MISMATCH")
        await recordUnknown(invocation.operationId);
      throw Object.assign(new Error(result.message), { code: result.code });
    }
  };
  const inboundPaths = (target: string): string[] =>
    Object.entries(options.app.metadataCache.resolvedLinks)
      .filter(
        ([source, links]) =>
          source !== target && Object.prototype.hasOwnProperty.call(links, target)
      )
      .map(([source]) => source)
      .sort();
  const matchesRenameSnapshot = async (snapshot: RenameSnapshot): Promise<boolean> => {
    const linked = snapshot.linked.map((file) => file.path);
    const sameTargets = () =>
      JSON.stringify(inboundPaths(snapshot.source)) === JSON.stringify(linked);
    if (!sameTargets() || (await exists(snapshot.destination))) return false;
    if ((await read(snapshot.source)) !== snapshot.before) return false;
    for (const file of snapshot.linked) if ((await read(file.path)) !== file.content) return false;
    return sameTargets();
  };
  const moveContent = async (
    target: string,
    destination: string | undefined,
    invocation: Invocation
  ): Promise<void> => {
    const resolved = await assertTarget(target, invocation.signal, true, invocation.conversationId);
    const destinationResolved = destination
      ? await assertTarget(destination, invocation.signal, true, invocation.conversationId)
      : undefined;
    const snapshot = invocation.renameSnapshot;
    if (snapshot && !(await matchesRenameSnapshot(snapshot)))
      throw Object.assign(new Error("批准后文件或入链目标发生变化，请重新核对并批准。"), {
        code: "STALE_BASELINE",
      });
    const before = snapshot?.before ?? (await read(target));
    invocation.validateBeforeWrite?.(before);
    const linked =
      snapshot?.linked.map((file) => file.path) ?? (destination ? inboundPaths(target) : []);
    const related = await Promise.all(
      linked.map(async (file) => {
        const resolved = await assertTarget(
          file,
          invocation.signal,
          true,
          invocation.conversationId
        );
        const content =
          snapshot?.linked.find((entry) => entry.path === file)?.content ?? (await read(file));
        return {
          path: file,
          resolved,
          content,
          beforeBlobRef: await blobs.put(content),
          afterHash: sha256(content),
          attributable: true,
        };
      })
    );
    const beforeBlobRef = await blobs.put(before);
    const runId = options.getRunId?.(invocation.conversationId);
    journal.mutations[invocation.operationId] = {
      operationId: invocation.operationId,
      ...(runId ? { runId } : {}),
      path: target,
      kind: destination ? "rename" : "trash",
      ...(destination ? { newPath: destination } : {}),
      beforeHash: sha256(before),
      beforeBlobRef,
      afterBlobRef: destination ? beforeBlobRef : null,
      afterHash: destination ? sha256(before) : "",
      committed: false,
      state: "prepared",
      effect: "not_applied",
      files: related.map(({ path: file, beforeBlobRef, afterHash, attributable }) => ({
        path: file,
        beforeBlobRef,
        afterHash,
        attributable,
      })),
    };
    await persist();
    const lease = await VAULT_PATH_LOCKS.acquire([
      resolved.canonical,
      ...(destinationResolved ? [destinationResolved.canonical] : []),
      ...related.map(({ resolved }) => resolved.canonical),
    ]);
    let effectStarted = false;
    const validateMove = async (): Promise<void> => {
      await assertTarget(target, invocation.signal, true, invocation.conversationId);
      await pathResolver.revalidate(resolved);
      if (destination && destinationResolved) {
        await assertTarget(destination, invocation.signal, true, invocation.conversationId);
        await pathResolver.revalidate(destinationResolved);
        if (await exists(destination))
          throw Object.assign(new Error("The destination exists."), { code: "EEXIST" });
      }
      const buffer = await actions.checkOpenBuffer(target);
      if (!buffer.ok) throw Object.assign(new Error(buffer.message), { code: buffer.code });
      if (sha256(await read(target)) !== sha256(before))
        throw Object.assign(new Error("The note changed."), { code: "STALE_BASELINE" });
      for (const file of related) {
        await assertTarget(file.path, invocation.signal, true, invocation.conversationId);
        await pathResolver.revalidate(file.resolved);
        if (sha256(await read(file.path)) !== file.afterHash)
          throw Object.assign(new Error("A linked note changed."), { code: "STALE_BASELINE" });
      }
      // 始终核对用户实际批准的全文和入链集合，不能在等待批准后悄悄扩大目标或换成新基线。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (snapshot && !(await matchesRenameSnapshot(snapshot)))
        throw Object.assign(new Error("批准后文件或入链目标发生变化，请重新核对并批准。"), {
          code: "STALE_BASELINE",
        });
      assertCurrentAccess(target, invocation.signal, true, invocation.conversationId);
      if (destination)
        assertCurrentAccess(destination, invocation.signal, true, invocation.conversationId);
      for (const file of related)
        assertCurrentAccess(file.path, invocation.signal, true, invocation.conversationId);
    };
    try {
      await validateMove();
      if (destination) {
        // 新目录属于同一次操作；准备完成后重验两端、权限及版本，不能用准备前的事实直接移动。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        await prepareParentFolders(destination, invocation);
        await recordState(invocation.operationId, "applying");
        await validateMove();
        effectStarted = true;
        await options.app.fileManager.renameFile(fileOf(target), destination);
      } else {
        await recordState(invocation.operationId, "applying");
        await validateMove();
        effectStarted = true;
        await trashFile(options.app, fileOf(target));
      }
      const linkedAfterBlobs: Record<string, string> = {};
      const files = [];
      for (const file of related) {
        const content = await read(file.path);
        const afterHash = sha256(content);
        if (afterHash === file.afterHash) continue;
        linkedAfterBlobs[file.path] = await blobs.put(content);
        files.push({
          path: file.path,
          beforeBlobRef: file.beforeBlobRef,
          afterHash,
          attributable: true,
        });
      }
      journal.mutations[invocation.operationId] = {
        ...journal.mutations[invocation.operationId],
        files,
        linkedAfterBlobs,
      };
      await markCommitted(invocation.operationId);
    } catch (error) {
      if (!effectStarted && (error as { code?: string }).code !== "EFFECT_UNKNOWN") {
        const code = (error as { code?: string }).code ?? "WRITE_FAILED";
        await recordState(
          invocation.operationId,
          code === "STALE_BASELINE" ? "stale" : code === "CANCELLED" ? "cancelled" : "failed",
          code
        );
        if ((journal.mutations[invocation.operationId].createdFolders?.length ?? 0) > 0)
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            wrote: true,
          });
        throw error;
      }
      await recordState(invocation.operationId, "effect_unknown", "EFFECT_UNKNOWN").catch(
        () => undefined
      );
      await recordUnknown(invocation.operationId);
      throw Object.assign(new Error("无法确认宿主移动或回收结果。"), { code: "EFFECT_UNKNOWN" });
    } finally {
      lease.release();
    }
  };
  const leafIds = new WeakMap<WorkspaceLeaf, string>();
  let leafSequence = 0;
  const workspace = {
    iterateAllLeaves: (listener: (leaf: ObsidianLeaf) => void): void => {
      const focused = options.app.workspace.getMostRecentLeaf?.();
      const leaves: WorkspaceLeaf[] = [];
      options.app.workspace.iterateAllLeaves((leaf) => {
        leaves.push(leaf);
      });
      if (focused)
        leaves.sort((left, right) => (left === focused ? -1 : right === focused ? 1 : 0));
      for (const leaf of leaves) {
        const view = leaf.view as unknown as {
          file?: TFile | null;
          editor?: {
            getValue(): string;
            getCursor(which: "from" | "to"): { line: number; ch: number };
            replaceRange(
              text: string,
              from: { line: number; ch: number },
              to: { line: number; ch: number }
            ): void;
          };
        };
        const editor = view.editor;
        let leafId = leafIds.get(leaf);
        if (!leafId) {
          leafId = `${options.sessionId}:editor:${++leafSequence}`;
          leafIds.set(leaf, leafId);
        }
        listener({
          id: leafId,
          view: {
            file: view.file,
            ...(editor
              ? {
                  editor: {
                    getValue: () => editor.getValue(),
                    getSelection: () => ({
                      from: editor.getCursor("from"),
                      to: editor.getCursor("to"),
                    }),
                    replaceRange: (text, from, to) => editor.replaceRange(text, from, to),
                  },
                }
              : {}),
          },
        });
      }
    },
    openFile: async (target: string, line?: number): Promise<void> => {
      await assertTarget(target);
      await options.app.workspace.openLinkText(
        target,
        "",
        false,
        line === undefined ? undefined : { eState: { line } }
      );
    },
  };
  const actions = new ObsidianActions({
    app: { workspace },
    pathResolver,
    vault: { read },
    registeredActions: ["open_note"],
  });
  const listeners = new Set<(event: VaultSearchFileEvent) => void>();
  const emit = (event: VaultSearchFileEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const eventRefs: EventRef[] = [
    options.app.vault.on("create", (file) => emit({ type: "create", path: file.path })),
    options.app.vault.on("modify", (file) => emit({ type: "modify", path: file.path })),
    options.app.vault.on("delete", (file) => emit({ type: "delete", path: file.path })),
    options.app.vault.on("rename", (file, oldPath) =>
      emit({ type: "rename", path: file.path, oldPath })
    ),
  ];
  const events = {
    subscribe: (listener: (event: VaultSearchFileEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const searchIndex = new VaultSearchIndex({
    vault: {
      listMarkdownFiles: async () => options.app.vault.getMarkdownFiles().map((file) => file.path),
      read,
    },
    configDir: options.app.vault.configDir,
    events,
    metadata: {
      titleOf: (target) => fileOf(target).basename,
      tagsOf: (target) =>
        options.app.metadataCache.getFileCache(fileOf(target))?.tags?.map(({ tag }) => tag) ?? [],
    },
  });
  const search = new VaultSearch({ index: searchIndex });
  const readOptions: VaultReadToolsOptions = {
    vault: {
      read,
      listMarkdownFiles: async (folder) =>
        options.app.vault
          .getMarkdownFiles()
          .filter((file) => !folder || file.path.startsWith(`${folder}/`))
          .map((file) => ({ path: file.path, size: file.stat.size })),
    },
    pathResolver,
    linkCache: options.app.metadataCache,
  };
  const readTools = new VaultReadTools(readOptions);
  const baseAdapter = {
    read,
    exists,
    fileExists: exists,
    create: (target: string, content: string) =>
      createContent(target, content, { operationId: "invalid", kind: "create" }),
    process: (target: string, update: (content: string) => string) =>
      processContent(target, update, { operationId: "invalid", kind: "write" }),
    renameFile: (target: string, destination: string) =>
      moveContent(target, destination, { operationId: "invalid", kind: "rename" }),
    trashFile: (target: string) =>
      moveContent(target, undefined, { operationId: "invalid", kind: "trash" }),
  };
  const registry = new ToolRegistry();
  const yaml = { parse, stringify: (value: unknown) => stringify(value) };
  readTools.register(registry);
  search.register(registry);
  for (const manifest of actions.manifests)
    registry.register(
      manifest.toolId === "obsidian_replace_selection"
        ? defineToolManifest({ ...manifest, effects: ["write"] })
        : manifest,
      "host"
    );
  new VaultWriteTools({ vault: baseAdapter, pathResolver }).register(registry);
  new VaultFrontmatter({ vault: baseAdapter, pathResolver, yaml }).register(registry);
  new VaultMoveTools({ vault: baseAdapter, pathResolver }).register(registry);
  const reconcile = async (): Promise<RecoveryResult> => {
    if (!journalBound) throw new Error("The mutation journal is not bound.");
    const pendingMutations = Object.values(journal.mutations).filter(
      (entry) =>
        !entry.committed &&
        entry.effect !== "not_applied" &&
        !(
          entry.effect === "partially_applied" &&
          entry.state &&
          ["failed", "stale", "cancelled", "rejected"].includes(entry.state)
        )
    );
    const manualRecovery: RecoveryDecision[] = [];
    for (const entry of pendingMutations) {
      if (!inScope(entry.path) || (entry.newPath && !inScope(entry.newPath))) {
        manualRecovery.push({
          operationId: entry.operationId,
          path: entry.path,
          state: "needs_reconciliation",
          action: "manual",
          canReapprove: false,
          canContinue: false,
          receiptWritten: false,
        });
      } else if (entry.kind === "rename") {
        if (
          !(await exists(entry.path)) &&
          entry.newPath &&
          (await exists(entry.newPath)) &&
          sha256(await read(entry.newPath)) === entry.afterHash &&
          (entry.files?.length ?? 0) === 0
        ) {
          await markCommitted(entry.operationId);
          manualRecovery.push({
            operationId: entry.operationId,
            path: entry.path,
            state: "committed",
            action: "complete_receipt",
            canReapprove: false,
            canContinue: true,
            receiptWritten: true,
          });
        } else if (
          entry.newPath &&
          (entry.files?.length ?? 0) === 0 &&
          typeof entry.beforeHash === "string" &&
          /^[a-f0-9]{64}$/.test(entry.beforeHash) &&
          typeof entry.afterHash === "string" &&
          /^[a-f0-9]{64}$/.test(entry.afterHash) &&
          (await exists(entry.path)) &&
          !(await exists(entry.newPath)) &&
          sha256(await read(entry.path)) === entry.beforeHash
        ) {
          // 两端及原字节证明笔记未移动时可结束未知状态；已创建目录仍由同一凭据保留，核对绝不重放。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          await recordState(entry.operationId, "failed", "MOVE_NOT_APPLIED");
          manualRecovery.push({
            operationId: entry.operationId,
            path: entry.path,
            state: "prepared",
            action: "reapprove",
            canReapprove: true,
            canContinue: true,
            receiptWritten: false,
          });
        } else
          manualRecovery.push({
            operationId: entry.operationId,
            path: entry.path,
            state: "unsafe_blocked",
            action: "manual",
            canReapprove: false,
            canContinue: false,
            receiptWritten: false,
          });
      }
    }
    const reconciled = await new MutationRecovery({
      vault: { fileExists: exists, read },
      ledger: {
        listEntries: async () =>
          pendingMutations
            .filter((entry) => entry.kind !== "rename" && inScope(entry.path))
            .map((entry) => ({
              ...entry,
              afterHash: entry.kind === "trash" ? null : entry.afterHash,
              replay: entry.kind === "trash" ? ("unsafe" as const) : ("safe" as const),
            })),
        findReceipt: async () => undefined,
        saveReceipt: async (receipt) => markCommitted(receipt.operationId),
      },
    }).reconcile();
    recovery = {
      decisions: Object.freeze([...reconciled.decisions, ...manualRecovery]),
    };
    return recovery;
  };
  const approve = async (
    request: GatewayApprovalRequest,
    operationId: string,
    signal?: AbortSignal,
    displayId = operationId,
    renameSnapshot?: RenameSnapshot
  ): Promise<"approved" | "rejected" | "cancelled" | "unavailable"> => {
    if (!options.requestPermission) return "unavailable";
    if (signal?.aborted) return "cancelled";
    const args = { ...request.arguments };
    const content: ToolCallContent[] = [];
    if (renameSnapshot) {
      content.push(
        { type: "diff", path: renameSnapshot.source, oldText: renameSnapshot.before, newText: "" },
        {
          type: "diff",
          path: renameSnapshot.destination,
          oldText: "",
          newText: renameSnapshot.before,
        },
        ...renameSnapshot.linked.map((file) => ({
          type: "diff" as const,
          path: file.path,
          oldText: file.content,
          newText: file.content,
        }))
      );
    }
    if (request.toolId === "obsidian_replace_selection") {
      const preview = actions.previewSelectionReplacement(args, { signal });
      if (!preview.ok) return "rejected";
      content.push({
        type: "diff",
        path: preview.filePath,
        oldText: preview.before,
        newText: preview.after,
      });
    }
    if (
      request.toolId === "vault_create" &&
      typeof args.content === "string" &&
      typeof args.path === "string"
    )
      content.push({ type: "diff", path: args.path, oldText: "", newText: args.content });
    if (
      request.toolId === "vault_edit" &&
      typeof args.path === "string" &&
      Array.isArray(args.edits)
    ) {
      const before = await read(args.path);
      const prepared = prepareExactPatch({ before, edits: args.edits as ExactPatchEdit[] });
      // 审批与真实写入必须同用读取返回的完整版本，旧别名不能覆盖新的 fileVersion。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      const fileVersion = args.fileVersion ?? args.expectedHash;
      if (!prepared.ok || sha256(before) !== fileVersion) return "rejected";
      content.push({
        type: "diff",
        path: args.path,
        oldText: before,
        newText: prepared.proposal.after,
      });
    }
    if (request.toolId === "vault_frontmatter") {
      const preview = new VaultFrontmatter({
        vault: {
          read,
          process: async () => {
            throw new Error("Preview cannot write.");
          },
        },
        pathResolver,
        yaml,
        authorize: async ({ path: target, before, proposedContent }) => {
          content.push({ type: "diff", path: target, oldText: before, newText: proposedContent });
          return false;
        },
      });
      await preview.apply(args, {
        operationId: `preview:${operationId}`,
        signal,
        isPathInScope: inScope,
      });
      if (content.length === 0) return "rejected";
    }
    if (request.toolId === "vault_revert") {
      const source =
        typeof args.operationId === "string" ? journal.mutations[args.operationId] : undefined;
      if (!source?.committed) return "rejected";
      const target = source.kind === "rename" ? source.newPath! : source.path;
      const before = (await exists(target)) ? await read(target) : "";
      const after = source.beforeBlobRef ? await blobs.read(source.beforeBlobRef) : "";
      if (after === null) return "rejected";
      content.push({
        type: "diff",
        path: target,
        oldText: before,
        newText: source.kind === "create" ? "" : after,
      });
      for (const file of source.files ?? []) {
        const backup = file.beforeBlobRef ? await blobs.read(file.beforeBlobRef) : null;
        if (backup === null) return "rejected";
        content.push({
          type: "diff",
          path: file.path,
          oldText: await read(file.path),
          newText: backup,
        });
      }
    }
    if (signal?.aborted) return "cancelled";
    const pending = options.requestPermission({
      sessionId: options.sessionId,
      signal,
      binding: {
        toolId: request.toolId,
        schemaHash: request.manifest.schemaHash,
        targets: request.targets.map((target) => target.value),
        beforeHash: sha256(
          JSON.stringify(
            content
              .filter((part) => part.type === "diff")
              .map((part) => ({ path: part.path, oldText: part.oldText }))
          )
        ),
        scopeVersion: request.scopeVersion,
        policyVersion: request.policyVersion,
      },
      toolCall: {
        toolCallId: displayId,
        title: request.toolId,
        kind: request.toolId.includes("trash") ? "delete" : "edit",
        status: "pending",
        rawInput: { ...args, affectedPaths: request.targets.map((target) => target.value) },
        ...(content.length ? { content } : {}),
      },
      options: [
        { optionId: "allow_once", name: "允许这一次", kind: "allow_once" },
        { optionId: "reject_once", name: "拒绝", kind: "reject_once" },
      ],
    });
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<PermissionDecision>((resolve) => {
      onAbort = () => resolve({ outcome: { outcome: "cancelled" } });
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
    let decision: PermissionDecision;
    try {
      decision = await Promise.race([pending, cancelled]);
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted || decision.outcome.outcome === "cancelled") return "cancelled";
    return decision.outcome.optionId === "allow_once" ? "approved" : "rejected";
  };
  const execute = async (
    manifest: ToolManifest,
    args: Record<string, unknown>,
    operationId: string,
    signal?: AbortSignal,
    conversationId?: string,
    renameSnapshot?: RenameSnapshot
  ) => {
    const invocation: Invocation = {
      operationId,
      conversationId,
      renameSnapshot,
      kind:
        manifest.toolId === "vault_create"
          ? "create"
          : manifest.toolId === "vault_frontmatter"
            ? "frontmatter"
            : manifest.toolId === "vault_rename"
              ? "rename"
              : manifest.toolId === "vault_trash"
                ? "trash"
                : "write",
      signal,
      ...(["vault_rename", "vault_trash"].includes(manifest.toolId) &&
      typeof (args.fileVersion ?? args.expectedHash) === "string"
        ? {
            validateBeforeWrite: (current: string) => {
              if (sha256(current) !== (args.fileVersion ?? args.expectedHash))
                throw Object.assign(new Error("The note changed since it was read."), {
                  code: "STALE_BASELINE",
                });
            },
          }
        : {}),
    };
    const context = {
      operationId,
      signal,
      isPathInScope: (target: string) =>
        inScope(
          target,
          conversationId,
          manifest.effects.some((effect) =>
            ["write", "rename", "trash", "create", "delete"].includes(effect)
          )
            ? "write"
            : "read"
        ),
    };
    const adapter = {
      ...baseAdapter,
      create: (target: string, content: string) => createContent(target, content, invocation),
      process: (target: string, update: (content: string) => string) =>
        processContent(target, update, invocation),
      renameFile: (target: string, destination: string) =>
        moveContent(target, destination, invocation),
      trashFile: (target: string) => moveContent(target, undefined, invocation),
    };
    const writes = new VaultWriteTools({ vault: adapter, pathResolver });
    const frontmatter = new VaultFrontmatter({ vault: adapter, pathResolver, yaml });
    const moves = new VaultMoveTools({
      vault: adapter,
      pathResolver,
      linkCache: options.app.metadataCache,
      events,
    });
    switch (manifest.toolId) {
      case "vault_list":
        return readTools.list(args, context);
      case "vault_read": {
        const outcome = createToolOutcome({
          operationId,
          toolId: manifest.toolId,
          caller: callerOf(conversationId ?? options.sessionId),
          success: true,
          effect: "applied",
        });
        // SDK 按最终文字裁切；必须精确扣除当前操作的公共外壳，不能裁坏正文后面的完整版本或游标。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        const envelopeBytes = new TextEncoder().encode(JSON.stringify({ outcome })).length - 1;
        return new VaultReadTools({
          ...readOptions,
          maxReadBytes: manifest.maxOutputBytes - envelopeBytes,
        }).read(args, context);
      }
      case "vault_links":
        return readTools.links(args, context);
      case "vault_search":
        return search.search(args, context);
      case "vault_create":
        return writes.create(args, context);
      case "vault_edit":
        return writes.edit(args, context);
      case "vault_frontmatter":
        return frontmatter.apply(args, context);
      case "vault_rename":
        return moves.rename(args, context);
      case "vault_trash":
        return moves.trash(args, context);
      case "obsidian_open_note":
        return actions.openNote(args, context);
      case "obsidian_get_selection": {
        const selected = await actions.getSelection(args, context);
        if (selected.ok)
          await assertTarget(selected.snapshot.filePath, signal, false, conversationId);
        return selected;
      }
      case "obsidian_replace_selection": {
        const preview = actions.previewSelectionReplacement(args, context);
        if (!preview.ok) return preview;
        // 选区也必须走同一写入回执和回退链；在宿主 CAS 回调内重验原叶片、完整缓冲区与范围，不能先改编辑器再补记录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        await processContent(
          preview.filePath,
          (current) => {
            if (current !== preview.before)
              throw Object.assign(new Error("请先保存当前编辑内容，再重新读取选区。"), {
                code: "OPEN_BUFFER_CONFLICT",
              });
            return preview.after;
          },
          {
            ...invocation,
            validateBeforeWrite: (current) => {
              const latest = actions.previewSelectionReplacement(args, context);
              if (!latest.ok || latest.before !== current || latest.after !== preview.after)
                throw Object.assign(new Error("选区或编辑内容已经变化，请重新读取并批准。"), {
                  code: "STALE_BASELINE",
                });
            },
          }
        );
        return {
          ok: true,
          filePath: preview.filePath,
          newContentHash: sha256(preview.after),
          receipt: journal.mutations[operationId],
        };
      }
      default:
        return actions.runAction(args, context);
    }
  };
  const registrations = registry.listDescriptions().map(({ toolId }): ToolRegistration => {
    const manifest = registry.requireManifest(toolId);
    const writesTargets = manifest.effects.some((effect) =>
      ["write", "create", "rename", "delete", "trash"].includes(effect)
    );
    return compileHostToolDefinition(
      {
        ...manifest,
        description: manifest.description,
        parameters: manifest.parameters,
        replay: manifest.replayPolicy === "unsafe" ? "unsafe" : "safe",
        outputLimits: { maxBytes: manifest.maxOutputBytes },
        execute: async (args, api, context) => {
          const signal = context.abortSignal;
          const conversationId = String(api.conversationId ?? options.sessionId);
          // 供应商可跨轮复用 callId，真实操作必须绑定 SDK 任务。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          const operationId =
            api.taskId === undefined
              ? `${options.sessionId}:${conversationId}:${api.callId}`
              : `vault-task:${options.sessionId}:${conversationId}:${api.taskId}`;
          const reviewedMode = modeOf(conversationId);
          try {
            if (!journalBound) throw new Error("The mutation journal is not bound.");
            if (disposed)
              throw Object.assign(new Error("The tool session is closed."), {
                code: "SESSION_CLOSED",
              });
            if (typeof args !== "object" || args === null || Array.isArray(args))
              throw Object.assign(new Error("Tool arguments must be an object."), {
                code: "INVALID_ARGUMENT",
              });
            const parameters = args as Record<string, unknown>;
            if (
              journal.mutations[operationId] &&
              !journal.mutations[operationId].committed &&
              recovery.decisions.some(
                (entry) => entry.operationId === operationId && !entry.canReapprove
              )
            )
              throw Object.assign(
                new Error("The previous effect requires manual reconciliation."),
                {
                  code: "EFFECT_UNKNOWN",
                }
              );
            if (journal.mutations[operationId]?.committed) {
              await publish(journal.mutations[operationId]);
              return {
                output: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      ok: true,
                      alreadyApplied: true,
                      receipt: journal.mutations[operationId],
                    }),
                  },
                ],
                details: JSON.parse(
                  JSON.stringify({
                    outcome: createToolOutcome({
                      operationId,
                      toolId,
                      caller: callerOf(conversationId),
                      success: true,
                      effect: "applied",
                      data: { alreadyApplied: true, receipt: journal.mutations[operationId] },
                      receipts: [operationId],
                    }),
                  })
                ),
              };
            }
            const resolved: PathResolution[] = [];
            for (const target of manifest.extractTargets(args))
              if (target.kind === "vault_path")
                resolved.push(
                  await assertTarget(target.value, signal, writesTargets, conversationId)
                );
            let renameSnapshot: RenameSnapshot | undefined;
            if (
              toolId === "vault_rename" &&
              typeof parameters.path === "string" &&
              typeof parameters.newPath === "string"
            ) {
              const linked = [];
              const before = await read(parameters.path);
              for (const source of inboundPaths(parameters.path)) {
                resolved.push(await assertTarget(source, signal, writesTargets, conversationId));
                linked.push({ path: source, content: await read(source) });
              }
              renameSnapshot = {
                source: parameters.path,
                destination: parameters.newPath,
                before,
                linked,
              };
            }
            const targets: PolicyTargetFact[] = resolved.map((target) => ({
              kind: "vault_path",
              value: target.relative,
              insideScope: inScope(
                target.relative,
                conversationId,
                writesTargets ? "write" : "read"
              ),
            }));
            const gateway = new ToolGateway({
              audit: options.audit,
              registry,
              policy: new PolicyEngine(),
              requestApproval: (request) =>
                approve(
                  request,
                  operationId,
                  signal,
                  durableToolCallId(options.sessionId, api.taskId, api.callId),
                  renameSnapshot
                ),
              isScopeActive: () =>
                !disposed && modeOf(conversationId) === reviewedMode && !readOnlyOf(conversationId),
              revalidateTargets: async () => {
                if (renameSnapshot && !(await matchesRenameSnapshot(renameSnapshot))) return false;
                for (const target of resolved) {
                  await pathResolver.revalidate(target);
                  await assertTarget(target.relative, signal, writesTargets, conversationId);
                }
                return true;
              },
            });
            gateway.registerTool({
              toolId,
              manifest,
              execute: async (toolArgs) => {
                if (writesTargets) await options.beforeMutation?.(signal);
                let finish!: () => void;
                const operation = new Promise<void>((resolve) => {
                  finish = resolve;
                });
                operations.add(operation);
                try {
                  const result = await execute(
                    manifest,
                    toolArgs,
                    operationId,
                    signal,
                    conversationId,
                    renameSnapshot
                  );
                  const mutation = journal.mutations[operationId];
                  const outcome = createToolOutcome({
                    operationId,
                    toolId,
                    caller: callerOf(conversationId),
                    success: result.ok,
                    effect:
                      mutation?.effect ??
                      (result.ok
                        ? manifest.effects.some(
                            (effect) => effect !== "read" && effect !== "network"
                          )
                          ? "applied"
                          : "not_applied"
                        : "code" in result && result.code === "EFFECT_UNKNOWN"
                          ? "unknown"
                          : "wrote" in result && result.wrote
                            ? "partially_applied"
                            : "not_applied"),
                    data: result,
                    truncated:
                      result.ok &&
                      "value" in result &&
                      (result.value as { truncated?: boolean } | undefined)?.truncated === true,
                    ...(result.ok
                      ? {}
                      : {
                          error: {
                            code: "code" in result ? String(result.code) : "TOOL_EXECUTION_FAILED",
                            phase: "verification" as const,
                            message: "message" in result ? String(result.message) : "操作未完成。",
                          },
                        }),
                    receipts:
                      mutation?.committed || journal.reverts[operationId] ? [operationId] : [],
                  });
                  const metadata = { ...outcome, data: undefined };
                  return {
                    content: JSON.stringify({ ...result, outcome: metadata }),
                    isError: !result.ok,
                    outcome,
                  };
                } finally {
                  operations.delete(operation);
                  finish();
                }
              },
            });
            const result = await gateway.executeTool(toolId, parameters, {
              operationId,
              caller: callerOf(conversationId),
              mode: reviewedMode,
              scope: {
                vaultRoot: options.vaultRoot,
                readOnly: readOnlyOf(conversationId),
              },
              scopeVersion: 1,
              policyVersion: 1,
              targets,
              signal,
            });
            return result.decision === "allow"
              ? {
                  output: [{ type: "text", text: result.content }],
                  isError: result.isError,
                  details: JSON.parse(JSON.stringify({ outcome: result.outcome })),
                }
              : {
                  output: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        ok: false,
                        code: result.code,
                        message: result.message,
                        outcome: result.outcome,
                      }),
                    },
                  ],
                  isError: true,
                  details: JSON.parse(JSON.stringify({ outcome: result.outcome })),
                };
          } catch (error) {
            const code = (error as { code?: string }).code ?? "TOOL_EXECUTION_FAILED";
            const rejectedResult = (
              failureCode: string,
              message: string,
              phase: ToolOutcomePhase
            ) => {
              const mutation = journal.mutations[operationId];
              // 展示或审计保存失败不能抹掉真实提交，已保存凭据与明确未执行的事实优先于异常名称。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
              const outcome = createToolOutcome({
                operationId,
                toolId,
                caller: callerOf(conversationId),
                success: false,
                effect: mutation?.committed
                  ? "applied"
                  : (mutation?.effect ??
                    (mutation || failureCode === "EFFECT_UNKNOWN" ? "unknown" : "not_applied")),
                receipts: mutation?.committed || journal.reverts[operationId] ? [operationId] : [],
                error: { code: failureCode, phase, message },
              });
              return {
                output: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({ ok: false, code: failureCode, message }),
                  },
                ],
                isError: true,
                details: JSON.parse(JSON.stringify({ outcome })),
              };
            };
            try {
              await options.audit?.record({
                operationId,
                actor: callerOf(conversationId) === "root" ? "root" : "child",
                toolId,
                arguments: args,
                targets: [],
                effects: manifest.effects,
                decision: signal?.aborted ? "cancelled" : "deny",
                status: signal?.aborted ? "cancelled" : "rejected",
              });
            } catch {
              return rejectedResult(
                "AUDIT_FAILED",
                toSafeError("AUDIT_FAILED").message,
                "persistence"
              );
            }
            const safe = toSafeError(code);
            return rejectedResult(
              code,
              safe.code === "INTERNAL_ERROR"
                ? error instanceof Error
                  ? error.message
                  : "工具执行失败。"
                : safe.message,
              ["EIO", "ENOSPC", "EROFS", "STORAGE_FAILED"].includes(code)
                ? "persistence"
                : code === "STALE_BASELINE" || code === "EFFECT_UNKNOWN"
                  ? "verification"
                  : journal.mutations[operationId]
                    ? "execution"
                    : "review"
            );
          }
        },
      },
      options.capabilities
    );
  });
  const performRevert = async (
    operationId: string,
    signal?: AbortSignal
  ): Promise<RevertResult> => {
    const source = journal.mutations[operationId];
    if (!source?.committed)
      return { ok: false, code: "NOT_FOUND", message: "没有可回退的修改记录。" };
    if (options.getMode() === "plan")
      return { ok: false, code: "PERMISSION_DENIED", message: "计划模式不能修改笔记。" };
    // 回退同样绑定所有真实文件端点，关联补偿也不能仅凭 operationId 脱离当前范围：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const resolved = await Promise.all(
      [
        ...new Set([
          source.path,
          ...(source.newPath ? [source.newPath] : []),
          ...(source.files ?? []).map((file) => file.path),
        ]),
      ].map((target) => assertTarget(target, signal, true))
    );
    const request = {
      toolId: "vault_revert",
      arguments: {
        operationId,
        path: source.path,
        ...(source.newPath ? { newPath: source.newPath } : {}),
      },
      manifest: registry.requireManifest("vault_edit"),
      targets: resolved.map(
        (target): PolicyTargetFact => ({
          kind: "vault_path",
          value: target.relative,
          insideScope: inScope(target.relative),
        })
      ),
      scopeVersion: 1,
      policyVersion: 1,
    };
    const revertId = `revert:${operationId}`;
    const approveRevert = async () => {
      const decision = await approve(request, revertId, signal);
      await options.audit?.record({
        operationId: revertId,
        actor: "root",
        toolId: "vault_revert",
        arguments: request.arguments,
        targets: request.targets.map((target) => target.value),
        effects: ["write"],
        decision:
          decision === "approved" ? "allow" : decision === "cancelled" ? "cancelled" : "deny",
        status:
          decision === "approved"
            ? "approved"
            : decision === "cancelled"
              ? "cancelled"
              : "rejected",
      });
      return decision === "approved";
    };
    const invocation: Invocation = {
      operationId: revertId,
      kind: source.kind === "trash" ? "create" : "write",
      signal,
    };
    if (source.kind === "rename") {
      if (journal.reverts[revertId])
        return { ok: true, receipt: journal.reverts[revertId], alreadyReverted: true };
      if (!(await approveRevert()))
        return { ok: false, code: "PERMISSION_DENIED", message: "回退没有得到批准。" };
      const destination = source.newPath!;
      if ((await exists(source.path)) || sha256(await read(destination)) !== source.afterHash)
        return { ok: false, code: "CONFLICT", message: "笔记已更改，不能安全撤回重命名。" };
      for (const file of source.files ?? [])
        if (sha256(await read(file.path)) !== file.afterHash)
          return { ok: false, code: "CONFLICT", message: "关联笔记已更改，不能安全撤回重命名。" };
      await moveContent(destination, source.path, { ...invocation, kind: "rename" });
      for (const file of source.files ?? []) {
        const before = file.beforeBlobRef ? await blobs.read(file.beforeBlobRef) : null;
        const current = await read(file.path);
        if (before === null)
          return {
            ok: false,
            code: "PARTIAL",
            message: "关联笔记备份缺失；已停止回退。",
            wrote: true,
          };
        if (current === before) continue;
        if (sha256(current) !== file.afterHash)
          return {
            ok: false,
            code: "PARTIAL",
            message: "关联笔记在回退期间发生变化；已停止回退。",
            wrote: true,
          };
        await processContent(
          file.path,
          (latest) => {
            if (sha256(latest) !== file.afterHash)
              throw Object.assign(new Error("The linked note changed."), {
                code: "STALE_BASELINE",
              });
            return before;
          },
          { ...invocation, operationId: `${revertId}:linked:${sha256(file.path)}` }
        );
      }
      const receipt: RevertReceipt = {
        operationId: revertId,
        revertOf: operationId,
        kind: "revert",
        mode: "restore",
        files: [{ path: source.path, action: "restored" }],
        status: "committed",
        committedAtMs: Date.now(),
      };
      journal.reverts[revertId] = receipt;
      await persist();
      return { ok: true, receipt };
    }
    const reverter = new RevertMutation({
      blobs,
      vault: {
        read,
        fileExists: exists,
        process: (target, update) => processContent(target, update, invocation),
        create: (target, content) => createContent(target, content, invocation),
        trashFile: (target) => moveContent(target, undefined, { ...invocation, kind: "trash" }),
      },
      receipts: {
        find: async (id) => journal.reverts[id],
        save: async (receipt) => {
          journal.reverts[receipt.operationId] = receipt;
          await persist();
        },
      },
      sourceReceipts: { find: async (id) => journal.mutations[id] },
      authorize: approveRevert,
    });
    return reverter.revert({ originalOperationId: operationId, operationId: revertId }, { signal });
  };
  const revertFailure = (error: unknown, signal?: AbortSignal): RevertResult => {
    const unknown = (error as { code?: string }).code === "EFFECT_UNKNOWN";
    // 停止或已完成的部分补偿都不能掩盖宿主丢失确认，界面必须继续显示待核对结果。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    return {
      ok: false,
      code: unknown ? "EFFECT_UNKNOWN" : signal?.aborted ? "CANCELLED" : "FAILED",
      message: error instanceof Error ? error.message : "回退失败。",
      ...(unknown ? { wrote: true } : {}),
    };
  };
  const auditedRevert = async (
    operationId: string,
    signal?: AbortSignal
  ): Promise<RevertResult> => {
    let result: RevertResult;
    try {
      result = await performRevert(operationId, signal);
    } catch (error) {
      if ((error as { code?: string }).code === "AUDIT_FAILED")
        return { ok: false, code: "AUDIT_FAILED", message: toSafeError("AUDIT_FAILED").message };
      result = revertFailure(error, signal);
    }
    const source = journal.mutations[operationId];
    try {
      await options.audit?.record({
        operationId: `revert:${operationId}`,
        actor: "root",
        toolId: "vault_revert",
        arguments: { operationId },
        targets: source ? [source.path, ...(source.newPath ? [source.newPath] : [])] : [],
        effects: ["write"],
        decision: result.ok ? "allow" : signal?.aborted ? "cancelled" : "deny",
        status: result.ok
          ? result.alreadyReverted
            ? "skipped"
            : "executed"
          : signal?.aborted
            ? "cancelled"
            : "failed",
      });
    } catch {
      return {
        ok: false,
        code: "AUDIT_FAILED",
        message: "审计记录保存失败。回退可能已经发生，请核对原记录，勿重复执行。",
        ...(result.ok || result.wrote ? { wrote: true } : {}),
      };
    }
    return result;
  };
  return {
    registrations: Object.freeze(registrations),
    get recovery() {
      return recovery;
    },
    bindMutationJournal: async (store) => {
      if (journalStore) throw new Error("The mutation journal is already bound.");
      const persisted = await store.load();
      const current = persisted ?? { version: 1, mutations: {}, reverts: {} };
      if (current.version !== 1 || !current.mutations || !current.reverts)
        throw new Error("Unsupported mutation journal.");
      if (!persisted) await store.save(current);
      journal = current;
      journalStore = store;
      journalBound = true;
      await reconcile();
    },
    drain: async () => {
      await Promise.all([...operations]);
    },
    reconcile,
    replayFileChanges: async () => {
      for (const source of Object.values(journal.mutations))
        if (source.committed) await publish(source);
    },
    revertOperations: async (operationIds, signal) => {
      // 文件卡合并了同一路径的真实提交，必须按账本顺序逆向补偿，不能让前端猜测先后或伪造原子回退：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (
        !Array.isArray(operationIds) ||
        operationIds.length === 0 ||
        operationIds.length > 100 ||
        operationIds.some((id) => typeof id !== "string" || !journal.mutations[id]?.committed)
      )
        return {
          ok: false,
          code: "INVALID_ARGUMENT",
          message: "回退必须引用当前聊天中已确认的修改记录。",
        };
      const selected = new Set(operationIds);
      const ordered = Object.keys(journal.mutations)
        .map((id, index) => ({ id, order: journal.mutations[id].commitOrder ?? index }))
        .filter(({ id }) => selected.has(id))
        .sort((left, right) => right.order - left.order)
        .map(({ id }) => id);
      const revertedOperationIds: string[] = [];
      let last: Extract<RevertResult, { ok: true }> | undefined;
      for (const id of ordered) {
        let result: RevertResult;
        try {
          result = signal?.aborted
            ? { ok: false, code: "CANCELLED", message: "回退已停止。" }
            : await auditedRevert(id, signal);
        } catch (error) {
          result = revertFailure(error, signal);
        }
        if (!result.ok)
          return revertedOperationIds.length
            ? {
                ...result,
                code:
                  result.code === "CANCELLED" || result.code === "EFFECT_UNKNOWN"
                    ? result.code
                    : "PARTIAL",
                message: `回退已停止，已有 ${revertedOperationIds.length} 项恢复；其余内容未继续操作。${result.message}`,
                revertedOperationIds: Object.freeze([...revertedOperationIds]),
                wrote: true,
              }
            : result;
        revertedOperationIds.push(id);
        last = result;
      }
      return { ...last!, revertedOperationIds: Object.freeze(revertedOperationIds) };
    },
    revert: async (operationId, signal) => {
      try {
        return await auditedRevert(operationId, signal);
      } catch (error) {
        return revertFailure(error, signal);
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      searchIndex.dispose();
      listeners.clear();
      blobWrites.clear();
      for (const ref of eventRefs) options.app.vault.offref(ref);
      saved.catch((error) => logError("[VaultHostTools] mutation persistence failed", error));
    },
  };
}
