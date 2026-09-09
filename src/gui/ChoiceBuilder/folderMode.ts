import type { TemplateFolderConfig } from "../../types/choices/ITemplateChoice";
import { t } from "../../i18n";

/**
 * The mutually-exclusive destination modes a Template choice can use, surfaced as
 * a single dropdown in the choice builder (#1131). Each mode maps to a canonical
 * combination of the four persisted `folder` booleans; nothing about the stored
 * shape changes, so this is purely a GUI consolidation.
 */
export type FolderMode =
	| "obsidian-default"
	| "specified"
	| "active-file"
	| "prompt";

/**
 * Derive the mode a stored `folder` config resolves to.
 *
 * This MUST mirror `TemplateChoiceEngine.getFolderPath()`'s branch precedence
 * exactly, so the dropdown always shows the mode that will actually run:
 *   - !enabled                          -> Obsidian "Default location for new notes"
 *   - chooseWhenCreatingNote            -> engine branch 2 (prompt across all folders)
 *   - createInSameFolderAsActiveFile    -> engine branch 3 (active file's folder)
 *   - else                              -> engine branches 1 & 4 (folders list, optionally + subfolders)
 *
 * The order below matches the engine: branch 1 (subfolders) is gated by
 * `!(chooseWhenCreatingNote || createInSameFolderAsActiveFile)`, so a legacy
 * choice with several flags set folds to the same mode the engine would run.
 */
export function deriveFolderMode(folder: TemplateFolderConfig): FolderMode {
	if (!folder.enabled) return "obsidian-default";
	if (folder.chooseWhenCreatingNote) return "prompt";
	if (folder.createInSameFolderAsActiveFile) return "active-file";
	return "specified";
}

/**
 * Return a NEW folder config with the canonical flags for `mode`.
 *
 * Only the mode-discriminant flags (`enabled`, `chooseWhenCreatingNote`,
 * `createInSameFolderAsActiveFile`) are set; `folders[]` and `chooseFromSubfolders`
 * are PRESERVED across every switch. This matches the previous toggle form, which
 * hid but never cleared those values — so switching mode and back never loses the
 * user's folder list or their "Include subfolders" preference.
 *
 * `chooseFromSubfolders` only affects the engine in "specified" mode (its branch 1
 * is gated by `!(chooseWhenCreatingNote || createInSameFolderAsActiveFile)`), so a
 * preserved value is inert in the other modes here. (Note:
 * `TemplateInsertEngine.computeChoiceTargetPath` reads it ungated — a pre-existing
 * quirk, unchanged by this UI work.)
 */
export function applyFolderMode(
	folder: TemplateFolderConfig,
	mode: FolderMode,
): TemplateFolderConfig {
	switch (mode) {
		case "obsidian-default":
			return {
				...folder,
				enabled: false,
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
			};
		case "specified":
			return {
				...folder,
				enabled: true,
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
			};
		case "active-file":
			return {
				...folder,
				enabled: true,
				createInSameFolderAsActiveFile: true,
				chooseWhenCreatingNote: false,
			};
		case "prompt":
			return {
				...folder,
				enabled: true,
				chooseWhenCreatingNote: true,
				createInSameFolderAsActiveFile: false,
			};
	}
}

/**
 * Build the folder-mode dropdown options at call time so the labels pick up the
 * current locale. Returning a fresh array on each call (rather than a module
 * constant) is what makes locale switching actually work — module-level code
 * runs at import time, which is BEFORE main.ts calls setLocale(), so a frozen
 * `{ value, label }` literal would lock in the English fallback and never
 * refresh.
 */
export function folderModeOptions(): { value: FolderMode; label: string }[] {
	return [
		{ value: "obsidian-default", label: t("choiceBuilder.folderMode.obsidianDefault") },
		{ value: "specified", label: t("choiceBuilder.folderMode.specified") },
		{ value: "active-file", label: t("choiceBuilder.folderMode.activeFile") },
		{ value: "prompt", label: t("choiceBuilder.folderMode.prompt") },
	];
}

export function folderModeDescriptions(): Record<FolderMode, string> {
	return {
		"obsidian-default": t("choiceBuilder.folderMode.obsidianDefaultDesc"),
		specified: t("choiceBuilder.folderMode.specifiedDesc"),
		"active-file": t("choiceBuilder.folderMode.activeFileDesc"),
		prompt: t("choiceBuilder.folderMode.promptDesc"),
	};
}
