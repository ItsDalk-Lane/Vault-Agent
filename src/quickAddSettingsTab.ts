import type {
	App,
	Setting,
	SettingDefinitionGroup,
	SettingDefinitionItem,
	TextAreaComponent,
} from "obsidian";
import {
	ButtonComponent,
	ExtraButtonComponent,
	PluginSettingTab,
	TextComponent,
} from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import ChoiceView from "./gui/choiceList/ChoiceView.svelte";
import ChoicesUnavailable from "./gui/choiceList/ChoicesUnavailable.svelte";
import { mountComponent, type MountHandle } from "./gui/svelte/mountComponent";
import type { Plain } from "./gui/svelte/persist.svelte";
import { GenericTextSuggester } from "./gui/suggesters/genericTextSuggester";
import GlobalVariablesView from "./gui/GlobalVariables/GlobalVariablesView.svelte";
import { settingsStore } from "./settingsStore";
import {
	getAllFolderPathsInVault,
	normalizeTemplateFolderPaths,
} from "./utilityObsidian";
import { sortFolderPathsByTree } from "./utils/folder-sorting";
import { ExportPackageModal } from "./gui/PackageManager/ExportPackageModal";
import { ImportPackageModal } from "./gui/PackageManager/ImportPackageModal";
import { InputPromptDraftStore } from "./utils/InputPromptDraftStore";
import type { QuickAddSettings } from "./settings";
import {
	DEFAULT_DATE_ALIASES,
	formatDateAliasLines,
	parseDateAliasLines,
} from "./utils/dateAliases";
import { renderDevelopmentInfo } from "./quickAddSettingsDevelopmentInfo";
import { createDocsLink, DOCS_URLS, openDocsUrl } from "./docs";
import { rootChoicesOf } from "./utils/choiceUtils";
import { t } from "./i18n";

/** String-named keys of {@link QuickAddSettings} — used to type the declarative
 * `control` keys so a mistyped key is caught at compile time. */
type SettingsKey = Extract<keyof QuickAddSettings, string>;

/** Settings-tab heading: "Choices & packages" — the "packages" UI is shared by the
 * Packages definition (which is what the settings search indexes) and by the
 * rendered description (which the row rewrites as the export state changes),
 * so the two can never drift. t() is computed inside the group builder so the
 * locale module is loaded before the key resolves. */
const PACKAGES_DESC_KEY = "settings.packages.desc";
const PACKAGES_DESC_NEEDS_CHOICE_KEY = "settings.packages.descNeedsChoice";

export class QuickAddSettingsTab extends PluginSettingTab {
	public plugin: QuickAdd;
	private choiceViewHandle: MountHandle | null = null;
	private globalVariablesViewHandle: MountHandle | null = null;
	/** Live store subscription behind the Packages row's Export state. */
	private packagesUnsubscribe: (() => void) | null = null;

	constructor(app: App, plugin: QuickAdd) {
		super(app, plugin);
		this.plugin = plugin;
		this.icon = "zap";
	}

	// -----------------------------------------------------------------------
	// Store bridge
	//
	// QuickAdd's single source of truth is the zustand `settingsStore`, and the
	// only persistence path is the subscriber installed in main.ts (which sets
	// `plugin.settings` and calls `saveSettings()` on every store change). The
	// declarative `control` API would otherwise bind directly to
	// `plugin.settings[key]` and call `saveData` itself, bypassing the store and
	// leaving every live store consumer (formatter, dateParser, choiceExecutor,
	// the AI command, the Svelte views, ...) stale. Overriding both accessors to
	// read/write the store keeps it authoritative. We must NOT also touch
	// `plugin.settings` or call `saveData` here — the subscriber owns that.
	// -----------------------------------------------------------------------

	override getControlValue(key: string): unknown {
		const state = settingsStore.getState();

		// `inputPrompt` is stored as an enum but surfaced as a boolean toggle.
		if (key === "inputPrompt") {
			return state.inputPrompt === "multi-line";
		}

		return state[key as keyof QuickAddSettings];
	}

	override setControlValue(key: string, value: unknown): void {
		if (key === "inputPrompt") {
			settingsStore.setState({
				inputPrompt: value ? "multi-line" : "single-line",
			});
			return;
		}

		if (key === "persistInputPromptDrafts") {
			const enabled = Boolean(value);
			settingsStore.setState({ persistInputPromptDrafts: enabled });
			if (!enabled) {
				InputPromptDraftStore.getInstance().clearAll();
			}
			return;
		}

		settingsStore.setState({ [key]: value } as Partial<QuickAddSettings>);
	}

	override getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
		const groups: SettingDefinitionGroup<SettingsKey>[] = [
			this.choicesAndPackagesGroup(),
			this.choicePickerGroup(),
			this.inputGroup(),
			this.templatesGroup(),
			this.notificationsGroup(),
			this.globalVariablesGroup(),
			this.aiAndOnlineGroup(),
			this.appearanceGroup(),
		];

		if (__IS_DEV_BUILD__) {
			groups.push(this.developerGroup());
		}

		return groups;
	}

	override hide(): void {
		// In declarative mode the framework owns row teardown — unloading the
		// control Components and running each render def's cleanup closure —
		// which the base hide() drives. We must call it (the old imperative tab
		// emptied containerEl itself, so the missing super.hide() was harmless
		// then; it is not now). destroySettingViews() is the idempotent safety
		// net for the two Svelte mounts.
		super.hide();
		this.destroySettingViews();
	}

	private destroySettingViews(): void {
		this.choiceViewHandle?.destroy();
		this.choiceViewHandle = null;
		this.globalVariablesViewHandle?.destroy();
		this.globalVariablesViewHandle = null;
		// Safety net for the Packages subscription: the render cleanup already
		// unsubscribes, but this row outlives no view of its own, so a missed
		// cleanup would leak a listener for the plugin's lifetime.
		this.packagesUnsubscribe?.();
		this.packagesUnsubscribe = null;
	}

	// ----- group builders -----

	private choicesAndPackagesGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.group.choicesAndPackages"),
			// QuickAdd's power surface is syntax you have to learn ({{VALUE}},
			// {{DATE}}, capture targets, ...) and until now the manual was reachable
			// from exactly one place in the whole plugin (issue #1541). A help icon
			// on the first heading is Obsidian's own idiom for this, and it costs the
			// page no vertical space, so the choices list stays the focus.
			extraButtons: [
				(button) =>
					button
						.setIcon("help-circle")
						.setTooltip(t("settings.docs.quickAddTooltip"))
						.onClick(() =>
							openDocsUrl(DOCS_URLS.gettingStarted, button.extraSettingsEl),
						),
			],
			items: [
				{
					name: t("settings.choices.name"),
					render: (setting) => this.renderChoicesView(setting),
				},
				{
					name: t("settings.packages.name"),
					desc: t(PACKAGES_DESC_KEY),
					render: (setting) => this.renderPackages(setting),
				},
			],
		};
	}

	private choicePickerGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.group.choicePicker"),
			items: [
				{
					name: t("settings.items.searchNestedChoices.name"),
					// "Multi" is the internal type id; every other user-facing string
					// says folder (see src/utils/choiceNoun.ts), and this was the one
					// place in the whole settings surface that leaked it.
					desc: t("settings.items.searchNestedChoices.desc"),
					control: { type: "toggle", key: "searchNestedChoices" },
				},
				{
					name: t("settings.items.templateFolderLauncherRow.name"),
					desc: t("settings.items.templateFolderLauncherRow.desc"),
					control: {
						type: "dropdown",
						key: "templateFolderLauncherRow",
						defaultValue: "bottom",
						options: {
							bottom: t("settings.items.templateFolderLauncherRow.bottom"),
							top: t("settings.items.templateFolderLauncherRow.top"),
							off: t("settings.items.templateFolderLauncherRow.off"),
						},
					},
				},
			],
		};
	}

	private inputGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.group.input"),
			items: [
				{
					name: t("settings.items.useMultiLine.name"),
					desc: t("settings.items.useMultiLine.desc"),
					control: { type: "toggle", key: "inputPrompt" },
				},
				{
					name: t("settings.items.persistDrafts.name"),
					desc: t("settings.items.persistDrafts.desc"),
					control: { type: "toggle", key: "persistInputPromptDrafts" },
				},
				{
					name: t("settings.items.useSelection.name"),
					desc: t("settings.items.useSelection.desc"),
					control: { type: "toggle", key: "useSelectionAsCaptureValue" },
				},
				{
					name: t("settings.items.namePastedImages.name"),
					desc: t("settings.items.namePastedImages.desc"),
					control: { type: "toggle", key: "namePastedImagesAfterNoteTitle" },
				},
				{
					name: t("settings.items.onePageInput.name"),
					// The trailing sentence used to read "See One-page Inputs in the
					// docs." as plain, unlinked prose (issue #1541).
					desc: this.descWithDocsLink(
						t("settings.items.onePageInput.descPrefix"),
						DOCS_URLS.onePageInputs,
						t("settings.docs.learnMoreAboutOnePageInput"),
					),
					control: { type: "toggle", key: "onePageInputEnabled" },
				},
				{
					name: t("settings.items.dateAliases.name"),
					desc: t("settings.items.dateAliases.desc"),
					render: (setting) => this.renderDateAliases(setting),
				},
			],
		};
	}

	private templatesGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.group.templatesAndProperties"),
			items: [
				{
					name: t("settings.items.templateFolderPaths.name"),
					desc: t("settings.items.templateFolderPaths.desc"),
					render: (setting) => this.renderTemplateFolderPaths(setting),
				},
				{
					name: t("settings.items.convertStringTypes.name"),
					desc: t("settings.items.convertStringTypes.desc"),
					control: { type: "toggle", key: "enableTemplatePropertyTypes" },
				},
			],
		};
	}

	private notificationsGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.group.notifications"),
			items: [
				{
					name: t("settings.items.announceUpdates.name"),
					desc: t("settings.items.announceUpdates.desc"),
					control: {
						type: "dropdown",
						key: "announceUpdates",
						defaultValue: "major",
						options: {
							all: t("settings.items.announceUpdates.all"),
							major: t("settings.items.announceUpdates.major"),
							none: t("settings.items.announceUpdates.none"),
						},
					},
				},
				{
					name: t("settings.items.showCaptureNotifications.name"),
					desc: t("settings.items.showCaptureNotifications.desc"),
					control: { type: "toggle", key: "showCaptureNotification" },
				},
				{
					name: t("settings.items.showInputCancellation.name"),
					desc: t("settings.items.showInputCancellation.desc"),
					control: {
						type: "toggle",
						key: "showInputCancellationNotification",
					},
				},
			],
		};
	}

	private globalVariablesGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.group.globalVariables"),
			items: [
				{
					name: t("settings.items.globalVariables.name"),
					render: (setting) => this.renderGlobalVariablesView(setting),
				},
			],
		};
	}

	private aiAndOnlineGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.group.aiAndOnline"),
			items: [
				{
					name: t("settings.items.disableAI.name"),
					desc: t("settings.items.disableAI.desc"),
					control: { type: "toggle", key: "disableOnlineFeatures" },
				},
				{
					name: t("settings.items.allowUriCallbacks.name"),
					desc: t("settings.items.allowUriCallbacks.desc"),
					control: { type: "toggle", key: "enableUriCallbacks" },
				},
			],
		};
	}

	private appearanceGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.appearance.heading"),
			items: [
				{
					name: t("settings.language.name"),
					desc: t("settings.language.desc"),
					control: {
						type: "dropdown",
						key: "preferredLocale",
						defaultValue: "",
						options: {
							"": t("settings.language.auto"),
							en: t("settings.language.en"),
							"zh-CN": t("settings.language.zh-CN"),
						},
					},
				},
				{
					name: t("settings.appearance.ribbonIconName"),
					desc: t("settings.appearance.ribbonIconDesc"),
					control: { type: "toggle", key: "enableRibbonIcon" },
				},
			],
		};
	}

	private developerGroup(): SettingDefinitionGroup<SettingsKey> {
		return {
			type: "group",
			heading: t("settings.group.developer"),
			items: [
				{
					name: t("settings.items.development.name"),
					desc: t("settings.items.development.desc"),
					render: (setting) => this.renderDevInfo(setting),
				},
			],
		};
	}

	// ----- render helpers -----

	/**
	 * A description ending in a documentation link. Built fresh on every call: the
	 * declarative renderer clones fragments before inserting them, but
	 * getSettingDefinitions() runs per render anyway, so a fresh fragment is free
	 * and cannot be accidentally re-parented.
	 *
	 * `linkText` names its destination wherever two links could be on screen at
	 * once, matching Obsidian's own "Learn more about ..." phrasing.
	 */
	private descWithDocsLink(
		text: string,
		url: string,
		linkText?: string,
	): DocumentFragment {
		const fragment = document.createDocumentFragment();
		fragment.append(document.createTextNode(text));
		createDocsLink(fragment, url, linkText ?? t("settings.docs.learnMore"));
		return fragment;
	}

	/** Strip the label/description column and let a row span the full width —
	 * used to host the mounted Svelte views. The declarative API requires a
	 * `name` on every definition (for search indexing); we set it on the def and
	 * remove the rendered `infoEl` here so the view still spans full width. */
	private prepareFullWidthSetting(setting: Setting): void {
		setting.infoEl.remove();
		setting.settingEl.addClass("qa-setting-full-width");
		setting.controlEl.addClass("qa-setting-full-width-control");
	}

	// The declarative framework builds every group by calling these `render`
	// closures in turn, so a throw out of one of them abandons the rest: when
	// ChoiceView's mount threw, QuickAdd's settings came up as a lone "Choices &
	// packages" heading with nothing under it, and no other section rendered at
	// all (#1451, #1507, #1566). That guard now lives in mountComponent itself, so
	// every Svelte host in the plugin gets it (#1584) — here we only choose which
	// card takes the view's place.
	//
	// ChoiceView has its own <svelte:boundary> for reactive failures inside the
	// list; mountComponent catches the setup that boundary sits inside.

	private renderChoicesView(setting: Setting): () => void {
		this.prepareFullWidthSetting(setting);

		this.choiceViewHandle?.destroy();
		const handle = mountComponent(
			setting.controlEl,
			ChoiceView,
			{
				app: this.app,
				plugin: this.plugin,
				choices: settingsStore.getState().choices,
				// Typed Plain<IChoice[]> (not IChoice[]) so a forgotten $state.snapshot at
				// the call site is a COMPILE error here — this is the real persistence sink
				// that must never receive a live Svelte $state proxy. Plain<T> is assignable
				// to T, so setState still accepts it.
				saveChoices: (choices: Plain<IChoice[]>) => {
					settingsStore.setState({ choices });
				},
			},
			// The choice list is the one view whose failure has a recovery story worth
			// spelling out (the data.json advice in ChoicesUnavailable), and the same
			// card the view itself shows when the tree is unreadable — so a mount
			// failure and a render failure look identical to the user.
			{ what: "your choices", fallbackComponent: ChoicesUnavailable },
		);
		this.choiceViewHandle = handle;

		// Capture the handle so a stale cleanup can only ever destroy its own
		// mount (and only nulls the field while it still points at this mount).
		return () => {
			handle.destroy();
			if (this.choiceViewHandle === handle) {
				this.choiceViewHandle = null;
			}
		};
	}

	private renderGlobalVariablesView(setting: Setting): () => void {
		this.prepareFullWidthSetting(setting);

		this.globalVariablesViewHandle?.destroy();
		const handle = mountComponent(
			setting.controlEl,
			GlobalVariablesView,
			{
				app: this.app,
				plugin: this.plugin,
			},
			{ what: "your global variables" },
		);
		this.globalVariablesViewHandle = handle;

		return () => {
			handle.destroy();
			if (this.globalVariablesViewHandle === handle) {
				this.globalVariablesViewHandle = null;
			}
		};
	}

	/** Packages description, with the reason Export is unavailable when it is. */
	private packagesDesc(hasNothingToExport: boolean): DocumentFragment {
		return this.descWithDocsLink(
			hasNothingToExport
				? `${t(PACKAGES_DESC_NEEDS_CHOICE_KEY)} `
				: `${t(PACKAGES_DESC_KEY)} `,
			DOCS_URLS.packages,
			t("settings.docs.packagesLink"),
		);
	}

	private renderPackages(setting: Setting): () => void {
		// Both package actions are secondary utilities — not the page's primary
		// action ("New choice" is) — so neither is a CTA. Keeping only one filled
		// primary button in the view avoids competing purple CTAs (per the
		// one-primary-button-per-page rule).
		let exportButton: ButtonComponent | undefined;
		setting.addButton((button) => {
			exportButton = button;
			button.setButtonText(t("settings.packages.exportButton")).onClick(() => {
				const choicesSnapshot = rootChoicesOf(
					settingsStore.getState().choices,
				);
				new ExportPackageModal(
					this.app,
					this.plugin,
					choicesSnapshot,
				).open();
			});
		});

		// Import stays available with zero choices on purpose: importing a package
		// is one of the most useful things a brand-new user can do, so the block as
		// a whole is not de-emphasised, only the action that cannot work.
		setting.addButton((button) =>
			button.setButtonText(t("settings.packages.importButton")).onClick(() => {
				new ImportPackageModal(this.app).open();
			}),
		);

		// "Export package…" used to be the first concrete action a new user saw
		// below the "No choices yet" empty state, with nothing to export (issue
		// #1547). The tooltip covers desktop hover; the description carries the
		// same reason for touch, where there is no hover, and for screen readers.
		const apply = (hasNothingToExport: boolean): void => {
			setting.setDesc(this.packagesDesc(hasNothingToExport));
			if (!exportButton) return;
			exportButton.setDisabled(hasNothingToExport);
			if (hasNothingToExport) {
				exportButton.setTooltip(t("settings.packages.nothingToExport"));
			} else {
				// setTooltip("") is unspecified; Obsidian's tooltip is driven by
				// aria-label, so drop the attribute outright.
				exportButton.buttonEl.removeAttribute("aria-label");
			}
		};

		// The declarative tab renders once and does NOT re-render on store changes,
		// so subscribe to keep the state honest while the tab stays open.
		let hasNothingToExport =
			rootChoicesOf(settingsStore.getState().choices).length === 0;
		apply(hasNothingToExport);

		this.packagesUnsubscribe?.();
		const unsubscribe = settingsStore.subscribe((settings) => {
			const next = rootChoicesOf(settings.choices).length === 0;
			if (next === hasNothingToExport) return;
			hasNothingToExport = next;
			apply(next);
		});
		this.packagesUnsubscribe = unsubscribe;

		return () => {
			unsubscribe();
			if (this.packagesUnsubscribe === unsubscribe) {
				this.packagesUnsubscribe = null;
			}
		};
	}

	private renderDateAliases(setting: Setting): void {
		setting.settingEl.addClass("qa-date-alias-setting");
		setting.controlEl.addClass("qa-date-alias-control");

		let textAreaRef: TextAreaComponent | null = null;

		setting.addTextArea((textArea) => {
			textAreaRef = textArea;
			textArea
				.setPlaceholder(t("settings.items.dateAliases.placeholder"))
				.setValue(
					formatDateAliasLines(settingsStore.getState().dateAliases),
				)
				.onChange((value) => {
					settingsStore.setState({
						dateAliases: parseDateAliasLines(value),
					});
				});
			textArea.inputEl.addClass("qa-date-alias-input");
		});

		setting.addButton((button) => {
			button
				.setButtonText(t("settings.items.dateAliases.resetButton"))
				.onClick(() => {
					settingsStore.setState({ dateAliases: DEFAULT_DATE_ALIASES });
					textAreaRef?.setValue(formatDateAliasLines(DEFAULT_DATE_ALIASES));
				});
			button.buttonEl.addClass("qa-date-alias-reset");
		});
	}

	private renderTemplateFolderPaths(setting: Setting): () => void {
		// Let this row span the full pane (label/desc stacked above a full-width
		// list) instead of cramming a growing list into the narrow control column.
		setting.settingEl.addClass("qa-template-folders-setting");

		const container = setting.controlEl.createDiv("qa-template-folders");
		const listEl = container.createDiv("qa-template-folder-list");

		const getPaths = (): string[] =>
			normalizeTemplateFolderPaths(settingsStore.getState().templateFolderPaths);
		const setPaths = (paths: string[]): void => {
			settingsStore.setState({ templateFolderPaths: paths });
		};

		const renderList = (): void => {
			listEl.empty();
			const paths = getPaths();
			if (paths.length === 0) {
				listEl.createDiv({
					cls: "qa-template-folder-empty",
					text: t("settings.items.templateFolderPaths.empty"),
				});
				return;
			}
			for (const folder of paths) {
				const row = listEl.createDiv("qa-template-folder-row");
				// title gives desktop a hover tooltip for paths truncated by ellipsis;
				// on mobile (no hover) the path wraps instead — see styles.css.
				row.createSpan({
					cls: "qa-template-folder-name",
					text: folder,
					attr: { title: folder },
				});
				new ExtraButtonComponent(row)
					.setIcon("trash-2")
					.setTooltip(`${t("common.remove")} ${folder}`)
					.onClick(() => {
						setPaths(getPaths().filter((f) => f !== folder));
						renderList();
					});
			}
		};

		const inputRow = container.createDiv("qa-template-folder-input-row");
		const input = new TextComponent(inputRow);
		input.setPlaceholder(t("settings.items.templateFolderPaths.placeholder"));
		input.inputEl.addClass("qa-template-folder-input");
		const suggester = new GenericTextSuggester(
			this.app,
			input.inputEl,
			sortFolderPathsByTree(getAllFolderPathsInVault(this.app)).filter(
				(path) => path !== "/",
			),
		);

		const addFolder = (): void => {
			// Store the canonical (normalized) form so "templates" and "templates/"
			// can't both be added, and dedupe against the existing list.
			const [folder] = normalizeTemplateFolderPaths([input.inputEl.value]);
			input.inputEl.value = "";
			if (!folder) return;
			const paths = getPaths();
			if (paths.includes(folder)) return;
			setPaths([...paths, folder]);
			renderList();
		};

		const onKeydown = (e: KeyboardEvent): void => {
			if (e.key === "Enter") {
				e.preventDefault();
				addFolder();
			}
		};
		input.inputEl.addEventListener("keydown", onKeydown);
		new ButtonComponent(inputRow)
			.setCta()
			.setButtonText(t("settings.items.templateFolderPaths.addButton"))
			.onClick(() => addFolder());

		renderList();

		// The suggester registers global (document/window) listeners while open;
		// tear it down when the row is rebuilt or the tab hides so nothing leaks.
		return () => {
			input.inputEl.removeEventListener("keydown", onKeydown);
			suggester.destroy();
		};
	}

	private renderDevInfo(setting: Setting): void {
		const infoContainer = setting.settingEl.createDiv();
		infoContainer.addClass("qa-dev-info");

		renderDevelopmentInfo(infoContainer, {
			branch: __DEV_GIT_BRANCH__,
			commit: __DEV_GIT_COMMIT__,
			dirty: __DEV_GIT_DIRTY__,
		});
	}
}
