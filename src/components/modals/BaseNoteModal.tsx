import { App, FuzzySuggestModal, TFile } from "obsidian";
import { t } from "@/i18n";

export abstract class BaseNoteModal<T> extends FuzzySuggestModal<T> {
  protected activeNote: TFile | null;
  protected availableNotes: T[];

  constructor(app: App) {
    super(app);
    this.activeNote = app.workspace.getActiveFile();
  }

  protected formatNoteTitle(basename: string, isActive: boolean, extension?: string): string {
    let title = basename;
    if (isActive) {
      title += t("ui.note.currentSuffix");
    }
    if (extension === "pdf") {
      title += t("ui.note.pdfSuffix");
    } else if (extension === "canvas") {
      title += t("ui.note.canvasSuffix");
    }
    return title;
  }
}
