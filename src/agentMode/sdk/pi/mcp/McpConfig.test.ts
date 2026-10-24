import {
  MCP_DEFAULT_TIMEOUT_MS,
  McpConfigError,
  applyMcpConfigChange,
  computeMcpFingerprint,
  exportMcpServerConfig,
  importMcpServerConfigs,
  isMcpFingerprintApproved,
  normalizeMcpServerConfig,
  toExportableMcpConfig,
} from "@/agentMode/sdk/pi/mcp/McpConfig";
import { McpSecretRefs } from "@/agentMode/sdk/pi/mcp/McpSecretRefs";

// A config may carry only secretRefs; the raw token lives in the keychain, so export/import never
// contains plaintext. Shell-evaluated commands, auto-downloading launchers, relative executables and
// implicit env evaluation are rejected, an unknown field is an explicit error, and a changed
// fingerprint invalidates the previous approval:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class MemorySecretStore {
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

function httpConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverId: "docs-server",
    displayName: "Docs",
    scope: "this-vault",
    transport: {
      kind: "http",
      url: "https://mcp.example.com/mcp",
      headerSecretRefs: { Authorization: "mcp:docs-server:authorization" },
    },
    ...overrides,
  };
}

function stdioConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverId: "local-server",
    scope: "project",
    transport: {
      kind: "stdio",
      commandPath: "/usr/local/bin/mcp-server",
      args: ["--stdio"],
      cwd: "/tmp/mcp",
      env: { LOG_LEVEL: "info" },
      envSecretRefs: { API_KEY: "mcp:local-server:api-key" },
    },
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(McpConfigError);
    expect((thrown as McpConfigError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("McpConfig", () => {
  describe("normalizeMcpServerConfig()", () => {
    it("normalizes an HTTP config with header secret refs and defaults", () => {
      const config = normalizeMcpServerConfig(httpConfig());

      expect(config).toMatchObject({
        serverId: "docs-server",
        displayName: "Docs",
        scope: "this-vault",
        enabled: false,
        trusted: false,
        timeoutMs: MCP_DEFAULT_TIMEOUT_MS,
        toolExposure: "deferred",
        credentialRefs: ["mcp:docs-server:authorization"],
      });
      expect(config.transport).toEqual({
        kind: "http",
        url: "https://mcp.example.com/mcp",
        headerSecretRefs: { Authorization: "mcp:docs-server:authorization" },
      });
      expect(config.fingerprint).toHaveLength(64);
      expect(Object.isFrozen(config)).toBe(true);
    });

    it("normalizes a stdio config with literal env and env secret refs", () => {
      const config = normalizeMcpServerConfig(stdioConfig());

      expect(config.transport).toEqual({
        kind: "stdio",
        commandPath: "/usr/local/bin/mcp-server",
        args: ["--stdio"],
        cwd: "/tmp/mcp",
        env: { LOG_LEVEL: "info" },
        envSecretRefs: { API_KEY: "mcp:local-server:api-key" },
      });
      expect(config.credentialRefs).toEqual(["mcp:local-server:api-key"]);
    });

    it("rejects command evaluation, auto-downloading launchers and relative executables", () => {
      expectCode(
        () =>
          normalizeMcpServerConfig(
            stdioConfig({
              transport: {
                kind: "stdio",
                commandPath: "!command --run",
                args: [],
                cwd: "/tmp",
                env: {},
                envSecretRefs: {},
              },
            })
          ),
        "MCP_COMMAND_EVALUATION_DENIED"
      );
      expectCode(
        () =>
          normalizeMcpServerConfig(
            stdioConfig({
              transport: {
                kind: "stdio",
                commandPath: "${SHELL}/server",
                args: [],
                cwd: "/tmp",
                env: {},
                envSecretRefs: {},
              },
            })
          ),
        "MCP_COMMAND_EVALUATION_DENIED"
      );
      expectCode(
        () =>
          normalizeMcpServerConfig(
            stdioConfig({
              transport: {
                kind: "stdio",
                commandPath: "/usr/local/bin/npx",
                args: ["-y", "some-server"],
                cwd: "/tmp",
                env: {},
                envSecretRefs: {},
              },
            })
          ),
        "MCP_COMMAND_EVALUATION_DENIED"
      );
      expectCode(
        () =>
          normalizeMcpServerConfig(
            stdioConfig({
              transport: {
                kind: "stdio",
                commandPath: "./bin/server",
                args: [],
                cwd: "/tmp",
                env: {},
                envSecretRefs: {},
              },
            })
          ),
        "MCP_RELATIVE_EXECUTABLE_DENIED"
      );
      expectCode(
        () =>
          normalizeMcpServerConfig(
            stdioConfig({
              transport: {
                kind: "stdio",
                commandPath: "server",
                args: [],
                cwd: "/tmp",
                env: {},
                envSecretRefs: {},
              },
            })
          ),
        "MCP_RELATIVE_EXECUTABLE_DENIED"
      );
    });

    it("rejects implicit env evaluation and plaintext secrets", () => {
      expectCode(
        () =>
          normalizeMcpServerConfig(
            stdioConfig({
              transport: {
                kind: "stdio",
                commandPath: "/usr/local/bin/mcp-server",
                args: [],
                cwd: "/tmp",
                env: { HOME_HINT: "${HOME}/vault" },
                envSecretRefs: {},
              },
            })
          ),
        "MCP_IMPLICIT_ENV_DENIED"
      );
      expectCode(
        () =>
          normalizeMcpServerConfig(
            stdioConfig({
              transport: {
                kind: "stdio",
                commandPath: "/usr/local/bin/mcp-server",
                args: [],
                cwd: "/tmp",
                env: { API_TOKEN: "raw-secret" },
                envSecretRefs: {},
              },
            })
          ),
        "MCP_SECRET_PLAINTEXT_DENIED"
      );
      expectCode(
        () =>
          normalizeMcpServerConfig(
            httpConfig({
              transport: {
                kind: "http",
                url: "https://mcp.example.com/mcp",
                headerSecretRefs: { Authorization: "Bearer raw-secret" },
              },
            })
          ),
        "MCP_SECRET_PLAINTEXT_DENIED"
      );
      expectCode(
        () =>
          normalizeMcpServerConfig(httpConfig({ headers: { Authorization: "Bearer raw-secret" } })),
        "MCP_SECRET_PLAINTEXT_DENIED"
      );
    });

    it("rejects insecure or credential-bearing URLs and relative cwd", () => {
      expectCode(
        () =>
          normalizeMcpServerConfig(
            httpConfig({
              transport: {
                kind: "http",
                url: "http://mcp.example.com/mcp",
                headerSecretRefs: {},
              },
            })
          ),
        "MCP_INSECURE_URL_DENIED"
      );
      expectCode(
        () =>
          normalizeMcpServerConfig(
            httpConfig({
              transport: {
                kind: "http",
                url: "https://user:pass@mcp.example.com/mcp",
                headerSecretRefs: {},
              },
            })
          ),
        "MCP_SECRET_PLAINTEXT_DENIED"
      );
      expect(
        normalizeMcpServerConfig(
          httpConfig({
            transport: { kind: "http", url: "http://localhost:3333/mcp", headerSecretRefs: {} },
          })
        ).transport
      ).toMatchObject({ kind: "http", url: "http://localhost:3333/mcp" });
      expectCode(
        () =>
          normalizeMcpServerConfig(
            stdioConfig({
              transport: {
                kind: "stdio",
                commandPath: "/usr/local/bin/mcp-server",
                args: [],
                cwd: "relative/dir",
                env: {},
                envSecretRefs: {},
              },
            })
          ),
        "MCP_CONFIG_INVALID"
      );
    });

    it("reports an unknown field explicitly", () => {
      expectCode(
        () => normalizeMcpServerConfig(httpConfig({ notes: "hello" })),
        "MCP_UNKNOWN_FIELD"
      );
      try {
        normalizeMcpServerConfig(httpConfig({ notes: "hello" }));
      } catch (thrown) {
        expect((thrown as McpConfigError).field).toBe("notes");
      }
      expectCode(
        () => normalizeMcpServerConfig(httpConfig({ scope: "workspace" })),
        "MCP_CONFIG_INVALID"
      );
    });
  });

  describe("computeMcpFingerprint()", () => {
    it("is stable for identical configs and changes when security-relevant fields change", () => {
      const first = normalizeMcpServerConfig(stdioConfig());
      const same = normalizeMcpServerConfig(stdioConfig());
      const changedArgs = normalizeMcpServerConfig(
        stdioConfig({
          transport: {
            kind: "stdio",
            commandPath: "/usr/local/bin/mcp-server",
            args: ["--stdio", "--verbose"],
            cwd: "/tmp/mcp",
            env: { LOG_LEVEL: "info" },
            envSecretRefs: { API_KEY: "mcp:local-server:api-key" },
          },
        })
      );
      const changedSecretRef = normalizeMcpServerConfig(
        stdioConfig({
          transport: {
            kind: "stdio",
            commandPath: "/usr/local/bin/mcp-server",
            args: ["--stdio"],
            cwd: "/tmp/mcp",
            env: { LOG_LEVEL: "info" },
            envSecretRefs: { API_KEY: "mcp:local-server:rotated-key" },
          },
        })
      );

      expect(computeMcpFingerprint(first)).toBe(first.fingerprint);
      expect(same.fingerprint).toBe(first.fingerprint);
      expect(changedArgs.fingerprint).not.toBe(first.fingerprint);
      expect(changedSecretRef.fingerprint).not.toBe(first.fingerprint);
    });

    it("does not change when only the display name or enabled flag changes", () => {
      const base = normalizeMcpServerConfig(httpConfig());
      const renamed = normalizeMcpServerConfig(
        httpConfig({ displayName: "Docs (renamed)", enabled: true })
      );

      expect(renamed.fingerprint).toBe(base.fingerprint);
    });
  });

  describe("isMcpFingerprintApproved()", () => {
    it("invalidates the previous approval when the fingerprint changes", () => {
      const approved = normalizeMcpServerConfig(stdioConfig());
      const approvedFingerprint = approved.fingerprint;
      expect(isMcpFingerprintApproved(approved, approvedFingerprint)).toBe(true);
      expect(isMcpFingerprintApproved(approved, null)).toBe(false);

      const changed = normalizeMcpServerConfig(
        stdioConfig({
          transport: {
            kind: "stdio",
            commandPath: "/usr/local/bin/mcp-server",
            args: ["--stdio", "--danger"],
            cwd: "/tmp/mcp",
            env: { LOG_LEVEL: "info" },
            envSecretRefs: { API_KEY: "mcp:local-server:api-key" },
          },
        })
      );
      expect(isMcpFingerprintApproved(changed, approvedFingerprint)).toBe(false);
    });
  });

  describe("applyMcpConfigChange()", () => {
    it("bumps the revision only for a changed fingerprint and drops trust on change", () => {
      const first = applyMcpConfigChange(null, {
        ...httpConfig(),
        enabled: true,
        trusted: true,
      });
      expect(first).toMatchObject({ revision: 1, enabled: true, trusted: true });

      const unchanged = applyMcpConfigChange(first, {
        ...httpConfig(),
        enabled: true,
        trusted: true,
      });
      expect(unchanged).toMatchObject({ revision: 1, enabled: true, trusted: true });

      const changed = applyMcpConfigChange(first, {
        ...httpConfig({
          transport: {
            kind: "http",
            url: "https://mcp.example.com/v2/mcp",
            headerSecretRefs: { Authorization: "mcp:docs-server:authorization" },
          },
        }),
        enabled: true,
        trusted: true,
      });
      expect(changed).toMatchObject({ revision: 2, enabled: true, trusted: false });
      expect(changed.fingerprint).not.toBe(first.fingerprint);
    });

    it("refuses a change that renames the serverId", () => {
      const first = applyMcpConfigChange(null, httpConfig());
      expectCode(
        () => applyMcpConfigChange(first, httpConfig({ serverId: "other-server" })),
        "MCP_CONFIG_INVALID"
      );
    });
  });

  describe("exportMcpServerConfig()", () => {
    it("exports secret refs without any plaintext value from the keychain", async () => {
      const store = new MemorySecretStore();
      const secrets = new McpSecretRefs({ store });
      const auth = await secrets.store("docs-server", "authorization", "Bearer sk-live-123");
      const apiKey = await secrets.store("local-server", "api-key", "sk-local-456");
      const http = normalizeMcpServerConfig(
        httpConfig({
          transport: {
            kind: "http",
            url: "https://mcp.example.com/mcp",
            headerSecretRefs: { Authorization: auth.ref },
          },
        })
      );
      const stdio = normalizeMcpServerConfig(
        stdioConfig({
          transport: {
            kind: "stdio",
            commandPath: "/usr/local/bin/mcp-server",
            args: ["--stdio"],
            cwd: "/tmp/mcp",
            env: { LOG_LEVEL: "info" },
            envSecretRefs: { API_KEY: apiKey.ref },
          },
        })
      );

      const exported = `${exportMcpServerConfig(http)}\n${exportMcpServerConfig(stdio)}`;

      expect(exported).not.toContain("sk-live-123");
      expect(exported).not.toContain("sk-local-456");
      expect(exported).toContain("mcp:docs-server:authorization");
      expect(exported).toContain("mcp:local-server:api-key");
      expect(JSON.parse(exportMcpServerConfig(http))).toMatchObject({
        credentialRefs: ["mcp:docs-server:authorization"],
        transport: { kind: "http", headerSecretRefs: { Authorization: auth.ref } },
      });
      expect(Object.isFrozen(toExportableMcpConfig(stdio).transport)).toBe(true);
    });
  });

  describe("importMcpServerConfigs()", () => {
    it("imports configs disabled and untrusted with a fresh revision", () => {
      const imported = importMcpServerConfigs(
        JSON.stringify([
          { ...httpConfig(), enabled: true, trusted: true, revision: 9 },
          stdioConfig(),
        ])
      );

      expect(imported).toHaveLength(2);
      for (const config of imported) {
        expect(config).toMatchObject({ enabled: false, trusted: false, revision: 1 });
        expect(config.fingerprint).toHaveLength(64);
      }
      expect(imported[0]?.transport.kind).toBe("http");
      expect(imported[1]?.transport.kind).toBe("stdio");
    });

    it("rejects an unknown field in an imported config instead of dropping it", () => {
      expectCode(
        () => importMcpServerConfigs([{ ...httpConfig(), mystery: true }]),
        "MCP_UNKNOWN_FIELD"
      );
    });
  });
});
