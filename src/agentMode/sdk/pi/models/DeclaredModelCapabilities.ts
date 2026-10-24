import { DECLARED_PI_MODEL_FACTS } from "./declaredPiModels.generated";
import type { DeclaredPiModelFact } from "./DeclaredPiModelFacts";
interface DeclaredModelCapabilities {
  modalities?: { input?: string[] };
  limits?: { context?: number; output?: number };
  reasoning?: boolean;
  reasoningEfforts?: readonly string[];
  capabilities?: { structuredOutput?: boolean; midConversationSystemMessages?: boolean };
}

const PROVIDER_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  togetherai: "together",
  vercel: "vercel-ai-gateway",
});

export function lookupDeclaredPiModel(
  providerId: string,
  modelId: string
): DeclaredPiModelFact | undefined {
  const builtinId = Object.hasOwn(PROVIDER_ALIASES, providerId)
    ? PROVIDER_ALIASES[providerId]
    : providerId;
  const provider = Object.hasOwn(DECLARED_PI_MODEL_FACTS, builtinId)
    ? DECLARED_PI_MODEL_FACTS[builtinId]
    : undefined;
  // 目录缺项不能凭供应商名称猜测模型能力。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
  if (!provider) return undefined;
  return Object.hasOwn(provider, modelId) ? provider[modelId] : undefined;
}

export function lookupDeclaredModelCapabilities(
  providerId: string,
  modelId: string
): DeclaredModelCapabilities | undefined {
  const model = lookupDeclaredPiModel(providerId, modelId);
  if (!model) return undefined;
  const compat = model.compat;
  const structuredOutput =
    compat && "supportsStrictMode" in compat
      ? compat.supportsStrictMode
      : compat && "supportsStrictTools" in compat
        ? compat.supportsStrictTools
        : undefined;
  return {
    modalities: { input: [...model.input] },
    limits: { context: model.contextWindow, output: model.maxTokens },
    reasoning: model.reasoning,
    reasoningEfforts: model.reasoningEfforts,
    capabilities: {
      structuredOutput,
      midConversationSystemMessages:
        compat && "supportsMidConvoSystemMessages" in compat
          ? compat.supportsMidConvoSystemMessages
          : undefined,
    },
  };
}
