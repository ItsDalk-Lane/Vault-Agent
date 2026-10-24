import {
  McpSettings,
  type McpServerView,
  type McpSettingsProps,
} from "@/agentMode/backends/pi/ui/McpSettings";
import type { Meta, StoryObj } from "@/lib/story";

// Real MCP settings states: an empty panel, a connected HTTP server with tools, an OAuth
// authorization in flight, and a stdio server that stays disabled because its interpreter is
// missing:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const connectedHttp: McpServerView = {
  serverId: "docs-server",
  displayName: "Docs",
  scope: "this-vault",
  transport: "http",
  enabled: true,
  trusted: true,
  connection: "connected",
  toolCount: 12,
  testStatus: "connected",
  testToolCount: 12,
  testDurationMs: 240,
};

const oauthPending: McpServerView = {
  serverId: "remote-server",
  displayName: "Remote",
  scope: "global",
  transport: "http",
  enabled: true,
  trusted: true,
  connection: "auth_required",
  toolCount: 0,
  oauth: { status: "pending", host: "mcp.example.com", scopes: ["read", "write"] },
};

const stdioUnavailable: McpServerView = {
  serverId: "local-server",
  displayName: "Local tools",
  scope: "project",
  transport: "stdio",
  enabled: false,
  trusted: false,
  connection: "idle",
  toolCount: 0,
  stdio: { commandPath: "/usr/local/bin/mcp-server", interpreterAvailable: false },
};

const meta = {
  title: "Settings/MCP Servers",
  component: McpSettings,
  args: {
    servers: [connectedHttp],
    onAdd: () => undefined,
    onEdit: () => undefined,
    onDelete: () => undefined,
    onToggleEnabled: () => undefined,
    onChangeScope: () => undefined,
    onTest: () => undefined,
    onConnect: () => undefined,
    onDisconnect: () => undefined,
    onAuthorize: () => undefined,
    onCancelAuthorize: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<McpSettingsProps>;
export default meta;

export const ConnectedHttp: StoryObj<McpSettingsProps> = {};

export const Empty: StoryObj<McpSettingsProps> = {
  args: { servers: [] },
};

export const OAuthPending: StoryObj<McpSettingsProps> = {
  args: { servers: [oauthPending] },
};

export const StdioInterpreterUnavailable: StoryObj<McpSettingsProps> = {
  args: { servers: [stdioUnavailable] },
};

export const LegacySseUnsupported: StoryObj<McpSettingsProps> = {
  args: {
    servers: [{ ...connectedHttp, connection: "error", unsupported: ["legacy_sse"] }],
  },
};
