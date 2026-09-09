import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { ICommand } from "../types/macros/ICommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { ConditionalCondition } from "../types/macros/Conditional/types";
import { CommandType } from "../types/macros/CommandType";
import type {
	QuickAddPackage,
	QuickAddPackageAssetKind,
} from "../types/packages/QuickAddPackage";
import { flattenChoices, isChoiceLike } from "../utils/choiceUtils";
import { commandListOf, isCommandLike } from "../utils/macroUtils";
import { decodeFromBase64 } from "../utils/base64";
import { extractScriptFromMarkdown } from "../utils/extractScriptFromMarkdown";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { t } from "../i18n";

/**
 * Pure, App-free analysis of a QuickAdd package for the import preview.
 *
 * Everything in this module is computed from the package payload + a set of
 * already-existing vault paths (and the importer's existing choices). It never
 * touches the Obsidian App, so it is unit-testable under jsdom and is the exact
 * model the import modal renders and the `quickadd:package-preview` CLI handler
 * returns.
 *
 * Key safety invariant: a file's "executable" status is decided from the
 * COMMAND GRAPH (is it referenced by a UserScript / script-mode Conditional?),
 * never from the package-declared `asset.kind`, which is an untrusted hint.
 */

export type PreviewSeverity = "critical" | "warning" | "info";

export type PreviewFlag =
	| "user-script"
	| "conditional-script"
	| "bundled-script"
	| "run-on-startup"
	| "mislabeled-executable"
	| "registers-command"
	| "obsidian-command"
	| "ai"
	| "ai-tools"
	| "capture-writes"
	| "template-write"
	| "overwrites-existing-choice"
	| "overwrites-existing-file"
	| "missing-reference"
	| "unknown-command"
	| "editor-command"
	| "open-file";

// Severity per flag. The user-facing label/description live in the i18n locale
// tables (`packageManager.flag.*`) and are resolved at CALL time — a module-level
// record would freeze whatever locale was active at import time.
const FLAG_SEVERITY: Record<PreviewFlag, PreviewSeverity> = {
	"user-script": "critical",
	"conditional-script": "critical",
	"bundled-script": "critical",
	"run-on-startup": "critical",
	"mislabeled-executable": "critical",
	"registers-command": "warning",
	"obsidian-command": "warning",
	ai: "warning",
	"ai-tools": "critical",
	"capture-writes": "warning",
	"template-write": "warning",
	"overwrites-existing-choice": "warning",
	"overwrites-existing-file": "warning",
	"missing-reference": "warning",
	"unknown-command": "warning",
	"editor-command": "info",
	"open-file": "info",
};

/** Maps a flag id to its camelCase key under `packageManager.flag.*`. */
const FLAG_I18N_KEY: Record<PreviewFlag, string> = {
	"user-script": "userScript",
	"conditional-script": "conditionalScript",
	"bundled-script": "bundledScript",
	"run-on-startup": "runOnStartup",
	"mislabeled-executable": "mislabeledExecutable",
	"registers-command": "registersCommand",
	"obsidian-command": "obsidianCommand",
	ai: "ai",
	"ai-tools": "aiTools",
	"capture-writes": "captureWrites",
	"template-write": "templateWrite",
	"overwrites-existing-choice": "overwritesExistingChoice",
	"overwrites-existing-file": "overwritesExistingFile",
	"missing-reference": "missingReference",
	"unknown-command": "unknownCommand",
	"editor-command": "editorCommand",
	"open-file": "openFile",
};

export function flagSeverity(flag: PreviewFlag): PreviewSeverity {
	return FLAG_SEVERITY[flag];
}

export function flagLabel(flag: PreviewFlag): string {
	return t(`packageManager.flag.${FLAG_I18N_KEY[flag]}.label`);
}

export function flagDescription(flag: PreviewFlag): string {
	return t(`packageManager.flag.${FLAG_I18N_KEY[flag]}.description`);
}

function isScriptKind(kind: QuickAddPackageAssetKind): boolean {
	return kind === "user-script" || kind === "conditional-script";
}

// A bundled asset that can be executed as code: a declared script kind, OR any
// non-`.md` file — because `kind` is an untrusted hint and a macro (in this
// package or already in the vault) loads it via the user-script loader, which
// runs the RAW bytes of ANY non-`.md` file as JavaScript (src/utils/userScript.ts:
// only `.md` is special-cased, to extract its first ```js fence). A `.js`-only
// check under-discloses: a payload at `scripts/x.txt`, `x.cjs`, or no extension
// runs identically. `.md` notes are handled by markdownAssetIsExecutable so plain
// templates stay un-flagged. Path-only check keeps this App-free.
function isExecutableBundledAsset(
	kind: QuickAddPackageAssetKind,
	originalPath: string,
): boolean {
	return isScriptKind(kind) || !MARKDOWN_FILE_EXTENSION_REGEX.test(originalPath);
}

// Since #1065 a `.md` note is loadable as a user script (its first ```js fence
// runs). The `.js` path check above can't see that, so a bundled note that lies
// about its `kind` (e.g. "template") and is referenced by no choice would slip the
// disclosure gate, land on disk, and run via any macro pointing at its path.
// Decode the bundled content and run the SAME extractor the loader uses: only a
// note that actually contains a runnable js fence is treated as executable, so
// plain `.md` templates are not flagged. Pure/App-free — operates on the payload.
function markdownAssetIsExecutable(
	originalPath: string,
	content: string,
): boolean {
	if (!MARKDOWN_FILE_EXTENSION_REGEX.test(originalPath)) return false;
	let decoded: string;
	try {
		decoded = decodeFromBase64(content);
	} catch {
		return false;
	}
	const { code } = extractScriptFromMarkdown(decoded);
	return code !== null && code.length > 0;
}

// The runnable code of a bundled executable asset, for static disclosure scans:
// a `.md` note yields its first js fence (what the loader runs); any other
// executable asset (a `.js`, or a script-kind asset) yields its decoded body.
// Pure/App-free — operates on the bundled payload only.
function bundledScriptCode(originalPath: string, content: string): string | null {
	let decoded: string;
	try {
		decoded = decodeFromBase64(content);
	} catch {
		return null;
	}
	if (MARKDOWN_FILE_EXTENSION_REGEX.test(originalPath)) {
		const { code } = extractScriptFromMarkdown(decoded);
		return code !== null && code.length > 0 ? code : null;
	}
	return decoded;
}

// #714: a bundled script that wires up QuickAdd's AI tool-calling lets an AI MODEL
// read and write the vault with model-chosen arguments — a distinct risk class from
// "this script runs". Detect the common surface forms: `quickAddApi.ai.tools/.agent/
// .tool(...)`, the destructured `ai.tools/agent/tool(...)`, and the built-in groups
// (`tools.vault/workspace/system(...)`). A heuristic for DISCLOSURE only — the
// security floor (any script ⇒ "full vault + network access, gated") already holds.
const AI_TOOLS_USE_REGEX =
	/\bai\s*\.\s*(?:tools|agent|tool)\b|\btools\s*\.\s*(?:vault|workspace|system)\s*\(/;
function scriptUsesAiTools(code: string): boolean {
	return AI_TOOLS_USE_REGEX.test(code);
}

const SEVERITY_ORDER: Record<PreviewSeverity, number> = {
	critical: 0,
	warning: 1,
	info: 2,
};

const KNOWN_COMMAND_TYPES = new Set<string>(Object.values(CommandType));

/** A site where a script/template file path is referenced. */
export interface PreviewUsageSite {
	choiceId: string;
	path: string;
	/** Referenced as an executable script (UserScript / script-mode Conditional). */
	asScript: boolean;
	/** The asset kind this reference implies, regardless of the bundled kind. */
	impliedKind: QuickAddPackageAssetKind;
	/** Human-readable location, e.g. "Daily Sync › fetch (User Script)". */
	breadcrumb: string;
}

/** A flattened command in a macro, for the read-only "Show macro" disclosure. */
export interface PreviewCommand {
	name: string;
	type: string;
	depth: number;
	flag?: PreviewFlag;
	scriptPath?: string;
	summary?: string;
}

export interface PreviewChoice {
	choiceId: string;
	name: string;
	type: string;
	/** Folder location (does not include the choice's own name). */
	location: string;
	/** Id already present in the importer's vault -> will overwrite a choice. */
	exists: boolean;
	registersCommand: boolean;
	flags: PreviewFlag[];
	commands: PreviewCommand[];
}

export interface PreviewFile {
	originalPath: string;
	kind: QuickAddPackageAssetKind;
	/** Present in pkg.assets (content available to preview). */
	bundled: boolean;
	/** Decided from the command graph, NOT from `kind`. */
	executable: boolean;
	/** Must be opened before the package import acknowledgement gate can pass. */
	requiresReview: boolean;
	/** Default destination already exists -> import will overwrite it. */
	exists: boolean;
	/** Cheap decoded-size estimate from base64 length (no decode). */
	sizeBytes: number;
	/** Bundled but referenced by no choice/command. */
	orphan: boolean;
	referencedBy: PreviewUsageSite[];
}

export interface CapabilityRow {
	flag: PreviewFlag;
	severity: PreviewSeverity;
	/** Plain-language description of what the capability does. */
	title: string;
	/** Location / count detail. */
	detail: string;
	/** Set for critical script rows; ties the row to the disclosure gate. */
	scriptPath?: string;
}

export interface MissingReference {
	path: string;
	asScript: boolean;
	breadcrumb: string;
}

export interface PreviewSummary {
	hasCritical: boolean;
	hasWarning: boolean;
	criticalCount: number;
	warningCount: number;
	runsOnStartup: boolean;
	scriptCount: number;
	registersCommandCount: number;
	overwritesChoices: number;
	overwritesFiles: number;
	missingCount: number;
}

export interface PackagePreview {
	quickAddVersion: string;
	createdAt: string;
	choiceCount: number;
	fileCount: number;
	choices: PreviewChoice[];
	files: PreviewFile[];
	capabilityRows: CapabilityRow[];
	missingReferences: MissingReference[];
	orphanAssets: string[];
	/** Bundled executable scripts the user must review to satisfy the gate. */
	criticalScriptPaths: string[];
	summary: PreviewSummary;
}

// --- Walk -------------------------------------------------------------------

interface ChoiceWalk {
	choiceId: string;
	name: string;
	type: string;
	location: string;
	registersCommand: boolean;
	flags: Set<PreviewFlag>;
	commands: PreviewCommand[];
	usages: PreviewUsageSite[];
	/** Granular critical/warning rows attributable to this choice. */
	rows: CapabilityRow[];
}

interface PackageWalk {
	choiceWalks: ChoiceWalk[];
}

function joinCrumb(parts: Array<string | undefined>): string {
	return parts.filter((part): part is string => Boolean(part)).join(" › ");
}

function commandLabel(command: ICommand): string {
	const name = command.name?.trim();
	return name && name.length > 0 ? name : String(command.type);
}

function conditionSummary(condition: ConditionalCondition): string {
	if (condition.mode === "script") {
		return `${t("packageManager.conditionScriptPrefix")} ${condition.scriptPath}${
			condition.exportName ? ` (${condition.exportName})` : ""
		}`;
	}
	const expected =
		condition.expectedValue !== undefined ? ` ${condition.expectedValue}` : "";
	return `${condition.variableName} ${condition.operator}${expected}`;
}

function isMacroChoice(choice: IChoice): choice is IMacroChoice {
	return choice.type === "Macro";
}

function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	return choice.type === "Multi";
}

function isTemplateChoice(choice: IChoice): choice is ITemplateChoice {
	return choice.type === "Template";
}

function isCaptureChoice(choice: IChoice): choice is ICaptureChoice {
	return choice.type === "Capture";
}

/** True when a template's file-exists behavior can modify an existing note. */
function templateModifiesExisting(choice: ITemplateChoice): boolean {
	const behavior = choice.fileExistsBehavior;
	if (!behavior || behavior.kind !== "apply") return false;
	return (
		behavior.mode === "overwrite" ||
		behavior.mode === "appendTop" ||
		behavior.mode === "appendBottom"
	);
}

function walkPackage(pkg: QuickAddPackage): PackageWalk {
	const choiceWalks: ChoiceWalk[] = [];
	// Every choice that has its own top-level row. A Multi child that is also a
	// separate entry is skipped during recursion (it gets its own walk), while an
	// inline-only child (present in a Multi.choices array but NOT an entry) is
	// recursed and attributed to its host — so a crafted package can't hide a
	// capability by inlining a child without listing it as an entry.
	//
	// Skipping the same-id inline child is only safe because parseQuickAddPackage
	// (findDivergentChoiceId) rejects any package whose inline child diverges from
	// its same-id entry: the copy walked here is provably the copy applyPackageImport
	// installs. Without that boundary check a benign entry could mask a malicious
	// inline child (e.g. runOnStartup:true) and suppress the disclosure gate.
	const entryIds = new Set(pkg.choices.map((entry) => entry.choice.id));

	for (const entry of pkg.choices) {
		const choice = entry.choice;
		const location =
			joinCrumb(entry.pathHint.slice(0, -1)) ||
			t("packageManager.rootLocation");
		const walk: ChoiceWalk = {
			choiceId: choice.id,
			name: choice.name,
			type: choice.type,
			location,
			registersCommand: false,
			flags: new Set<PreviewFlag>(),
			commands: [],
			usages: [],
			rows: [],
		};

		collectChoice(choice, walk, [choice.name], entryIds, 0);

		choiceWalks.push(walk);
	}

	return { choiceWalks };
}

function collectChoice(
	choice: IChoice,
	walk: ChoiceWalk,
	crumbs: string[],
	entryIds: ReadonlySet<string>,
	depthLevel: number,
): void {
	if (choice.command) {
		walk.registersCommand = true;
		walk.flags.add("registers-command");
	}

	if (isMacroChoice(choice)) {
		if (choice.runOnStartup) {
			walk.flags.add("run-on-startup");
			walk.rows.push({
				flag: "run-on-startup",
				severity: "critical",
				title: t("packageManager.row.runOnStartup"),
				detail: joinCrumb(crumbs),
			});
		}
		collectCommands(choice.macro?.commands, walk, crumbs, entryIds, depthLevel);
	}

	if (isTemplateChoice(choice)) {
		if (choice.templatePath) {
			walk.usages.push({
				choiceId: walk.choiceId,
				path: choice.templatePath,
				asScript: false,
				impliedKind: "template",
				breadcrumb: joinCrumb([...crumbs, t("packageManager.crumb.template")]),
			});
		}
		if (templateModifiesExisting(choice)) {
			walk.flags.add("template-write");
		}
	}

	if (isCaptureChoice(choice)) {
		walk.flags.add("capture-writes");
		const createCfg = choice.createFileIfItDoesntExist;
		if (
			createCfg?.enabled &&
			createCfg.createWithTemplate &&
			createCfg.template
		) {
			walk.usages.push({
				choiceId: walk.choiceId,
				path: createCfg.template,
				asScript: false,
				impliedKind: "capture-template",
				breadcrumb: joinCrumb([
					...crumbs,
					t("packageManager.crumb.newFileTemplate"),
				]),
			});
		}
	}

	if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			// A packaged folder's list can hold a `null` hole like any other
			// (#1566); it carries nothing, so step over it rather than deref it.
			if (!isChoiceLike(child)) continue;
			// Skip children that have their own top-level row (avoids double
			// counting); recurse inline-only children so they can't hide.
			if (entryIds.has(child.id)) continue;
			collectChoice(child, walk, [...crumbs, child.name], entryIds, depthLevel);
		}
	}
}

function collectCommands(
	// `unknown`: raw `macro.commands` / branch values, straight from data.json.
	commands: unknown,
	walk: ChoiceWalk,
	crumbs: string[],
	entryIds: ReadonlySet<string>,
	depth: number,
): void {
	for (const command of commandListOf(commands)) {
		if (!isCommandLike(command)) continue;
		const label = commandLabel(command);
		const commandCrumbs = [...crumbs, label];

		switch (command.type) {
			case CommandType.UserScript: {
				const script = command as IUserScript;
				walk.flags.add("user-script");
				walk.commands.push({
					name: label,
					type: command.type,
					depth,
					flag: "user-script",
					scriptPath: script.path,
				});
				if (script.path) {
					walk.usages.push({
						choiceId: walk.choiceId,
						path: script.path,
						asScript: true,
						impliedKind: "user-script",
						breadcrumb: joinCrumb(commandCrumbs),
					});
					walk.rows.push({
						flag: "user-script",
						severity: "critical",
						title: t("packageManager.row.userScript"),
						detail: `${joinCrumb(commandCrumbs)} (${script.path})`,
						scriptPath: script.path,
					});
				}
				break;
			}
			case CommandType.Conditional: {
				const conditional = command as IConditionalCommand;
				const condition = conditional.condition;
				const summary = condition ? conditionSummary(condition) : undefined;
				const isScript =
					condition?.mode === "script" && Boolean(condition.scriptPath);
				walk.commands.push({
					name: label,
					type: command.type,
					depth,
					flag: isScript ? "conditional-script" : undefined,
					scriptPath: isScript ? condition.scriptPath : undefined,
					summary,
				});
				if (isScript) {
					const scriptPath = (condition as { scriptPath: string }).scriptPath;
					walk.flags.add("conditional-script");
					walk.usages.push({
						choiceId: walk.choiceId,
						path: scriptPath,
						asScript: true,
						impliedKind: "conditional-script",
						breadcrumb: joinCrumb(commandCrumbs),
					});
					walk.rows.push({
						flag: "conditional-script",
						severity: "critical",
						title: t("packageManager.row.conditionalScript"),
						detail: `${joinCrumb(commandCrumbs)} (${scriptPath})`,
						scriptPath,
					});
				}
				collectCommands(
					conditional.thenCommands ?? [],
					walk,
					[...commandCrumbs, t("packageManager.crumb.then")],
					entryIds,
					depth + 1,
				);
				collectCommands(
					conditional.elseCommands ?? [],
					walk,
					[...commandCrumbs, t("packageManager.crumb.else")],
					entryIds,
					depth + 1,
				);
				break;
			}
			case CommandType.NestedChoice: {
				const nested = command as INestedChoiceCommand;
				walk.commands.push({ name: label, type: command.type, depth });
				if (nested.choice) {
					// Embedded choice has no pkg.choices entry: recurse fully,
					// attributing its capabilities to this top-level choice.
					collectChoice(
						nested.choice,
						walk,
						[...commandCrumbs, nested.choice.name],
						entryIds,
						depth + 1,
					);
				}
				break;
			}
			case CommandType.Obsidian: {
				const obsidian = command as IObsidianCommand;
				walk.flags.add("obsidian-command");
				walk.commands.push({ name: label, type: command.type, depth });
				walk.rows.push({
					flag: "obsidian-command",
					severity: "warning",
					title: t("packageManager.row.obsidianCommand"),
					detail: `${joinCrumb(commandCrumbs)}${
						obsidian.commandId ? ` (${obsidian.commandId})` : ""
					}`,
				});
				break;
			}
			case CommandType.AIAssistant: {
				walk.flags.add("ai");
				walk.commands.push({ name: label, type: command.type, depth });
				walk.rows.push({
					flag: "ai",
					severity: "warning",
					title: t("packageManager.row.ai"),
					detail: joinCrumb(commandCrumbs),
				});
				break;
			}
			case CommandType.EditorCommand: {
				walk.flags.add("editor-command");
				walk.commands.push({ name: label, type: command.type, depth });
				break;
			}
			case CommandType.OpenFile: {
				walk.flags.add("open-file");
				walk.commands.push({ name: label, type: command.type, depth });
				break;
			}
			case CommandType.Choice:
			case CommandType.Wait: {
				walk.commands.push({ name: label, type: command.type, depth });
				break;
			}
			default: {
				if (!KNOWN_COMMAND_TYPES.has(String(command.type))) {
					walk.flags.add("unknown-command");
					walk.commands.push({
						name: label,
						type: String(command.type),
						depth,
						flag: "unknown-command",
					});
					walk.rows.push({
						flag: "unknown-command",
						severity: "warning",
						title: t("packageManager.row.unknownCommand"),
						detail: `${joinCrumb(commandCrumbs)} (${String(command.type)})`,
					});
				} else {
					walk.commands.push({ name: label, type: String(command.type), depth });
				}
				break;
			}
		}
	}
}

// --- Public analysis --------------------------------------------------------

/**
 * Every script/template path the package references (deduped). The orchestrator
 * uses this to resolve existence for both bundled and unbundled references in a
 * single vault pass.
 */
export function collectReferencedAssetPaths(pkg: QuickAddPackage): string[] {
	const { choiceWalks } = walkPackage(pkg);
	const paths = new Set<string>();
	for (const walk of choiceWalks) {
		for (const usage of walk.usages) {
			if (usage.path) paths.add(usage.path);
		}
	}
	return Array.from(paths);
}

// Cheap decoded-size estimate (no decode). Assumes RFC 4648 base64 as produced
// by btoa/Buffer; the floor handles unpadded input correctly too.
function estimateBytesFromBase64(content: string): number {
	const len = content.length;
	if (len === 0) return 0;
	let padding = 0;
	if (content.endsWith("==")) padding = 2;
	else if (content.endsWith("=")) padding = 1;
	return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

function flagComparator(a: PreviewFlag, b: PreviewFlag): number {
	return SEVERITY_ORDER[flagSeverity(a)] - SEVERITY_ORDER[flagSeverity(b)];
}

/**
 * Build the full preview model.
 *
 * @param existingChoices the importer's current choices (for id-collision detection)
 * @param pkg the parsed package
 * @param existsByPath paths (bundled or referenced) that already exist in the vault
 */
export function buildPackagePreview(
	existingChoices: IChoice[],
	pkg: QuickAddPackage,
	existsByPath: ReadonlySet<string>,
): PackagePreview {
	const { choiceWalks } = walkPackage(pkg);
	const existingById = new Set(
		flattenChoices(existingChoices).map((choice) => choice.id),
	);

	// Index usage sites by referenced path.
	const usagesByPath = new Map<string, PreviewUsageSite[]>();
	for (const walk of choiceWalks) {
		for (const usage of walk.usages) {
			const list = usagesByPath.get(usage.path) ?? [];
			list.push(usage);
			usagesByPath.set(usage.path, list);
		}
	}
	const referencedAsScript = new Set<string>();
	for (const [path, usages] of usagesByPath) {
		if (usages.some((u) => u.asScript)) referencedAsScript.add(path);
	}

	const bundledPaths = new Set(pkg.assets.map((asset) => asset.originalPath));

	// Files manifest (one per bundled asset).
	const files: PreviewFile[] = pkg.assets.map((asset) => {
		const usages = usagesByPath.get(asset.originalPath) ?? [];
		const executable = referencedAsScript.has(asset.originalPath);
		const requiresReview =
			executable ||
			isExecutableBundledAsset(asset.kind, asset.originalPath) ||
			markdownAssetIsExecutable(asset.originalPath, asset.content);
		return {
			originalPath: asset.originalPath,
			kind: asset.kind,
			bundled: true,
			executable,
			requiresReview,
			exists: existsByPath.has(asset.originalPath),
			sizeBytes: estimateBytesFromBase64(asset.content),
			orphan: usages.length === 0,
			referencedBy: usages,
		};
	});

	// Choices.
	const choices: PreviewChoice[] = choiceWalks.map((walk) => {
		const exists = existingById.has(walk.choiceId);
		const flags = Array.from(walk.flags);
		if (exists) flags.push("overwrites-existing-choice");
		flags.sort(flagComparator);
		return {
			choiceId: walk.choiceId,
			name: walk.name,
			type: walk.type,
			location: walk.location,
			exists,
			registersCommand: walk.registersCommand,
			flags,
			commands: walk.commands,
		};
	});

	// Missing references: referenced but neither bundled nor present in vault.
	const missingReferences: MissingReference[] = [];
	for (const [path, usages] of usagesByPath) {
		if (bundledPaths.has(path)) continue;
		if (existsByPath.has(path)) continue; // will reuse an existing vault file
		const asScript = usages.some((u) => u.asScript);
		missingReferences.push({
			path,
			asScript,
			breadcrumb: usages[0]?.breadcrumb ?? path,
		});
	}

	const orphanAssets = files.filter((file) => file.orphan).map((f) => f.originalPath);

	// Capability rows: granular critical/per-item rows from the walk, plus
	// aggregated warning rows for counts.
	const capabilityRows: CapabilityRow[] = [];
	for (const walk of choiceWalks) {
		for (const row of walk.rows) capabilityRows.push(row);
	}

	// Mislabeled executable: a bundled file run as a script whose declared kind
	// is not a script kind.
	for (const file of files) {
		if (!file.executable) continue;
		if (isScriptKind(file.kind)) continue;
		capabilityRows.push({
			flag: "mislabeled-executable",
			severity: "critical",
			title: t("packageManager.row.mislabeledExecutable"),
			detail: file.originalPath,
			scriptPath: file.originalPath,
		});
	}

	// A bundled file written to disk can be executed by any macro that points at
	// its path (in this package OR already in the user's vault), so it must be
	// reviewed even when no choice in THIS package references it.
	// isExecutableBundledAsset covers declared script kinds AND every non-`.md`
	// path (the loader runs the raw bytes of any non-`.md` file), regardless of
	// what `kind` the package claims.
	for (const file of files) {
		if (!file.requiresReview) continue;
		if (file.executable) continue; // already a critical user-script/mislabeled row + in criticalScriptPaths
		capabilityRows.push({
			flag: "bundled-script",
			severity: "critical",
			title: t("packageManager.row.bundledScript"),
			detail: file.originalPath,
			scriptPath: file.originalPath,
		});
	}

	// AI-tools disclosure (#714): scan each reviewable bundled script for AI
	// tool-calling and surface a distinct critical row. Scans the SAME decoded code
	// the loader runs, so a note that hides a js fence is covered too.
	for (const file of files) {
		if (!file.requiresReview) continue;
		const asset = pkg.assets.find((a) => a.originalPath === file.originalPath);
		if (!asset) continue;
		const code = bundledScriptCode(asset.originalPath, asset.content);
		if (!code || !scriptUsesAiTools(code)) continue;
		capabilityRows.push({
			flag: "ai-tools",
			severity: "critical",
			title: t("packageManager.row.aiTools"),
			detail: file.originalPath,
			scriptPath: file.originalPath,
		});
	}

	const registersCommandCount = choices.filter((c) => c.registersCommand).length;
	if (registersCommandCount > 0) {
		capabilityRows.push({
			flag: "registers-command",
			severity: "warning",
			title: t("packageManager.row.registersCommand"),
			detail: t(
				registersCommandCount === 1
					? "packageManager.choiceCount.one"
					: "packageManager.choiceCount.other",
				{ count: registersCommandCount },
			),
		});
	}

	const overwriteChoiceCount = choices.filter((c) => c.exists).length;
	if (overwriteChoiceCount > 0) {
		capabilityRows.push({
			flag: "overwrites-existing-choice",
			severity: "warning",
			title: t("packageManager.row.overwritesChoices"),
			detail: t(
				overwriteChoiceCount === 1
					? "packageManager.choiceCount.one"
					: "packageManager.choiceCount.other",
				{ count: overwriteChoiceCount },
			),
		});
	}

	const overwriteFileCount = files.filter((f) => f.exists).length;
	if (overwriteFileCount > 0) {
		capabilityRows.push({
			flag: "overwrites-existing-file",
			severity: "warning",
			title: t("packageManager.row.overwritesFiles"),
			detail: t(
				overwriteFileCount === 1
					? "packageManager.fileCount.one"
					: "packageManager.fileCount.other",
				{ count: overwriteFileCount },
			),
		});
	}

	if (missingReferences.length > 0) {
		const scriptMissing = missingReferences.filter((m) => m.asScript).length;
		capabilityRows.push({
			// A missing SCRIPT runs from whatever file exists at that path: an
			// execution-hijack risk, so it ranks critical (and requires the gate).
			flag: "missing-reference",
			severity: scriptMissing > 0 ? "critical" : "warning",
			title:
				scriptMissing > 0
					? t("packageManager.row.missingRefsScript")
					: t("packageManager.row.missingRefsFile"),
			detail: t(
				missingReferences.length === 1
					? "packageManager.referenceCount.one"
					: "packageManager.referenceCount.other",
				{ count: missingReferences.length },
			),
		});
	}

	capabilityRows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

	const criticalScriptPaths = files
		.filter((file) => file.requiresReview)
		.map((file) => file.originalPath);

	const scriptCount = referencedAsScript.size;
	const runsOnStartup = choiceWalks.some((w) => w.flags.has("run-on-startup"));
	const criticalCount = capabilityRows.filter((r) => r.severity === "critical").length;
	const warningCount = capabilityRows.filter((r) => r.severity === "warning").length;

	const summary: PreviewSummary = {
		hasCritical: criticalCount > 0,
		hasWarning: warningCount > 0,
		criticalCount,
		warningCount,
		runsOnStartup,
		scriptCount,
		registersCommandCount,
		overwritesChoices: overwriteChoiceCount,
		overwritesFiles: overwriteFileCount,
		missingCount: missingReferences.length,
	};

	return {
		quickAddVersion: pkg.quickAddVersion,
		createdAt: pkg.createdAt,
		choiceCount: pkg.choices.length,
		fileCount: pkg.assets.length,
		choices,
		files,
		capabilityRows,
		missingReferences,
		orphanAssets,
		criticalScriptPaths,
		summary,
	};
}

// --- Lazy content preview + gate predicates ---------------------------------

/** Cap on previewed characters; larger scripts are flagged truncated. */
export const MAX_PREVIEW_CHARS = 100_000;

export interface AssetPreviewContent {
	found: boolean;
	text: string;
	truncated: boolean;
	sizeBytes: number;
	looksMinified: boolean;
	error?: string;
}

function byteLength(text: string): number {
	if (typeof TextEncoder !== "undefined") {
		return new TextEncoder().encode(text).length;
	}
	return text.length;
}

function looksMinified(text: string): boolean {
	if (text.length < 1000) return false;
	let longestLine = 0;
	let lineCount = 1;
	let current = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") {
			if (current > longestLine) longestLine = current;
			current = 0;
			lineCount++;
		} else {
			current++;
		}
	}
	if (current > longestLine) longestLine = current;
	const avgPerLine = text.length / lineCount;
	return longestLine > 1000 || avgPerLine > 250;
}

/**
 * Decode a bundled asset's content for display. Lazy by design — call this only
 * when the user expands a file, never during initial analysis.
 */
export function decodeAssetPreview(
	pkg: QuickAddPackage,
	originalPath: string,
): AssetPreviewContent {
	const asset = pkg.assets.find((a) => a.originalPath === originalPath);
	if (!asset) {
		return {
			found: false,
			text: "",
			truncated: false,
			sizeBytes: 0,
			looksMinified: false,
			error: t("packageManager.errorNotBundled"),
		};
	}

	try {
		const decoded = decodeFromBase64(asset.content);
		const truncated = decoded.length > MAX_PREVIEW_CHARS;
		const text = truncated ? decoded.slice(0, MAX_PREVIEW_CHARS) : decoded;
		return {
			found: true,
			text,
			truncated,
			sizeBytes: byteLength(decoded),
			// Scan only the previewed slice — enough to spot minification.
			looksMinified: looksMinified(text),
		};
	} catch (error) {
		return {
			found: true,
			text: "",
			truncated: false,
			sizeBytes: 0,
			looksMinified: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** A package needs explicit acknowledgement when it has any critical capability. */
export function requiresAcknowledgement(preview: PackagePreview): boolean {
	return preview.summary.hasCritical;
}

/**
 * True when every bundled critical script has been expanded/reviewed at least
 * once. Used to gate the acknowledgement checkbox.
 */
export function isFullyReviewed(
	preview: PackagePreview,
	reviewedScriptPaths: ReadonlySet<string>,
): boolean {
	return preview.criticalScriptPaths.every((path) =>
		reviewedScriptPaths.has(path),
	);
}
