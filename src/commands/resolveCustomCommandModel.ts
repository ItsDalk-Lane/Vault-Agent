import type { ModelManagementApi } from "@/modelManagement";
import { resolveChatModelSelectionId } from "@/modelManagement";

export function resolveCustomCommandModel(
  api: Pick<ModelManagementApi, "backendConfigRegistry">,
  selection: string
): string | undefined {
  const entries = api.backendConfigRegistry
    .resolveEnabled("pi")
    .filter(
      (entry) =>
        entry.state === "ok" &&
        entry.provider.origin.kind === "byok" &&
        !entry.configuredModel.info.isEmbedding &&
        entry.configuredModel.info.toolCall !== false
    );
  return resolveChatModelSelectionId(entries, selection, false);
}
