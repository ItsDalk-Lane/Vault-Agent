import type { App } from "obsidian";
import { Notice } from "obsidian";
import { createDocsLink, DOCS_URLS } from "../../docs";
import { t } from "../../i18n";

/**
 * Shows a notice to the user when no user scripts are found in their vault.
 * Provides helpful guidance on where to place scripts and links to documentation.
 */
export function showNoScriptsFoundNotice(app: App): void {
	const notice = new Notice("", 10000);
	const messageEl = notice.messageEl;
	messageEl.replaceChildren();
	messageEl.createDiv({
		text: t("userScript.noScriptsFound.title"),
		cls: "quickadd-notice-title",
	});

	// Popout-aware: Obsidian's createDiv/createEl helpers route through
	// messageEl.ownerDocument instead of the bare `document` global.
	const content = messageEl.createDiv();
	content.createDiv({ text: t("userScript.noScriptsFound.body") });
	content.createEl("br");
	content.createDiv({ text: t("userScript.noScriptsFound.ensure") });
	content.createDiv({
		text: t("userScript.noScriptsFound.inVault", {
			configDir: app.vault.configDir,
		}),
	});
	content.createDiv({ text: t("userScript.noScriptsFound.notHidden") });
	content.createDiv({ text: t("userScript.noScriptsFound.isJsOrNote") });
	content.createEl("br");

	createDocsLink(
		content,
		DOCS_URLS.userScripts,
		t("userScript.noScriptsFound.viewDocs"),
	);
}
