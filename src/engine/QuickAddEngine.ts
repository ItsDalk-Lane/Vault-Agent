import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { log } from "../logger/logManager";
import { withTemplaterFileCreationSuppressed } from "../utilityObsidian";
import { escapesVaultBoundary } from "../utils/vaultPathBoundary";
import { t } from "../i18n";

export abstract class QuickAddEngine {
	public app: App;

	protected constructor(app: App) {
		this.app = app;
	}

	public abstract run(): void | Promise<unknown>;

	protected async createFolder(folder: string): Promise<void> {
		const folderExists = await this.app.vault.adapter.exists(folder);

		if (!folderExists) {
			await this.app.vault.createFolder(folder);
		}
	}

	protected stripLeadingSlash(path: string): string {
		return path.replace(/^\/+/, "");
	}

	protected normalizeMarkdownFilePath(
		folderPath: string,
		fileName: string
	): string {
		const safeFolderPath = this.stripLeadingSlash(folderPath);
		const actualFolderPath: string = safeFolderPath ? `${safeFolderPath}/` : "";
		const formattedFileName: string = this.stripLeadingSlash(fileName).replace(
			MARKDOWN_FILE_EXTENSION_REGEX,
			""
		);
		return `${actualFolderPath}${formattedFileName}.md`;
	}

	protected async fileExists(filePath: string): Promise<boolean> {
		return await this.app.vault.adapter.exists(filePath);
	}

	protected getFileByPath(filePath: string): TFile {
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (!file) {
			log.logError(t("errors.fileNotFound", { path: filePath }));
			throw new Error(t("errors.fileNotFound", { path: filePath }));
		}

		if (file instanceof TFolder) {
			log.logError(t("errors.pathIsFolder", { path: filePath }));
			throw new Error(t("errors.pathIsFolder", { path: filePath }));
		}

		if (!(file instanceof TFile))
			throw new Error(t("errors.pathIsNotFile", { path: filePath }));

		return file;
	}

	protected async createFileWithInput(
		filePath: string,
		fileContent: string,
		opts: { suppressTemplaterOnCreate?: boolean } = {},
	): Promise<TFile> {
		// Authoritative vault-containment boundary for every new-file write (Template
		// and Capture both funnel through here). `filePath` is assembled from formatted
		// names that can be seeded by untrusted input — an obsidian:// URI, the CLI, or
		// `{{VALUE}}` resolved from synced note content. A traversal/absolute/drive/UNC
		// path (e.g. "..\\..\\..\\evil.md" or "C:/evil.md") would make `vault.create`
		// AND the folder pre-creation below resolve OUTSIDE the vault root. Reject it
		// here, before any filesystem touch, so the sink can never escape even if an
		// upstream normalizer is bypassed. Mirrors the package-import write guard (#1434).
		if (escapesVaultBoundary(filePath)) {
			throw new Error(
				t("errors.createOutsideVault", { path: filePath }),
			);
		}

		const dirMatch = filePath.match(/(.*)[/\\]/);
		let dirName = "";
		if (dirMatch) dirName = dirMatch[1];

		const dir = this.app.vault.getAbstractFileByPath(dirName);

		if (!dir || !(dir instanceof TFolder)) {
			await this.createFolder(dirName);

			}

			const createFile = () => this.app.vault.create(filePath, fileContent);
			const shouldSuppress =
				opts.suppressTemplaterOnCreate &&
				filePath.toLowerCase().endsWith(".md");

			return shouldSuppress
				? await withTemplaterFileCreationSuppressed(this.app, filePath, createFile)
				: await createFile();
		}
}
