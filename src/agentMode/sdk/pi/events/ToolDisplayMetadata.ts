import type { AgentToolKind } from "@/agentMode/session/types";

// Native tool names keep the fixed display aliases the existing cards were built around, while an
// MCP tool keeps its raw name and server so a tool that happens to be called "Agent" is never
// mistaken for the subagent control tool:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const TOOL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  read: "Read",
  write: "Write",
  edit: "Edit",
  web_search: "WebSearch",
  bash: "Bash",
  powershell: "Bash",
  delegate_task: "Agent",
  start_background_task: "Agent",
});

const TOOL_KINDS: Readonly<Record<string, AgentToolKind>> = Object.freeze({
  read: "read",
  write: "edit",
  edit: "edit",
  delete: "delete",
  move: "move",
  search: "search",
  web_search: "fetch",
  grep: "search",
  bash: "execute",
  powershell: "execute",
  fetch: "fetch",
});

export interface ToolDisplayMetadata {
  /** The provider's tool name, kept for the card title and for MCP attribution.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  readonly title: string;
  readonly vendorToolName: string;
  readonly toolKind: AgentToolKind;
  readonly mcpServer?: string;
}

export function toolKindFor(toolName: string): AgentToolKind {
  return TOOL_KINDS[toolName.toLowerCase()] ?? "other";
}

export function vendorToolNameFor(toolName: string): string {
  return TOOL_ALIASES[toolName.toLowerCase()] ?? toolName;
}

export function namespacedToolCallId(sessionId: string, toolCallId: string): string {
  return `pi:${sessionId}:${toolCallId}`;
}

export function durableToolCallId(
  sessionId: string,
  taskId: string | number | undefined,
  callId: string
): string {
  return taskId === undefined
    ? namespacedToolCallId(sessionId, callId)
    : `pi-task:${sessionId}:${taskId}`;
}

export function toolDisplayMetadataFor(
  toolName: string,
  options: { readonly mcpServer?: string } = {}
): ToolDisplayMetadata {
  if (options.mcpServer !== undefined) {
    return {
      title: toolName,
      vendorToolName: toolName,
      toolKind: "other",
      mcpServer: options.mcpServer,
    };
  }
  return {
    title: toolName,
    vendorToolName: vendorToolNameFor(toolName),
    toolKind: toolKindFor(toolName),
  };
}
