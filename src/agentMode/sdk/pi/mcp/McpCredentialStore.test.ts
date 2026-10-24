import {
  McpCredentialError,
  McpCredentialStore,
  type McpKeychainPort,
} from "@/agentMode/sdk/pi/mcp/McpCredentialStore";

// OAuth credentials live in the keychain under a dedicated namespace, are keyed by the exact server
// origin, and every save carries the generation captured before the await so a signOut wins:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemoryKeychain implements McpKeychainPort {
  readonly values = new Map<string, string>();
  failNext = false;
  async read(ref: string): Promise<string | undefined> {
    if (this.failNext) throw new Error("keychain unavailable");
    return this.values.get(ref);
  }
  async write(ref: string, value: string): Promise<void> {
    if (this.failNext) throw new Error("keychain unavailable");
    this.values.set(ref, value);
  }
  async delete(ref: string): Promise<void> {
    if (this.failNext) throw new Error("keychain unavailable");
    this.values.delete(ref);
  }
}

function harness() {
  const keychain = new MemoryKeychain();
  const store = new McpCredentialStore({ keychain, now: () => 1_000 });
  return { keychain, store };
}

describe("McpCredentialStore", () => {
  describe("saveTokens()", () => {
    it("stores tokens under an origin-scoped keychain ref and never returns them for another origin", async () => {
      const harnessed = harness();

      const saved = await harnessed.store.saveTokens("docs", "https://mcp.example.com", {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: 5_000,
      });

      expect(saved).toBe(true);
      const ref = harnessed.store.refFor("docs", "https://mcp.example.com");
      expect(ref.startsWith("mcp-oauth:docs:")).toBe(true);
      expect(ref.startsWith("mcp:")).toBe(false);
      await expect(
        harnessed.store.credentials("docs", "https://mcp.example.com")
      ).resolves.toMatchObject({
        tokens: { accessToken: "access-1", refreshToken: "refresh-1" },
      });
      await expect(
        harnessed.store.credentials("docs", "https://other.example.com")
      ).resolves.toBeUndefined();
      await expect(harnessed.store.load("docs", "https://mcp.example.com")).resolves.toMatchObject({
        origin: "https://mcp.example.com",
        generation: 0,
      });
    });

    it("rejects a write whose generation is stale after signOut", async () => {
      const harnessed = harness();
      const generation = harnessed.store.generationOf("docs");
      await harnessed.store.saveTokens("docs", "https://mcp.example.com", {
        accessToken: "access-1",
      });

      await harnessed.store.signOut("docs", "https://mcp.example.com");
      const late = await harnessed.store.saveTokens(
        "docs",
        "https://mcp.example.com",
        { accessToken: "late-access" },
        generation
      );

      expect(late).toBe(false);
      await expect(
        harnessed.store.credentials("docs", "https://mcp.example.com")
      ).resolves.toBeUndefined();
      await expect(harnessed.store.isCurrent("docs", generation)).resolves.toBe(false);
    });

    it("surfaces a keychain failure as an explicit store error", async () => {
      const harnessed = harness();
      harnessed.keychain.failNext = true;

      await expect(
        harnessed.store.saveTokens("docs", "https://mcp.example.com", { accessToken: "a" })
      ).rejects.toBeInstanceOf(McpCredentialError);
    });

    it("ignores a malformed stored record", async () => {
      const harnessed = harness();
      const ref = harnessed.store.refFor("docs", "https://mcp.example.com");
      harnessed.keychain.values.set(ref, "not json");

      await expect(
        harnessed.store.load("docs", "https://mcp.example.com")
      ).resolves.toBeUndefined();
    });
  });

  describe("setOrigin()", () => {
    it("invalidates the previous origin credentials when the origin changes", async () => {
      const harnessed = harness();
      await harnessed.store.setOrigin("docs", "https://old.example.com");
      await harnessed.store.saveTokens("docs", "https://old.example.com", { accessToken: "old" });

      const changed = await harnessed.store.setOrigin("docs", "https://new.example.com");

      expect(changed).toBe(true);
      await expect(
        harnessed.store.credentials("docs", "https://old.example.com")
      ).resolves.toBeUndefined();
      await expect(
        harnessed.store.credentials("docs", "https://new.example.com")
      ).resolves.toBeUndefined();
      expect(harnessed.store.generationOf("docs")).toBe(1);
      expect(await harnessed.store.setOrigin("docs", "https://new.example.com")).toBe(false);
    });
  });

  describe("signOut()", () => {
    it("bumps the generation and removes the origin credentials", async () => {
      const harnessed = harness();
      await harnessed.store.setOrigin("docs", "https://mcp.example.com");
      await harnessed.store.saveTokens("docs", "https://mcp.example.com", { accessToken: "a" });

      const generation = await harnessed.store.signOut("docs");

      expect(generation).toBe(1);
      await expect(
        harnessed.store.credentials("docs", "https://mcp.example.com")
      ).resolves.toBeUndefined();
      expect(harnessed.keychain.values.size).toBe(0);
    });
  });
});
