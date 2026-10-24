import { desktopProviderFetch } from "@/utils/desktopProviderFetch";

jest.mock(
  "@earendil-works/pi-mcp/oauth",
  () => ({
    MemoryOAuthStateStore: class {
      value: unknown;
      save(value: unknown) {
        this.value = value;
      }
      load() {
        return this.value;
      }
    },
    OAuthCallbackServer: {
      listen: jest.fn(async () => ({
        redirectUrl: "http://127.0.0.1/callback",
        close: async () => undefined,
        waitForCallback: async () => ({ code: "code", state: "state" }),
      })),
    },
    McpOAuthProvider: jest.fn(
      (options: { store: { load(): { clientInformation?: unknown; tokens?: unknown } } }) => ({
        state: async () => "state",
        clientInformation: async () => options.store.load().clientInformation,
        tokens: async () => options.store.load().tokens,
      })
    ),
    authorizeMcp: jest.fn(async () => "AUTHORIZED"),
  }),
  { virtual: true }
);

import {
  MCP_OAUTH_TIMEOUT_MS,
  McpOAuth,
  createPiMcpOAuthFlow,
  type McpOAuthCallbackResult,
  type McpOAuthFlowPort,
  type McpOAuthSessionPort,
  type McpOAuthTimerHandle,
  type McpOAuthTimerPort,
} from "@/agentMode/sdk/pi/mcp/McpOAuth";
import {
  McpCredentialStore,
  type McpKeychainPort,
  type McpOAuthTokens,
} from "@/agentMode/sdk/pi/mcp/McpCredentialStore";

// Authorization happens in the browser through the injected pi-mcp flow: the callback server listens
// on loopback, a mismatched state is rejected, the attempt is bounded to 10 minutes and a timeout or
// cancel closes the callback server, concurrent refreshes share one flow, and a signOut makes a late
// refresh or login callback unable to restore a token:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryKeychain implements McpKeychainPort {
  readonly values = new Map<string, string>();
  async read(ref: string): Promise<string | undefined> {
    return this.values.get(ref);
  }
  async write(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }
  async delete(ref: string): Promise<void> {
    this.values.delete(ref);
  }
}

class ManualTimer implements McpOAuthTimerPort {
  #next = 1;
  #entries = new Map<number, { at: number; callback: () => void }>();
  nowMs = 0;
  setTimeout(callback: () => void, ms: number): McpOAuthTimerHandle {
    const id = this.#next++;
    this.#entries.set(id, { at: this.nowMs + ms, callback });
    return { id };
  }
  clearTimeout(handle: McpOAuthTimerHandle): void {
    this.#entries.delete(handle.id);
  }
  advance(ms: number): void {
    this.nowMs += ms;
    const due = [...this.#entries.entries()]
      .filter(([, entry]) => entry.at <= this.nowMs)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [id, entry] of due) {
      this.#entries.delete(id);
      entry.callback();
    }
  }
}

class FakeSession implements McpOAuthSessionPort {
  redirectUrl = "http://127.0.0.1:4567/callback";
  startResult: { status: "AUTHORIZED" | "REDIRECT"; state: string } = {
    status: "REDIRECT",
    state: "state-1",
  };
  callback: McpOAuthCallbackResult = { code: "code-1", state: "state-1" };
  waitImpl: ((state: string) => Promise<McpOAuthCallbackResult>) | null = null;
  exchangeImpl: ((input: { code: string; state: string }) => Promise<McpOAuthTokens>) | null = null;
  tokensValue: McpOAuthTokens | undefined;
  refreshImpl: (() => Promise<McpOAuthTokens | undefined>) | null = null;
  refreshValue: McpOAuthTokens | undefined;
  startCalls = 0;
  exchangeCalls = 0;
  refreshCalls = 0;
  closeCalls = 0;

  async start(): Promise<{ status: "AUTHORIZED" | "REDIRECT"; state: string }> {
    this.startCalls += 1;
    return this.startResult;
  }

  async waitForCallback(state: string): Promise<McpOAuthCallbackResult> {
    if (this.waitImpl !== null) return this.waitImpl(state);
    return this.callback;
  }

  async exchange(input: { code: string; state: string }): Promise<McpOAuthTokens> {
    this.exchangeCalls += 1;
    if (this.exchangeImpl !== null) return this.exchangeImpl(input);
    return { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 5_000 };
  }

  async tokens(): Promise<McpOAuthTokens | undefined> {
    return this.tokensValue;
  }

  async refresh(): Promise<McpOAuthTokens | undefined> {
    this.refreshCalls += 1;
    if (this.refreshImpl !== null) return this.refreshImpl();
    return (
      this.refreshValue ?? { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: 9_000 }
    );
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FakeFlow implements McpOAuthFlowPort {
  session = new FakeSession();
  beginCalls = 0;
  lastInput:
    | {
        serverUrl: string;
        host: string;
        timeoutMs: number;
        scope?: string;
        signal?: AbortSignal;
      }
    | undefined;
  beginImpl: ((input: { signal?: AbortSignal }) => Promise<McpOAuthSessionPort>) | null = null;

  async begin(input: {
    serverUrl: string;
    host: string;
    timeoutMs: number;
    scope?: string;
    signal?: AbortSignal;
  }): Promise<McpOAuthSessionPort> {
    this.beginCalls += 1;
    this.lastInput = input;
    if (this.beginImpl !== null) return this.beginImpl(input);
    return this.session;
  }
}

function harness(options: { serverUrl?: string; session?: FakeSession } = {}) {
  const keychain = new MemoryKeychain();
  const store = new McpCredentialStore({ keychain, now: () => 1_000 });
  const timer = new ManualTimer();
  const flow = new FakeFlow();
  if (options.session !== undefined) flow.session = options.session;
  const oauth = new McpOAuth({
    serverId: "docs",
    serverUrl: options.serverUrl ?? "https://mcp.example.com/mcp",
    scopes: ["read", "write"],
    store,
    flow,
    timer,
    now: () => timer.nowMs,
  });
  return { oauth, store, flow, timer, keychain };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("McpOAuth", () => {
  describe("McpOAuth", () => {
    describe("authorize()", () => {
      it("authorizes through the browser callback on loopback without a terminal step", async () => {
        const harnessed = harness();

        const result = await harnessed.oauth.authorize();

        expect(result).toMatchObject({ status: "authorized", origin: "https://mcp.example.com" });
        expect(harnessed.flow.lastInput).toMatchObject({
          host: "127.0.0.1",
          timeoutMs: MCP_OAUTH_TIMEOUT_MS,
          scope: "read write",
        });
        expect(harnessed.flow.session.startCalls).toBe(1);
        expect(harnessed.flow.session.exchangeCalls).toBe(1);
        expect(harnessed.flow.session.closeCalls).toBe(1);
        await expect(
          harnessed.store.credentials("docs", "https://mcp.example.com")
        ).resolves.toMatchObject({ tokens: { accessToken: "access-1" } });
        expect(harnessed.oauth.target).toEqual({
          origin: "https://mcp.example.com",
          host: "mcp.example.com",
          scopes: ["read", "write"],
        });
      });

      it("rejects a callback whose state does not match the authorization request", async () => {
        const harnessed = harness();
        harnessed.flow.session.waitImpl = async () => ({ code: "code-1", state: "evil-state" });

        const result = await harnessed.oauth.authorize();

        expect(result).toMatchObject({ status: "failed", errorCode: "MCP_OAUTH_STATE_MISMATCH" });
        expect(harnessed.flow.session.exchangeCalls).toBe(0);
        await expect(
          harnessed.store.credentials("docs", "https://mcp.example.com")
        ).resolves.toBeUndefined();
        expect(harnessed.flow.session.closeCalls).toBe(1);
      });

      it("closes the callback server and reports a timeout after 10 minutes", async () => {
        const harnessed = harness();
        const waitStarted = deferred<void>();
        harnessed.flow.session.waitImpl = () => {
          waitStarted.resolve();
          return new Promise<McpOAuthCallbackResult>(() => undefined);
        };

        const running = harnessed.oauth.authorize();
        await waitStarted.promise;
        harnessed.timer.advance(MCP_OAUTH_TIMEOUT_MS);
        const result = await running;

        expect(result.status).toBe("timed_out");
        expect(harnessed.flow.session.closeCalls).toBe(1);
        await expect(
          harnessed.store.credentials("docs", "https://mcp.example.com")
        ).resolves.toBeUndefined();
      });

      it("closes the callback server and reports cancellation", async () => {
        const harnessed = harness();
        const waitStarted = deferred<void>();
        harnessed.flow.session.waitImpl = () => {
          waitStarted.resolve();
          return new Promise<McpOAuthCallbackResult>(() => undefined);
        };
        const controller = new AbortController();

        const running = harnessed.oauth.authorize({ signal: controller.signal });
        await waitStarted.promise;
        controller.abort();
        const result = await running;

        expect(result.status).toBe("cancelled");
        expect(harnessed.flow.session.closeCalls).toBe(1);
      });

      it("does not restore credentials when signOut lands during the code exchange", async () => {
        const harnessed = harness();
        const exchange = deferred<McpOAuthTokens>();
        const exchangeStarted = deferred<void>();
        harnessed.flow.session.exchangeImpl = () => {
          exchangeStarted.resolve();
          return exchange.promise;
        };

        const running = harnessed.oauth.authorize();
        await exchangeStarted.promise;
        await harnessed.store.signOut("docs", "https://mcp.example.com");
        exchange.resolve({ accessToken: "late-access", refreshToken: "late-refresh" });
        const result = await running;

        expect(result).toMatchObject({ status: "failed", errorCode: "MCP_OAUTH_STALE_GENERATION" });
        await expect(
          harnessed.store.credentials("docs", "https://mcp.example.com")
        ).resolves.toBeUndefined();
      });

      it("does not save an exchange that finishes after cancellation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const harnessed = harness();
        const exchange = deferred<McpOAuthTokens>();
        const started = deferred<void>();
        harnessed.flow.session.exchangeImpl = () => {
          started.resolve();
          return exchange.promise;
        };
        const controller = new AbortController();
        const running = harnessed.oauth.authorize({ signal: controller.signal });
        await started.promise;
        controller.abort();
        exchange.resolve({ accessToken: "cancelled-token" });
        expect((await running).status).toBe("cancelled");
        expect(
          await harnessed.store.credentials("docs", "https://mcp.example.com")
        ).toBeUndefined();
      });
    });

    describe("accessToken()", () => {
      it("returns the stored token without refreshing before it expires", async () => {
        const harnessed = harness();
        await harnessed.store.setOrigin("docs", "https://mcp.example.com");
        await harnessed.store.saveTokens("docs", "https://mcp.example.com", {
          accessToken: "access-1",
          expiresAt: 5_000,
        });

        const access = await harnessed.oauth.accessToken();

        expect(access).toMatchObject({ refreshed: false, tokens: { accessToken: "access-1" } });
        expect(harnessed.flow.beginCalls).toBe(0);
      });

      it("uses a token with no declared expiry until the server requests refresh https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const harnessed = harness();
        await harnessed.store.saveTokens("docs", "https://mcp.example.com", {
          accessToken: "no-expiry",
        });
        await expect(harnessed.oauth.accessToken()).resolves.toMatchObject({
          refreshed: false,
          tokens: { accessToken: "no-expiry" },
        });
        expect(harnessed.flow.beginCalls).toBe(0);
      });

      it("refreshes an expired token and shares one refresh between concurrent callers", async () => {
        const harnessed = harness();
        await harnessed.store.setOrigin("docs", "https://mcp.example.com");
        await harnessed.store.saveTokens("docs", "https://mcp.example.com", {
          accessToken: "expired",
          expiresAt: 0,
        });

        const [first, second] = await Promise.all([
          harnessed.oauth.accessToken(),
          harnessed.oauth.accessToken(),
        ]);

        expect(first).toMatchObject({ refreshed: true, tokens: { accessToken: "access-2" } });
        expect(second?.tokens.accessToken).toBe("access-2");
        expect(harnessed.flow.beginCalls).toBe(1);
        expect(harnessed.flow.session.refreshCalls).toBe(1);
      });

      it("drops a refresh result that finishes after signOut", async () => {
        const harnessed = harness();
        await harnessed.store.setOrigin("docs", "https://mcp.example.com");
        await harnessed.store.saveTokens("docs", "https://mcp.example.com", {
          accessToken: "expired",
          expiresAt: 0,
        });
        const refresh = deferred<McpOAuthTokens | undefined>();
        const refreshStarted = deferred<void>();
        harnessed.flow.session.refreshImpl = () => {
          refreshStarted.resolve();
          return refresh.promise;
        };

        const running = harnessed.oauth.refresh();
        await refreshStarted.promise;
        await harnessed.store.signOut("docs", "https://mcp.example.com");
        refresh.resolve({ accessToken: "late-access" });

        await expect(running).resolves.toBeUndefined();
        await expect(
          harnessed.store.credentials("docs", "https://mcp.example.com")
        ).resolves.toBeUndefined();
      });

      it("returns no access when the origin has no credentials", async () => {
        const harnessed = harness();

        await expect(harnessed.oauth.accessToken()).resolves.toBeUndefined();
        expect(harnessed.flow.beginCalls).toBe(0);
      });
    });

    describe("constructor()", () => {
      it("never carries the old origin credentials to a new origin", async () => {
        const keychain = new MemoryKeychain();
        const store = new McpCredentialStore({ keychain, now: () => 1_000 });
        const firstFlow = new FakeFlow();
        const first = new McpOAuth({
          serverId: "docs",
          serverUrl: "https://old.example.com/mcp",
          store,
          flow: firstFlow,
          timer: new ManualTimer(),
          now: () => 0,
        });
        await first.authorize();
        await expect(store.credentials("docs", "https://old.example.com")).resolves.toMatchObject({
          tokens: { accessToken: "access-1" },
        });

        const secondFlow = new FakeFlow();
        const second = new McpOAuth({
          serverId: "docs",
          serverUrl: "https://new.example.com/mcp",
          store,
          flow: secondFlow,
          timer: new ManualTimer(),
          now: () => 0,
        });
        await second.authorize();

        await expect(store.credentials("docs", "https://old.example.com")).resolves.toBeUndefined();
        await expect(store.credentials("docs", "https://new.example.com")).resolves.toMatchObject({
          tokens: { accessToken: "access-1" },
        });
        await expect(second.accessToken()).resolves.toMatchObject({
          tokens: { accessToken: "access-1" },
        });
        expect(store.generationOf("docs")).toBe(1);
      });
    });
  });

  describe("createPiMcpOAuthFlow()", () => {
    it("uses desktop networking for all OAuth stages, seeds stored credentials and prevents background browser login https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const sdk = jest.requireMock<{ McpOAuthProvider: jest.Mock; authorizeMcp: jest.Mock }>(
        "@earendil-works/pi-mcp/oauth"
      );
      const keychain = new MemoryKeychain();
      const store = new McpCredentialStore({ keychain });
      await store.saveClientInformation("docs", "https://mcp.example.com", {
        clientId: "saved-client",
        clientSecret: "saved-client-secret",
      });
      await store.saveTokens("docs", "https://mcp.example.com", {
        accessToken: "saved-access",
        refreshToken: "saved-refresh",
        expiresAt: 0,
      });
      const browser = { open: jest.fn(async () => undefined) };
      const flow = await createPiMcpOAuthFlow({ browser, credentials: store, serverId: "docs" });
      const session = await flow.begin({
        serverUrl: "https://mcp.example.com/mcp",
        host: "127.0.0.1",
        timeoutMs: 1000,
      });
      const options = sdk.McpOAuthProvider.mock.calls[0]?.[0] as {
        store: { load(): { clientInformation: unknown; tokens: unknown } };
        onRedirect(url: URL): Promise<void>;
      };
      expect(options.store.load()).toMatchObject({
        clientInformation: { client_id: "saved-client", client_secret: "saved-client-secret" },
        tokens: { refresh_token: "saved-refresh" },
      });
      await session.refresh();
      expect(sdk.authorizeMcp).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ fetch: desktopProviderFetch })
      );
      await expect(options.onRedirect(new URL("https://login.example.com"))).rejects.toThrow(
        "settings"
      );
      expect(browser.open).not.toHaveBeenCalled();
      await session.start();
      expect(sdk.authorizeMcp).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ fetch: desktopProviderFetch })
      );
      await session.exchange({ code: "code", state: "state" });
      expect(sdk.authorizeMcp).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ fetch: desktopProviderFetch })
      );
      await options.onRedirect(new URL("https://login.example.com"));
      expect(browser.open).toHaveBeenCalledWith("https://login.example.com/");
      await session.close();
    });
  });
});
