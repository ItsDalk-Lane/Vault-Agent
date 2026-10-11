import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { t } from "../i18n";
import { currentFile } from "src/utils/currentFile";
import {
	orderFolderPathsByConfiguredRoots,
	sortFolderPathsByTree,
} from "src/utils/folder-sorting";
import { getAllFolderPathsInVault } from "src/utils/vaultQueries";
import { normalizeVaultPath } from "src/utils/pathUtils";
import { hasTemplatePathSyntax } from "src/utils/templatePathSyntax";
import type { FieldRequirement } from "./RequirementCollector";
import { templateFolderPathKeyFor } from "./templateFolderPathKey";

/**
 * Mirrors TemplateChoiceEngine.getFolderPath's branch precedence (and the
 * folder-mode dropdown in gui/ChoiceBuilder/folderMode.ts): which destination
 * set the run's folder chooser offers, and what a typed value may name.
 *
 * Returns null when the run will NOT open the chooser (single configured
 * destination, "same folder as active file") or when the destination set is
 * data-dependent (a folder definition with format syntax resolves at run
 * time), so those keep the sequential prompts.
 */
export function collectTemplateFolderRequirement(
	app: App,
	choiceExecutor: IChoiceExecutor | undefined,
	choice: ITemplateChoice,
): FieldRequirement | null {
	const config = choice.folder;
	if (!config?.enabled || config.createInSameFolderAsActiveFile) return null;

	const roots = [...(config.folders ?? [])];

	if (config.chooseWhenCreatingNote) {
		return requirementFor(
			app,
			choiceExecutor,
			choice.id,
			sortFolderPathsByTree(getAllFolderPathsInVault(app)),
			undefined,
		);
	}

	// The remaining modes offer configured folders, so they are only decidable
	// here when none of them needs run-time formatting (a token in an unused
	// folder must not prompt or fail - same rule as scanTemplateBody).
	if (roots.some((folder) => hasTemplatePathSyntax(folder))) return null;

	if (config.chooseFromSubfolders) {
		return requirementFor(
			app,
			choiceExecutor,
			choice.id,
			orderFolderPathsByConfiguredRoots(
				sortFolderPathsByTree(getAllFolderPathsInVault(app)),
				roots,
			),
			roots,
		);
	}

	// Default mode: the configured folders themselves, unformatted (guaranteed
	// token-free above). A single destination never prompts at run time.
	return requirementFor(app, choiceExecutor, choice.id, roots, roots);
}

/**
 * Emits the folder field exactly when the run's chooser would open:
 * `shouldPromptForFolder` with the engine's always-on allowCreate - more than
 * one offered destination, or none (type-to-create only). One destination is
 * taken silently by the run, so there is nothing to collect.
 */
function requirementFor(
	app: App,
	choiceExecutor: IChoiceExecutor | undefined,
	choiceId: string,
	destinations: string[],
	allowedRoots: string[] | undefined,
): FieldRequirement | null {
	const items = folderChooserItems(app, choiceExecutor, destinations, allowedRoots);
	if (items.length === 1) return null;

	return {
		id: templateFolderPathKeyFor(choiceId),
		label: t("onePageInput.selectFolder"),
		type: "suggester",
		source: "collected",
		options: items.map((item) => item.path),
		displayOptions: items.map((item) => item.label),
		placeholder: t("onePageInput.selectFolderPlaceholder"),
		// Typed text is a folder to create, like the run's InputSuggester.
		suggesterConfig: { allowCustomInput: true, caseSensitive: false, multiSelect: false },
	};
}

interface FolderChooserItem {
	path: string;
	label: string;
}

/**
 * The chooser's offered rows: the active-file folder first (the run's
 * `getCurrentFolderSuggestion` top item), then the destinations, deduped by
 * normalized path and confined to the allowed roots the way
 * FolderSelectionEngine.buildFolderSuggestions filters them.
 */
function folderChooserItems(
	app: App,
	choiceExecutor: IChoiceExecutor | undefined,
	destinations: string[],
	allowedRoots: string[] | undefined,
): FolderChooserItem[] {
	const items: FolderChooserItem[] = [];
	const seen = new Set<string>();

	const add = (path: string, label?: string) => {
		const normalized = normalizeVaultPath(path);
		if (seen.has(normalized)) return;
		if (!isPathAllowed(normalized, allowedRoots)) return;
		seen.add(normalized);
		items.push({ path, label: label ?? path });
	};

	const activeFile = currentFile(app, choiceExecutor);
	const parent = activeFile?.parent;
	if (activeFile && parent) add(parent.path ?? "", "<current folder>");

	for (const destination of destinations) add(destination);

	return items;
}

/** FolderSelectionEngine.isPathAllowed's rule: a root of "" allows everything. */
function isPathAllowed(path: string, roots: string[] | undefined): boolean {
	if (!roots || roots.length === 0) return true;
	for (const root of roots) {
		if (!root) return true;
		if (path === root) return true;
		if (path.startsWith(`${root}/`)) return true;
	}
	return false;
}
