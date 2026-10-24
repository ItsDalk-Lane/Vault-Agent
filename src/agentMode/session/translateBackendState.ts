import type {
  BackendModelCatalog,
  BackendState,
  ModelEntry,
  ModelState,
} from "@/agentMode/session/types";

export function findModelEntry(
  state: ModelState | null | undefined,
  baseModelId: string
): ModelEntry | undefined {
  return state?.availableModels.find((e) => e.baseModelId === baseModelId);
}

export function modelStateSignature(state: BackendState | null): string {
  const m = state?.model;
  if (!m) return "";
  const apply =
    m.apply.kind === "setConfigOption"
      ? `setConfigOption:${m.apply.configId}:${m.apply.effortConfigId ?? ""}`
      : m.apply.kind;
  return [
    m.current.baseModelId,
    m.current.effort ?? "",
    apply,
    m.availableModels
      .map(
        (e) =>
          `${e.baseModelId}:${e.provider ?? ""}:${e.effortOptions
            .map((o) => o.value ?? "_")
            .join("|")}`
      )
      .join(","),
  ].join("/");
}

export function modelCatalogSignature(catalog: BackendModelCatalog | null): string {
  if (!catalog) return "";
  return JSON.stringify(catalog.availableModels);
}

export function modeStateSignature(state: BackendState | null): string {
  const md = state?.mode;
  if (!md) return "";
  const apply = md.options.map((o) => `${o.value}:${md.apply[o.value]?.kind ?? ""}`).join(",");
  return `${md.current ?? ""}|${apply}`;
}
