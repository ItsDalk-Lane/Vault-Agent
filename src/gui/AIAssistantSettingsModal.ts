import type { App } from "obsidian";
import { Modal, Setting, TextAreaComponent } from "obsidian";
import type { QuickAddSettings } from "src/settings";
import { mountSystemPromptLiteralNote } from "./ai/systemPromptLiteralNote";
import { AIAssistantProvidersModal } from "./AIAssistantProvidersModal";
import { populateModelDropdown } from "./modelSelect";
import { GenericTextSuggester } from "./suggesters/genericTextSuggester";
import { getAllFolderPathsInVault } from "src/utilityObsidian";
import { t } from "../i18n";

type AIAssistantSettings = QuickAddSettings["ai"];

export class AIAssistantSettingsModal extends Modal {
	public waitForClose: Promise<AIAssistantSettings>;

	private resolvePromise: (settings: AIAssistantSettings) => void;
	private rejectPromise: (reason?: unknown) => void;

	private settings: AIAssistantSettings;

	constructor(app: App, settings: AIAssistantSettings) {
		super(app);

		this.settings = settings;

		this.waitForClose = new Promise<AIAssistantSettings>(
			(resolve, reject) => {
				this.rejectPromise = reject;
				this.resolvePromise = resolve;
			}
		);

		this.open();
		this.display();
	}

	private display(): void {
		this.modalEl.addClass("qa-ai-wide-modal");
		this.contentEl.addClass("qa-ai-scroll-content");

		this.contentEl.createEl("h2", {
			text: t("ai.settingsTitle"),
			cls: "qa-modal-title",
		});

		this.addProvidersSetting(this.contentEl);
		this.addDefaultModelSetting(this.contentEl);
		this.addPromptTemplateFolderPathSetting(this.contentEl);
		this.addShowAssistantSetting(this.contentEl);
		this.addConfirmToolCallsSetting(this.contentEl);

		this.addDefaultSystemPromptSetting(this.contentEl);
	}

	private reload(): void {
		this.contentEl.empty();

		this.display();
	}

	addProvidersSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("ai.providers.name"))
			.setDesc(t("ai.providers.desc"))
			.addButton((button) => {
				button.setButtonText(t("ai.providers.editButton")).onClick(() => {
					void new AIAssistantProvidersModal(
						this.settings.providers,
						this.app
					).waitForClose.then(() => {
						this.reload();
					});
				});
			});
	}
 
	addDefaultModelSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("ai.defaultModel.name"))
			.setDesc(t("ai.defaultModel.desc"))
			.addDropdown((dropdown) => {
				populateModelDropdown(
					dropdown,
					{
						model: this.settings.defaultModel,
						modelRef: this.settings.defaultModelRef,
					},
					(selection) => {
						this.settings.defaultModel = selection.model;
						this.settings.defaultModelRef = selection.modelRef;
					},
				);
			});
	}

	addPromptTemplateFolderPathSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("ai.promptTemplateFolderPath.name"))
			.setDesc(t("ai.promptTemplateFolderPath.desc"))
			.addText((text) => {
				text.setValue(this.settings.promptTemplatesFolderPath).onChange(
					(value) => {
						this.settings.promptTemplatesFolderPath = value;
					}
				);

				new GenericTextSuggester(
					this.app,
					text.inputEl,
					getAllFolderPathsInVault(this.app)
				);
			});
	}

	addShowAssistantSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("ai.showAssistant.name"))
			.setDesc(t("ai.showAssistant.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.settings.showAssistant);
				toggle.onChange((value) => {
					this.settings.showAssistant = value;
				});
			});
	}

	addConfirmToolCallsSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("ai.confirmToolCalls"))
			.setDesc(t("ai.confirmToolCallsDesc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("destructive", t("ai.confirmModeDestructive"));
				dropdown.addOption("always", t("ai.confirmModeAlways"));
				dropdown.addOption("never", t("ai.confirmModeNever"));
				dropdown.setValue(this.settings.confirmToolCalls ?? "destructive");
				dropdown.onChange((value) => {
					this.settings.confirmToolCalls =
						value as QuickAddSettings["ai"]["confirmToolCalls"];
				});
			});
	}

	addDefaultSystemPromptSetting(contentEl: HTMLElement) {
		new Setting(contentEl)
			.setName(t("ai.defaultSystemPrompt.name"))
			.setDesc(t("ai.defaultSystemPrompt.desc"));

		const textAreaComponent = new TextAreaComponent(contentEl);
		textAreaComponent.inputEl.addClass("qa-ai-prompt-textarea");
		// The textarea is appended to contentEl rather than to the Setting's
		// controlEl (it needs the full modal width), so nothing associates it with
		// the "Default system prompt" name above.
		textAreaComponent.inputEl.setAttribute(
			"aria-label",
			t("ai.defaultSystemPrompt.name"),
		);

		// No format preview and no `{{` token autocomplete here: the system prompt
		// is sent to the model verbatim (see mountSystemPromptLiteralNote). The
		// preview this replaces resolved the tokens on screen and was, for the
		// shipped token-free default, a character-for-character duplicate of the
		// textarea above it (#1568).
		const updateLiteralNote = mountSystemPromptLiteralNote(
			contentEl,
			textAreaComponent.inputEl,
			this.settings.defaultSystemPrompt ?? "",
		);

		textAreaComponent
			.setValue(this.settings.defaultSystemPrompt)
			.onChange((value) => {
				this.settings.defaultSystemPrompt = value;
				updateLiteralNote(value);
			});
	}

	onClose(): void {
		this.resolvePromise(this.settings);
		super.onClose();
	}
}
