import { logError, logInfo, logWarn } from "@/logger";
import type VaultAgentPlugin from "@/main";
import { App, FileSystemAdapter, Platform } from "obsidian";
import type {
  BackendDescriptor,
  BackendId,
  BackendModelCatalog,
  BackendProcess,
  BackendState,
  SessionId,
  SessionUpdateHandler,
} from "./types";

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
    return this.startProbeChain(backendId);
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
    return this.startProbeChain(backendId);
  }

  private startProbeChain(backendId: BackendId): Promise<void> {
    const promise = this.runProbeChain(backendId).finally(() => {
      this.inflight.delete(backendId);
      this.pendingRefresh.delete(backendId);
    });
    this.inflight.set(backendId, promise);
    return promise;
  }

  private async runProbeChain(backendId: BackendId): Promise<void> {
    let round = 0;
    do {
      this.pendingRefresh.delete(backendId);
      if (round > 0) this.clearCached(backendId);
      round += 1;
      await this.runProbe(backendId);
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

  private async runProbe(backendId: BackendId): Promise<void> {
    if (Platform.isMobile) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const cwd = adapter.getBasePath();

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

    // An agent can revise its model list after the probe session opens, so the cache follows it.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/625
    let catalog: BackendModelCatalog | null = null;
    let updatedState: BackendState | null = null;
    const onProbeEvent: SessionUpdateHandler = ({ update }) => {
      if (update.sessionUpdate !== "state_changed" || !update.state.model) return;
      updatedState = update.state;
      if (!catalog || this.modelCatalogCache.get(backendId) !== catalog) return;
      catalog = { availableModels: update.state.model.availableModels };
      this.modelCatalogCache.set(backendId, catalog);
      this.notify();
    };

    let probe: { sessionId: SessionId; state: BackendState } | null = null;
    try {
      await proc.start?.();
      probe = await proc.newSession({ cwd });
      proc.registerSessionHandler(probe.sessionId, onProbeEvent);
    } catch (err) {
      logError(`[AgentMode] preload ${backendId} failed`, err);
    }

    if (this.disposed || !probe || (!probe.state.model && !probe.state.mode)) {
      if (probe) {
        logInfo(`[AgentMode] preload ${backendId}: agent did not report any initial state`);
      }
      try {
        await proc.shutdown();
      } catch (e) {
        logWarn(`[AgentMode] preload ${backendId}: shutdown failed`, e);
      }
      return;
    }

    if (this.disposed || !proc.isRunning()) {
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
    catalog = { availableModels: (updatedState ?? probe.state).model?.availableModels ?? null };
    this.modelCatalogCache.set(backendId, catalog);
    this.warmExitUnsubs.set(backendId, exitUnsub);
    logProbeResult(backendId, "session probe", probe.state);
    this.notify();
  }
}

function logProbeResult(backendId: BackendId, label: string, state: BackendState): void {
  const ids = state.model?.availableModels.map((m) => m.baseModelId).join(", ") ?? "";
  const modeOpts = state.mode?.options.map((o) => o.value).join(", ") ?? "";
  const currentBaseId = state.model?.current.baseModelId ?? "-";
  const currentEntry = state.model?.availableModels.find((e) => e.baseModelId === currentBaseId);
  const effortOpts = currentEntry?.effortOptions.map((o) => o.value ?? "default").join(", ") ?? "";
  logInfo(
    `[AgentMode] preload ${backendId} (${label}): models=[${ids}] (current=${currentBaseId}), ` +
      `mode=[${modeOpts}] effort=[${effortOpts}]`
  );
}
