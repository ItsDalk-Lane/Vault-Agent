<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import { t } from "../../i18n";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type {
	FileExistsBehaviorCategoryId,
	FileExistsModeId,
} from "../../template/fileExistsPolicy";
import {
	fileExistsBehaviorCategoryOptions,
	getBehaviorCategory,
	getDefaultBehaviorForCategory,
	getFileExistsMode,
	getModesForCategory,
	existingNoteActions,
} from "../../template/fileExistsPolicy";
import { log } from "../../logger/logManager";
import { getAllFolderPathsInVault, getTemplateFile } from "../../utilityObsidian";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { sortFolderPathsByTree } from "../../utils/folder-sorting";
import { ExclusiveSuggester } from "../suggesters/exclusiveSuggester";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import FolderList from "./FolderList.svelte";
import {
	applyFolderMode,
	deriveFolderMode,
	folderModeDescriptions,
	folderModeOptions,
	type FolderMode,
} from "./folderMode";
import SettingItem from "../components/SettingItem.svelte";
import Toggle from "../components/Toggle.svelte";
import Dropdown from "../components/Dropdown.svelte";
import ChoiceNameHeader from "./components/ChoiceNameHeader.svelte";
import ValidatedInput from "./components/ValidatedInput.svelte";
import LabeledField from "./components/LabeledField.svelte";
import FormatPreviewField from "./components/FormatPreviewField.svelte";
import FormatTokenHint from "./components/FormatTokenHint.svelte";
import AppendLinkSetting from "./components/AppendLinkSetting.svelte";
import OpenFileSetting from "./components/OpenFileSetting.svelte";
import FileOpeningSetting from "./components/FileOpeningSetting.svelte";
import OnePageOverrideSetting from "./components/OnePageOverrideSetting.svelte";
import DateOriginSetting from "./components/DateOriginSetting.svelte";
import CommandPaletteSetting from "./components/CommandPaletteSetting.svelte";
import ChoiceIconSetting from "./components/ChoiceIconSetting.svelte";
import { suggester } from "./components/suggesterAction";
import { VALUE_SYNTAX } from "../../constants";
import { usesDefaultTemplateTitlePrompt } from "../../utils/templateNoteDiscoveryEligibility";
import { likelyTargetFolderPath } from "../../utils/previewTargetFolder";

/**
 * Reactive replacement for TemplateChoiceBuilder.display(). Conditional rows are
 * {#if} blocks over the $state-backed choice proxy, so toggling a control updates
 * in place — no contentEl.empty()/display() teardown, no lost scroll/caret (#1130).
 */
let {
	choice = $bindable(),
	app,
	plugin,
}: {
	choice: ITemplateChoice;
	app: App;
	plugin: QuickAdd;
} = $props();

// Computed once from the stable app/plugin props ($derived satisfies the
// reactive-reference rule; the vault snapshot matches the imperative builder,
// which also read these once per render).
const templatePaths = $derived(plugin.getTemplateFiles().map((f) => f.path));
const allFolders = $derived(sortFolderPathsByTree(getAllFolderPathsInVault(app)));

function validateTemplatePath(
	raw: string,
): boolean | string | { valid: boolean; message?: string } {
	const value = raw.trim();
	if (!value) return true;
	// A path with format syntax (e.g. "Templates/{{value:type}} Template.md")
	// can only be resolved when the choice runs, so don't flag it "not found";
	// show a neutral hint instead (issue #620).
	if (hasTemplatePathSyntax(value)) {
		return { valid: true, message: t("choiceBuilder.templateForm.templateFormatSyntaxHint") };
	}
	// Resolve like the engine does at run time rather than requiring
	// suggestion-list membership: a template outside the configured folders
	// still runs fine and must not be flagged "not found" (master #1170/#1325).
	return getTemplateFile(app, value) !== null || t("choiceBuilder.templateForm.templateNotFound");
}

// --- File name format ----------------------------------------------------
const fileNameSuggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, "fileName"),
];
const discoverySupported = $derived(
	usesDefaultTemplateTitlePrompt(
		choice,
		choice.fileNameFormat.enabled
			? choice.fileNameFormat.format
			: VALUE_SYNTAX,
	),
);
const discoveryDescription = $derived(
	discoverySupported
		? t("choiceBuilder.templateForm.searchExistingDesc")
		: t("choiceBuilder.templateForm.searchExistingUnsupportedDesc"),
);

// --- Folder selector -----------------------------------------------------
// The four persisted folder booleans encode mutually-exclusive destination
// modes; the dropdown is a derived view over them (no schema change). The mode
// mirrors TemplateChoiceEngine.getFolderPath() precedence — see folderMode.ts.
const folderMode = $derived(deriveFolderMode(choice.folder));
const folderModeDesc = $derived(folderModeDescriptions()[folderMode]);
const needsFolderList = $derived(
	folderMode === "specified" && choice.folder.folders.length === 0,
);

function onFolderModeChange(value: string) {
	// Immutable reassignment so the nested change is reactive (in-place
	// choice.folder.x = ... would not retrigger the {#if} blocks).
	choice.folder = applyFolderMode(choice.folder, value as FolderMode);
}

let folderInputValue = $state("");
let folderSuggester: ExclusiveSuggester | undefined;

function attachFolderSuggester(el: HTMLInputElement | HTMLTextAreaElement) {
	folderSuggester = new ExclusiveSuggester(
		app,
		el,
		allFolders,
		choice.folder.folders,
	);
	return folderSuggester;
}

// Keep the exclusion set in sync with the current folder list (replaces the
// imperative updateCurrentItems() calls). Tolerates a destroyed suggester after
// the input unmounts on a mode switch — updateCurrentItems is field-only and the
// input is recreated (with a fresh suggester) when "specified" mode returns.
$effect(() => {
	folderSuggester?.updateCurrentItems(choice.folder.folders);
});

function addFolder() {
	const input = folderInputValue.trim();
	// An empty entry resolves to the vault root at run time and renders as an
	// invisible blank row, while silently suppressing the "add a folder" warning.
	// Treat a blank Add as a no-op.
	if (!input) return;
	if (choice.folder.folders.some((folder) => folder === input)) {
		log.logWarning(t("choiceBuilder.templateForm.duplicateFolderWarning"));
		return;
	}
	choice.folder.folders.push(input);
	folderInputValue = "";
}

function onFolderInputKeypress(event: KeyboardEvent) {
	if (event.key === "Enter") addFolder();
}

// --- File already exists -------------------------------------------------
const behaviorCategory = $derived(getBehaviorCategory(choice.fileExistsBehavior));
const showModeRow = $derived(
	behaviorCategory !== "prompt" && behaviorCategory !== "keep",
);
const modeOptions = $derived(
	getModesForCategory(behaviorCategory === "update" ? "update" : "create"),
);
const selectedMode = $derived(
	choice.fileExistsBehavior.kind === "apply"
		? choice.fileExistsBehavior.mode
		: modeOptions[0].id,
);

function onCategoryChange(value: string) {
	choice.fileExistsBehavior = getDefaultBehaviorForCategory(
		value as FileExistsBehaviorCategoryId,
		choice.fileExistsBehavior,
	);
}

function onModeChange(value: string) {
	choice.fileExistsBehavior = {
		kind: "apply",
		mode: value as FileExistsModeId,
	};
}
</script>

<ChoiceNameHeader bind:name={choice.name} {app} />

<SettingItem name={t("choiceBuilder.templateForm.headingTemplate")} heading />

<LabeledField
	name={t("choiceBuilder.templateForm.templatePath")}
	desc={t("choiceBuilder.templateForm.templatePathDesc")}
>
	{#snippet children(id)}
		<ValidatedInput
			{id}
			value={choice.templatePath}
			placeholder={t("choiceBuilder.placeholder.templatePath")}
			{app}
			suggestions={templatePaths}
			maxSuggestions={50}
			validator={validateTemplatePath}
			onChange={(value) => (choice.templatePath = value.trim())}
		/>
	{/snippet}
</LabeledField>

<LabeledField
	name={t("choiceBuilder.templateForm.fileNameFormat")}
	desc={t("choiceBuilder.templateForm.fileNameFormatDesc")}
	bodyVisible={choice.fileNameFormat.enabled}
>
	{#snippet control()}
		<Toggle bind:checked={choice.fileNameFormat.enabled} />
	{/snippet}
	{#snippet children(id)}
		<ValidatedInput
			{id}
			bind:value={choice.fileNameFormat.format}
			placeholder={t("choiceBuilder.placeholder.fileNameFormat")}
			makeSuggesters={fileNameSuggesters}
		/>
		<FormatTokenHint value={choice.fileNameFormat.format} />
		<FormatPreviewField
			value={choice.fileNameFormat.format}
			formatterKind="fileName"
			targetFolderPath={likelyTargetFolderPath(choice.folder)}
			{app}
			{plugin}
		/>
	{/snippet}
</LabeledField>

<SettingItem name={t("choiceBuilder.templateForm.headingLocation")} heading />

<SettingItem name={t("choiceBuilder.templateForm.newNoteLocation")} desc={folderModeDesc}>
	{#snippet control()}
		<Dropdown
			value={folderMode}
			options={folderModeOptions()}
			ariaLabel={t("choiceBuilder.templateForm.newNoteLocation")}
			onchange={onFolderModeChange}
		/>
	{/snippet}
</SettingItem>

{#if folderMode === "specified"}
	<div class="folderSelectionContainer">
		<div class="folderList">
			<FolderList
				folders={choice.folder.folders}
				onChange={(next) => (choice.folder.folders = next)}
			/>
		</div>
		<div class="folderInputContainer">
			<input
				type="text"
				class="qa-folder-path-input"
				placeholder={t("choiceBuilder.placeholder.folderPath")}
				aria-label={t("choiceBuilder.placeholder.folderPath")}
				bind:value={folderInputValue}
				onkeypress={onFolderInputKeypress}
				use:suggester={attachFolderSuggester}
			/>
			<button type="button" class="mod-cta" onclick={addFolder}>{t("common.add")}</button>
		</div>
	</div>

	{#if needsFolderList}
		<div class="qa-folder-mode-warning">
			{t("choiceBuilder.templateForm.emptyFolderListWarning")}
		</div>
	{/if}

	<SettingItem
		name={t("choiceBuilder.templateForm.includeSubfolders")}
		desc={t("choiceBuilder.templateForm.includeSubfoldersDesc")}
	>
		{#snippet control()}
			<Toggle bind:checked={choice.folder.chooseFromSubfolders} />
		{/snippet}
	</SettingItem>
{/if}

<SettingItem name={t("choiceBuilder.templateForm.headingLinking")} heading />
<AppendLinkSetting bind:appendLink={choice.appendLink} fileLabel="created" {app} />
<SettingItem
	name={t("choiceBuilder.templateForm.copyLinkToClipboard")}
	desc={t("choiceBuilder.templateForm.copyLinkToClipboardDesc")}
>
	{#snippet control()}
		<Toggle
			checked={choice.copyLinkToClipboard ?? false}
			onchange={(value) => (choice.copyLinkToClipboard = value)}
		/>
	{/snippet}
</SettingItem>

<SettingItem name={t("choiceBuilder.templateForm.headingBehavior")} heading />

<SettingItem
	name={t("choiceBuilder.templateForm.searchExisting")}
	desc={discoveryDescription}
>
	{#snippet control()}
		<!-- When discovery is unsupported (custom file-name format) the engine
		     ignores the stored flag, so show the toggle as off to match the
		     runtime behavior rather than a misleading checked-but-greyed state. -->
		<Toggle
			checked={discoverySupported
				? (choice.discoverExistingNotesBeforeCreate ?? false)
				: false}
			disabled={!discoverySupported}
			onchange={(value) => (choice.discoverExistingNotesBeforeCreate = value)}
		/>
	{/snippet}
</SettingItem>

{#if discoverySupported && choice.discoverExistingNotesBeforeCreate}
	<SettingItem name={t("choiceBuilder.templateForm.whenSelectingExisting")}>
		{#snippet control()}
			<Dropdown
				value={choice.existingNoteAction ?? "open"}
				options={existingNoteActions.map((action) => ({ value: action.id, label: action.label }))}
				onchange={(value) => {
					const action = existingNoteActions.find((action) => action.id === value);
					if (action) choice.existingNoteAction = action.id;
				}}
			/>
		{/snippet}
	</SettingItem>
{/if}

<SettingItem
	name={discoverySupported && choice.discoverExistingNotesBeforeCreate
		? t("choiceBuilder.templateForm.ifNewNotePathExists")
		: t("choiceBuilder.templateForm.ifTargetFileExists")}
	desc={t("choiceBuilder.templateForm.fileExistsDesc")}
>
	{#snippet control()}
		<Dropdown
			value={behaviorCategory}
			options={fileExistsBehaviorCategoryOptions.map((o) => ({
				value: o.id,
				label: o.label,
			}))}
			onchange={onCategoryChange}
		/>
	{/snippet}
</SettingItem>

{#if showModeRow}
	<SettingItem
		name={behaviorCategory === "update" ? t("choiceBuilder.templateForm.updateAction") : t("choiceBuilder.templateForm.newFileNaming")}
		desc={getFileExistsMode(selectedMode).description}
	>
		{#snippet control()}
			<Dropdown
				value={selectedMode}
				options={modeOptions.map((mode) => ({
					value: mode.id,
					label: mode.label,
				}))}
				onchange={onModeChange}
			/>
		{/snippet}
	</SettingItem>
{/if}

<OpenFileSetting bind:openFile={choice.openFile} description={t("choiceBuilder.templateForm.openFileDesc")} />
{#if choice.openFile}
	<FileOpeningSetting bind:fileOpening={choice.fileOpening} contextLabel="created" />
{/if}

<DateOriginSetting bind:dateOrigin={choice.dateOrigin} />

<OnePageOverrideSetting bind:onePageInput={choice.onePageInput} />

<CommandPaletteSetting
	bind:command={choice.command}
	bind:pickDayCommand={choice.pickDayCommand}
	name={choice.name}
	dateOrigin={choice.dateOrigin}
/>

<ChoiceIconSetting bind:icon={choice.icon} type={choice.type} {app} />
