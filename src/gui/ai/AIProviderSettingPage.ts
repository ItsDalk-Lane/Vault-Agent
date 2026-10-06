import type { App, ButtonComponent } from "obsidian";
import { Notice, Setting, SettingGroup, SettingPage } from "obsidian";
import type { AIProvider, Model } from "src/ai/Provider";
import { sortModelsForDisplay } from "src/ai/Provider";
import { mergeModels } from "src/ai/modelsDirectory";
import { diffModelLists, syncStoredProvider } from "src/ai/modelSyncService";
import {
	describeConnectionResult,
	testProviderConnection,
} from "src/ai/providerConnection";
import { settingsStore } from "src/settingsStore";
import { retitleSettingPage } from "src/utils/openPluginSettings";
import { t } from "../../i18n";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { confirmAction } from "../confirmAction";
import { ModelDirectoryModal } from "../ModelDirectoryModal";
import {
	findProvider,
	removeProvider,
	updateProvider,
	withoutSyncStatus,
} from "./aiSettingsState";
import { configureProviderSecret } from "./providerSettings";
import { countModels, describeSyncStatus } from "./syncStatus";

function describeModelSource(provider: Pick<AIProvider, "modelSource">): string {
	switch (provider.modelSource ?? "providerApi") {
		case "modelsDev":
			return t("ai.sourceModelsDev");
		case "auto":
			return t("ai.sourceAuto");
		default:
			return t("ai.sourceProviderApi");
	}
}

/** Set a result line under a setting's description, colored by outcome. */
function setStatusLine(
	el: HTMLElement,
	text: string,
	tone?: "success" | "error",
): void {
	el.setText(text);
	el.classList.toggle("mod-success", tone === "success");
	el.classList.toggle("mod-error", tone === "error");
}

/** "Context: 128,000 tokens · Output: … · Released 2024-05-13". */
function describeModel(model: Model): string {
	const parts = [
		t("aiProviderPage.contextTokens", {
			count: model.maxTokens.toLocaleString(),
		}),
	];
	if (model.maxOutputTokens) {
		parts.push(
			t("aiProviderPage.outputTokens", {
				count: model.maxOutputTokens.toLocaleString(),
			}),
		);
	}
	if (model.supportsTemperature === false) {
		parts.push(t("aiProviderPage.fixedSampling"));
	}
	if (model.releaseDate)
		parts.push(t("aiProviderPage.released", { date: model.releaseDate }));
	return parts.join(" · ");
}

/**
 * One provider's settings, as a sub-page of Settings → QuickAdd → AI
 * Assistant. Like every settings page it saves as you edit: each change is
 * written to the store under the provider's id, and the page listens to the
 * store so background syncs show up in the model list and the status line.
 */
export class AIProviderSettingPage extends SettingPage {
	private unsubscribe: (() => void) | null = null;
	private modelFilter = "";
	private modelListEl: HTMLElement | null = null;
	private syncStatusEl: HTMLElement | null = null;
	private connectionResultEl: HTMLElement | null = null;

	constructor(
		private readonly app: App,
		private readonly providerId: string,
	) {
		super();
	}

	private get provider(): AIProvider | undefined {
		return findProvider(this.providerId);
	}

	display(): void {
		this.teardown();
		this.containerEl.empty();

		const provider = this.provider;
		if (!provider) {
			this.containerEl.createDiv({
				cls: "setting-item-description",
				text: t("aiProviderPage.providerMissing"),
			});
			return;
		}

		this.renderConnectionGroup(provider);
		this.renderModelSyncGroup(provider);
		this.renderModelsGroup();
		this.renderDeleteGroup();

		let shown = provider;
		this.unsubscribe = settingsStore.subscribe(() => {
			const current = this.provider;
			if (!current || current === shown) return;
			const previous = shown;
			shown = current;
			if (current.models !== previous.models) this.renderModelList();
			if (
				current.lastModelSync !== previous.lastModelSync ||
				current.models.length !== previous.models.length
			) {
				this.renderSyncStatus();
			}
		});

		void this.syncOnOpen(provider);
	}

	hide(): void {
		this.teardown();
		super.hide();
	}

	private teardown(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.modelListEl = null;
		this.syncStatusEl = null;
		this.connectionResultEl = null;
	}

	/**
	 * Quiet refresh when the page opens, so the list the user is about to
	 * browse is current. A failure shows only in the status line; "Sync now"
	 * is the loud path.
	 */
	private async syncOnOpen(provider: AIProvider): Promise<void> {
		if (!provider.autoSyncModels) return;
		if (settingsStore.getState().disableOnlineFeatures) return;
		try {
			await syncStoredProvider(this.app, this.providerId);
		} catch {
			// Recorded in lastModelSync; the status line shows it.
		}
	}

	private edit(update: (provider: AIProvider) => AIProvider): void {
		updateProvider(this.providerId, update);
	}

	/** An edit that changes what a connection test or sync would talk to. */
	private editConnection(update: (provider: AIProvider) => AIProvider): void {
		this.edit((provider) => withoutSyncStatus(update(provider)));
		if (this.connectionResultEl) setStatusLine(this.connectionResultEl, "");
	}

	/** Leave this page for the one that opened it (the AI Assistant page). */
	private close(): void {
		const setting = (
			this.app as unknown as { setting?: { closePage?: () => void } }
		).setting;
		if (typeof setting?.closePage === "function") setting.closePage();
		else this.display();
	}

	private renderConnectionGroup(provider: AIProvider): void {
		const group = new SettingGroup(this.containerEl);

		group.addSetting((setting) => {
			setting
				.setName(t("ai.providerName"))
				.setDesc(
					provider.id
						? t("aiProviderPage.nameDescWithId", { id: provider.id })
						: t("aiProviderPage.nameDesc"),
				)
				.addText((text) => {
					text.setValue(provider.name).onChange((value) => {
						this.edit((p) => ({ ...p, name: value }));
						retitleSettingPage(
							this.app,
							this,
							value.trim() || t("aiProviderPage.untitledProvider"),
						);
					});
				});
		});

		group.addSetting((setting) => {
			setting
				.setName(t("ai.endpoint.name"))
				.setDesc(t("aiProviderPage.endpointDesc"))
				.addText((text) => {
					text.setPlaceholder(t("aiProviderPage.endpointPlaceholder"));
					text.setValue(provider.endpoint).onChange((value) => {
						this.editConnection((p) => ({ ...p, endpoint: value }));
					});
				});
		});

		group.addSetting((setting) => {
			setting
				.setName(t("ai.providerType"))
				.setDesc(t("ai.requestFormatDesc"))
				.addDropdown((dropdown) => {
					dropdown.addOption("", t("ai.autoDetect"));
					dropdown.addOption("openai", t("aiProviderPage.kindOpenAiCompatible"));
					dropdown.addOption("anthropic", "Anthropic");
					dropdown.addOption("gemini", "Gemini");
					dropdown.setValue(provider.kind ?? "");
					dropdown.onChange((value) => {
						this.editConnection((p) => ({
							...p,
							kind: value ? (value as AIProvider["kind"]) : undefined,
						}));
					});
				});
		});

		group.addSetting((setting) => {
			configureProviderSecret(setting, this.app, {
				value: provider.apiKeyRef ?? "",
				hasLegacyKey: !!provider.apiKey && !provider.apiKeyRef,
				onChange: (value) => {
					this.editConnection((p) => ({ ...p, apiKeyRef: value, apiKey: "" }));
				},
			});
		});

		group.addSetting((setting) => {
			setting
				.setName(t("aiProviderPage.connection"))
				.setDesc(t("aiProviderPage.connectionDesc"));
			const resultEl = setting.descEl.createDiv({ cls: "qa-ai-status-line" });
			this.connectionResultEl = resultEl;
			setting.addButton((button) => {
				button.setButtonText(t("aiProviderPage.testConnection")).onClick(async () => {
					const current = this.provider;
					if (!current) return;
					button.setDisabled(true);
					setStatusLine(resultEl, t("aiProviderPage.testing"));
					try {
						const result = await testProviderConnection(this.app, current);
						setStatusLine(
							resultEl,
							describeConnectionResult(result),
							result.ok ? "success" : "error",
						);
					} finally {
						button.setDisabled(false);
					}
				});
			});
		});
	}

	private renderModelSyncGroup(provider: AIProvider): void {
		const source = describeModelSource(provider);
		const group = new SettingGroup(this.containerEl).setHeading(
			t("aiProviderPage.modelSyncHeading"),
		);

		group.addSetting((setting) => {
			setting
				.setName(t("ai.modelSource"))
				.setDesc(t("aiProviderPage.modelSourceDesc"))
				.addDropdown((dropdown) => {
					dropdown.addOption("providerApi", t("ai.modelSourceProviderApi"));
					dropdown.addOption("modelsDev", t("ai.modelSourceModelsDev"));
					dropdown.addOption("auto", t("aiProviderPage.modelSourceAuto"));
					dropdown.setValue(provider.modelSource ?? "providerApi");
					dropdown.onChange((value) => {
						this.editConnection((p) => ({
							...p,
							modelSource: value as AIProvider["modelSource"],
						}));
						// The descriptions below name the source.
						this.display();
					});
				});
		});

		group.addSetting((setting) => {
			setting
				.setName(t("ai.autoSyncModels.name"))
				.setDesc(t("aiProviderPage.autoSyncDesc", { source }));
			this.syncStatusEl = setting.descEl.createDiv({ cls: "qa-ai-status-line" });
			this.renderSyncStatus();
			setting
				.addToggle((toggle) => {
					toggle.setValue(!!provider.autoSyncModels).onChange((value) => {
						this.edit((p) => ({ ...p, autoSyncModels: value }));
					});
				})
				.addButton((button) => {
					button
						.setButtonText(t("ai.autoSyncModels.syncNowButton"))
						.onClick(() => this.syncNow(button));
				});
		});

		group.addSetting((setting) => {
			setting
				.setName(t("ai.importModels.browseButton"))
				.setDesc(t("aiProviderPage.browseModelsDesc", { source }))
				.addButton((button) => {
					button.setButtonText(t("aiProviderPage.browseButton")).onClick(() => this.browseModels());
				});
		});
	}

	private async syncNow(button: ButtonComponent): Promise<void> {
		const provider = this.provider;
		if (!provider) return;
		const source = describeModelSource(provider);
		// Report against the list on screen now. A background sync may land
		// on this provider while the request runs; it is counted too, so the
		// notice never says "up to date" while the list visibly changes.
		const shown = provider.models.map((model) => ({ ...model }));
		button.setDisabled(true);
		try {
			const discovered = await syncStoredProvider(this.app, this.providerId);
			const current = this.provider;
			if (!discovered || !current) return;
			// Count only models the source reports, so a model the user added
			// by hand meanwhile is not announced as synced.
			const sourceNames = new Set(discovered.map((m) => m.name));
			const counts = diffModelLists(
				shown,
				current.models.filter((m) => sourceNames.has(m.name)),
			);
			new Notice(
				counts.added > 0 || counts.updated > 0
					? t("aiProviderPage.syncedFromSource", {
							source,
							added: counts.added,
							updated: counts.updated,
						})
					: t("ai.syncedUpToDate", { source }),
			);
		} catch (err) {
			new Notice(
				t("ai.modelSyncFailed", {
					error: (err as { message?: string }).message ?? String(err),
				}),
			);
		} finally {
			button.setDisabled(false);
		}
	}

	private async browseModels(): Promise<void> {
		const provider = this.provider;
		if (!provider) return;
		const result = await new ModelDirectoryModal(this.app, provider).waitForClose;
		if (!result) return;
		const { imported, mode } = result;
		this.edit((p) => ({
			...p,
			// Merge (not append-only dedupe): re-importing a model the provider
			// already has refreshes its context/output metadata.
			models: mode === "replace" ? imported : mergeModels(p.models, imported),
		}));
		new Notice(
			mode === "replace"
				? t("aiProviderPage.importedReplaced", { count: countModels(imported.length) })
				: t("aiProviderPage.imported", { count: countModels(imported.length) }),
		);
	}

	private renderModelsGroup(): void {
		// mod-list: Obsidian's compact style for collections (as in Keychain),
		// which also keeps each row's delete button inline on phones.
		const group = new SettingGroup(this.containerEl)
			.setHeading(t("aiProviderPage.modelsHeading"))
			.addClass("mod-list", "qa-ai-models-group");
		group.addSearch((search) => {
			search
				.setPlaceholder(t("aiProviderPage.filterPlaceholder"))
				.setValue(this.modelFilter)
				.onChange((value) => {
					this.modelFilter = value;
					this.renderModelList();
				});
		});
		group.addExtraButton((button) => {
			button
				.setIcon("plus")
				.setTooltip(t("ai.addModel.button"))
				.onClick(() => void this.addModel());
		});
		this.modelListEl = group.listEl;
		this.renderModelList();
	}

	/** (Re)render the model rows. Newest first, retired last. */
	private renderModelList(): void {
		const listEl = this.modelListEl;
		const provider = this.provider;
		if (!listEl || !provider) return;
		listEl.empty();

		const retired = provider.models.filter((model) => model.deprecated);
		if (retired.length > 0) {
			// Capture the names now: a sync that retires more models while the
			// confirmation is open must not widen what gets removed.
			const retiredNames = new Set(retired.map((model) => model.name));
			const setting = new Setting(listEl)
				.setName(
					t("aiProviderPage.retiredHeading", { count: countModels(retired.length) }),
				)
				.setDesc(t("aiProviderPage.retiredDesc"))
				.addButton((button) => {
					button.setButtonText(t("aiProviderPage.removeRetired")).onClick(async () => {
						const confirmed = await confirmAction(this.app, {
							title: t("aiProviderPage.removeRetiredConfirm", {
								count: countModels(retiredNames.size),
								name: provider.name,
							}),
							action: t("common.remove"),
						});
						if (!confirmed) return;
						this.edit((p) => ({
							...p,
							models: p.models.filter((model) => !retiredNames.has(model.name)),
						}));
					});
				});
			setting.settingEl.addClass("qa-ai-retired-notice");
		}

		const query = this.modelFilter.trim().toLowerCase();
		const shown = sortModelsForDisplay(provider.models).filter(
			(model) => !query || model.name.toLowerCase().includes(query),
		);

		if (shown.length === 0) {
			new Setting(listEl)
				.setName(
					query
						? t("aiProviderPage.noModelsMatchFilter", { filter: this.modelFilter.trim() })
						: t("aiProviderPage.noModelsYet"),
				)
				.settingEl.addClass("mod-empty-state");
			return;
		}

		for (const model of shown) {
			const setting = new Setting(listEl).setName(model.name).setDesc(describeModel(model));
			if (model.deprecated) {
				setting.nameEl.createSpan({
					cls: "qa-ai-model-badge",
					text: t("aiProviderPage.retiredBadge"),
				});
			}
			setting.addExtraButton((button) => {
				button
					.setIcon("trash-2")
					.setTooltip(t("aiProviderPage.deleteModelTooltip"))
					.onClick(() => void this.deleteModel(model.name));
			});
		}
	}

	private async deleteModel(name: string): Promise<void> {
		const confirmed = await confirmAction(this.app, {
			title: t("aiProviderPage.deleteModelConfirm", { name }),
			action: t("common.delete"),
		});
		if (!confirmed) return;
		// By name: a sync may have replaced the model objects meanwhile.
		this.edit((p) => ({
			...p,
			models: p.models.filter((model) => model.name !== name),
		}));
	}

	private async addModel(): Promise<void> {
		let modelName: string;
		let maxTokens: string;
		try {
			modelName = await GenericInputPrompt.Prompt(
				this.app,
				t("aiProviderPage.modelNamePrompt"),
			);
			maxTokens = await GenericInputPrompt.Prompt(
				this.app,
				t("aiProviderPage.contextWindowPrompt"),
			);
		} catch {
			// Cancelling either prompt is a clean no-op.
			return;
		}

		const name = modelName.trim();
		if (!name) {
			new Notice(t("ai.modelNameEmpty"));
			return;
		}
		// Reject non-numeric input outright: parseInt would silently accept
		// "10abc" as 10. Require a plain positive integer.
		const tokens = maxTokens.trim();
		// Past 2^53 a digit string no longer parses to itself (and a long one
		// to Infinity, which data.json stores as null).
		if (!/^[1-9]\d*$/.test(tokens) || !Number.isSafeInteger(Number(tokens))) {
			new Notice(t("aiProviderPage.contextWindowPositive"));
			return;
		}
		if (this.provider?.models.some((model) => model.name === name)) {
			new Notice(t("aiProviderPage.nameAlreadyInList", { name }));
			return;
		}

		this.edit((p) => ({
			...p,
			models: [...p.models, { name, maxTokens: Number(tokens) }],
		}));
	}

	private renderSyncStatus(): void {
		const provider = this.provider;
		if (!this.syncStatusEl || !provider) return;
		setStatusLine(
			this.syncStatusEl,
			describeSyncStatus(provider, Date.now()),
			provider.lastModelSync?.error ? "error" : undefined,
		);
	}

	private renderDeleteGroup(): void {
		new SettingGroup(this.containerEl).addSetting((setting) => {
			setting
				.setName(t("aiProviderPage.deleteProvider"))
				.setDesc(t("aiProviderPage.deleteProviderWarn"))
				.addButton((button) => {
					button
						.setButtonText(t("common.delete"))
						.setDestructive()
						.setCta()
						.onClick(async () => {
							const provider = this.provider;
							if (!provider) return;
							const confirmed = await confirmAction(this.app, {
								title: t("aiProviderPage.deleteProviderConfirm", {
									name: provider.name.trim() || t("aiProviderPage.thisProvider"),
								}),
								message: t("aiProviderPage.deleteProviderWarn"),
								action: t("common.delete"),
							});
							if (!confirmed) return;
							removeProvider(this.providerId);
							this.close();
						});
				});
		});
	}
}
