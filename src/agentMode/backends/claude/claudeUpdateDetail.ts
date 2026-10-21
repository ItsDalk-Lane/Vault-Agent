import type { InstallState } from "@/agentMode/session/types";
import { t } from "@/i18n";

export function claudeUpdateDetail(state: InstallState): string {
  if (state.kind === "incompatible" && state.source === "custom") {
    return t("agentInfra.backend.compat.claudeUpdateCustom");
  }
  return t("agentInfra.backend.compat.claudeUpdate");
}
