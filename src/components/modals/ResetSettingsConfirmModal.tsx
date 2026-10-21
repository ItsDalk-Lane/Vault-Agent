import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { t } from "@/i18n";
import { App } from "obsidian";

export class ResetSettingsConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void | Promise<void>) {
    super(app, onConfirm, t("settings.resetConfirm.body"), t("settings.reset"));
  }
}
