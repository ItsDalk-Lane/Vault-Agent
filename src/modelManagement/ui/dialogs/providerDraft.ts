import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import { v4 as uuidv4 } from "uuid";

export interface ModelDraft {
  key: string;
  info: ModelInfo;
  enabled: boolean;
  expanded: boolean;
  context: string;
  output: string;
}

export interface ProviderDraft {
  displayName: string;
  baseUrl: string;
  providerType: ProviderType;
  apiKey: string;
  extras: Record<string, unknown>;
  enabled: boolean;
  models: ModelDraft[];
}

export function parseTokenCount(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(trimmed);
  if (!match) return null;
  const count =
    Number(match[1]) * (match[2]?.toLowerCase() === "m" ? 1000000 : match[2] ? 1000 : 1);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export function createModelDraft(info: ModelInfo, enabled = true, expanded = false): ModelDraft {
  return {
    key: uuidv4(),
    info: {
      ...info,
      modalities: {
        ...info.modalities,
        input: [
          ...new Set([
            "text",
            ...(info.modalities?.input ?? []).filter((input) => input === "image"),
          ]),
        ],
      },
      capabilities: { ...info.capabilities },
      reasoningEfforts: [...(info.reasoningEfforts ?? [])],
    },
    enabled,
    expanded,
    context: info.limits?.context === undefined ? "" : String(info.limits.context),
    output: info.limits?.output === undefined ? "" : String(info.limits.output),
  };
}

export function modelDraftInfo(model: ModelDraft): ModelInfo {
  return {
    ...model.info,
    // 未选能力必须覆盖 SDK 的协议默认值，原生搜索未接通时不能写成支持。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    capabilities: {
      ...model.info.capabilities,
      structuredOutput: model.info.capabilities?.structuredOutput ?? false,
      midConversationSystemMessages:
        model.info.capabilities?.midConversationSystemMessages ?? false,
      nativeWebSearch: false,
    },
    modalities: {
      ...model.info.modalities,
      input: ["text", ...(model.info.modalities?.input ?? []).filter((input) => input === "image")],
    },
    id: model.info.id.trim(),
    displayName: model.info.displayName || model.info.id.trim(),
    reasoning: (model.info.reasoningEfforts?.length ?? 0) > 0,
    reasoningEfforts: orderReasoningEfforts(model.info.reasoningEfforts ?? []),
    limits: {
      ...model.info.limits,
      context: parseTokenCount(model.context) ?? undefined,
      output: parseTokenCount(model.output) ?? undefined,
    },
  };
}

export function mergeDeclaredModelInfo(
  info: ModelInfo,
  declared: Partial<ModelInfo> | undefined
): ModelInfo {
  return {
    ...declared,
    ...info,
    modalities: { ...declared?.modalities, ...info.modalities },
    capabilities: { ...declared?.capabilities, ...info.capabilities },
    limits: { ...declared?.limits, ...info.limits },
  };
}

export function orderReasoningEfforts(efforts: readonly string[]): string[] {
  const known = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  return [...efforts].sort(
    (a, b) =>
      (known.includes(a) ? known.indexOf(a) : known.length) -
      (known.includes(b) ? known.indexOf(b) : known.length)
  );
}
