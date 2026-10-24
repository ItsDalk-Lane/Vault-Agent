import type { App } from "obsidian";
import { Notice } from "obsidian";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { t } from "@/i18n";
import { logError } from "@/logger";

export function confirmSessionRollover(app: App, rollover: () => Promise<unknown>): void {
  new ConfirmModal(
    app,
    async () => {
      try {
        await rollover();
        new Notice(t("controls.rolloverCompleted"));
      } catch (error) {
        // 总结停止或后端拒绝时保留真实原因，不能把原聊天仍在误报为新聊天已准备好。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
        logError("[AgentMode] summarized chat creation failed", error);
        new Notice(
          `${t("controls.rolloverFailed")} ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    t("controls.rolloverDescription"),
    t("controls.rolloverSession"),
    t("controls.rolloverSession")
  ).open();
}
