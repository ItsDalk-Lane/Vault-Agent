import { EditorCommandType } from "./EditorCommandType";
import type { App } from "obsidian";
import { log } from "../../../logger/logManager";
import { t } from "../../../i18n";
import { EditorCommand } from "./EditorCommand";

export class PasteCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.Paste);
	}

	static async run(app: App) {
		const clipboard = await navigator.clipboard.readText();
		const activeView = EditorCommand.getActiveMarkdownView(app);

		if (!activeView) {
			log.logError(t("errors.noActiveMarkdownView"));
			return;
		}

		activeView.editor.replaceSelection(clipboard);
	}
}
