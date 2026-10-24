import { createMcpEffectGuard, type McpEffectGuard } from "@/agentMode/sdk/pi/mcp/McpEffectGuard";
import { compileHostToolDefinition } from "@/agentMode/sdk/pi/tools/HostToolDefinition";
import type { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import type { ConversationId, Harness, ToolRegistration } from "@earendil-works/pi-durable";
import type { PermissionDecision, SessionUpdate, VaultAgentMode } from "@/agentMode/session/types";
import { durableToolCallId } from "@/agentMode/sdk/pi/events/ToolDisplayMetadata";
import { PiMcpService, type PiMcpServiceOptions } from "./PiMcpService";
import {
  McpToolAdapter,
  type McpDurableToolRegistration,
  type McpToolAdapterOptions,
} from "./McpToolAdapter";
import { planMcpExposure, type McpExposureTool } from "./McpExposure";
import type { McpServerConfig } from "./McpConfig";
import { logWarn } from "@/logger";
import type { AuditLog } from "@/agentMode/sdk/pi/policy/AuditLog";
import type { PolicyCaller } from "@/agentMode/sdk/pi/policy/PolicyEngine";

export interface PiMcpToolsOptions extends PiMcpServiceOptions {
  readonly capabilities?: CapabilityCatalog;
  readonly conversationId: string;
  readonly riskFor?: McpToolAdapterOptions["riskFor"];
  readonly onUnknownEffect?: () => Promise<void>;
  readonly harness: Pick<Harness, "snapshot" | "conversation">;
  readonly audit?: Pick<AuditLog, "record">;
  readonly getCaller?: (conversationId: string) => PolicyCaller;
  readonly emit: (update: SessionUpdate) => void;
  readonly getModeForConversation?: (conversationId: string) => VaultAgentMode;
  readonly isReadOnly?: (conversationId: string) => boolean;
  readonly installTools?: (tools: readonly ToolRegistration[]) => void;
  readonly supportsImagesForConversation?: (conversationId: string) => Promise<boolean>;
}

export interface PiMcpTools {
  readonly registrations: readonly ToolRegistration[];
  readonly recovery: McpEffectGuard["recovery"];
  reconcile: McpEffectGuard["reconcile"];
  prepare(conversationId: string): Promise<void>;
  dispose(): Promise<void>;
}

interface LoadedMcpTools {
  readonly config: McpServerConfig;
  readonly tools: readonly McpExposureTool[];
  readonly registrations: readonly McpDurableToolRegistration[];
}

// 默认延后连接，真正查找时才接触服务器；单个服务失败不影响本地工具。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export async function createPiMcpTools(options: PiMcpToolsOptions): Promise<PiMcpTools> {
  const [{ defineDoc }, { BACKGROUND_CONTEXT }] = await Promise.all([
    import("@earendil-works/pi-durable"),
    import("@earendil-works/chord/context"),
  ]);
  const loadedDoc = defineDoc<{
    selections: { serverId: string; fingerprint: string; toolName: string; schemaHash: string }[];
  }>({
    kind: "va.mcp.loaded",
    version: 1,
    scope: "conversation",
    history: "rewindable",
    fork: "initial",
    initial: () => ({ selections: [] }),
  });
  const effects = await createMcpEffectGuard(options);
  const service = new PiMcpService(options);
  const configs = service
    .configs()
    .filter((config) => service.isCurrent(config) && config.toolExposure !== "hidden");
  const loaded = new Map<string, LoadedMcpTools>();
  const loading = new Map<string, Promise<void>>();
  const installed = new Set<string>();
  const load = (config: McpServerConfig): Promise<void> => {
    const current = loading.get(config.serverId);
    if (current) return current;
    const promise = (async () => {
      const catalog = await service.connect(config.serverId);
      const client = service.getClient(config.serverId);
      if (!client) throw new Error("The MCP connection closed before its tools loaded.");
      const adapter = new McpToolAdapter({
        capabilities: options.capabilities,
        effects,
        onUnknownEffect: options.onUnknownEffect,
        riskFor: options.riskFor,
        checkAvailability: () => ({
          available: service.isCurrent(config) && service.getClient(config.serverId) === client,
          reason: "The MCP server is disabled, disconnected, or its configuration changed.",
        }),
        audit: options.audit,
        getCaller: options.getCaller,
        supportsImagesForConversation: options.supportsImagesForConversation,
        serverId: config.serverId,
        catalog,
        client,
        redactor: await service.redactorFor(config),
        gateway: {
          authorize: async (input) => {
            const knownReadOnly =
              !input.unknownEffects &&
              input.manifest.effects.every(
                (effect) => effect === "read" || effect === "state" || effect === "ui"
              );
            const canExecute = () =>
              knownReadOnly ||
              (input.conversationId
                ? !options.isReadOnly?.(input.conversationId) &&
                  (options.getModeForConversation?.(input.conversationId) ?? options.getMode()) !==
                    "plan"
                : options.getMode() !== "plan");
            const sameConnection = () =>
              service.isCurrent(config) && service.getClient(config.serverId) === client;
            if (!sameConnection())
              return {
                allowed: false,
                code: "MCP_CONFIG_CHANGED",
                message: "The MCP server or tools changed; reopen the session.",
              };
            if (!canExecute())
              return {
                allowed: false,
                code: "MCP_READ_ONLY",
                message: "External MCP effects are unavailable in a read-only session.",
              };
            const aborted: PermissionDecision = { outcome: { outcome: "cancelled" } };
            const decision = await new Promise<PermissionDecision>((resolve, reject) => {
              if (input.signal?.aborted) {
                resolve(aborted);
                return;
              }
              const cancel = () => resolve(aborted);
              input.signal?.addEventListener("abort", cancel, { once: true });
              const pending =
                options.requestPermission?.({
                  sessionId: options.sessionId,
                  signal: input.signal,
                  binding: {
                    toolId: input.manifest.toolId,
                    schemaHash: input.manifest.schemaHash,
                    targets: [`mcp:${config.serverId}:${config.fingerprint}`],
                    scopeVersion: 1,
                    policyVersion: 1,
                  },
                  // 模型跨轮复用 callId 时，审批和进度都必须绑定真实任务，避免覆盖原审批或错更新卡片。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
                  toolCall: {
                    toolCallId: durableToolCallId(
                      options.sessionId,
                      input.taskId,
                      input.toolCallId ?? input.toolName
                    ),
                    title: `${config.displayName} · ${input.toolName}`,
                    kind: "other",
                    status: "pending",
                    rawInput: input.args,
                  },
                  options: [
                    { optionId: "allow_once", name: "允许这一次", kind: "allow_once" },
                    { optionId: "reject_once", name: "拒绝", kind: "reject_once" },
                  ],
                }) ?? Promise.resolve(aborted);
              pending
                .then(resolve, reject)
                .finally(() => input.signal?.removeEventListener("abort", cancel))
                .catch(() => undefined);
            });
            // 审批后再次检查来源、模式和取消信号，旧批准不能触发新的外部效果。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            return decision.outcome.outcome === "selected" &&
              decision.outcome.optionId === "allow_once" &&
              sameConnection() &&
              canExecute() &&
              !input.signal?.aborted
              ? {
                  allowed: true,
                  revalidate: () => sameConnection() && canExecute() && !input.signal?.aborted,
                }
              : {
                  allowed: false,
                  code: "MCP_CALL_REJECTED",
                  message: "The external tool call was not approved.",
                };
          },
        },
        onExecutionUpdate: (update) =>
          options.emit({
            sessionUpdate: "tool_call_update",
            toolCallId: durableToolCallId(options.sessionId, update.taskId, update.toolCallId),
            status: "in_progress",
            progress: {
              description: `${update.message ?? update.toolName}: ${update.progress}${update.total !== undefined ? `/${update.total}` : ""}`,
            },
          }),
      });
      loaded.set(config.serverId, {
        config,
        registrations: adapter.registrations(),
        tools: catalog.snapshot.tools.map((tool) => ({ ...tool, exposure: config.toolExposure })),
      });
    })();
    loading.set(config.serverId, promise);
    void promise.catch(() => {
      loading.delete(config.serverId);
    });
    return promise;
  };
  const loadConfigs = async (servers: readonly McpServerConfig[]) => {
    const results = await Promise.allSettled(servers.map(load));
    for (const result of results)
      if (result.status === "rejected") logWarn("[PiMcp] server unavailable", result.reason);
  };
  const currentTools = () =>
    configs.flatMap((config) =>
      service.isCurrent(config) ? (loaded.get(config.serverId)?.tools ?? []) : []
    );
  const registrationFor = (name: string, deferred: boolean): ToolRegistration | undefined => {
    for (const server of loaded.values()) {
      if (!service.isCurrent(server.config)) continue;
      const registration = server.registrations.find((tool) => tool.name === name);
      if (registration)
        return {
          ...registration,
          parameters: registration.parameters,
          ...(deferred ? { deferred: true as const } : {}),
        };
    }
    return undefined;
  };
  const install = (names: readonly string[]): void => {
    const additions = names
      .filter((name) => !installed.has(name))
      .flatMap((name) => {
        const registration = registrationFor(name, true);
        return registration ? [registration] : [];
      });
    if (!additions.length) return;
    if (!options.installTools)
      throw new Error("Deferred MCP tools cannot be loaded in this session. Reopen the chat.");
    options.installTools(additions);
    for (const tool of additions) installed.add(tool.name);
  };
  const prepare = async (conversationId: string): Promise<void> => {
    // 打开历史不连接服务器；真正继续时只恢复仍受信且配置和结构均未变的工具。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    const saved = await options.harness.snapshot(
      loadedDoc,
      Number(conversationId) as ConversationId,
      BACKGROUND_CONTEXT
    );
    if (!saved) return;
    const valid = saved.selections.filter((selection) =>
      configs.some(
        (config) =>
          config.serverId === selection.serverId &&
          config.fingerprint === selection.fingerprint &&
          service.isCurrent(config)
      )
    );
    const selectedServers = new Set(valid.map((selection) => selection.serverId));
    await loadConfigs(configs.filter((config) => selectedServers.has(config.serverId)));
    const current = currentTools();
    install(
      valid.flatMap((selection) =>
        current.some(
          (tool) =>
            tool.serverId === selection.serverId &&
            tool.internalName === selection.toolName &&
            tool.schemaHash === selection.schemaHash
        )
          ? [selection.toolName]
          : []
      )
    );
  };
  await loadConfigs(configs.filter((config) => config.toolExposure === "direct"));
  const plan = planMcpExposure(currentTools());
  const tools: ToolRegistration[] = [];
  for (const name of [...plan.direct, ...plan.deferred]) {
    const registration = registrationFor(name, plan.deferred.includes(name));
    if (registration) {
      tools.push(registration);
      installed.add(name);
    }
  }
  if (configs.length) {
    const { Type } = await import("@earendil-works/pi-ai");
    tools.push(
      compileHostToolDefinition(
        {
          toolId: "mcp_search_tools",
          family: "mcp",
          effects: ["network"],
          allowedCallers: ["root", "subagent"],
          checkAvailability: () => ({
            available: configs.some((config) => service.isCurrent(config)),
            reason: "No current MCP service is configured for discovery.",
          }),
          description:
            "Find configured external tools by service name, tool name, or purpose and load their schemas for this session.",
          parameters: Type.Object({ query: Type.String() }),
          replay: "safe",
          outputLimits: { maxBytes: 64 * 1024 },
          execute: async ({ query }, api, context) => {
            await loadConfigs(configs.filter((config) => service.isCurrent(config)));
            const allTools = currentTools();
            const updatedPlan = planMcpExposure(allTools);
            const eligible = new Set([...updatedPlan.direct, ...updatedPlan.deferred]);
            // 用户按设置页名称指定服务时，也必须能发现其随机内部编号下的工具。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            const serviceNames = new Map(
              configs.map((config) => [config.serverId, config.displayName])
            );
            const words: string[] = String(query).toLowerCase().split(/\s+/).filter(Boolean);
            const matches = allTools
              .filter(
                (tool) =>
                  eligible.has(tool.internalName) &&
                  words.every((word) =>
                    `${tool.serverId} ${serviceNames.get(tool.serverId) ?? ""} ${tool.toolName} ${tool.description ?? ""}`
                      .toLowerCase()
                      .includes(word)
                  )
              )
              .slice(0, 20);
            const conversation = await options.harness.conversation(api.conversationId, context);
            if (!conversation)
              throw new Error("The MCP tools' owning conversation is unavailable.");
            // 先可靠保存来源再发布 schema，写盘失败时不能留下仅内存可用的外部工具。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
            await conversation.commit(async (tx) => {
              const doc = await tx.doc(loadedDoc, api.conversationId);
              const selectedNames = new Set(matches.map((tool) => tool.internalName));
              doc.selections = doc.selections.filter((item) => !selectedNames.has(item.toolName));
              for (const tool of matches) {
                const config = configs.find((config) => config.serverId === tool.serverId)!;
                doc.selections.push({
                  serverId: tool.serverId,
                  fingerprint: config.fingerprint,
                  toolName: tool.internalName,
                  schemaHash: tool.schemaHash ?? "",
                });
              }
            }, context);
            install(matches.map((tool) => tool.internalName));
            return {
              output: [
                {
                  type: "text",
                  text: JSON.stringify(
                    matches.map((tool) => ({
                      name: tool.internalName,
                      serverId: tool.serverId,
                      serverDisplayName: serviceNames.get(tool.serverId),
                      // 目录结果也会进入模型与历史，只复用已脱敏的注册描述。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
                      description: registrationFor(tool.internalName, true)?.description,
                      parameters: registrationFor(tool.internalName, true)?.parameters,
                    }))
                  ),
                },
              ],
              control: { addTools: matches.map((tool) => tool.internalName) },
            };
          },
        },
        options.capabilities
      )
    );
  }
  return {
    registrations: Object.freeze(tools),
    get recovery() {
      return effects.recovery;
    },
    reconcile: () => effects.reconcile(),
    prepare,
    dispose: () => service.dispose(),
  };
}
