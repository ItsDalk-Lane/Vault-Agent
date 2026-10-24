import {
  McpSecretRefError,
  McpSecretRefs,
  assertMcpSecretRef,
  isMcpSecretRef,
  mcpSecretRef,
} from "@/agentMode/sdk/pi/mcp/McpSecretRefs";

// Credentials are stored by ref in the keychain: the config carries only `mcp:<server>:<field>`, a
// plaintext value is refused, and resolving an invalid ref fails instead of reading something else:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemorySecretStore {
  readonly values = new Map<string, string>();
  readonly deletes: string[] = [];
  async read(ref: string): Promise<string | undefined> {
    return this.values.get(ref);
  }
  async write(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }
  async delete(ref: string): Promise<void> {
    this.deletes.push(ref);
    this.values.delete(ref);
  }
}

describe("McpSecretRefs", () => {
  describe("mcpSecretRef()", () => {
    it("builds a namespaced ref from a server and field", () => {
      expect(mcpSecretRef("Docs Server", "Authorization")).toBe("mcp:docs-server:authorization");
      expect(mcpSecretRef("local.server", "api_key")).toBe("mcp:local.server:api_key");
    });

    it("refuses a ref without a server or field", () => {
      expect(() => mcpSecretRef("  ", "token")).toThrow(McpSecretRefError);
      expect(() => mcpSecretRef("server", "!!!")).toThrow(McpSecretRefError);
    });
  });

  describe("isMcpSecretRef()", () => {
    it("accepts only the namespaced ref shape", () => {
      expect(isMcpSecretRef("mcp:docs:authorization")).toBe(true);
      expect(isMcpSecretRef("Bearer sk-live-123")).toBe(false);
      expect(isMcpSecretRef("keychain:docs:authorization")).toBe(false);
      expect(isMcpSecretRef(undefined)).toBe(false);
    });
  });

  describe("assertMcpSecretRef()", () => {
    it("returns a valid ref and rejects a plaintext value explicitly", () => {
      expect(assertMcpSecretRef("mcp:docs:authorization", "header")).toBe("mcp:docs:authorization");
      expect(() => assertMcpSecretRef("sk-live-123", "header")).toThrow(McpSecretRefError);
      try {
        assertMcpSecretRef("sk-live-123", "header");
      } catch (thrown) {
        expect((thrown as McpSecretRefError).code).toBe("MCP_SECRET_PLAINTEXT_DENIED");
      }
      try {
        assertMcpSecretRef("", "header");
      } catch (thrown) {
        expect((thrown as McpSecretRefError).code).toBe("MCP_SECRET_REF_INVALID");
      }
    });
  });

  describe("McpSecretRefs", () => {
    it("stores a value under a ref and resolves it back", async () => {
      const store = new MemorySecretStore();
      const secrets = new McpSecretRefs({ store });

      const ref = await secrets.store("docs-server", "authorization", "Bearer sk-live-123");

      expect(ref).toEqual({ ref: "mcp:docs-server:authorization", source: "keychain" });
      expect(store.values.get(ref.ref)).toBe("Bearer sk-live-123");
      await expect(secrets.resolve(ref.ref)).resolves.toBe("Bearer sk-live-123");
    });

    it("refuses an empty secret value and an invalid ref", async () => {
      const store = new MemorySecretStore();
      const secrets = new McpSecretRefs({ store });

      await expect(secrets.store("docs-server", "authorization", "")).rejects.toBeInstanceOf(
        McpSecretRefError
      );
      await expect(secrets.resolve("sk-live-123")).rejects.toBeInstanceOf(McpSecretRefError);
      await expect(secrets.remove("sk-live-123")).rejects.toBeInstanceOf(McpSecretRefError);
    });

    it("removes a stored secret by ref", async () => {
      const store = new MemorySecretStore();
      const secrets = new McpSecretRefs({ store });
      const ref = await secrets.store("docs-server", "authorization", "Bearer sk-live-123");

      await secrets.remove(ref.ref);

      expect(store.deletes).toEqual([ref.ref]);
      await expect(secrets.resolve(ref.ref)).resolves.toBeUndefined();
    });
  });
});
