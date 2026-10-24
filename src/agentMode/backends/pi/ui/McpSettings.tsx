import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { McpScope } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { McpServerRow } from "@/agentMode/backends/pi/ui/McpServerRow";
import React from "react";

// The MCP settings panel reads real config/connection/test/OAuth state through its props and never
// renders a static mock: disabling a server drops its connection and tool catalog, an unsupported
// protocol says so, a cancelled authorization becomes actionable again, and editing/deleting/scope
// changes are explicit user actions. The reducer here is what a host state container uses to apply
// those transitions:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type McpConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "auth_required"
  | "error"
  | "closed";

export type McpOAuthStatusView = "none" | "pending" | "authorized" | "cancelled" | "failed";

export type McpTestStatusView = "connected" | "auth_required" | "error" | "timed_out" | "cancelled";

export interface McpServerView {
  readonly serverId: string;
  readonly displayName: string;
  readonly scope: McpScope;
  readonly transport: "http" | "stdio";
  readonly enabled: boolean;
  readonly trusted: boolean;
  readonly connection: McpConnectionStatus;
  readonly toolCount: number;
  readonly error?: string;
  readonly blockedReason?: string;
  readonly testStatus?: McpTestStatusView;
  readonly testToolCount?: number;
  readonly testDurationMs?: number;
  readonly oauth?: {
    readonly status: McpOAuthStatusView;
    readonly host: string;
    readonly scopes: readonly string[];
  };
  readonly stdio?: { readonly commandPath: string; readonly interpreterAvailable: boolean };
  readonly unsupported?: readonly string[];
}

export type McpServerChange =
  | { readonly type: "enable"; readonly serverId: string }
  | { readonly type: "disable"; readonly serverId: string }
  | { readonly type: "scope"; readonly serverId: string; readonly scope: McpScope }
  | { readonly type: "delete"; readonly serverId: string }
  | { readonly type: "connect"; readonly serverId: string; readonly status: McpConnectionStatus }
  | { readonly type: "disconnect"; readonly serverId: string }
  | { readonly type: "oauth-cancel"; readonly serverId: string }
  | {
      readonly type: "test-result";
      readonly serverId: string;
      readonly status: McpTestStatusView;
      readonly toolCount: number;
      readonly durationMs: number;
    };

export function applyMcpServerChange(
  servers: readonly McpServerView[],
  change: McpServerChange
): readonly McpServerView[] {
  if (change.type === "delete") {
    return Object.freeze(servers.filter((server) => server.serverId !== change.serverId));
  }
  return Object.freeze(
    servers.map((server): McpServerView => {
      if (server.serverId !== change.serverId) return server;
      switch (change.type) {
        case "enable":
          return { ...server, enabled: true };
        case "disable":
          return { ...withoutError(server), enabled: false, connection: "closed", toolCount: 0 };
        case "scope":
          return { ...server, scope: change.scope };
        case "connect":
          return { ...server, connection: change.status };
        case "disconnect":
          return { ...server, connection: "closed", toolCount: 0 };
        case "oauth-cancel":
          return {
            ...withoutError(server),
            ...(server.oauth === undefined
              ? {}
              : { oauth: { ...server.oauth, status: "cancelled" as const } }),
          };
        case "test-result":
          return {
            ...server,
            testStatus: change.status,
            testToolCount: change.toolCount,
            testDurationMs: change.durationMs,
            toolCount: change.status === "connected" ? change.toolCount : server.toolCount,
          };
        default:
          return server;
      }
    })
  );
}

function withoutError(server: McpServerView): McpServerView {
  return {
    serverId: server.serverId,
    displayName: server.displayName,
    scope: server.scope,
    transport: server.transport,
    enabled: server.enabled,
    trusted: server.trusted,
    connection: server.connection,
    toolCount: server.toolCount,
    ...(server.testStatus !== undefined ? { testStatus: server.testStatus } : {}),
    ...(server.testToolCount !== undefined ? { testToolCount: server.testToolCount } : {}),
    ...(server.testDurationMs !== undefined ? { testDurationMs: server.testDurationMs } : {}),
    ...(server.oauth !== undefined ? { oauth: server.oauth } : {}),
    ...(server.stdio !== undefined ? { stdio: server.stdio } : {}),
    ...(server.blockedReason !== undefined ? { blockedReason: server.blockedReason } : {}),
    ...(server.unsupported !== undefined ? { unsupported: server.unsupported } : {}),
  };
}

export interface McpSettingsProps {
  readonly servers: readonly McpServerView[];
  readonly busyServerIds?: readonly string[];
  readonly onAdd?: () => void;
  readonly onEdit?: (serverId: string) => void;
  readonly onDelete?: (serverId: string) => void;
  readonly onToggleEnabled?: (serverId: string, enabled: boolean) => void;
  readonly onChangeScope?: (serverId: string, scope: McpScope) => void;
  readonly onTest?: (serverId: string) => void;
  readonly onConnect?: (serverId: string) => void;
  readonly onDisconnect?: (serverId: string) => void;
  readonly onAuthorize?: (serverId: string) => void;
  readonly onCancelAuthorize?: (serverId: string) => void;
}

export const McpSettings: React.FC<McpSettingsProps> = ({
  servers,
  busyServerIds,
  onAdd,
  onEdit,
  onDelete,
  onToggleEnabled,
  onChangeScope,
  onTest,
  onConnect,
  onDisconnect,
  onAuthorize,
  onCancelAuthorize,
}) => {
  const busy = new Set(busyServerIds ?? []);
  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-sm tw-font-medium">{t("agentInfra.backend.pi.mcp.title")}</div>
          <div className="tw-text-ui-smaller tw-text-muted">
            {t("agentInfra.backend.pi.mcp.description")}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onAdd?.()}>
          {t("agentInfra.backend.pi.mcp.add")}
        </Button>
      </div>
      {servers.length === 0 ? (
        <div className="tw-text-ui-smaller tw-text-muted">
          {t("agentInfra.backend.pi.mcp.empty")}
        </div>
      ) : (
        <div className="tw-flex tw-flex-col tw-gap-2">
          {servers.map((server) => (
            <McpServerRow
              key={server.serverId}
              server={server}
              busy={busy.has(server.serverId)}
              {...(onEdit !== undefined ? { onEdit } : {})}
              {...(onDelete !== undefined ? { onDelete } : {})}
              {...(onToggleEnabled !== undefined ? { onToggleEnabled } : {})}
              {...(onChangeScope !== undefined ? { onChangeScope } : {})}
              {...(onTest !== undefined ? { onTest } : {})}
              {...(onConnect !== undefined ? { onConnect } : {})}
              {...(onDisconnect !== undefined ? { onDisconnect } : {})}
              {...(onAuthorize !== undefined ? { onAuthorize } : {})}
              {...(onCancelAuthorize !== undefined ? { onCancelAuthorize } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
};
