import type { VaultAgentSettings } from "@/settings/model";
import type { PiMcpServiceOptions } from "@/agentMode/sdk/pi/mcp/PiMcpService";
import { normalizeMcpServerConfig, type McpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { FakeMcpTransport } from "./fakeMcpSdk";

let nextVault = 1;

export function mcpConfig(overrides: Partial<McpServerConfig> = {}) {
  return normalizeMcpServerConfig({
    serverId: "docs",
    enabled: true,
    trusted: true,
    scope: "this-vault",
    toolExposure: "direct",
    transport: { kind: "http", url: "https://mcp.example.com/mcp", headerSecretRefs: {} },
    ...overrides,
  });
}

export function piMcpFixture(configs = [mcpConfig()]) {
  const secrets = new Map<string, string>();
  const settings = {
    agentMode: { backends: { pi: { mcpServers: configs } } },
  } as unknown as VaultAgentSettings;
  const tools = [
    {
      name: "echo",
      description: "Read docs",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
  ];
  const clients: Array<{
    connect: jest.Mock;
    close: jest.Mock;
    request: jest.Mock;
    listTools: jest.Mock;
    callTool: jest.Mock;
  }> = [];
  let settingsListener: (() => void) | undefined;
  const options: PiMcpServiceOptions = {
    sessionId: "root-test",
    vaultId: `test-vault-${nextVault++}`,
    getSettings: () => settings,
    getMode: () => "default",
    keychain: {
      isAvailable: () => true,
      getVaultId: () => "test",
      getSecretById: (ref) => secrets.get(ref) ?? null,
      setSecretById: (ref, value) => {
        secrets.set(ref, value);
      },
      deleteSecretById: (ref) => {
        secrets.delete(ref);
      },
    },
    subscribeSettings: (listener) => {
      settingsListener = listener;
      return () => {
        settingsListener = undefined;
      };
    },
    sdk: {
      createClient: () => {
        const client = {
          connect: jest.fn(async () => undefined),
          close: jest.fn(async () => undefined),
          request: jest.fn(async () => ({ tools })),
          listTools: jest.fn(async () => tools),
          callTool: jest.fn(async () => ({
            content: [{ type: "text" as const, text: "approved output" }],
          })),
        };
        clients.push(client);
        return client;
      },
      createTransport: async () => new FakeMcpTransport(),
      isAuthRequiredError: () => false,
    },
    requestPermission: jest.fn(async () => ({
      outcome: { outcome: "selected" as const, optionId: "allow_once" },
    })),
  };
  return {
    options,
    settings,
    secrets,
    clients,
    change: (next: McpServerConfig[]) => {
      settings.agentMode.backends.pi!.mcpServers = next;
      settingsListener?.();
    },
  };
}
