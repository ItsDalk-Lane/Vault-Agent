import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { McpServerConfig, McpToolExposure, McpScope } from "@/agentMode/sdk/pi/mcp/McpConfig";

export interface PiMcpDraft {
  readonly displayName: string;
  readonly kind: "http" | "stdio";
  readonly address: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly token: string;
  readonly oauth: boolean;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly scope: McpScope;
  readonly exposure: McpToolExposure;
}

export interface PiMcpServerFormProps {
  readonly config?: McpServerConfig;
  readonly onSave: (draft: PiMcpDraft) => void;
  readonly onCancel: () => void;
}

export function PiMcpServerForm({ config, onSave, onCancel }: PiMcpServerFormProps) {
  const [name, setName] = useState(config?.displayName ?? "");
  const [kind, setKind] = useState<"http" | "stdio">(config?.transport.kind ?? "http");
  const [address, setAddress] = useState(
    config?.transport.kind === "http" ? config.transport.url : (config?.transport.commandPath ?? "")
  );
  const [args, setArgs] = useState(
    config?.transport.kind === "stdio" ? config.transport.args.join("\n") : ""
  );
  const [cwd, setCwd] = useState(config?.transport.kind === "stdio" ? config.transport.cwd : "");
  const [token, setToken] = useState("");
  const [oauth, setOAuth] = useState(
    config?.transport.kind === "http" && config.transport.oauth !== undefined
  );
  const [clientId, setClientId] = useState(
    config?.transport.kind === "http" ? (config.transport.oauth?.clientId ?? "") : ""
  );
  const [scopes, setScopes] = useState(
    config?.transport.kind === "http" ? (config.transport.oauth?.scopes?.join(" ") ?? "") : ""
  );
  const [scope, setScope] = useState<McpScope>(config?.scope ?? "this-vault");
  const [exposure, setExposure] = useState<McpToolExposure>(config?.toolExposure ?? "deferred");
  const inputClass =
    "tw-h-auto tw-min-h-10 tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2 tw-text-sm";
  return (
    <form
      className="tw-flex tw-flex-col tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          displayName: name.trim(),
          kind,
          address: address.trim(),
          args: args.split("\n").filter((arg) => arg.length > 0),
          cwd: cwd.trim(),
          token,
          oauth,
          clientId: clientId.trim(),
          scopes: scopes.split(/\s+/).filter(Boolean),
          scope,
          exposure,
        });
      }}
    >
      <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
        {t("agentInfra.backend.pi.mcp.form.name")}
        <input
          className={inputClass}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
        {t("agentInfra.backend.pi.mcp.form.connection")}
        <select
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as "http" | "stdio")}
        >
          <option value="http">HTTP</option>
          <option value="stdio">{t("agentInfra.backend.pi.mcp.form.local")}</option>
        </select>
      </label>
      <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
        {t(
          kind === "http"
            ? "agentInfra.backend.pi.mcp.form.url"
            : "agentInfra.backend.pi.mcp.form.command"
        )}
        <input
          className={inputClass}
          required
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </label>
      {kind === "stdio" ? (
        <>
          <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
            {t("agentInfra.backend.pi.mcp.form.args")}
            <textarea
              className={inputClass}
              rows={3}
              value={args}
              onChange={(event) => setArgs(event.target.value)}
            />
          </label>
          <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
            {t("agentInfra.backend.pi.mcp.form.cwd")}
            <input
              className={inputClass}
              required
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
            />
          </label>
          <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
            {t("agentInfra.backend.pi.mcp.form.localNotice")}
          </p>
        </>
      ) : (
        <>
          <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
            {t("agentInfra.backend.pi.mcp.form.token")}
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <label className="tw-flex tw-items-center tw-gap-2 tw-text-sm">
            <input
              type="checkbox"
              checked={oauth}
              onChange={(event) => setOAuth(event.target.checked)}
            />
            {t("agentInfra.backend.pi.mcp.form.oauth")}
          </label>
          {oauth ? (
            <>
              <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
                {t("agentInfra.backend.pi.mcp.form.clientId")}
                <input
                  className={inputClass}
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                />
              </label>
              <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
                {t("agentInfra.backend.pi.mcp.form.scopes")}
                <input
                  className={inputClass}
                  value={scopes}
                  onChange={(event) => setScopes(event.target.value)}
                />
              </label>
            </>
          ) : null}
        </>
      )}
      <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
        {t("agentInfra.backend.pi.mcp.scope")}
        <select
          className={inputClass}
          value={scope}
          onChange={(event) => setScope(event.target.value as McpScope)}
        >
          <option value="this-vault">{t("agentInfra.backend.pi.mcp.scope.thisVault")}</option>
          <option value="project">{t("agentInfra.backend.pi.mcp.scope.project")}</option>
        </select>
      </label>
      <label className="tw-flex tw-flex-col tw-gap-1 tw-text-sm">
        {t("agentInfra.backend.pi.mcp.form.exposure")}
        <select
          className={inputClass}
          value={exposure}
          onChange={(event) => setExposure(event.target.value as McpToolExposure)}
        >
          <option value="direct">{t("agentInfra.backend.pi.mcp.form.direct")}</option>
          <option value="deferred">{t("agentInfra.backend.pi.mcp.form.deferred")}</option>
          <option value="hidden">{t("agentInfra.backend.pi.mcp.form.hidden")}</option>
        </select>
      </label>
      <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
        {t("agentInfra.backend.pi.mcp.form.reviewNotice")}
      </p>
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit">{t("agentInfra.backend.pi.mcp.form.save")}</Button>
      </div>
    </form>
  );
}
