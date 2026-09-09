import type { App } from "obsidian";
import { Modal } from "obsidian";
import { t } from "../../i18n";
import ImportPackageModalComponent from "./ImportPackageModal.svelte";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";

export class ImportPackageModal extends Modal {
	private handle: MountHandle | null = null;

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("quickAddModal", "packageImportModal");
		this.handle = mountComponent(
			this.contentEl,
			ImportPackageModalComponent,
			{
				app: this.app,
				close: () => this.close(),
			},
			{ what: t("svelteCards.whatPackageImporter") },
		);
	}

	onClose(): void {
		this.handle?.destroy();
		this.handle = null;
	}
}
