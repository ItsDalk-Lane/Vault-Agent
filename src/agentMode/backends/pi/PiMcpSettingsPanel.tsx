import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { App } from "obsidian";
import { Notice } from "obsidian";
import type VaultAgentPlugin from "@/main";
import {
  getSettings,
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  useSettingsValue,
} from "@/settings/model";
import { KeychainService } from "@/services/keychainService";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { SettingSection } from "@/components/ui/setting-section";
import { t } from "@/i18n";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { PiMcpService } from "@/agentMode/sdk/pi/mcp/PiMcpService";
import {
  normalizeMcpServerConfig,
  type McpServerConfig,
  type McpScope,
} from "@/agentMode/sdk/pi/mcp/McpConfig";
import { mcpSecretRef } from "@/agentMode/sdk/pi/mcp/McpSecretRefs";
import { McpSettings, type McpServerView } from "./McpSettings";
import { PiMcpServerForm, type PiMcpDraft } from "./PiMcpServerForm";

export interface PiMcpSettingsPanelProps {
  readonly plugin: VaultAgentPlugin;
  readonly app: App;
}

export function PiMcpSettingsPanel({ plugin, app }: PiMcpSettingsPanelProps) {
  const settings = useSettingsValue();
  const [editing, setEditing] = useState<McpServerConfig | "new" | null>(null);
  const [busy, setBusy] = useState<readonly string[]>([]);
  const keychain = KeychainService.getInstance(app);
  const projectId = plugin.agentSessionManager?.getActiveProjectId() ?? undefined;
  const service = useMemo(
    () =>
      new PiMcpService({
        sessionId: "root-mcp-settings",
        vaultId: keychain.getVaultId(),
        projectId,
        keychain,
        getSettings,
        getMode: () => "default",
        subscribeSettings: (listener) => subscribeToSettingsChange(listener),
        browser: {
          open: async (url) => {
            await requireNodeModule<{ shell: { openExternal(url: string): Promise<void> } }>(
              "electron"
            ).shell.openExternal(url);
          },
        },
        requestPermission: (request) =>
          new Promise((resolve) => {
            new ConfirmModal(
              app,
              () => resolve({ outcome: { outcome: "selected", optionId: "allow_once" } }),
              <div className="tw-flex tw-flex-col tw-gap-2">
                <p>{t("agentInfra.backend.pi.mcp.form.localNotice")}</p>
                <pre className="tw-whitespace-pre-wrap tw-break-all tw-text-ui-smaller">
                  {JSON.stringify(request.toolCall.rawInput, null, 2)}
                </pre>
              </div>,
              request.toolCall.title,
              t("agentInfra.backend.pi.mcp.form.allowOnce"),
              t("common.cancel"),
              () => resolve({ outcome: { outcome: "cancelled" } })
            ).open();
          }),
      }),
    [app, keychain, projectId]
  );
  const states = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(
    () => () => {
      void service.dispose();
    },
    [service]
  );
  const configs = service.configs();
  const saveConfigs = (next: readonly McpServerConfig[]) =>
    updateAgentModeBackendFields("pi", { mcpServers: next });
  const run = (id: string, work: () => Promise<unknown>) => {
    setBusy((current) => [...current, id]);
    void work()
      .catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy((current) => current.filter((entry) => entry !== id)));
  };
  const change = (id: string, partial: Partial<McpServerConfig>) =>
    saveConfigs(
      configs.map((config) =>
        config.serverId === id
          ? normalizeMcpServerConfig({ ...config, ...partial, revision: config.revision + 1 })
          : config
      )
    );
  const scope = (id: string, next: McpScope) => {
    if (next === "project" && !projectId) {
      new Notice(t("agentInfra.backend.pi.mcp.form.chooseProject"));
      return;
    }
    change(id, { scope: next, projectId: next === "project" ? projectId : undefined });
  };
  const save = (draft: PiMcpDraft) => {
    try {
      if (draft.scope === "project" && !projectId)
        throw new Error(t("agentInfra.backend.pi.mcp.form.chooseProject"));
      const previous = editing && editing !== "new" ? editing : undefined;
      const serverId = previous?.serverId ?? `server-${window.crypto.randomUUID()}`;
      const headerSecretRefs =
        previous?.transport.kind === "http" ? { ...previous.transport.headerSecretRefs } : {};
      const ref = mcpSecretRef(`${keychain.getVaultId()}-${serverId}`, "authorization");
      const config = normalizeMcpServerConfig({
        serverId,
        displayName: draft.displayName,
        enabled: true,
        trusted: true,
        scope: draft.scope,
        ...(draft.scope === "project" ? { projectId } : {}),
        toolExposure: draft.exposure,
        revision: (previous?.revision ?? 0) + 1,
        timeoutMs: previous?.timeoutMs,
        transport:
          draft.kind === "http"
            ? {
                kind: "http",
                url: draft.address,
                headerSecretRefs: draft.token
                  ? { ...headerSecretRefs, Authorization: ref }
                  : headerSecretRefs,
                ...(draft.oauth
                  ? {
                      oauth: {
                        ...(draft.clientId ? { clientId: draft.clientId } : {}),
                        scopes: draft.scopes,
                      },
                    }
                  : {}),
              }
            : {
                kind: "stdio",
                commandPath: draft.address,
                args: draft.args,
                cwd: draft.cwd,
                env: previous?.transport.kind === "stdio" ? previous.transport.env : {},
                envSecretRefs:
                  previous?.transport.kind === "stdio" ? previous.transport.envSecretRefs : {},
              },
      });
      // 先验证整份配置，再保存令牌；设置文件始终只保存密码库引用。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (draft.kind === "http" && draft.token)
        keychain.setSecretById(ref, `Bearer ${draft.token}`);
      saveConfigs([...configs.filter((entry) => entry.serverId !== serverId), config]);
      setEditing(null);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  };
  const servers: McpServerView[] = configs.map((config) => {
    const state = states.find((entry) => entry.serverId === config.serverId);
    return {
      serverId: config.serverId,
      displayName: config.displayName,
      scope: config.scope,
      transport: config.transport.kind,
      enabled: config.enabled,
      trusted: config.trusted,
      connection: state?.connection === "closing" ? "closed" : (state?.connection ?? "idle"),
      toolCount: state?.toolCount ?? 0,
      ...(state?.error ? { error: state.error } : {}),
      ...(state?.test
        ? {
            testStatus: state.test.status,
            testToolCount: state.test.toolCount,
            testDurationMs: state.test.durationMs,
          }
        : {}),
      ...(config.transport.kind === "http"
        ? {
            oauth: {
              status: state?.oauth ?? "none",
              host: new URL(config.transport.url).host,
              scopes: config.transport.oauth?.scopes ?? [],
            },
          }
        : {}),
      ...(!config.trusted || (config.scope === "project" && config.projectId !== projectId)
        ? { blockedReason: t("agentInfra.backend.pi.mcp.form.reviewRequired") }
        : {}),
    };
  });
  return (
    <SettingSection>
      <div className="tw-flex tw-flex-col tw-gap-4 tw-py-4">
        {(settings.agentMode.backends.pi?.mcpServers?.length ?? 0) > configs.length ? (
          <p className="tw-m-0 tw-text-ui-smaller tw-text-error">
            {t("agentInfra.backend.pi.mcp.form.invalidConfig")}
          </p>
        ) : null}
        <McpSettings
          servers={servers}
          busyServerIds={busy}
          onAdd={() => setEditing("new")}
          onEdit={(id) => setEditing(configs.find((entry) => entry.serverId === id) ?? null)}
          onDelete={(id) => {
            run(id, async () => {
              await service.disconnect(id);
              await service.signOut(id).catch(() => undefined);
              const config = configs.find((entry) => entry.serverId === id);
              for (const ref of config?.credentialRefs ?? [])
                if (
                  !configs.some(
                    (entry) => entry.serverId !== id && entry.credentialRefs.includes(ref)
                  )
                )
                  keychain.deleteSecretById(ref);
              saveConfigs(configs.filter((entry) => entry.serverId !== id));
            });
          }}
          onToggleEnabled={(id, enabled) => change(id, { enabled })}
          onChangeScope={scope}
          onTest={(id) => run(id, () => service.test(id))}
          onConnect={(id) => run(id, () => service.connect(id))}
          onDisconnect={(id) => run(id, () => service.disconnect(id))}
          onAuthorize={(id) => run(id, () => service.authorize(id))}
          onCancelAuthorize={(id) => service.cancelAuthorize(id)}
        />
        {editing ? (
          <PiMcpServerForm
            key={editing === "new" ? "new" : editing.serverId}
            {...(editing === "new" ? {} : { config: editing })}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
          {t("agentInfra.backend.pi.mcp.form.reopenNotice")}
        </p>
      </div>
    </SettingSection>
  );
}
