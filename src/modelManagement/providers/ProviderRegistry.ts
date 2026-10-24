import type { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";

import { logError } from "@/logger";
import { KeychainService, providerKeychainName } from "@/services/keychainService";
import { getSettings, setSettings } from "@/settings/model";
import { frozenOr, sliceMemo, sliceMemoByKey } from "@/utils/sliceCache";

import type { Provider, ProviderOrigin } from "@/modelManagement/types/persisted";

const EMPTY_LIST: readonly Provider[] = Object.freeze([]);

export class ProviderRegistry {
  readonly #app: App;

  readonly #list = sliceMemo((source: Record<string, Provider>) =>
    frozenOr(Object.values(source), EMPTY_LIST)
  );
  readonly #byOrigin = sliceMemoByKey(
    (source: Record<string, Provider>, kind: ProviderOrigin["kind"]) =>
      frozenOr(
        Object.values(source).filter((p) => p.origin.kind === kind),
        EMPTY_LIST
      )
  );

  readonly #listeners = new Set<(providerId: string) => void>();

  constructor(app: App) {
    this.#app = app;
  }

  subscribe(listener: (providerId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(providerId: string): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(providerId);
      } catch (err) {
        logError("[modelManagement] ProviderRegistry listener threw", err);
      }
    }
  }

  notifyConfigChanged(providerId: string): void {
    this.#emit(providerId);
  }

  list(): readonly Provider[] {
    return this.#list(getSettings().providers);
  }

  get(providerId: string): Provider | undefined {
    return getSettings().providers[providerId];
  }

  listByOrigin(originKind: ProviderOrigin["kind"]): readonly Provider[] {
    return this.#byOrigin(getSettings().providers, originKind);
  }

  async add(input: Omit<Provider, "providerId" | "addedAt" | "apiKeyKeychainId">): Promise<string> {
    const providerId = uuidv4();
    const row: Provider = {
      ...input,
      providerId,
      addedAt: Date.now(),
      apiKeyKeychainId: null,
    };
    setSettings((cur) => ({
      providers: { ...cur.providers, [providerId]: row },
    }));
    this.#emit(providerId);
    return providerId;
  }

  async update(
    providerId: string,
    patch: Partial<Omit<Provider, "providerId" | "addedAt" | "apiKeyKeychainId" | "origin">>
  ): Promise<void> {
    const existing = getSettings().providers[providerId];
    if (!existing) {
      throw new Error(
        `[modelManagement] ProviderRegistry.update: unknown providerId ${providerId}`
      );
    }
    const safePatch = { ...patch } as Record<string, unknown>;
    delete safePatch.providerId;
    delete safePatch.addedAt;
    delete safePatch.apiKeyKeychainId;
    // 切换格式必须保留合法协议，同时拒绝未支持的外部值。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    if (!["anthropic", "openai-compatible", "google"].includes(String(safePatch.providerType))) {
      delete safePatch.providerType;
    }
    delete safePatch.origin;
    for (const key of Object.keys(safePatch)) {
      if (Object.is(existing[key as keyof Provider], safePatch[key])) {
        delete safePatch[key];
      }
    }
    if (Object.keys(safePatch).length === 0) return;
    // CORS 旧字段只保留数据兼容，不影响当前 Pi 执行配置。https://github.com/ItsDalk-Lane/Vault-Agent/issues/5
    const affectsAgentProviderConfig = Object.keys(safePatch).some((key) => key !== "enableCors");
    const next: Provider = { ...existing, ...(safePatch as Partial<Provider>) };
    setSettings((cur) => ({
      providers: { ...cur.providers, [providerId]: next },
    }));
    if (affectsAgentProviderConfig) this.#emit(providerId);
  }

  #setApiKeyKeychainId(providerId: string, apiKeyKeychainId: string | null): void {
    const existing = getSettings().providers[providerId];
    if (!existing) return;
    if (existing.apiKeyKeychainId === apiKeyKeychainId) return;
    setSettings((cur) => {
      const current = cur.providers[providerId];
      if (!current) return {};
      return {
        providers: { ...cur.providers, [providerId]: { ...current, apiKeyKeychainId } },
      };
    });
  }

  async remove(providerId: string): Promise<void> {
    const existing = getSettings().providers[providerId];
    if (!existing) return;
    if (existing.apiKeyKeychainId) {
      try {
        KeychainService.getInstance(this.#app).deleteSecretById(existing.apiKeyKeychainId);
      } catch (err) {
        logError(`[modelManagement] ProviderRegistry.remove: failed to clear keychain`, err);
      }
    }
    setSettings((cur) => {
      const next = { ...cur.providers };
      delete next[providerId];
      return { providers: next };
    });
    this.#emit(providerId);
  }

  async getApiKey(providerId: string): Promise<string | null> {
    const row = getSettings().providers[providerId];
    if (!row || !row.apiKeyKeychainId) return null;
    return KeychainService.getInstance(this.#app).getSecretById(row.apiKeyKeychainId);
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    const row = getSettings().providers[providerId];
    if (!row) {
      throw new Error(
        `[modelManagement] ProviderRegistry.setApiKey: unknown providerId ${providerId}`
      );
    }
    const keychain = KeychainService.getInstance(this.#app);
    const keychainId =
      row.apiKeyKeychainId ??
      providerKeychainName(keychain.getVaultId(), row, getSettings().providers);
    // Re-registering with the key already stored is not a change, and emitting
    // one restarts every backend that bakes provider config into its spawn
    // (Plus reconciliation replays the license key on every sign-in and load).
    // Compare the stored secret, not the pointer: a same-id rotation is what
    // the pointer cannot see, and a dangling pointer reads back null, so it
    // still writes and repairs itself.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/472
    if (row.apiKeyKeychainId === keychainId && keychain.getSecretById(keychainId) === apiKey) {
      return;
    }
    if (row.apiKeyKeychainId !== keychainId) {
      this.#setApiKeyKeychainId(providerId, keychainId);
    }
    keychain.setSecretById(keychainId, apiKey);
    this.#emit(providerId);
  }

  async clearApiKey(providerId: string): Promise<void> {
    const row = getSettings().providers[providerId];
    if (!row) return;
    if (row.apiKeyKeychainId) {
      try {
        KeychainService.getInstance(this.#app).deleteSecretById(row.apiKeyKeychainId);
      } catch (err) {
        logError(`[modelManagement] ProviderRegistry.clearApiKey: failed to delete keychain`, err);
      }
      this.#setApiKeyKeychainId(providerId, null);
      this.#emit(providerId);
    }
  }
}
