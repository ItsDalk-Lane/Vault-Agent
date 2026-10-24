import { McpManager, McpManagerError } from "@/agentMode/sdk/pi/mcp/McpManager";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { createFakeSdkPort, type FakeSdkPort } from "@/agentMode/sdk/pi/mcp/__tests__/fakeMcpSdk";

// The pool shares one handshake per vault + root + scope + fingerprint, keeps other vaults
// separate, cleans up failures so a retry can connect, leaves local Vault tools untouched, and
// closes every connection on dispose. The Pi MCP package is ESM, so tests inject an SDK-shaped port
// from __tests__/fakeMcpSdk while the manager logic stays real:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function httpConfig(serverId: string, url = "https://mcp.example.com/mcp") {
  return normalizeMcpServerConfig({
    serverId,
    scope: "this-vault",
    transport: { kind: "http", url, headerSecretRefs: {} },
  });
}

interface Harness {
  readonly manager: McpManager;
  readonly sdk: FakeSdkPort;
  readonly states: string[];
}

function harness(
  options: {
    vaultKey?: string;
    rootId?: string;
    failServerIds?: readonly string[];
    authServerIds?: readonly string[];
  } = {}
): Harness {
  const sdk = createFakeSdkPort({
    ...(options.failServerIds !== undefined ? { failServerIds: options.failServerIds } : {}),
    ...(options.authServerIds !== undefined ? { authServerIds: options.authServerIds } : {}),
  });
  const states: string[] = [];
  const manager = new McpManager({
    vaultKey: options.vaultKey ?? "vault-a",
    rootId: options.rootId ?? "root-1",
    resolveCredential: async () => "Bearer test",
    sdk,
    onStateChange: (connection) => {
      states.push(connection.state);
    },
  });
  return { manager, sdk, states };
}

describe("McpManager", () => {
  describe("acquire()", () => {
    it("performs one handshake for concurrent acquires of the same key", async () => {
      const harnessed = harness();
      const config = httpConfig("docs");

      const [first, second] = await Promise.all([
        harnessed.manager.acquire(config),
        harnessed.manager.acquire(config),
      ]);
      const third = await harnessed.manager.acquire(config);

      expect(first).toBe(second);
      expect(third).toBe(first);
      expect(harnessed.sdk.createdServerIds).toEqual(["docs"]);
      expect(harnessed.sdk.servers).toHaveLength(1);
      expect(harnessed.sdk.servers[0]?.initializes()).toBe(1);
      expect(first.refCount).toBe(3);
      expect(first.state).toBe("connected");
      expect(harnessed.manager.size).toBe(1);
      expect(Object.isFrozen(first.config)).toBe(true);
    });

    it("reuses a connected key while referenced and reconnects after refCount reaches zero", async () => {
      const harnessed = harness();
      const config = httpConfig("docs");

      const first = await harnessed.manager.acquire(config);
      const key = first.key;
      const sameReference = await harnessed.manager.acquire(config);
      await harnessed.manager.release(key);
      await harnessed.manager.release(key);

      expect(sameReference).toBe(first);
      expect(harnessed.sdk.servers).toHaveLength(1);
      expect(harnessed.sdk.servers[0]?.initializes()).toBe(1);
      expect(harnessed.manager.getState(key)).toBe("closed");
      expect(harnessed.sdk.servers[0]?.transport.closed).toBe(true);
      expect(harnessed.manager.size).toBe(0);
      expect(await harnessed.manager.release(key)).toBe(false);

      const reconnected = await harnessed.manager.acquire(config);
      expect(reconnected).not.toBe(first);
      expect(harnessed.sdk.servers).toHaveLength(2);
      expect(harnessed.sdk.servers[1]?.initializes()).toBe(1);
    });

    it("does not share a connection with another vault or root", async () => {
      const first = harness({ vaultKey: "vault-a", rootId: "root-1" });
      const otherVault = harness({ vaultKey: "vault-b", rootId: "root-1" });
      const otherRoot = harness({ vaultKey: "vault-a", rootId: "root-2" });
      const config = httpConfig("docs");

      const a = await first.manager.acquire(config);
      const b = await otherVault.manager.acquire(config);
      const c = await otherRoot.manager.acquire(config);

      expect(a.key).not.toBe(b.key);
      expect(a.key).not.toBe(c.key);
      expect(first.sdk.servers).toHaveLength(1);
      expect(otherVault.sdk.servers).toHaveLength(1);
      expect(otherRoot.sdk.servers).toHaveLength(1);
      expect(a.client).not.toBe(b.client);
    });

    it("cleans up a failed connect and still lets local Vault tools run", async () => {
      const harnessed = harness({ failServerIds: ["broken"] });
      const broken = httpConfig("broken");
      const good = httpConfig("docs");
      const vaultRead = async (): Promise<string> => "vault content";

      await expect(harnessed.manager.acquire(broken)).rejects.toThrow("handshake failed");
      expect(harnessed.manager.getState(harnessed.manager.keyOf(broken))).toBe("error");
      expect(harnessed.manager.size).toBe(0);
      expect(harnessed.sdk.clients[0]?.closed).toBe(true);
      expect(harnessed.states).toContain("error");
      expect(harnessed.states).toContain("closed");

      const connected = await harnessed.manager.acquire(good);
      await expect(vaultRead()).resolves.toBe("vault content");
      expect(connected.state).toBe("connected");
      expect(harnessed.manager.size).toBe(1);
    });

    it("records auth_required without leaving a broken pooled connection", async () => {
      const harnessed = harness({ authServerIds: ["needs-auth"] });
      const config = httpConfig("needs-auth");
      const key = harnessed.manager.keyOf(config);

      await expect(harnessed.manager.acquire(config)).rejects.toMatchObject({
        name: "McpAuthRequiredError",
      });
      expect(harnessed.manager.getState(key)).toBe("auth_required");
      expect(harnessed.manager.size).toBe(0);

      await harnessed.manager.invalidateServer("needs-auth");
      expect(harnessed.manager.getState(key)).toBe("closed");
    });
  });

  describe("handleConfigChange()", () => {
    it("closes the old fingerprint connection so the next acquire connects with the new config", async () => {
      const harnessed = harness();
      const before = httpConfig("docs", "https://mcp.example.com/mcp");
      const after = httpConfig("docs", "https://mcp.example.com/v2/mcp");

      const connection = await harnessed.manager.acquire(before);
      expect(connection.config.fingerprint).toBe(before.fingerprint);

      await harnessed.manager.handleConfigChange(before, after);

      expect(harnessed.manager.getState(connection.key)).toBe("closed");
      expect(harnessed.manager.size).toBe(0);

      const reconnected = await harnessed.manager.acquire(after);
      expect(reconnected.key).not.toBe(connection.key);
      expect(harnessed.sdk.createdServerIds).toEqual(["docs", "docs"]);
      expect(harnessed.sdk.servers).toHaveLength(2);
    });

    it("keeps the connection when the fingerprint is unchanged", async () => {
      const harnessed = harness();
      const before = httpConfig("docs");
      const after = normalizeMcpServerConfig({
        serverId: "docs",
        scope: "this-vault",
        transport: { kind: "http", url: "https://mcp.example.com/mcp", headerSecretRefs: {} },
      });

      const connection = await harnessed.manager.acquire(before);
      await harnessed.manager.handleConfigChange(before, after);

      expect(harnessed.manager.getState(connection.key)).toBe("connected");
      expect(harnessed.manager.size).toBe(1);
    });
  });

  describe("dispose()", () => {
    it("closes every pooled connection and refuses further acquires", async () => {
      const harnessed = harness();
      const first = await harnessed.manager.acquire(httpConfig("docs"));
      const second = await harnessed.manager.acquire(httpConfig("search"));

      await harnessed.manager.dispose();

      expect(harnessed.manager.getState(first.key)).toBe("closed");
      expect(harnessed.manager.getState(second.key)).toBe("closed");
      expect(harnessed.sdk.servers.every((server) => server.transport.closed)).toBe(true);
      expect(harnessed.sdk.clients.every((client) => client.closed)).toBe(true);
      expect(harnessed.manager.size).toBe(0);
      await expect(harnessed.manager.acquire(httpConfig("docs"))).rejects.toBeInstanceOf(
        McpManagerError
      );
    });
  });
});
