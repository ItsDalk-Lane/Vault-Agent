import { describe, expect, it } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { collectTemplateFolderRequirement } from "./templateFolderRequirement";
import { templateFolderPathKeyFor } from "./templateFolderPathKey";
import { t } from "../i18n";
import type ITemplateChoice from "../types/choices/ITemplateChoice";

function createFolder(path: string): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split("/").pop() ?? path;
	return folder;
}

function createActiveFile(parentPath: string): TFile {
	const file = new TFile();
	file.path = `${parentPath}/Active.md`;
	file.name = "Active.md";
	file.basename = "Active";
	file.extension = "md";
	file.parent = createFolder(parentPath) as never;
	return file;
}

function createApp(folders: string[], activeFile: TFile | null = null): App {
	return {
		workspace: {
			getActiveFile: () => activeFile,
		},
		vault: {
			getAllLoadedFiles: () => folders.map(createFolder),
		},
	} as unknown as App;
}

function createChoice(
	folder: Partial<ITemplateChoice["folder"]>,
): ITemplateChoice {
	return {
		name: "Folder Requirement Test",
		id: "folder-requirement-test",
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

describe("collectTemplateFolderRequirement", () => {
	it("returns null when the folder setting is disabled", () => {
		const choice = createChoice({ enabled: false, folders: ["A", "B"] });
		expect(
			collectTemplateFolderRequirement(createApp(["A", "B"]), undefined, choice),
		).toBeNull();
	});

	it("returns null for the same-folder-as-active-file mode (never prompts)", () => {
		const choice = createChoice({ createInSameFolderAsActiveFile: true, folders: [] });
		expect(
			collectTemplateFolderRequirement(createApp(["A", "B"]), undefined, choice),
		).toBeNull();
	});

	it("collects every vault folder for the ask-every-time mode", () => {
		const choice = createChoice({ chooseWhenCreatingNote: true });
		const requirement = collectTemplateFolderRequirement(
			createApp(["A/B2", "A", "A/B1"]),
			undefined,
			choice,
		);

		expect(requirement?.id).toBe(templateFolderPathKeyFor(choice.id));
		expect(requirement?.type).toBe("suggester");
		expect(requirement?.options).toEqual(["A", "A/B1", "A/B2"]);
		expect(requirement?.suggesterConfig?.allowCustomInput).toBe(true);
		expect(requirement?.label).toBe(t("onePageInput.selectFolder"));
	});

	it("offers the active file's folder first, like the run's chooser", () => {
		const choice = createChoice({ chooseWhenCreatingNote: true });
		const requirement = collectTemplateFolderRequirement(
			createApp(["A", "Current"], createActiveFile("Current")),
			undefined,
			choice,
		);

		expect(requirement?.options).toEqual(["Current", "A"]);
		expect(requirement?.displayOptions).toEqual(["<current folder>", "A"]);
	});

	it("confines subfolder-mode options to the configured roots", () => {
		const choice = createChoice({
			folders: ["A"],
			chooseFromSubfolders: true,
		});
		const requirement = collectTemplateFolderRequirement(
			createApp(["A", "A/B", "B", "B/C"]),
			undefined,
			choice,
		);

		expect(requirement?.options).toEqual(["A", "A/B"]);
	});

	it("returns null when a subfolder root would offer exactly one destination", () => {
		const choice = createChoice({
			folders: ["A"],
			chooseFromSubfolders: true,
		});
		expect(
			collectTemplateFolderRequirement(createApp(["A"]), undefined, choice),
		).toBeNull();
	});

	it("lists multiple configured folders in default mode", () => {
		const choice = createChoice({ folders: ["Notes/Inbox", "Archive"] });
		const requirement = collectTemplateFolderRequirement(
			createApp(["Notes/Inbox", "Archive"]),
			undefined,
			choice,
		);

		expect(requirement?.options).toEqual(["Notes/Inbox", "Archive"]);
	});

	it("returns null when default mode has a single configured folder", () => {
		const choice = createChoice({ folders: ["Notes/Inbox"] });
		expect(
			collectTemplateFolderRequirement(
				createApp(["Notes/Inbox"]),
				undefined,
				choice,
			),
		).toBeNull();
	});

	it("leaves format-syntax folder definitions to the run-time prompts", () => {
		const withToken = createChoice({ folders: ["Notes/{{VALUE:year}}"] });
		expect(
			collectTemplateFolderRequirement(createApp(["Notes"]), undefined, withToken),
		).toBeNull();

		const subfoldersWithToken = createChoice({
			folders: ["Notes/{{VALUE:year}}"],
			chooseFromSubfolders: true,
		});
		expect(
			collectTemplateFolderRequirement(
				createApp(["Notes"]),
				undefined,
				subfoldersWithToken,
			),
		).toBeNull();
	});
});
