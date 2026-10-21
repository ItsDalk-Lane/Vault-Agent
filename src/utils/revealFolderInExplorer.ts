import { logWarn } from "@/logger";
import { App, Notice, TFolder } from "obsidian";
import { t } from "@/i18n";

export function revealFolderInExplorer(app: App, relPath: string): void {
  const folder = app.vault.getAbstractFileByPath(relPath);
  if (!(folder instanceof TFolder)) {
    new Notice(t("ui.notice.folderMissing", { path: relPath }), 5000);
    return;
  }
  const fileExplorer = (
    app as unknown as {
      internalPlugins?: {
        getPluginById?: (
          id: string
        ) =>
          | { enabled?: boolean; instance?: { revealInFolder?: (folder: TFolder) => void } }
          | undefined;
      };
    }
  ).internalPlugins?.getPluginById?.("file-explorer");
  if (fileExplorer?.enabled && fileExplorer.instance?.revealInFolder) {
    fileExplorer.instance.revealInFolder(folder);
    return;
  }
  logWarn("[settings] File Explorer plugin unavailable; cannot reveal folder.");
  new Notice(t("ui.notice.explorerDisabled"), 5000);
}
