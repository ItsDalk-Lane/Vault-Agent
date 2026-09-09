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
	appendDiv(
		messageEl,
		t("userScript.noScriptsFound.title"),
		"quickadd-notice-title",
	);

	// Use the notice element's owning document (popout-aware) instead of the bare
	// `document` global.
	const doc = messageEl.ownerDocument;
	const content = doc.createElement("div");
	messageEl.append(content);
	appendDiv(content, t("userScript.noScriptsFound.body"));
	content.append(doc.createElement("br"));
	appendDiv(content, t("userScript.noScriptsFound.ensure"));
	appendDiv(
		content,
		t("userScript.noScriptsFound.inVault", {
			configDir: app.vault.configDir,
		}),
	);
	appendDiv(content, t("userScript.noScriptsFound.notHidden"));
	appendDiv(content, t("userScript.noScriptsFound.isJsOrNote"));
	content.append(doc.createElement("br"));

	createDocsLink(
		content,
		DOCS_URLS.userScripts,
		t("userScript.noScriptsFound.viewDocs"),
	);
}

function appendDiv(parent: HTMLElement, text: string, cls?: string): HTMLDivElement {
	const element = parent.ownerDocument.createElement("div");
	element.textContent = text;
	if (cls) element.classList.add(cls);
	parent.append(element);
	return element;
}
