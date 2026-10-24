import { isCompactionRequest } from "@/agentMode/sdk/pi/models/ModelRequestKind";
import { compileModelToolResults } from "@/agentMode/sdk/pi/models/ModelToolResults";
import { budgetModelRequest } from "@/agentMode/sdk/pi/models/RequestWindowBudget";
import type {
  Models,
  CredentialStore,
  Api,
  Model,
  AssistantMessageEventStream,
  AssistantMessage,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import type { VaultAgentSettings } from "@/settings/model";
import type { KeychainPort } from "@/agentMode/sdk/pi/models/KeychainCredentialStore";
import { KeychainCredentialStore } from "@/agentMode/sdk/pi/models/KeychainCredentialStore";
import {
  buildModelCatalog,
  type ModelCatalogSnapshot,
} from "@/agentMode/sdk/pi/models/ModelCatalog";
import {
  buildProvider,
  loadPiProviderDeps,
  type ProviderStreamsFactory,
} from "@/agentMode/sdk/pi/models/ProviderFactory";
import { STRICT_NO_AMBIENT_AUTH } from "@/agentMode/sdk/pi/models/ModelAuth";
import {
  createOpenCodeSessionId,
  withOpenCodeSessionHeaders,
} from "@/agentMode/sdk/pi/models/OpenCodeSession";
import { sha256 } from "@/utils/hash";
import { logWarn } from "@/logger";
import { withStructuredToolSampling } from "@/agentMode/sdk/pi/models/ModelRequestCapabilities";
import { isProviderEnabled } from "@/utils/providerAvailability";
import { resolveProviderBaseUrl } from "@/utils/providerCapability";

export interface PiRuntimeModels {
  readonly models: Models;
  readonly catalog: ModelCatalogSnapshot;
}

export interface PiProviderDispatch {
  readonly model: Model<Api>;
  readonly isCompaction: boolean;
  readonly providerSessionId?: string;
  readonly credentialFingerprint?: string;
  readonly signal?: AbortSignal;
  readonly open: () => AssistantMessageEventStream;
}

export interface PiProviderStream {
  readonly stream: AssistantMessageEventStream;
  readonly onResponse?: (message: AssistantMessage) => Promise<void>;
}

export interface PiModelContextPreparation {
  readonly context: TranscriptContext;
  readonly model: Model<Api>;
  readonly isCompaction: boolean;
  readonly providerSessionId?: string;
  readonly signal?: AbortSignal;
}

type PiModelSettings = Pick<VaultAgentSettings, "providers" | "configuredModels">;

interface OrganizationHeaderRequest {
  readonly headers?: Record<string, string | null>;
}

function withOpenAIOrganization<T extends OrganizationHeaderRequest>(
  request: T | undefined,
  organization: string | undefined
): T | OrganizationHeaderRequest | undefined {
  // 已保存的组织信息仍需发送；单次请求显式覆盖（含删除）时优先，避免重复的大小写变体。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (
    !organization ||
    Object.keys(request?.headers ?? {}).some((name) => name.toLowerCase() === "openai-organization")
  ) {
    return request;
  }
  return { ...request, headers: { "OpenAI-Organization": organization, ...request?.headers } };
}

export function configuredPiCatalog(settings: PiModelSettings): ModelCatalogSnapshot {
  for (const provider of Object.values(settings.providers)) {
    // 无法确定目标主机时跳过，旧配置也不能静默回退另一家服务。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    if (
      provider.origin.kind === "byok" &&
      isProviderEnabled(provider) &&
      !resolveProviderBaseUrl(provider)
    ) {
      logWarn(`[PiRuntimeModels] provider "${provider.providerId}" has no valid endpoint; skipped`);
    }
  }
  return buildModelCatalog(
    {
      providers: Object.values(settings.providers)
        .filter(
          (provider) =>
            provider.origin.kind === "byok" &&
            isProviderEnabled(provider) &&
            resolveProviderBaseUrl(provider)
        )
        .map((provider) => ({
          ...provider,
          baseUrl: resolveProviderBaseUrl(provider),
          useResponsesApi: provider.extras?.useResponsesApi === true,
        })),
      models: settings.configuredModels
        .filter((model) => {
          const provider = settings.providers[model.providerId];
          return (
            !model.info.isEmbedding &&
            provider?.origin.kind === "byok" &&
            isProviderEnabled(provider) &&
            !!resolveProviderBaseUrl(provider)
          );
        })
        .map((model) => ({
          configuredModelId: model.configuredModelId,
          providerId: model.providerId,
          upstreamModelId: model.info.id,
          displayName: model.info.displayName,
          toolCall: model.info.toolCall,
          reasoning: model.info.reasoning,
          reasoningEfforts: model.info.reasoningEfforts,
          structuredOutput: model.info.capabilities?.structuredOutput,
          midConversationSystemMessages: model.info.capabilities?.midConversationSystemMessages,
          capabilities: model.info.modalities?.input?.includes("image") ? ["vision"] : [],
          contextWindow: model.info.limits?.context,
          costRates: model.info.cost,
        })),
    },
    { sha256 }
  );
}

export async function createPiModels(options: {
  readonly settings: PiModelSettings;
  readonly keychain: KeychainPort;
  readonly streamsFactory?: ProviderStreamsFactory;
  readonly fetch?: typeof window.fetch;
  readonly dispatch?: (input: PiProviderDispatch) => Promise<PiProviderStream>;
  readonly prepareContext?: (input: PiModelContextPreparation) => Promise<TranscriptContext>;
}): Promise<PiRuntimeModels> {
  const [{ createModels }, deps, { createAssistantMessageEventStream }, { lookupDeclaredPiModel }] =
    await Promise.all([
      import("@earendil-works/pi-ai/models"),
      loadPiProviderDeps(),
      import("@earendil-works/pi-ai"),
      import("@/agentMode/sdk/pi/models/DeclaredModelCapabilities"),
    ]);
  const catalog = configuredPiCatalog(options.settings);
  const stored = new KeychainCredentialStore({ keychain: options.keychain });
  const credentials: CredentialStore = {
    read: async (id, operation) => {
      const existing = await stored.read(id, operation);
      if (existing) return existing;
      const provider = options.settings.providers[id];
      const key = provider?.apiKeyKeychainId
        ? options.keychain.getSecretById(provider.apiKeyKeychainId)
        : null;
      return key ? { type: "api_key", key } : undefined;
    },
    list: (operation) => stored.list(operation),
    modify: (id, change, operation) => stored.modify(id, change, operation),
    delete: (id, operation) => stored.delete(id, operation),
  };
  const models = createModels({ credentials, authContext: STRICT_NO_AMBIENT_AUTH });
  for (const provider of Object.values(options.settings.providers)) {
    const entries = catalog.readyModels.filter(
      (entry) => entry.providerInstanceId === provider.providerId
    );
    const api = entries[0]?.api;
    if (!api || provider.origin.kind !== "byok") continue;
    const baseUrl = resolveProviderBaseUrl(provider);
    const openCodeFallbackSessionId = createOpenCodeSessionId();
    models.setProvider(
      buildProvider(
        {
          providerInstanceId: provider.providerId,
          protocol: api,
          baseUrl,
          requiresApiKey: provider.requiresApiKey !== false,
          models: entries.map((entry) => {
            const configured = options.settings.configuredModels.find(
              (model) => model.configuredModelId === entry.configuredModelId
            );
            const declared =
              provider.origin.kind === "byok" && provider.origin.catalogProviderId && configured
                ? lookupDeclaredPiModel(provider.origin.catalogProviderId, configured.info.id)
                : undefined;
            const capabilities = configured?.info.capabilities;
            return {
              upstreamModelId: entry.upstreamModelId,
              displayName: configured?.info.displayName,
              contextWindow: entry.contextWindow ?? undefined,
              maxTokens: configured?.info.limits?.output,
              reasoning: entry.capabilities.supportsThinking,
              supportsImages: entry.capabilities.supportsImages,
              costRates: entry.costRates ?? undefined,
              reasoningEfforts: configured?.info.reasoningEfforts,
              // 切换协议后旧供应商的等级名称不再适用，必须按新协议生成请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
              thinkingLevelMap: declared?.api === api ? declared.thinkingLevelMap : undefined,
              compat:
                api === "google-generative-ai"
                  ? undefined
                  : {
                      // 保留原生自适应推理等参数；用户能力覆盖仅改变其声明的开关。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
                      ...(declared?.api === api ? declared.compat : {}),
                      ...(capabilities?.structuredOutput === undefined
                        ? {}
                        : {
                            supportsStrictMode: capabilities.structuredOutput,
                            ...(api === "anthropic-messages"
                              ? { supportsStrictTools: capabilities.structuredOutput }
                              : {}),
                          }),
                      ...(capabilities?.midConversationSystemMessages === undefined
                        ? {}
                        : {
                            supportsMidConvoSystemMessages:
                              capabilities.midConversationSystemMessages,
                          }),
                    },
            };
          }),
        },
        {
          ...deps,
          streamsFactory: (protocol) => {
            const streams = (options.streamsFactory ?? deps.streamsFactory)(protocol);
            const organization =
              (protocol === "openai-completions" || protocol === "openai-responses") &&
              typeof provider.extras?.openAIOrgId === "string"
                ? provider.extras.openAIOrgId.trim()
                : undefined;
            // Google SDK 暂不支持自定义网络通道，其余协议使用同一个宿主流式连接。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
            const transport =
              protocol !== "google-generative-ai" && options.fetch ? { fetch: options.fetch } : {};
            const guarded = (
              model: Model<Api>,
              context: TranscriptContext,
              requestedMaxTokens: number | undefined,
              signal: AbortSignal | undefined,
              providerSessionId: string | undefined,
              credentialFingerprint: string,
              open: (
                maxTokens: number,
                compiledContext: TranscriptContext
              ) => AssistantMessageEventStream
            ): AssistantMessageEventStream => {
              const output = createAssistantMessageEventStream();
              void (async () => {
                let dispatched: PiProviderStream | undefined;
                let responded = false;
                const recordResponse = async (message: AssistantMessage) => {
                  if (responded) return;
                  responded = true;
                  await dispatched?.onResponse?.(message);
                };
                try {
                  const isCompaction = isCompactionRequest(context);
                  const preparedContext = options.prepareContext
                    ? await options.prepareContext({
                        context,
                        model,
                        isCompaction,
                        providerSessionId,
                        signal,
                      })
                    : context;
                  const compiledContext = withStructuredToolSampling(
                    model,
                    compileModelToolResults(preparedContext)
                  );
                  const { maxTokens } = await budgetModelRequest(
                    model,
                    compiledContext,
                    requestedMaxTokens
                  );
                  const openBudgeted = () => open(maxTokens, compiledContext);
                  dispatched = options.dispatch
                    ? await options.dispatch({
                        model,
                        isCompaction,
                        signal,
                        providerSessionId,
                        credentialFingerprint,
                        open: openBudgeted,
                      })
                    : { stream: openBudgeted() };
                  const source = dispatched.stream;
                  for await (const event of source) {
                    if (event.type === "done") await recordResponse(event.message);
                    else if (event.type === "error") await recordResponse(event.error);
                    output.push(event);
                  }
                  const result = await source.result();
                  await recordResponse(result);
                  output.end(result);
                } catch (error) {
                  const failed: AssistantMessage = {
                    role: "assistant",
                    content: [],
                    api: model.api,
                    provider: model.provider,
                    model: model.id,
                    usage: {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                      totalTokens: 0,
                      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                    },
                    stopReason: signal?.aborted ? "aborted" : "error",
                    errorMessage: error instanceof Error ? error.message : String(error),
                    timestamp: Date.now(),
                  };
                  await recordResponse(failed).catch((recordError) =>
                    logWarn("[PiRuntimeModels] response accounting failed", recordError)
                  );
                  output.push({
                    type: "error",
                    reason: failed.stopReason === "aborted" ? "aborted" : "error",
                    error: failed,
                  });
                  output.end(failed);
                }
              })();
              return output;
            };
            return {
              stream: (model, context, request) =>
                guarded(
                  model,
                  context,
                  request?.maxTokens,
                  request?.signal,
                  request?.sessionId,
                  sha256(request?.apiKey ?? ""),
                  (maxTokens, compiledContext) =>
                    streams.stream(model, compiledContext, {
                      ...withOpenCodeSessionHeaders(
                        withOpenAIOrganization(request, organization),
                        baseUrl,
                        openCodeFallbackSessionId
                      ),
                      ...transport,
                      maxRetries: 0,
                      maxTokens,
                    })
                ),
              streamSimple: (model, context, request) =>
                guarded(
                  model,
                  context,
                  request?.maxTokens,
                  request?.signal,
                  request?.sessionId,
                  sha256(request?.apiKey ?? ""),
                  (maxTokens, compiledContext) => {
                    const effort = request?.reasoning;
                    // OpenAI 协议允许供应商自定义强度字符串；用 Pi 的映射入口保留用户声明值。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
                    if (
                      effort &&
                      !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
                        effort
                      ) &&
                      (model.api === "openai-completions" || model.api === "openai-responses")
                    ) {
                      return streams.streamSimple(
                        {
                          ...model,
                          thinkingLevelMap: { ...model.thinkingLevelMap, minimal: effort },
                        },
                        compiledContext,
                        {
                          ...withOpenCodeSessionHeaders(
                            withOpenAIOrganization(
                              { ...request, reasoning: "minimal" },
                              organization
                            ),
                            baseUrl,
                            openCodeFallbackSessionId
                          ),
                          ...transport,
                          maxRetries: 0,
                          maxTokens,
                        }
                      );
                    }
                    return streams.streamSimple(model, compiledContext, {
                      ...withOpenCodeSessionHeaders(
                        withOpenAIOrganization(request, organization),
                        baseUrl,
                        openCodeFallbackSessionId
                      ),
                      ...transport,
                      maxRetries: 0,
                      maxTokens,
                    });
                  }
                ),
            };
          },
        }
      )
    );
  }
  return { models, catalog };
}
