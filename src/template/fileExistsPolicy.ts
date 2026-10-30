import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "src/constants";
import { t } from "../i18n";

// Labels/descriptions/verbs use getters so they resolve through t() at ACCESS
// time. Module-level string literals would freeze the English fallback: this
// module is imported before main.ts calls setLocale().
export const fileExistsBehaviorCategoryOptions = [
	{
		id: "prompt",
		get label() {
			return t("fileExists.category.prompt");
		},
	},
	{
		id: "update",
		get label() {
			return t("fileExists.category.update");
		},
	},
	{
		id: "create",
		get label() {
			return t("fileExists.category.create");
		},
	},
	{
		id: "keep",
		get label() {
			return t("fileExists.category.keep");
		},
	},
] as const;

export type FileExistsBehaviorCategoryId =
	(typeof fileExistsBehaviorCategoryOptions)[number]["id"];
type FileExistsModeCategoryId = Exclude<
	FileExistsBehaviorCategoryId,
	"prompt"
>;

export const fileExistsModes = [
	{
		id: "appendBottom",
		category: "update",
		get label() {
			return t("fileExists.mode.appendBottom.label");
		},
		get description() {
			return t("fileExists.mode.appendBottom.description");
		},
		requiresExistingFile: true,
		resolutionKind: "modifyExisting",
	},
	{
		id: "appendTop",
		category: "update",
		get label() {
			return t("fileExists.mode.appendTop.label");
		},
		get description() {
			return t("fileExists.mode.appendTop.description");
		},
		requiresExistingFile: true,
		resolutionKind: "modifyExisting",
	},
	{
		id: "overwrite",
		category: "update",
		get label() {
			return t("fileExists.mode.overwrite.label");
		},
		get description() {
			return t("fileExists.mode.overwrite.description");
		},
		requiresExistingFile: true,
		resolutionKind: "modifyExisting",
	},
	{
		id: "increment",
		category: "create",
		get label() {
			return t("fileExists.mode.increment.label");
		},
		get description() {
			return t("fileExists.mode.increment.description");
		},
		requiresExistingFile: false,
		resolutionKind: "createNew",
	},
	{
		id: "duplicateSuffix",
		category: "create",
		get label() {
			return t("fileExists.mode.duplicateSuffix.label");
		},
		get description() {
			return t("fileExists.mode.duplicateSuffix.description");
		},
		requiresExistingFile: false,
		resolutionKind: "createNew",
	},
	{
		// Saved choices store this id from when it was the only keep mode, so it
		// keeps its id and its behavior: it opens the note even with Open off.
		id: "doNothing",
		category: "keep",
		get label() {
			return t("fileExists.mode.doNothing.label");
		},
		get description() {
			return t("fileExists.mode.doNothing.description");
		},
		requiresExistingFile: true,
		resolutionKind: "reuseExisting",
		opensExistingFile: true,
	},
	{
		id: "leaveUnchanged",
		category: "keep",
		get label() {
			return t("fileExists.mode.leaveUnchanged.label");
		},
		get description() {
			return t("fileExists.mode.leaveUnchanged.description");
		},
		requiresExistingFile: true,
		resolutionKind: "reuseExisting",
		opensExistingFile: false,
	},
] as const;

export type FileExistsModeId = (typeof fileExistsModes)[number]["id"];
export type FileExistsModeDefinition = (typeof fileExistsModes)[number];
export type TemplateFileExistsBehavior =
	| { kind: "prompt" }
	| { kind: "apply"; mode: FileExistsModeId };

export type TemplateExistingNoteAction = "open" | Extract<
	FileExistsModeDefinition,
	{ resolutionKind: "modifyExisting" }
>["id"];

export const existingNoteActions = [
	{
		id: "open",
		get label() {
			return t("fileExists.existingNoteAction.open.label");
		},
		get verb() {
			return t("fileExists.existingNoteAction.open.verb");
		},
	},
	{
		id: "appendBottom",
		get label() {
			return t("fileExists.existingNoteAction.appendBottom.label");
		},
		get verb() {
			return t("fileExists.existingNoteAction.appendBottom.verb");
		},
	},
	{
		id: "appendTop",
		get label() {
			return t("fileExists.existingNoteAction.appendTop.label");
		},
		get verb() {
			return t("fileExists.existingNoteAction.appendTop.verb");
		},
	},
	{
		id: "overwrite",
		get label() {
			return t("fileExists.existingNoteAction.overwrite.label");
		},
		get verb() {
			return t("fileExists.existingNoteAction.overwrite.verb");
		},
	},
] satisfies Array<{ id: TemplateExistingNoteAction; label: string; verb: string }>;

function existingNoteActionDefinition(value: unknown) {
	const action = existingNoteActions.find((action) => action.id === (value === undefined ? "open" : value));
	if (!action) throw new Error(`Unknown existing-note action: ${String(value)}`);
	return action;
}

export function getExistingNoteAction(value: unknown): TemplateExistingNoteAction {
	return existingNoteActionDefinition(value).id;
}

export function existingNoteActionVerb(value: TemplateExistingNoteAction | undefined): string {
	return existingNoteActionDefinition(value).verb;
}

type ExistsFn = (path: string) => Promise<boolean>;
type CreateNewModeId = Extract<
	FileExistsModeDefinition,
	{ resolutionKind: "createNew" }
>["id"];

const fileExistsModeById = new Map<FileExistsModeId, FileExistsModeDefinition>(
	fileExistsModes.map((mode) => [mode.id, mode]),
);

const defaultModeByCategory: Record<FileExistsModeCategoryId, FileExistsModeId> = {
	update: "appendBottom",
	create: "duplicateSuffix",
	keep: "doNothing",
};

// Keys are LEGACY PERSISTED STRINGS from saved choice data — never localize
// them; they must match what old vaults stored, in English, forever.
const legacyFileExistsModeMap: Record<string, FileExistsModeId> = {
	"Append to the bottom of the file": "appendBottom",
	"Append to the top of the file": "appendTop",
	"Overwrite the file": "overwrite",
	"Increment the file name": "increment",
	"Append duplicate suffix": "duplicateSuffix",
	Nothing: "doNothing",
	appendBottom: "appendBottom",
	appendTop: "appendTop",
	overwrite: "overwrite",
	increment: "increment",
	duplicateSuffix: "duplicateSuffix",
	doNothing: "doNothing",
	leaveUnchanged: "leaveUnchanged",
};

const createNewPathResolvers: Record<
	CreateNewModeId,
	(filePath: string, exists: ExistsFn) => Promise<string>
> = {
	increment: resolveIncrementedCollisionPath,
	duplicateSuffix: resolveDuplicateSuffixCollisionPath,
};

export function getFileExistsMode(id: FileExistsModeId): FileExistsModeDefinition {
	const mode = fileExistsModeById.get(id);
	if (!mode) {
		throw new Error(`Unknown file exists mode: ${id}`);
	}
	return mode;
}

export function getModesForCategory(
	category: FileExistsModeCategoryId,
): FileExistsModeDefinition[] {
	return fileExistsModes.filter((mode) => mode.category === category);
}

function getCategoryForMode(
	modeId: FileExistsModeId,
): FileExistsModeCategoryId {
	return getFileExistsMode(modeId).category;
}

// The prompt's Do nothing item used to open the note, so its slot now reads Open
// existing file with the same behavior. Leaving the note alone from the prompt is
// what Escape already does.
export function getPromptModes(): FileExistsModeDefinition[] {
	return fileExistsModes.filter((mode) => mode.id !== "leaveUnchanged");
}

export function getDefaultBehaviorForCategory(
	category: FileExistsBehaviorCategoryId,
	currentBehavior?: TemplateFileExistsBehavior,
): TemplateFileExistsBehavior {
	if (category === "prompt") {
		return { kind: "prompt" };
	}

	if (
		currentBehavior?.kind === "apply" &&
		getCategoryForMode(currentBehavior.mode) === category
	) {
		return currentBehavior;
	}

	return { kind: "apply", mode: defaultModeByCategory[category] };
}

export function mapLegacyFileExistsModeToId(
	mode: unknown,
): FileExistsModeId | null {
	if (typeof mode !== "string") {
		return null;
	}

	// `legacyFileExistsModeMap` is a plain object, so a bare `[mode]` lookup
	// would resolve inherited members for magic keys (`__proto__` ->
	// Object.prototype, `constructor` -> the Object function, `toString`/
	// `valueOf` -> functions). All are truthy, silently defeating the `?? null`
	// fallback and returning a non-`FileExistsModeId`. Restrict to own keys so
	// any unknown input - including a hand-edited or imported `fileExistsMode` -
	// falls back cleanly.
	if (!Object.prototype.hasOwnProperty.call(legacyFileExistsModeMap, mode)) {
		return null;
	}

	return legacyFileExistsModeMap[mode] ?? null;
}

export async function resolveCreateNewCollisionFilePath(
	filePath: string,
	modeId: CreateNewModeId,
	exists: ExistsFn,
): Promise<string> {
	return await createNewPathResolvers[modeId](filePath, exists);
}

export async function resolveIncrementedCollisionPath(
	filePath: string,
	exists: ExistsFn,
): Promise<string> {
	// Iterate (never recurse) and bump the trailing number with BigInt so the
	// candidate always advances by exactly one - even past 2^53, where the old
	// `parseInt(n, 10) + 1` became a no-op (the computed "next" path equalled the
	// current one, `exists` stayed true, and the recursion spun forever). The
	// numeric part strictly increases, so no name repeats and a finite vault
	// guarantees `exists` eventually returns false. BigInt swaps in for parseInt
	// with no other change, so this is byte-for-byte identical below 2^53.
	let candidate = filePath;
	while (await exists(candidate)) {
		const { basename, extension } = splitCollisionFileName(candidate);
		const match = basename.match(/^(.*?)(\d+)$/);
		const nextBasename = match
			? `${match[1]}${String(BigInt(match[2]) + 1n).padStart(match[2].length, "0")}`
			: `${basename}1`;
		candidate = `${nextBasename}${extension}`;
	}
	return candidate;
}

export async function resolveDuplicateSuffixCollisionPath(
	filePath: string,
	exists: ExistsFn,
): Promise<string> {
	let candidate = filePath;
	while (await exists(candidate)) {
		const { basename, extension } = splitCollisionFileName(candidate);
		const match = basename.match(/^(.*) \((\d+)\)$/);
		const nextBasename = match
			? `${match[1]} (${String(BigInt(match[2]) + 1n)})`
			: `${basename} (1)`;
		candidate = `${nextBasename}${extension}`;
	}
	return candidate;
}

function splitCollisionFileName(filePath: string) {
	if (CANVAS_FILE_EXTENSION_REGEX.test(filePath)) {
		return {
			basename: filePath.replace(CANVAS_FILE_EXTENSION_REGEX, ""),
			extension: ".canvas",
		};
	}

	if (BASE_FILE_EXTENSION_REGEX.test(filePath)) {
		return {
			basename: filePath.replace(BASE_FILE_EXTENSION_REGEX, ""),
			extension: ".base",
		};
	}

	return {
		basename: filePath.replace(MARKDOWN_FILE_EXTENSION_REGEX, ""),
		extension: ".md",
	};
}
