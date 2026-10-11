// @vitest-environment jsdom
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { inputSuggestMock, setTargetFolderPath, existingFolders } = vi.hoisted(() => ({
	inputSuggestMock: vi.fn(),
	setTargetFolderPath: vi.fn(),
	existingFolders: { paths: new Set<string>() },
}));

vi.mock("../gui/InputSuggester/inputSuggester", () => ({
	default: {
		Suggest: inputSuggestMock,
	},
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: {
		Suggest: vi.fn(),
	},
}));

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class {
		setLinkToCurrentFileBehavior() {}
		setPromptRunContext() {}
		setTargetFolderPath(path: string | null) {
			setTargetFolderPath(path);
		}
		async formatTemplateFilePath(input: string): Promise<string> {
			return input;
		}
		formatFolderPath(folderPath: string): Promise<string> {
			return Promise.resolve(folderPath);
		}
		async formatFileName(): Promise<string> {
			throw new Error("Stop test after folder selection");
		}
	},
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

import { TFolder, type App } from "obsidian";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";
import { QA_INTERNAL_TEMPLATE_FOLDER_PATH } from "../constants";
import { templateFolderPathKeyFor } from "../preflight/templateFolderPathKey";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ITemplateChoice from "../types/choices/ITemplateChoice";

function createFolder(path: string): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split("/").pop() ?? path;
	return folder;
}

function createChoice(
	folder: Partial<ITemplateChoice["folder"]>,
): ITemplateChoice {
	return {
		name: "Preselected Folder Test",
		id: "preselected-folder-test",
		type: "Template",
		command: false,
		templatePath: "Templates/Test.md",
		folder: {
			enabled: true,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
			...folder,
		},
		fileNameFormat: { enabled: false, format: "{{VALUE}}" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "source",
			focus: false,
		},
		fileExistsBehavior: { kind: "prompt" },
	};
}

function createEngine(
	choice: ITemplateChoice,
	vaultFolders: string[],
	variables: Map<string, unknown>,
) {
	existingFolders.paths = new Set(vaultFolders);
	const app = {
		plugins: {
			plugins: {},
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
		},
		vault: {
			getAllLoadedFiles: vi.fn(() => vaultFolders.map(createFolder)),
			getAbstractFileByPath: vi.fn((path: string) =>
				vaultFolders.includes(path) ? createFolder(path) : null,
			),
			adapter: {
				exists: vi.fn(async (path: string) => existingFolders.paths.has(path)),
			},
			createFolder: vi.fn(async (path: string) => {
				existingFolders.paths.add(path);
			}),
		},
	} as unknown as App;

	const plugin = {
		settings: {
			globalVariables: {},
		},
	} as any;
	const choiceExecutor: IChoiceExecutor = {
		...createChoiceExecutor(),
		execute: vi.fn(),
		variables,
	};

	return new TemplateChoiceEngine(app, plugin, choice, choiceExecutor);
}

describe("TemplateChoiceEngine preselected folder", () => {
	beforeEach(() => {
		inputSuggestMock.mockReset();
		setTargetFolderPath.mockReset();
		inputSuggestMock.mockImplementation(
			async (
				_app: App,
				_displayItems: string[],
				items: string[],
			): Promise<string> => items[0],
		);
	});

	it("skips the chooser when the one-page form supplied the folder", async () => {
		const choice = createChoice({ chooseWhenCreatingNote: true });
		const variables = new Map<string, unknown>([
			[templateFolderPathKeyFor(choice.id), "A/B1"],
		]);
		const engine = createEngine(choice, ["A", "A/B1"], variables);

		await engine.run();

		expect(inputSuggestMock).not.toHaveBeenCalled();
		expect(setTargetFolderPath).toHaveBeenCalledWith("A/B1");
		expect(engine["app"].vault.createFolder).not.toHaveBeenCalled();
	});

	it("creates the preselected folder when it does not exist yet, like a typed answer", async () => {
		const choice = createChoice({ chooseWhenCreatingNote: true });
		const variables = new Map<string, unknown>([
			[templateFolderPathKeyFor(choice.id), "Out/New"],
		]);
		const engine = createEngine(choice, ["A", "B"], variables);

		await engine.run();

		expect(inputSuggestMock).not.toHaveBeenCalled();
		expect(engine["app"].vault.createFolder).toHaveBeenCalledWith("Out/New");
		expect(setTargetFolderPath).toHaveBeenCalledWith("Out/New");
	});

	it("honours the unscoped CLI alias when no scoped key answers this choice", async () => {
		const choice = createChoice({ chooseWhenCreatingNote: true });
		const variables = new Map<string, unknown>([
			[QA_INTERNAL_TEMPLATE_FOLDER_PATH, "A"],
		]);
		const engine = createEngine(choice, ["A"], variables);

		await engine.run();

		expect(inputSuggestMock).not.toHaveBeenCalled();
		expect(setTargetFolderPath).toHaveBeenCalledWith("A");
	});

	it("ignores the preselect when the run takes its single configured folder silently", async () => {
		const choice = createChoice({ folders: ["Only"] });
		const variables = new Map<string, unknown>([
			[templateFolderPathKeyFor(choice.id), "Elsewhere"],
		]);
		const engine = createEngine(choice, ["Only"], variables);

		await engine.run();

		expect(inputSuggestMock).not.toHaveBeenCalled();
		expect(setTargetFolderPath).toHaveBeenCalledWith("Only");
		expect(engine["app"].vault.createFolder).not.toHaveBeenCalledWith("Elsewhere");
	});

	it("falls back to the chooser when the preselect is outside the allowed roots", async () => {
		const choice = createChoice({ folders: [" Work"], chooseFromSubfolders: true });
		const variables = new Map<string, unknown>([
			[templateFolderPathKeyFor(choice.id), "Work/new"],
		]);
		const engine = createEngine(choice, [" Work", " Work/sub"], variables);

		await engine.run();

		expect(inputSuggestMock).toHaveBeenCalledTimes(1);
		expect(setTargetFolderPath).not.toHaveBeenCalledWith("Work/new");
	});

	it("falls back to the chooser when the preselect is not a usable folder name", async () => {
		const choice = createChoice({ chooseWhenCreatingNote: true });
		const variables = new Map<string, unknown>([
			[templateFolderPathKeyFor(choice.id), "a<b"],
		]);
		const engine = createEngine(choice, ["A", "B"], variables);

		await engine.run();

		expect(inputSuggestMock).toHaveBeenCalledTimes(1);
		expect(setTargetFolderPath).not.toHaveBeenCalledWith("a<b");
	});

	it("ignores an ambiguous unscoped alias when several scoped answers exist", async () => {
		const choice = createChoice({ chooseWhenCreatingNote: true });
		const variables = new Map<string, unknown>([
			[templateFolderPathKeyFor("other-choice"), "X"],
			[templateFolderPathKeyFor("another-choice"), "Y"],
			[QA_INTERNAL_TEMPLATE_FOLDER_PATH, "A"],
		]);
		const engine = createEngine(choice, ["A", "B"], variables);

		await engine.run();

		expect(inputSuggestMock).toHaveBeenCalledTimes(1);
	});

	it("falls back to the chooser when the form answer is blank", async () => {
		const choice = createChoice({ chooseWhenCreatingNote: true });
		const variables = new Map<string, unknown>([
			[templateFolderPathKeyFor(choice.id), ""],
		]);
		const engine = createEngine(choice, ["A", "B"], variables);

		await engine.run();

		expect(inputSuggestMock).toHaveBeenCalledTimes(1);
	});
});
