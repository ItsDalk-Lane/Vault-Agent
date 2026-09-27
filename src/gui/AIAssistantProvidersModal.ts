import { addProviderSecret } from "./ai/providerSettings";
import type { App } from "obsidian";
import { ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { AIProvider } from "src/ai/Provider";
import { ensureProviderIds } from "src/ai/Provider";
import { mergeModels } from "src/ai/modelsDirectory";
import { syncProviderModels } from "src/ai/modelSyncService";
import { settingsStore } from "src/settingsStore";
import { ModelDirectoryModal } from "./ModelDirectoryModal";
import { deepClone } from "src/utils/deepClone";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import { ProviderPickerModal } from "./ProviderPickerModal";
import GenericYesNoPrompt from "./GenericYesNoPrompt/GenericYesNoPrompt";
import { t } from "../i18n";

export class AIAssistantProvidersModal extends Modal {
	public waitForClose: Promise<AIProvider[]>;

	private resolvePromise: (settings: AIProvider[]) => void;
	private rejectPromise: (reason?: unknown) => void;

	private providers: AIProvider[];
	private selectedProvider: AIProvider | null;

	private _selectedProviderClone: AIProvider | null;

	constructor(providers: AIProvider[], app: App) {
		super(app);

		this.providers = providers;
		// Providers from hand-edited data.json may lack the stable id that
		// pinned model refs and the qualified script syntax rely on.
		ensureProviderIds(this.providers);

		this.waitForClose = new Promise<AIProvider[]>((resolve, reject) => {
			this.rejectPromise = reject;
			this.resolvePromise = resolve;
		});

		this.open();
		this.display();
		void this.autoSyncOnOpen();
	}

	/**
	 * Quiet refresh of every auto-sync provider when the settings open, so the
	 * lists a user is about to browse are current. Failures stay silent here —
	 * the explicit "Sync now" button is the loud path.
	 */
	private async autoSyncOnOpen(): Promise<void> {
		if (settingsStore.getState().disableOnlineFeatures) return;

		let changed = false;
		for (const provider of this.providers) {
			if (!provider.autoSyncModels) continue;
			try {
				const { added } = await syncProviderModels(this.app, provider);
				changed = changed || added > 0;
			} catch {
				// Quiet by design; "Sync now" surfaces errors.
			}
		}

		// Refresh whatever view is showing, but never clobber in-progress edits.
		if (changed && !this.selectedProvider) this.reload();
	}

	private display(): void {
		const modalName = this.selectedProvider
			? `${this.selectedProvider.name}`
			: t("ai.providersTitle.name");

		this.contentEl.createEl("h2", {
			text: modalName,
			cls: "qa-modal-title",
		});

		if (this.selectedProvider) {
			this.addProviderSetting(this.contentEl);

			return;
		}

		this.addProvidersSetting(this.contentEl);
	}

	private reload(): void {
		this.contentEl.empty();

		this.display();
	}

	addProvidersSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("ai.providersTitle.name"))
			.setDesc(t("ai.providersTitle.desc"))
            .addButton((button) => {
                button.setButtonText(t("ai.addProvider")).onClick(async () => {
                    await new ProviderPickerModal(this.app, this.providers).waitForClose;
                    this.reload();
                });

                button.setCta();
            });

		const providersContainer = container.createDiv({
			cls: "providers-container qa-ai-list-container",
		});

		this.providers.forEach((provider, i) => {
			new Setting(providersContainer)
				.setName(provider.name)
				.setDesc(provider.endpoint)
				.addButton((button) => this.addDeleteButton(button, provider.name, () => this.providers.splice(i, 1)))
					.addButton((button) => {
						button.setButtonText(t("ai.editProvider")).onClick(() => {
							this.selectedProvider = provider;
							this._selectedProviderClone = deepClone(provider);

							this.reload();
						});
					});
		});
	}

	private addDeleteButton(
		button: ButtonComponent,
		name: string,
		remove: () => void,
	): void {
		button.setDestructive();
		button.setIcon("trash");
		button.onClick(async () => {
			const confirmed = await GenericYesNoPrompt.Prompt(
				this.app, t("ai.deleteProviderConfirm", { name }),
			);
			if (!confirmed) return;
			remove();
			this.reload();
		});
	}

	addProviderSetting(container: HTMLElement) {
		this.addNameSetting(container);
		this.addEndpointSetting(container);
		this.addApiKeySetting(container);
		this.addKindSetting(container);
		this.addModelSourceSetting(container);

		this.addProviderModelsSetting(container);
		this.addImportModelsFromDirectorySetting(container);
		this.addAutoSyncSetting(container);

		this.addProviderSettingButtonRow(this.contentEl);
	}

	addNameSetting(container: HTMLElement) {
		const providerId = this.selectedProvider!.id;
		new Setting(container)
			.setName(t("ai.providerName"))
			.setDesc(
				providerId
					? t("ai.providerNameDescWithId", { id: providerId })
					: t("ai.providerNameDesc"),
			)
			.addText((text) => {
				text.setValue(this.selectedProvider!.name).onChange((value) => {
					this.selectedProvider!.name = value;
				});
			});
	}

	addEndpointSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("ai.endpoint.name"))
			.setDesc(t("ai.endpoint.desc"))
			.addText((text) => {
				text.setValue(this.selectedProvider!.endpoint).onChange(
					(value) => {
						this.selectedProvider!.endpoint = value;
					}
				);
			});
	}

	addApiKeySetting(container: HTMLElement) {
		const hasLegacyKey =
			!!this.selectedProvider?.apiKey && !this.selectedProvider?.apiKeyRef;
		addProviderSecret(container, this.app, {
			value: this.selectedProvider?.apiKeyRef ?? "",
			hasLegacyKey,
			onChange: (value) => {
				if (!this.selectedProvider) return;
				this.selectedProvider.apiKeyRef = value;
				this.selectedProvider.apiKey = "";
			},
		});
	}

	addKindSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("ai.providerType"))
			.setDesc(t("ai.requestFormatDesc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("", t("ai.autoDetect"));
				dropdown.addOption("openai", "OpenAI-compatible");
				dropdown.addOption("anthropic", "Anthropic");
				dropdown.addOption("gemini", "Gemini");
				dropdown.setValue(this.selectedProvider?.kind ?? "");
				dropdown.onChange((value) => {
					if (!this.selectedProvider) return;
					this.selectedProvider.kind = value
						? (value as AIProvider["kind"])
						: undefined;
				});
			});
	}

	addModelSourceSetting(container: HTMLElement) {
		const provider = this.selectedProvider;
		new Setting(container)
			.setName(t("ai.modelSource"))
			.setDesc(t("ai.modelSyncDesc"))
			.addDropdown((dropdown) => {
				dropdown.addOption(
					"providerApi",
					t("ai.modelSourceProviderApi"),
				);
				dropdown.addOption("modelsDev", t("ai.modelSourceModelsDev"));
				dropdown.addOption(
					"auto",
					t("ai.modelSourceAuto"),
				);
				const current = provider?.modelSource ?? "providerApi";
				dropdown.setValue(current);
				dropdown.onChange((value) => {
					if (!this.selectedProvider) return;
					this.selectedProvider.modelSource = value as AIProvider["modelSource"];
					this.reload();
				});
			});
	}

    addProviderModelsSetting(container: HTMLElement) {
        const modelsContainer = container.createDiv({
			cls: "models-container qa-ai-list-container",
		});

        this.selectedProvider!.models.forEach((model, i) => {
            const metadata = [`Context: ${model.maxTokens.toLocaleString()} tokens`];
            if (model.maxOutputTokens) {
                metadata.push(`Output: ${model.maxOutputTokens.toLocaleString()} tokens`);
            }
            if (model.supportsTemperature === false) {
                metadata.push("Fixed sampling (no temperature)");
            }
            new Setting(modelsContainer)
                .setName(model.name)
                .setDesc(metadata.join(" · "))
                .addButton((button) => this.addDeleteButton(button, model.name, () => this.selectedProvider!.models.splice(i, 1)));
        });

        new Setting(modelsContainer)
            .setName(t("ai.addModel.name"))
            .addButton((button) => {
                button.setButtonText(t("ai.addModel.button")).onClick(async () => {
                    let modelName: string;
                    let maxTokens: string;
                    try {
                        modelName = await GenericInputPrompt.Prompt(
                            this.app,
                            t("svelteCards.modelNamePrompt")
                        );
                        maxTokens = await GenericInputPrompt.Prompt(
                            this.app,
                            t("svelteCards.maxTokensPrompt")
                        );
                    } catch {
                        // Cancelling either prompt is a clean no-op.
                        return;
                    }

                    const trimmedName = modelName.trim();
                    if (!trimmedName) {
                        new Notice(t("ai.modelNameEmpty"));
                        return;
                    }

                    // Reject non-numeric input outright: parseInt would silently
                    // accept "10abc" as 10. Require a plain positive integer.
                    const normalizedMaxTokens = maxTokens.trim();
                    if (!/^[1-9]\d*$/.test(normalizedMaxTokens)) {
                        new Notice(t("ai.maxTokensPositive"));
                        return;
                    }
                    const parsedMaxTokens = Number(normalizedMaxTokens);

                    this.selectedProvider!.models.push({
                        name: trimmedName,
                        maxTokens: parsedMaxTokens,
                    });

                    this.reload();
                });
                button.setCta();
            });
    }

	addImportModelsFromDirectorySetting(container: HTMLElement) {
		const sourceDescription = this.describeModelSource(this.selectedProvider);
		new Setting(container)
			.setName(t("ai.importModels.name"))
			.setDesc(t("ai.browseModelsDesc", { source: sourceDescription }))
			.addButton((button) => {
				button.setButtonText(t("ai.importModels.browseButton")).onClick(async () => {
					const res = await new ModelDirectoryModal(this.app, this.selectedProvider!).waitForClose;
                    if (!res) return;
                    const { imported, mode } = res;
                    if (mode === "replace") {
                        this.selectedProvider!.models = imported;
                    } else {
                        // Merge (not append-only dedupe): re-importing a model the
                        // provider already has refreshes its context/output metadata.
                        this.selectedProvider!.models = mergeModels(
                            this.selectedProvider!.models,
                            imported
                        );
                    }
                    new Notice(t(imported.length === 1 ? "ai.modelsImportedOne" : "ai.modelsImportedOther", { count: imported.length }) + (mode === "replace" ? t("ai.importModeReplaced") : t("ai.importModeAdded")));
                    this.reload();
                });
                button.setCta();
            });
    }

	addAutoSyncSetting(container: HTMLElement) {
		const sourceDescription = this.describeModelSource(this.selectedProvider);
		new Setting(container)
			.setName(t("ai.autoSyncModels.name"))
			.setDesc(t("ai.autoSyncDesc", { source: sourceDescription }))
			.addToggle((toggle) => {
				const current = !!this.selectedProvider?.autoSyncModels;
				toggle.setValue(current).onChange((value) => {
					if (this.selectedProvider) this.selectedProvider.autoSyncModels = value;
				});
			})
			.addButton((button) => {
				button.setButtonText(t("ai.autoSyncModels.syncNowButton")).onClick(async () => {
					try {
						const { added, updated } = await syncProviderModels(
							this.app,
							this.selectedProvider!,
						);
						new Notice(
							added > 0 || updated > 0
								? t("ai.syncedFrom", { source: sourceDescription, added, updated })
								: t("ai.syncedUpToDate", { source: sourceDescription }),
						);
						this.reload();
					} catch (err) {
						new Notice(
							t("ai.modelSyncFailed", { error: (err as { message?: string }).message ?? String(err) })
						);
					}
				});
				button.setCta();
			});
	}

	// Discard in-progress edits to the selected provider by restoring the
	// snapshot taken on Edit. We swap the array entry wholesale rather than
	// Object.assign-ing the clone over the live object: Object.assign cannot
	// remove keys the edit ADDED but the snapshot lacks (e.g. an apiKeyRef set on
	// a default provider that had none), so those edits would survive Cancel.
	private restoreSelectedProviderFromClone(): void {
		if (!this.selectedProvider || !this._selectedProviderClone) return;

		const index = this.providers.indexOf(this.selectedProvider);
		if (index !== -1) {
			this.providers[index] = this._selectedProviderClone;
		}

		this.selectedProvider = null;
		this._selectedProviderClone = null;
	}

	addProviderSettingButtonRow(container: HTMLElement) {
		const buttonRow = container.createDiv({
			cls: "button-row qa-ai-provider-button-row",
		});

		const CancelButton = new ButtonComponent(buttonRow);
		CancelButton.setButtonText(t("common.cancel"));
		CancelButton.setDestructive();
		CancelButton.onClick(() => {
			// Cancel always returns to the provider list, discarding edits. We
			// never close() here so the modal doesn't flash-close-and-reopen via
			// onClose's path.
			this.restoreSelectedProviderFromClone();

			this.reload();
		});

		const SaveButton = new ButtonComponent(buttonRow);
		SaveButton.setButtonText(t("common.save"));
		SaveButton.setCta();
		SaveButton.onClick(() => {
			this.selectedProvider = null;
			this.reload();
		});
	}

	describeModelSource(provider: AIProvider | null): string {
		const mode = provider?.modelSource ?? "providerApi";
		switch (mode) {
			case "modelsDev":
				return t("ai.sourceModelsDev");
			case "auto":
				return t("ai.sourceAuto");
			default:
				return t("ai.sourceProviderApi");
		}
	}

	onClose(): void {
		// If the user dismissed while editing a provider (Escape / X), discard
		// the in-progress edits by restoring the snapshot, then resolve and close.
		// We do NOT reopen the modal here — reopening on close made Escape re-show
		// the dialog and required a second Escape to actually leave.
		this.restoreSelectedProviderFromClone();

		this.resolvePromise(this.providers);
		super.onClose();
	}
}
