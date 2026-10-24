import type { McpFetch } from "@earendil-works/pi-mcp";
import { desktopProviderFetch } from "@/utils/desktopProviderFetch";
import type { OAuthTokens } from "@earendil-works/pi-mcp/oauth";
import { McpCredentialStore, type McpOAuthTokens } from "@/agentMode/sdk/pi/mcp/McpCredentialStore";

// Authorization happens entirely in the browser through the pi-mcp OAuth flow: the loopback callback
// server only listens on 127.0.0.1, the state returned by the flow must match the callback exactly
// (PKCE/state are owned by the flow), the whole attempt is bounded to 10 minutes and a cancel or
// timeout closes the callback server. Tokens go to the keychain through McpCredentialStore, and every
// save carries the generation captured before the await, so a signOut makes a late refresh or login
// callback harmless:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const MCP_OAUTH_TIMEOUT_MS = 600_000;
export const MCP_OAUTH_CALLBACK_HOST = "127.0.0.1";

export interface McpOAuthCallbackResult {
  readonly code: string;
  readonly state: string;
  readonly iss?: string;
}

export interface McpOAuthSessionPort {
  readonly redirectUrl: string;
  start(
    signal?: AbortSignal
  ): Promise<{ readonly status: "AUTHORIZED" | "REDIRECT"; readonly state: string }>;
  waitForCallback(state: string): Promise<McpOAuthCallbackResult>;
  exchange(
    input: { readonly code: string; readonly state: string; readonly iss?: string },
    signal?: AbortSignal
  ): Promise<McpOAuthTokens>;
  tokens(): Promise<McpOAuthTokens | undefined>;
  refresh(signal?: AbortSignal): Promise<McpOAuthTokens | undefined>;
  close(): Promise<void>;
}

export interface McpOAuthFlowPort {
  begin(input: {
    readonly serverUrl: string;
    readonly host: string;
    readonly timeoutMs: number;
    readonly scope?: string;
    readonly signal?: AbortSignal;
  }): Promise<McpOAuthSessionPort>;
}

export interface McpOAuthTimerHandle {
  readonly id: number;
}

export interface McpOAuthTimerPort {
  setTimeout(callback: () => void, ms: number): McpOAuthTimerHandle;
  clearTimeout(handle: McpOAuthTimerHandle): void;
}

export type McpOAuthStatus = "authorized" | "cancelled" | "timed_out" | "failed";

export type McpOAuthErrorCode =
  | "MCP_OAUTH_STATE_MISMATCH"
  | "MCP_OAUTH_STALE_GENERATION"
  | "MCP_OAUTH_FAILED";

export interface McpOAuthResult {
  readonly status: McpOAuthStatus;
  readonly origin: string;
  readonly scopes: readonly string[];
  readonly errorCode?: McpOAuthErrorCode;
  readonly error?: string;
}

export interface McpOAuthOptions {
  readonly serverId: string;
  readonly serverUrl: string;
  readonly scopes?: readonly string[];
  readonly store: McpCredentialStore;
  readonly flow: McpOAuthFlowPort;
  readonly timer?: McpOAuthTimerPort;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface McpOAuthAccess {
  readonly tokens: McpOAuthTokens;
  readonly origin: string;
  readonly refreshed: boolean;
}

export class McpOAuth {
  readonly #serverId: string;
  readonly #serverUrl: string;
  readonly #origin: string;
  readonly #scopes: readonly string[];
  readonly #store: McpCredentialStore;
  readonly #flow: McpOAuthFlowPort;
  readonly #timer: McpOAuthTimerPort;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  #refreshInFlight: Promise<McpOAuthTokens | undefined> | null = null;

  constructor(options: McpOAuthOptions) {
    this.#serverId = options.serverId;
    this.#serverUrl = options.serverUrl;
    this.#origin = new URL(options.serverUrl).origin;
    this.#scopes = Object.freeze([...(options.scopes ?? [])]);
    this.#store = options.store;
    this.#flow = options.flow;
    this.#timer = options.timer ?? defaultTimerPort();
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? MCP_OAUTH_TIMEOUT_MS;
  }

  get target(): {
    readonly origin: string;
    readonly host: string;
    readonly scopes: readonly string[];
  } {
    return { origin: this.#origin, host: new URL(this.#serverUrl).host, scopes: this.#scopes };
  }

  async authorize(options: { readonly signal?: AbortSignal } = {}): Promise<McpOAuthResult> {
    await this.#store.setOrigin(this.#serverId, this.#origin);
    const generation = this.#store.generationOf(this.#serverId);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = this.#timer.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    let session: McpOAuthSessionPort | null = null;
    try {
      session = await this.#flow.begin({
        serverUrl: this.#serverUrl,
        host: MCP_OAUTH_CALLBACK_HOST,
        timeoutMs: this.#timeoutMs,
        ...(this.#scopes.length > 0 ? { scope: this.#scopes.join(" ") } : {}),
        signal: controller.signal,
      });
      const started = await session.start(controller.signal);
      if (started.status === "AUTHORIZED") {
        const tokens = await session.tokens();
        if (tokens === undefined) {
          return this.#failure(
            "MCP_OAUTH_FAILED",
            "The OAuth flow reported authorization without tokens."
          );
        }
        // 用户取消期间完成的交换也不能恢复凭据。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (controller.signal.aborted) throw new Error("The OAuth flow was cancelled.");
        const saved = await this.#store.saveTokens(
          this.#serverId,
          this.#origin,
          tokens,
          generation
        );
        return saved
          ? { status: "authorized", origin: this.#origin, scopes: this.#scopes }
          : this.#failure(
              "MCP_OAUTH_STALE_GENERATION",
              "The credentials were signed out during login."
            );
      }
      const callback = await this.#abortable(
        session.waitForCallback(started.state),
        controller.signal
      );
      if (callback.state !== started.state) {
        return this.#failure(
          "MCP_OAUTH_STATE_MISMATCH",
          "The OAuth callback state did not match the authorization request."
        );
      }
      const tokens = await session.exchange(
        {
          code: callback.code,
          state: callback.state,
          ...(callback.iss !== undefined ? { iss: callback.iss } : {}),
        },
        controller.signal
      );
      if (controller.signal.aborted) throw new Error("The OAuth flow was cancelled.");
      const saved = await this.#store.saveTokens(this.#serverId, this.#origin, tokens, generation);
      return saved
        ? { status: "authorized", origin: this.#origin, scopes: this.#scopes }
        : this.#failure(
            "MCP_OAUTH_STALE_GENERATION",
            "The credentials were signed out during login."
          );
    } catch (thrown) {
      if (timedOut) {
        return { status: "timed_out", origin: this.#origin, scopes: this.#scopes };
      }
      if (controller.signal.aborted || options.signal?.aborted === true) {
        return { status: "cancelled", origin: this.#origin, scopes: this.#scopes };
      }
      return this.#failure("MCP_OAUTH_FAILED", messageOf(thrown));
    } finally {
      this.#timer.clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      await session?.close();
    }
  }

  async accessToken(
    options: { readonly signal?: AbortSignal } = {}
  ): Promise<McpOAuthAccess | undefined> {
    const credentials = await this.#store.credentials(this.#serverId, this.#origin);
    if (credentials === undefined) return undefined;
    const expiresAt = credentials.tokens.expiresAt;
    // 服务未声明过期时间时保留令牌，收到认证失败后再刷新。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (expiresAt === undefined || expiresAt > this.#now()) {
      return { tokens: credentials.tokens, origin: this.#origin, refreshed: false };
    }
    const refreshed = await this.refresh(options);
    return refreshed === undefined
      ? undefined
      : { tokens: refreshed, origin: this.#origin, refreshed: true };
  }

  async refresh(
    options: { readonly signal?: AbortSignal } = {}
  ): Promise<McpOAuthTokens | undefined> {
    if (this.#refreshInFlight !== null) return this.#refreshInFlight;
    const generation = this.#store.generationOf(this.#serverId);
    const inFlight = this.#refreshOnce(generation, options.signal).finally(() => {
      if (this.#refreshInFlight === inFlight) this.#refreshInFlight = null;
    });
    this.#refreshInFlight = inFlight;
    return inFlight;
  }

  async signOut(): Promise<void> {
    await this.#store.signOut(this.#serverId, this.#origin);
  }

  async #refreshOnce(
    generation: number,
    signal: AbortSignal | undefined
  ): Promise<McpOAuthTokens | undefined> {
    let session: McpOAuthSessionPort | null = null;
    try {
      session = await this.#flow.begin({
        serverUrl: this.#serverUrl,
        host: MCP_OAUTH_CALLBACK_HOST,
        timeoutMs: this.#timeoutMs,
        ...(this.#scopes.length > 0 ? { scope: this.#scopes.join(" ") } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });
      const tokens = await session.refresh(signal);
      if (tokens === undefined || signal?.aborted) return undefined;
      const saved = await this.#store.saveTokens(this.#serverId, this.#origin, tokens, generation);
      return saved ? tokens : undefined;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async #abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error("The OAuth flow was aborted.");
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(new Error("The OAuth flow was aborted."));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    });
  }

  #failure(errorCode: McpOAuthErrorCode, error: string): McpOAuthResult {
    return { status: "failed", origin: this.#origin, scopes: this.#scopes, errorCode, error };
  }
}

export async function createPiMcpOAuthFlow(options: {
  readonly browser: { open(url: string): Promise<void> };
  readonly credentials?: McpCredentialStore;
  readonly serverId?: string;
  readonly clientId?: string;
  readonly fetch?: McpFetch;
}): Promise<McpOAuthFlowPort> {
  const oauth = await import("@earendil-works/pi-mcp/oauth");
  // 授权发现、交换和刷新也会跨域，必须与 MCP 连接使用同一宿主网络。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const fetch = options.fetch ?? desktopProviderFetch;
  return {
    begin: async (input) => {
      const origin = new URL(input.serverUrl).origin;
      const generation = options.serverId
        ? options.credentials?.generationOf(options.serverId)
        : undefined;
      const saved = options.serverId
        ? await options.credentials?.load(options.serverId, origin)
        : undefined;
      const server = await oauth.OAuthCallbackServer.listen({
        host: input.host,
        timeoutMs: input.timeoutMs,
      });
      const state = new oauth.MemoryOAuthStateStore();
      state.save({
        serverUrl: input.serverUrl,
        ...(saved?.clientInformation
          ? {
              clientInformation: {
                client_id: saved.clientInformation.clientId,
                ...(saved.clientInformation.clientSecret
                  ? { client_secret: saved.clientInformation.clientSecret }
                  : {}),
              },
            }
          : {}),
        ...(saved?.tokens
          ? {
              tokens: {
                access_token: saved.tokens.accessToken,
                token_type: "Bearer",
                ...(saved.tokens.refreshToken ? { refresh_token: saved.tokens.refreshToken } : {}),
                ...(saved.tokens.scope ? { scope: saved.tokens.scope } : {}),
              },
              ...(saved.tokens.expiresAt !== undefined
                ? { tokensExpireAt: saved.tokens.expiresAt }
                : {}),
            }
          : {}),
      });
      let allowBrowser = false;
      const provider = new oauth.McpOAuthProvider({
        serverUrl: input.serverUrl,
        redirectUrl: server.redirectUrl,
        store: state,
        ...(options.clientId ? { clientId: options.clientId } : {}),
        clientMetadata: { client_name: "Vault Agent", redirect_uris: [server.redirectUrl] },
        onRedirect: async (url) => {
          // 后台刷新不能偷偷弹出浏览器，只允许设置页主动发起登录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          if (!allowBrowser)
            throw new Error("Authorize this server from settings before retrying.");
          await options.browser.open(url.href);
        },
      });
      const saveClient = async () => {
        const client = await provider.clientInformation();
        if (client && options.serverId && options.credentials)
          await options.credentials.saveClientInformation(
            options.serverId,
            origin,
            {
              clientId: client.client_id,
              ...(client.client_secret ? { clientSecret: client.client_secret } : {}),
            },
            generation
          );
      };
      return {
        redirectUrl: server.redirectUrl,
        start: async (signal) => {
          allowBrowser = true;
          const result = await oauth.authorizeMcp(provider, {
            fetch,
            serverUrl: input.serverUrl,
            ...(input.scope ? { scope: input.scope } : {}),
            ...(signal ? { signal } : {}),
          });
          await saveClient();
          return { status: result, state: await provider.state() };
        },
        waitForCallback: (expectedState) => server.waitForCallback(expectedState),
        exchange: async (callback, signal) => {
          await oauth.authorizeMcp(provider, {
            fetch,
            serverUrl: input.serverUrl,
            authorizationCode: callback.code,
            ...(callback.iss ? { iss: callback.iss } : {}),
            ...(signal ? { signal } : {}),
          });
          await saveClient();
          const mapped = mapTokens(await provider.tokens());
          if (!mapped) throw new Error("The OAuth flow returned no tokens.");
          return mapped;
        },
        tokens: async () => mapTokens(await provider.tokens()),
        refresh: async (signal) => {
          allowBrowser = false;
          const result = await oauth.authorizeMcp(provider, {
            fetch,
            serverUrl: input.serverUrl,
            skipRefresh: false,
            ...(input.scope ? { scope: input.scope } : {}),
            ...(signal ? { signal } : {}),
          });
          await saveClient();
          return result === "AUTHORIZED" ? mapTokens(await provider.tokens()) : undefined;
        },
        close: () => server.close(),
      };
    },
  };
}

function mapTokens(tokens: OAuthTokens | undefined): McpOAuthTokens | undefined {
  if (tokens === undefined) return undefined;
  return {
    accessToken: tokens.access_token,
    ...(tokens.refresh_token !== undefined ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.expires_in !== undefined
      ? { expiresAt: Date.now() + tokens.expires_in * 1_000 }
      : {}),
    ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
  };
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function defaultTimerPort(): McpOAuthTimerPort {
  let nextId = 1;
  const handles = new Map<number, number>();
  return {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      handles.set(
        id,
        window.setTimeout(() => {
          handles.delete(id);
          callback();
        }, ms)
      );
      return { id };
    },
    clearTimeout: (handle) => {
      const native = handles.get(handle.id);
      if (native === undefined) return;
      handles.delete(handle.id);
      window.clearTimeout(native);
    },
  };
}
