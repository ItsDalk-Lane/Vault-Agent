import { logError, logInfo, logWarn } from "@/logger";
import type VaultAgentPlugin from "@/main";
import { App, FileSystemAdapter, Platform } from "obsidian";
import type { BackendDescriptor, BackendId, BackendModelCatalog, BackendProcess } from "./types";

export interface WarmBackend {
  proc: BackendProcess;
}

export class AgentModelPreloader {
  private readonly warm = new Map<BackendId, WarmBackend>();
  private readonly modelCatalogCache = new Map<BackendId, BackendModelCatalog>();
  private readonly inflight = new Map<BackendId, Promise<void>>();
  private readonly pendingRefresh = new Set<BackendId>();
  private readonly listeners = new Set<() => void>();
  private readonly warmExitUnsubs = new Map<BackendId, () => void>();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly plugin: VaultAgentPlugin,
    private readonly resolveDescriptor: (id: BackendId) => BackendDescriptor | undefined,
    private readonly beforeBackendStart?: (id: BackendId) => Promise<void>
  ) {}

  getCachedModelCatalog(backendId: BackendId): BackendModelCatalog | null {
    return this.modelCatalogCache.get(backendId) ?? null;
  }

  clearCached(backendId: BackendId): void {
    if (this.disposed) return;
    let changed = false;
    if (this.modelCatalogCache.delete(backendId)) changed = true;
    const warm = this.warm.get(backendId);
    if (warm) {
      this.warm.delete(backendId);
      this.warmExitUnsubs.get(backendId)?.();
      this.warmExitUnsubs.delete(backendId);
      warm.proc.shutdown().catch((e) => {
        logWarn(`[AgentMode] preload clearCached: shutdown of warm ${backendId} failed`, e);
      });
      changed = true;
    }
    if (changed) this.notify();
  }

  takeWarm(backendId: BackendId): WarmBackend | null {
    const entry = this.warm.get(backendId);
    if (!entry) return null;
    this.warm.delete(backendId);
    this.warmExitUnsubs.get(backendId)?.();
    this.warmExitUnsubs.delete(backendId);
    return entry;
  }

  getWarmProcs(): Array<{ backendId: BackendId; proc: BackendProcess }> {
    return Array.from(this.warm.entries(), ([backendId, entry]) => ({
      backendId,
      proc: entry.proc,
    }));
  }

  preload(backendId: BackendId): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const existing = this.inflight.get(backendId);
    if (existing) return existing;
    return this.startLoadChain(backendId);
  }

  refresh(backendId: BackendId): Promise<void> | null {
    if (this.disposed) return null;
    const existing = this.inflight.get(backendId);
    if (existing) {
      this.pendingRefresh.add(backendId);
      return existing;
    }
    if (this.getCachedModelCatalog(backendId) === null) return null;
    this.clearCached(backendId);
    return this.startLoadChain(backendId);
  }

  private startLoadChain(backendId: BackendId): Promise<void> {
    const promise = this.runLoadChain(backendId).finally(() => {
      this.inflight.delete(backendId);
      this.pendingRefresh.delete(backendId);
    });
    this.inflight.set(backendId, promise);
    return promise;
  }

  private async runLoadChain(backendId: BackendId): Promise<void> {
    let round = 0;
    do {
      this.pendingRefresh.delete(backendId);
      if (round > 0) this.clearCached(backendId);
      round += 1;
      await this.loadCatalog(backendId);
    } while (this.pendingRefresh.has(backendId) && !this.disposed);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  shutdown(): void {
    this.disposed = true;
    this.modelCatalogCache.clear();
    this.inflight.clear();
    this.pendingRefresh.clear();
    this.listeners.clear();
    for (const [backendId, warm] of this.warm) {
      this.warmExitUnsubs.get(backendId)?.();
      warm.proc.shutdown().catch((e) => {
        logWarn(`[AgentMode] preload shutdown: warm ${backendId} shutdown failed`, e);
      });
    }
    this.warm.clear();
    this.warmExitUnsubs.clear();
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logWarn("[AgentMode] preload listener threw", e);
      }
    }
  }

  private async loadCatalog(backendId: BackendId): Promise<void> {
    if (Platform.isMobile) return;
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) return;

    const descriptor = this.resolveDescriptor(backendId);
    if (!descriptor) {
      logWarn(`[AgentMode] preload skipped: unknown backend ${backendId}`);
      return;
    }
    await this.beforeBackendStart?.(backendId);
    if (this.disposed) return;

    const proc = descriptor.createBackendProcess({
      plugin: this.plugin,
      app: this.app,
      clientVersion: this.plugin.manifest.version,
      descriptor,
    });

    let catalog: BackendModelCatalog | null = null;
    try {
      await proc.start?.();
      catalog = proc.getModelCatalog();
    } catch (err) {
      logError(`[AgentMode] preload ${backendId} failed`, err);
    }

    if (this.disposed || !catalog || !proc.isRunning()) {
      try {
        await proc.shutdown();
      } catch (e) {
        logWarn(`[AgentMode] preload ${backendId}: shutdown failed`, e);
      }
      return;
    }

    const warm: WarmBackend = {
      proc,
    };
    const exitUnsub = proc.onExit(() => {
      if (this.disposed) return;
      if (this.warm.get(backendId) === warm) {
        this.warm.delete(backendId);
        this.modelCatalogCache.delete(backendId);
        this.warmExitUnsubs.delete(backendId);
        this.notify();
      }
    });
    this.warm.set(backendId, warm);
    this.modelCatalogCache.set(backendId, catalog);
    this.warmExitUnsubs.set(backendId, exitUnsub);
    const ids = catalog.availableModels?.map((model) => model.baseModelId).join(", ") ?? "";
    logInfo(`[AgentMode] preload ${backendId}: models=[${ids}]`);
    this.notify();
  }
}
