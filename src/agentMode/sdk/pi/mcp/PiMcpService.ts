import { desktopProviderFetch } from "@/utils/desktopProviderFetch";
import type { McpClient, McpFetch, ListToolsResult } from "@earendil-works/pi-mcp";
import type { VaultAgentSettings } from "@/settings/model";
import type { KeychainPort } from "@/agentMode/sdk/pi/models/KeychainCredentialStore";
import type {
  PermissionDecision,
  PermissionPrompt,
  VaultAgentMode,
} from "@/agentMode/session/types";
import { normalizeMcpServerConfig, type McpServerConfig } from "./McpConfig";
import { McpManager, type McpSdkPort, type McpConnectionState } from "./McpManager";
import { McpCatalog } from "./McpCatalog";
import { createHttpMcpTransport } from "./HttpTransport";
import { McpCredentialStore } from "./McpCredentialStore";
import { McpOAuth, createPiMcpOAuthFlow } from "./McpOAuth";
import { McpConnectionTester, type McpTestReport } from "./McpConnectionTest";
import { StdioTransportFactory } from "./StdioTransportFactory";
import { CommandEnvironment } from "@/agentMode/sdk/pi/tools/CommandEnvironment";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";
import { logWarn } from "@/logger";

export interface PiMcpStatus {
  readonly serverId: string;
  readonly connection: McpConnectionState;
  readonly toolCount: number;
  readonly error?: string;
  readonly test?: McpTestReport;
  readonly oauth?: "pending" | "authorized" | "cancelled" | "failed";
}

export interface PiMcpServiceOptions {
  readonly sessionId: string;
  readonly vaultId: string;
  readonly projectId?: string;
  readonly keychain: KeychainPort;
  readonly getSettings: () => VaultAgentSettings;
  readonly getMode: () => VaultAgentMode;
  readonly requestPermission?: (request: PermissionPrompt) => Promise<PermissionDecision>;
  readonly subscribeSettings?: (listener: () => void) => () => void;
  readonly browser?: { open(url: string): Promise<void> };
  readonly sdk?: McpSdkPort;
  readonly fetch?: McpFetch;
}

const EMPTY_STATUS: readonly PiMcpStatus[] = Object.freeze([]);
const EMPTY_CONFIGS: readonly McpServerConfig[] = Object.freeze([]);
const credentialStores = new Map<string, McpCredentialStore>();

export class PiMcpService {
  private manager: Promise<McpManager> | undefined;
  private readonly catalogs = new Map<string, McpCatalog>();
  private readonly clients = new Map<string, McpClient>();
  private readonly notificationDetachers = new Map<string, () => void>();
  private readonly fingerprints = new Map<string, string>();
  private readonly statuses = new Map<string, PiMcpStatus>();
  private readonly listeners = new Set<() => void>();
  private readonly authorizations = new Map<string, AbortController>();
  private readonly oauth = new Map<string, McpOAuth>();
  private readonly testers = new Map<string, McpConnectionTester>();
  private readonly testControllers = new Set<AbortController>();
  private readonly credentials: McpCredentialStore;
  private readonly detach: (() => void) | undefined;
  private snapshot: readonly PiMcpStatus[] = EMPTY_STATUS;
  private disposed = false;

  constructor(private readonly options: PiMcpServiceOptions) {
    // 同一资料库的设置页和运行中会话共享注销代次，阻止迟到刷新恢复已撤销的凭据。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    this.credentials =
      credentialStores.get(options.vaultId) ??
      new McpCredentialStore({
        namespace: `mcp-oauth-${options.vaultId}`,
        keychain: {
          read: async (ref) => options.keychain.getSecretById(ref) ?? undefined,
          write: async (ref, value) => {
            options.keychain.setSecretById(ref, value);
          },
          delete: async (ref) => {
            options.keychain.deleteSecretById(ref);
          },
        },
      });
    credentialStores.set(options.vaultId, this.credentials);
    this.detach = options.subscribeSettings?.(() => {
      for (const [serverId, fingerprint] of this.fingerprints) {
        const config = this.configs().find((entry) => entry.serverId === serverId);
        if (!config || !this.isCurrent(config) || config.fingerprint !== fingerprint) {
          this.authorizations.get(serverId)?.abort();
          void this.disconnect(serverId).catch((error) =>
            logWarn("[PiMcp] disconnect failed", error)
          );
        }
      }
    });
  }

  configs(): readonly McpServerConfig[] {
    const configs: McpServerConfig[] = [];
    for (const raw of this.options.getSettings().agentMode.backends.pi?.mcpServers ?? []) {
      try {
        configs.push(normalizeMcpServerConfig(raw));
      } catch (error) {
        logWarn("[PiMcp] invalid configuration", error);
      }
    }
    return configs.length ? Object.freeze(configs) : EMPTY_CONFIGS;
  }

  getSnapshot = (): readonly PiMcpStatus[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getClient(serverId: string): McpClient | undefined {
    return this.clients.get(serverId);
  }

  async redactorFor(config: McpServerConfig): Promise<Redactor> {
    const values = config.credentialRefs.flatMap((ref) => {
      const value = this.options.keychain.getSecretById(ref);
      return value ? [value, value.replace(/^Bearer\s+/i, "")] : [];
    });
    if (config.transport.kind === "http") {
      const saved = await this.credentials.credentials(
        config.serverId,
        new URL(config.transport.url).origin
      );
      if (saved)
        values.push(
          saved.tokens.accessToken,
          saved.tokens.refreshToken ?? "",
          saved.clientInformation?.clientSecret ?? ""
        );
    }
    return new Redactor({ secretValues: values });
  }

  async connect(serverId: string): Promise<McpCatalog> {
    const config = this.requireRunnableConfig(serverId);
    const existing = this.catalogs.get(serverId);
    if (existing && this.fingerprints.get(serverId) === config.fingerprint) return existing;
    this.fingerprints.set(serverId, config.fingerprint);
    try {
      const manager = await this.getManager();
      const connection = await manager.acquire(config);
      const client = connection.client as McpClient;
      const catalog = new McpCatalog({
        serverId,
        client: {
          listToolsPage: (cursor) =>
            client.request<ListToolsResult>("tools/list", cursor ? { cursor } : {}),
        },
      });
      await catalog.refresh();
      // 配置在握手期间改变也必须撤销，不能把旧地址的工具重新放回目录。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      if (!this.isCurrent(config)) {
        await this.disconnect(serverId);
        throw new Error("The MCP configuration changed while connecting.");
      }
      this.catalogs.set(serverId, catalog);
      this.clients.set(serverId, client);
      this.notificationDetachers.set(
        serverId,
        client.onNotification?.("notifications/tools/list_changed", () => {
          // 工具目录改变立即撤销旧连接，避免审批期间偷偷替换参数或实现。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
          void this.disconnect(serverId)
            .then(() =>
              this.setStatus(serverId, {
                connection: "error",
                error: "The server tools changed; reconnect and reopen the chat.",
              })
            )
            .catch((error) => logWarn("[PiMcp] catalog invalidation failed", error));
        }) ?? (() => undefined)
      );
      this.setStatus(serverId, {
        connection: "connected",
        toolCount: catalog.snapshot.tools.length,
        error: undefined,
      });
      return catalog;
    } catch (error) {
      this.setStatus(serverId, {
        connection:
          error instanceof Error && error.name === "McpAuthRequiredError"
            ? "auth_required"
            : "error",
        error: (await this.redactorFor(config)).redactText(
          error instanceof Error ? error.message : String(error)
        ),
        toolCount: 0,
      });
      throw new Error(this.statuses.get(serverId)?.error ?? "The MCP connection failed.");
    }
  }

  async disconnect(serverId: string): Promise<void> {
    this.notificationDetachers.get(serverId)?.();
    this.notificationDetachers.delete(serverId);
    this.catalogs.delete(serverId);
    this.clients.delete(serverId);
    this.fingerprints.delete(serverId);
    if (this.manager) await (await this.manager).invalidateServer(serverId);
    this.setStatus(serverId, { connection: "closed", toolCount: 0 });
  }

  async test(serverId: string): Promise<McpTestReport> {
    const config = this.requireRunnableConfig(serverId);
    let tester = this.testers.get(config.fingerprint);
    if (!tester) {
      tester = new McpConnectionTester({
        fingerprint: config.fingerprint,
        redactor: await this.redactorFor(config),
        connect: async ({ signal }) => {
          const manager = this.createManager(this.options.sdk ?? (await this.productionSdk()));
          const abort = () => {
            void manager.dispose();
          };
          signal.addEventListener("abort", abort, { once: true });
          try {
            const connection = await manager.acquire(config);
            const client = connection.client as McpClient;
            return {
              serverInfo: client.serverInfo,
              capabilities: client.serverCapabilities as Record<string, unknown>,
              listTools: ({ signal: readSignal, timeoutMs }) =>
                client.listTools({ signal: readSignal, timeoutMs }),
              close: async () => {
                signal.removeEventListener("abort", abort);
                await manager.dispose();
              },
            };
          } catch (error) {
            signal.removeEventListener("abort", abort);
            await manager.dispose();
            throw error;
          }
        },
      });
      this.testers.set(config.fingerprint, tester);
    }
    const controller = new AbortController();
    this.testControllers.add(controller);
    try {
      const report = await tester.run({ signal: controller.signal });
      this.setStatus(serverId, { test: report });
      return report;
    } finally {
      this.testControllers.delete(controller);
    }
  }

  async authorize(serverId: string): Promise<void> {
    const config = this.requireRunnableConfig(serverId);
    const oauth = await this.oauthFor(config);
    const controller = new AbortController();
    this.authorizations.get(serverId)?.abort();
    this.authorizations.set(serverId, controller);
    this.fingerprints.set(serverId, config.fingerprint);
    this.setStatus(serverId, { oauth: "pending" });
    try {
      const result = await oauth.authorize({ signal: controller.signal });
      this.setStatus(serverId, {
        oauth:
          result.status === "authorized"
            ? "authorized"
            : result.status === "cancelled"
              ? "cancelled"
              : "failed",
        ...(result.error ? { error: result.error } : {}),
      });
      if (result.status === "authorized") await this.disconnect(serverId);
    } finally {
      if (this.authorizations.get(serverId) === controller) this.authorizations.delete(serverId);
    }
  }

  cancelAuthorize(serverId: string): void {
    this.authorizations.get(serverId)?.abort();
  }

  async signOut(serverId: string): Promise<void> {
    this.cancelAuthorize(serverId);
    await (await this.oauthFor(this.requireConfig(serverId))).signOut();
    await this.disconnect(serverId);
    this.setStatus(serverId, { oauth: undefined });
  }

  isCurrent(config: McpServerConfig): boolean {
    const current = this.configs().find((entry) => entry.serverId === config.serverId);
    return Boolean(
      !this.disposed &&
      current?.enabled &&
      current.trusted &&
      current.fingerprint === config.fingerprint &&
      (current.scope !== "project" ||
        (current.projectId && current.projectId === this.options.projectId))
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.detach?.();
    for (const controller of this.authorizations.values()) controller.abort();
    for (const controller of this.testControllers) controller.abort();
    if (this.manager) await (await this.manager).dispose();
    for (const detach of this.notificationDetachers.values()) detach();
    this.notificationDetachers.clear();
    this.catalogs.clear();
    this.clients.clear();
    this.listeners.clear();
  }

  private requireConfig(serverId: string): McpServerConfig {
    const config = this.configs().find((entry) => entry.serverId === serverId);
    if (!config) throw new Error("The MCP server was removed.");
    return config;
  }

  private requireRunnableConfig(serverId: string): McpServerConfig {
    const config = this.requireConfig(serverId);
    if (!this.isCurrent(config))
      throw new Error("Review and enable this server for the current project before connecting.");
    return config;
  }

  private setStatus(serverId: string, patch: Partial<PiMcpStatus>): void {
    this.statuses.set(serverId, {
      serverId,
      connection: "idle",
      toolCount: 0,
      ...this.statuses.get(serverId),
      ...patch,
    });
    this.snapshot = Object.freeze([...this.statuses.values()]);
    for (const listener of this.listeners) listener();
  }

  private getManager(): Promise<McpManager> {
    return (this.manager ??= Promise.resolve(this.options.sdk ?? this.productionSdk()).then((sdk) =>
      this.createManager(sdk)
    ));
  }

  private createManager(sdk: McpSdkPort): McpManager {
    return new McpManager({
      vaultKey: this.options.vaultId,
      rootId: this.options.sessionId,
      resolveCredential: async (ref) => this.options.keychain.getSecretById(ref) ?? undefined,
      sdk,
      onStateChange: (connection) =>
        this.setStatus(connection.config.serverId, {
          connection: connection.state,
          toolCount: this.catalogs.get(connection.config.serverId)?.snapshot.tools.length ?? 0,
        }),
    });
  }

  private async oauthFor(config: McpServerConfig): Promise<McpOAuth> {
    if (config.transport.kind !== "http")
      throw new Error("Browser authorization is only available for HTTP servers.");
    const key = `${config.serverId}:${config.fingerprint}`;
    const existing = this.oauth.get(key);
    if (existing) return existing;
    await this.credentials.setOrigin(config.serverId, new URL(config.transport.url).origin);
    const flow = await createPiMcpOAuthFlow({
      browser: this.options.browser ?? {
        open: async () => {
          throw new Error("Authorize this server from Vault Agent settings.");
        },
      },
      credentials: this.credentials,
      serverId: config.serverId,
      clientId: config.transport.oauth?.clientId,
      fetch: this.options.fetch ?? desktopProviderFetch,
    });
    const oauth = new McpOAuth({
      serverId: config.serverId,
      serverUrl: config.transport.url,
      scopes: config.transport.oauth?.scopes,
      store: this.credentials,
      flow,
    });
    this.oauth.set(key, oauth);
    return oauth;
  }

  private async productionSdk(): Promise<McpSdkPort> {
    const sdk = await import("@earendil-works/pi-mcp");
    return {
      createClient: (config) =>
        new sdk.McpClient({
          name: "vault-agent",
          version: "1.0.0",
          requestTimeoutMs: config.timeoutMs,
        }),
      isAuthRequiredError: (error) => error instanceof sdk.McpAuthRequiredError,
      createTransport: async (config) => {
        if (config.transport.kind === "http") {
          const oauth = config.transport.oauth ? await this.oauthFor(config) : undefined;
          const handle = await createHttpMcpTransport(config.transport, {
            resolveCredential: async (ref) => this.options.keychain.getSecretById(ref) ?? undefined,
            // 使用宿主流式网络避免页面跨域拦截，同时保留重定向凭据守卫。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            fetch: this.options.fetch ?? desktopProviderFetch,
            createTransport: (options) =>
              new sdk.StreamableHttpTransport({
                ...options,
                headers: { ...options.headers },
                ...(oauth
                  ? {
                      authProvider: {
                        token: async () => (await oauth.accessToken())?.tokens.accessToken,
                        onUnauthorized: async () => {
                          await oauth.refresh();
                        },
                      },
                    }
                  : {}),
              }),
          });
          return handle.transport;
        }
        if (
          this.options.getMode() === "plan" ||
          this.options.getSettings().agentMode.backends.pi?.hostExecutionMode !== "trusted_host"
        )
          throw new Error(
            "Enable trusted host execution outside plan mode before starting a local MCP server."
          );
        const approved = await this.options.requestPermission?.({
          sessionId: this.options.sessionId,
          toolCall: {
            toolCallId: `mcp-start:${config.serverId}:${config.fingerprint}`,
            title: `Start ${config.displayName}`,
            kind: "execute",
            status: "pending",
            rawInput: {
              commandPath: config.transport.commandPath,
              args: config.transport.args,
              cwd: config.transport.cwd,
            },
          },
          options: [
            { optionId: "allow_once", name: "允许这一次", kind: "allow_once" },
            { optionId: "reject_once", name: "拒绝", kind: "reject_once" },
          ],
        });
        // 审批期间切换计划模式或禁用配置也不能再启动本地进程。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        if (
          approved?.outcome.outcome !== "selected" ||
          approved.outcome.optionId !== "allow_once" ||
          !this.isCurrent(config) ||
          this.options.getMode() === "plan"
        )
          throw new Error("The local MCP server was not approved.");
        const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
        const factory = new StdioTransportFactory({
          environment: new CommandEnvironment({
            platform:
              process.platform === "win32"
                ? "win32"
                : process.platform === "darwin"
                  ? "darwin"
                  : "linux",
            parentEnv: process.env,
          }),
          exists: (file) =>
            fs.access(file).then(
              () => true,
              () => false
            ),
          createTransport: (plan) =>
            new sdk.StdioTransport({
              command: plan.command,
              args: plan.args,
              cwd: plan.cwd,
              env: { ...plan.env },
              inheritEnv: false,
            }),
          terminate: { terminate: async () => "incomplete" },
          resolveSecret: async (ref) => this.options.keychain.getSecretById(ref) ?? undefined,
        });
        return (
          await factory.create({
            serverId: config.serverId,
            config: config.transport,
            mode: "trusted_host",
            riskAuthorized: true,
          })
        ).transport;
      },
    };
  }
}
