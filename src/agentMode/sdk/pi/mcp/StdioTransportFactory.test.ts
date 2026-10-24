import type { McpStdioTransport } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  StdioFactoryError,
  StdioTransportFactory,
  type StdioLaunchPlan,
  type StdioProcessTerminator,
} from "@/agentMode/sdk/pi/mcp/StdioTransportFactory";
import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import { FakeMcpTransport } from "@/agentMode/sdk/pi/mcp/__tests__/fakeMcpSdk";

// strict never starts an opaque local server, trusted_host needs its own risk authorization, the
// command and cwd are absolute and must exist (never resolved through PATH), the child inherits no
// environment and receives only this server's granted secrets, a missing interpreter disables just
// that server, and close asks the terminator to clean the real process:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeTerminator implements StdioProcessTerminator {
  readonly calls: Array<{ plan: StdioLaunchPlan; reason: string }> = [];
  result: "confirmed" | "incomplete" = "confirmed";
  async terminate(
    plan: StdioLaunchPlan,
    reason: "closed" | "cancelled"
  ): Promise<"confirmed" | "incomplete"> {
    this.calls.push({ plan, reason });
    return this.result;
  }
}

function stdioConfig(overrides: Partial<McpStdioTransport> = {}): McpStdioTransport {
  return {
    kind: "stdio",
    commandPath: "/usr/local/bin/mcp-server",
    args: ["--stdio"],
    cwd: "/tmp/mcp",
    env: {},
    envSecretRefs: {},
    ...overrides,
  };
}

interface Harness {
  readonly factory: StdioTransportFactory;
  readonly created: StdioLaunchPlan[];
  readonly transport: FakeMcpTransport;
  readonly terminate: FakeTerminator;
}

function harness(
  options: {
    exists?: (path: string) => Promise<boolean>;
    secretValue?: string | undefined;
    parentEnv?: Readonly<Record<string, string | undefined>>;
  } = {}
): Harness {
  const parentEnv = options.parentEnv ?? {
    PATH: "/usr/bin:/bin",
    HOME: "/Users/example",
    USER: "example",
    ANTHROPIC_API_KEY: "sk-ant-model-key",
    OPENAI_API_KEY: "sk-openai-model-key",
  };
  const created: StdioLaunchPlan[] = [];
  const transport = new FakeMcpTransport();
  const terminate = new FakeTerminator();
  const factory = new StdioTransportFactory({
    environment: new CommandEnvironment({ platform: "darwin", parentEnv }),
    exists: options.exists ?? (async () => true),
    createTransport: (plan) => {
      created.push(plan);
      return transport;
    },
    terminate,
    resolveSecret: async () => ("secretValue" in options ? options.secretValue : "server-secret"),
    defaultRiskAuthorized: true,
  });
  return { factory, created, transport, terminate };
}

function request(config: McpStdioTransport, overrides: Record<string, unknown> = {}) {
  return {
    serverId: "local-server",
    config,
    riskAuthorized: true,
    interpreterAvailable: true,
    ...overrides,
  };
}

async function expectCode(
  operation: () => Promise<unknown>,
  code: string
): Promise<StdioFactoryError> {
  try {
    await operation();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(StdioFactoryError);
    expect((thrown as StdioFactoryError).code).toBe(code);
    return thrown as StdioFactoryError;
  }
  throw new Error(`Expected ${code}`);
}

describe("StdioTransportFactory", () => {
  describe("create()", () => {
    it("requires the config-level risk authorization before any start (https://github.com/ItsDalk-Lane/Vault-Agent/issues/15)", async () => {
      const harnessed = harness();

      await expectCode(
        () => harnessed.factory.create(request(stdioConfig(), { riskAuthorized: false })),
        "MCP_STDIO_NOT_TRUSTED"
      );
      expect(harnessed.created).toEqual([]);
    });

    it("rejects an auto-downloading launcher and a relative command", async () => {
      const harnessed = harness();

      await expectCode(
        () => harnessed.factory.create(request(stdioConfig({ commandPath: "/usr/bin/npx" }))),
        "MCP_STDIO_INVALID_CONFIG"
      );
      await expectCode(
        () => harnessed.factory.create(request(stdioConfig({ commandPath: "./mcp-server" }))),
        "MCP_STDIO_INVALID_CONFIG"
      );
      expect(harnessed.created).toEqual([]);
    });

    it("inherits no model API key and only injects this server's granted secrets", async () => {
      const harnessed = harness();

      const handle = await harnessed.factory.create(
        request(
          stdioConfig({
            env: { LOG_LEVEL: "debug" },
            envSecretRefs: { MCP_TOKEN: "mcp:local-server:token" },
          })
        )
      );

      expect(handle.plan.inheritEnv).toBe(false);
      expect(handle.plan.env).toMatchObject({
        LOG_LEVEL: "debug",
        MCP_TOKEN: "server-secret",
        PATH: "/usr/bin:/bin",
      });
      expect(handle.plan.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(handle.plan.env.OPENAI_API_KEY).toBeUndefined();
      expect(handle.plan.secretEnvKeys).toEqual(["MCP_TOKEN"]);
      expect(harnessed.created).toHaveLength(1);
      expect(handle.transport).toBe(harnessed.transport);
    });

    it("fails when a granted secret is missing instead of starting without it", async () => {
      const harnessed = harness({ secretValue: undefined });

      await expectCode(
        () =>
          harnessed.factory.create(
            request(stdioConfig({ envSecretRefs: { MCP_TOKEN: "mcp:local-server:token" } }))
          ),
        "MCP_STDIO_SECRET_MISSING"
      );
      expect(harnessed.created).toEqual([]);
    });

    it("does not fall back to PATH when the absolute command is missing", async () => {
      const harnessed = harness({
        exists: async (path) => path !== "/usr/local/bin/mcp-server",
      });

      const error = await expectCode(
        () => harnessed.factory.create(request(stdioConfig())),
        "MCP_STDIO_COMMAND_MISSING"
      );

      expect(error.message).toContain("PATH lookup is not used");
      expect(harnessed.created).toEqual([]);
    });

    it("reports a missing cwd before creating a transport", async () => {
      const harnessed = harness({ exists: async (path) => path !== "/tmp/mcp" });

      await expectCode(
        () => harnessed.factory.create(request(stdioConfig())),
        "MCP_STDIO_CWD_MISSING"
      );
      expect(harnessed.created).toEqual([]);
    });

    it("disables only the server whose interpreter is unavailable", async () => {
      const harnessed = harness();

      await expectCode(
        () =>
          harnessed.factory.create(
            request(stdioConfig({ commandPath: "/usr/local/bin/node" }), {
              interpreterAvailable: false,
            })
          ),
        "MCP_STDIO_INTERPRETER_UNAVAILABLE"
      );
      expect(harnessed.created).toEqual([]);

      const other = await harnessed.factory.create(
        request(stdioConfig(), { interpreterAvailable: false })
      );
      expect(other.plan.command).toBe("/usr/local/bin/mcp-server");
      expect(harnessed.created).toHaveLength(1);
    });

    it("closes the injected transport and requests cleanup from its supplied terminator", async () => {
      const harnessed = harness();
      const handle = await harnessed.factory.create(request(stdioConfig()));

      const result = await handle.close();

      expect(harnessed.transport.closed).toBe(true);
      expect(result).toEqual({ status: "closed", cleanup: "clean" });
      expect(harnessed.terminate.calls).toHaveLength(1);
      expect(harnessed.terminate.calls[0]).toMatchObject({
        reason: "closed",
        plan: { serverId: "local-server", command: "/usr/local/bin/mcp-server" },
      });
    });

    it("starts actual local stdio servers through the SDK and verifies their original OS processes exit after manager and factory close https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const report = JSON.parse(
        execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "mcpStdio"], {
          cwd: path.resolve(__dirname, "../../../../.."),
          encoding: "utf8",
          timeout: 30_000,
        })
      ) as {
        status: string;
        scenarioId: string;
        processes: {
          label: string;
          pid: number;
          exited: boolean;
          signal: string;
          stdinClosed: boolean;
        }[];
        orphanedProcesses: number;
        checks: string[];
      };
      expect(report.status).toBe("passed");
      expect(report.scenarioId).toBe("SC-P09-T08-04");
      expect(report.orphanedProcesses).toBe(0);
      expect(report.processes.map((entry) => entry.label)).toEqual([
        "production_service_manager",
        "factory_handle",
      ]);
      for (const entry of report.processes) {
        expect(entry.pid).toBeGreaterThan(0);
        expect(entry).toMatchObject({ exited: true, signal: "SIGTERM", stdinClosed: true });
      }
      expect(report.checks).toEqual([
        "strict_gate_spawns_no_os_process",
        "actual_sdk_initialize_list_and_call_over_stdio",
        "production_service_manager_close_terminates_original_pid",
        "factory_handle_close_requires_verified_os_process_exit",
        "stdin_close_is_followed_by_real_sigterm_not_only_fake_cleanup",
        "actual_child_environment_does_not_inherit_model_keys",
      ]);
    }, 35_000);

    it("reports an unproven cleanup instead of claiming a clean close", async () => {
      const harnessed = harness();
      harnessed.terminate.result = "incomplete";
      const handle = await harnessed.factory.create(request(stdioConfig()));

      const result = await handle.close();

      expect(result).toEqual({ status: "closed", cleanup: "cleanup_incomplete" });
    });
  });
});
