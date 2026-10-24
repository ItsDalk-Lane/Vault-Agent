import { PiMcpServerForm, type PiMcpServerFormProps } from "./PiMcpServerForm";
import type { McpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";

const base: McpServerConfig = {
  serverId: "docs",
  displayName: "Docs",
  scope: "this-vault",
  enabled: true,
  trusted: true,
  transport: {
    kind: "http",
    url: "https://docs.example.com/mcp",
    headerSecretRefs: {},
    oauth: { scopes: ["read"] },
  },
  timeoutMs: 30000,
  toolExposure: "deferred",
  credentialRefs: [],
  revision: 1,
  fingerprint: "fixture",
};
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Pi MCP Server Form",
  component: PiMcpServerForm,
  args: { onSave: () => undefined, onCancel: () => undefined },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<PiMcpServerFormProps>;
export default meta;
export const Http: StoryObj<PiMcpServerFormProps> = {};
export const BrowserAuthorization: StoryObj<PiMcpServerFormProps> = { args: { config: base } };
export const LocalProgram: StoryObj<PiMcpServerFormProps> = {
  args: {
    config: {
      ...base,
      serverId: "local",
      displayName: "Local",
      transport: {
        kind: "stdio",
        commandPath: "/usr/local/bin/mcp-server",
        args: ["--read-only"],
        cwd: "/Users/example/Documents",
        env: {},
        envSecretRefs: {},
      },
    },
  },
};
