import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { McpScope } from "@/agentMode/sdk/pi/mcp/McpConfig";
import type { McpConnectionStatus, McpServerView } from "@/agentMode/backends/pi/ui/McpSettings";
import React from "react";

// One MCP server row: real state drives every badge and button. Test/connect/authorize act on the
// server, editing and deletion are explicit, and a disabled or unsupported server cannot connect or
// test. An unsupported protocol is stated instead of pretending to support it:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface McpServerRowProps {
  readonly server: McpServerView;
  readonly busy: boolean;
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

const SCOPES: readonly McpScope[] = ["global", "this-vault", "project"];

const STATUS_KEYS = {
  idle: "agentInfra.backend.pi.mcp.status.idle",
  connecting: "agentInfra.backend.pi.mcp.status.connecting",
  connected: "agentInfra.backend.pi.mcp.status.connected",
  auth_required: "agentInfra.backend.pi.mcp.status.authRequired",
  error: "agentInfra.backend.pi.mcp.status.error",
  closed: "agentInfra.backend.pi.mcp.status.closed",
} as const satisfies Readonly<Record<McpConnectionStatus, string>>;

export const McpServerRow: React.FC<McpServerRowProps> = ({
  server,
  busy,
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
  const unsupported = server.unsupported ?? [];
  const stdioUnavailable =
    server.transport === "stdio" && server.stdio?.interpreterAvailable === false;
  const canOperate =
    server.enabled &&
    server.trusted &&
    !server.blockedReason &&
    unsupported.length === 0 &&
    !stdioUnavailable;
  const oauthStatus = server.oauth?.status ?? "none";
  return (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-3 tw-py-2">
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-sm tw-font-medium">{server.displayName}</div>
          <div className="tw-text-ui-smaller tw-text-muted">{server.serverId}</div>
        </div>
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-1">
          <Badge variant="outline">
            {t(`agentInfra.backend.pi.mcp.transport.${server.transport}`)}
          </Badge>
          <Badge variant={server.connection === "connected" ? "accent" : "outline"}>
            {t(STATUS_KEYS[server.connection])}
          </Badge>
          {server.trusted ? (
            <Badge variant="outline">{t("agentInfra.backend.pi.mcp.trustedHost")}</Badge>
          ) : null}
          <Badge variant="outline">
            {t("agentInfra.backend.pi.mcp.tools", { count: server.toolCount })}
          </Badge>
        </div>
      </div>

      {unsupported.length > 0 ? (
        <div className="tw-rounded-md tw-bg-secondary tw-px-3 tw-py-2 tw-text-ui-smaller tw-text-warning">
          {t("agentInfra.backend.pi.mcp.unsupported", { protocols: unsupported.join(", ") })}
        </div>
      ) : null}
      {stdioUnavailable ? (
        <div className="tw-rounded-md tw-bg-secondary tw-px-3 tw-py-2 tw-text-ui-smaller tw-text-warning">
          {t("agentInfra.backend.pi.mcp.stdioUnavailable")}
        </div>
      ) : null}
      {server.blockedReason ? (
        <div className="tw-text-ui-smaller tw-text-error">{server.blockedReason}</div>
      ) : null}
      {server.error !== undefined ? (
        <div className="tw-text-ui-smaller tw-text-error">{server.error}</div>
      ) : null}
      {server.testStatus !== undefined ? (
        <div className="tw-text-ui-smaller tw-text-muted">
          {t("agentInfra.backend.pi.mcp.testResult", {
            status: server.testStatus,
            count: server.testToolCount ?? 0,
            duration: server.testDurationMs ?? 0,
          })}
        </div>
      ) : null}

      {oauthStatus === "pending" && server.oauth !== undefined ? (
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-text-ui-smaller tw-text-muted">
          <span>
            {t("agentInfra.backend.pi.mcp.oauthTarget", {
              host: server.oauth.host,
              scopes: server.oauth.scopes.join(" "),
            })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onCancelAuthorize?.(server.serverId)}
          >
            {t("agentInfra.backend.pi.mcp.cancelAuthorize")}
          </Button>
        </div>
      ) : null}
      {oauthStatus === "cancelled" ? (
        <div className="tw-text-ui-smaller tw-text-muted">
          {t("agentInfra.backend.pi.mcp.oauthCancelled")}
        </div>
      ) : null}
      {oauthStatus === "failed" ? (
        <div className="tw-text-ui-smaller tw-text-error">
          {t("agentInfra.backend.pi.mcp.oauthFailed", { message: server.error ?? "" })}
        </div>
      ) : null}

      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <label className="tw-flex tw-items-center tw-gap-1 tw-text-ui-smaller tw-text-muted">
          <span>{t("agentInfra.backend.pi.mcp.scope")}</span>
          <select
            className="tw-rounded-sm tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-1 tw-py-0.5 tw-text-ui-smaller"
            value={server.scope}
            onChange={(event) => onChangeScope?.(server.serverId, event.target.value as McpScope)}
          >
            {SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {t(
                  `agentInfra.backend.pi.mcp.scope.${scope === "this-vault" ? "thisVault" : scope}`
                )}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="ghost2"
          size="sm"
          className="tw-px-0"
          onClick={() => onToggleEnabled?.(server.serverId, !server.enabled)}
        >
          {server.enabled
            ? t("agentInfra.backend.pi.mcp.disable")
            : t("agentInfra.backend.pi.mcp.enable")}
        </Button>
        <Button
          variant="ghost2"
          size="sm"
          className="tw-px-0"
          onClick={() => onEdit?.(server.serverId)}
        >
          {t("agentInfra.backend.pi.mcp.edit")}
        </Button>
        <Button
          variant="ghost2"
          size="sm"
          className="tw-px-0"
          onClick={() => onDelete?.(server.serverId)}
        >
          {t("agentInfra.backend.pi.mcp.delete")}
        </Button>
        <div className={cn("tw-ml-auto tw-flex tw-max-w-full tw-flex-wrap tw-gap-2")}>
          {server.connection === "auth_required" || oauthStatus === "cancelled" ? (
            <Button variant="secondary" size="sm" onClick={() => onAuthorize?.(server.serverId)}>
              {t("agentInfra.backend.pi.mcp.authorize")}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={!canOperate || busy}
            onClick={() => onTest?.(server.serverId)}
          >
            {busy ? t("agentInfra.backend.pi.mcp.testing") : t("agentInfra.backend.pi.mcp.test")}
          </Button>
          {server.connection === "connected" ? (
            <Button
              variant="default"
              size="sm"
              disabled={!canOperate || busy}
              onClick={() => onDisconnect?.(server.serverId)}
            >
              {t("agentInfra.backend.pi.mcp.disconnect")}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              disabled={!canOperate || busy}
              onClick={() => onConnect?.(server.serverId)}
            >
              {t("agentInfra.backend.pi.mcp.connect")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
