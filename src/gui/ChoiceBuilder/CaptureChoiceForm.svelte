<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { getTemplateFile } from "../../utils/templateFolderUtils";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { t } from "../../i18n";
import SettingItem from "../components/SettingItem.svelte";
import SettingGroup from "../components/SettingGroup.svelte";
import Toggle from "../components/Toggle.svelte";
import Dropdown from "../components/Dropdown.svelte";
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
import CaptureTargetSetting from "./components/CaptureTargetSetting.svelte";
import WritePositionSetting from "./components/WritePositionSetting.svelte";
import ChoiceIconSetting from "./components/ChoiceIconSetting.svelte";

/**
 * Reactive replacement for CaptureChoiceBuilder.display(). Every conditional row
 * (capture target, create-if-missing, write position + insert-after/before fields,
 * append link, file opening) is an {#if} over the $state choice proxy, so toggling
 * a control updates in place — no contentEl.empty()/display() teardown (#1130).
 */
let {
	choice = $bindable(),
	app,
	plugin,
}: {
	choice: ICaptureChoice;
	app: App;
	plugin: QuickAdd;
} = $props();

const templateFilePaths = $derived(
	plugin.getTemplateFiles().map((f) => f.path),
);
const formatSuggestContext = $derived(choice.propertyCapture ? "propertyValue" : "noteContent");
// Upstream's `choice.propertyCapture?.action` assumed a single object; the
// multi-property fork stores an array, so read the FIRST row's action instead.
const captureFormatPlaceholder = $derived.by(() => {
	const setting = choice.propertyCapture;
	const first = Array.isArray(setting) ? setting[0] : setting;
	return first?.action === "addToList"
		? t("choiceBuilder.placeholder.oneItemPerLine")
		: t("choiceBuilder.placeholder.format");
});
const formatSuggesters = $derived.by(() => {
	const context = formatSuggestContext;
	return [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, context),
	];
});

function validateTemplate(
	raw: string,
): boolean | string | { valid: boolean; message?: string } {
	const value = raw.trim();
	if (!value) return true;
	// A path with format syntax (e.g. "Templates/{{value:type}} Template.md")
	// only resolves when the capture runs, so show a neutral hint rather than
	// flagging it "not found" (issue #620).
	if (hasTemplatePathSyntax(value)) {
		return { valid: true, message: t("choiceBuilder.captureForm.templateFormatSyntaxHint") };
	}
	// Resolve like the engine does at run time rather than requiring
	// suggestion-list membership (templates outside the configured folders are
	// valid). Mirrors templateChoiceBuilder (master #1170/#1325).
	return getTemplateFile(app, value) !== null || t("choiceBuilder.captureForm.templateNotFound");
}

// An empty format captures {{VALUE}} on its own; `enabled` just mirrors whether
// there is text, so choices saved with the old toggle keep working.
const captureFormat = $derived(choice.format.enabled ? choice.format.format : "");

const selectionOptions = [
	{ value: "", label: t("choiceBuilder.captureForm.selectionFollowGlobal") },
	{ value: "enabled", label: t("choiceBuilder.captureForm.selectionUse") },
	{ value: "disabled", label: t("choiceBuilder.captureForm.selectionIgnore") },
];
const selectionOverride = $derived(
	typeof choice.useSelectionAsCaptureValue === "boolean"
		? choice.useSelectionAsCaptureValue
			? "enabled"
			: "disabled"
		: "",
);

function onSelectionChange(value: string) {
	if (value === "") {
		choice.useSelectionAsCaptureValue = undefined;
		return;
	}
	choice.useSelectionAsCaptureValue = value === "enabled";
}

function onTemplaterAfterCaptureChange(value: boolean) {
	if (!choice.templater) choice.templater = {};
	choice.templater.afterCapture = value ? "wholeFile" : "none";
}
</script>

<SettingGroup heading={t("choiceBuilder.captureForm.headingLocation")}>
	<CaptureTargetSetting bind:choice {app} {plugin} />

	{#if !choice.captureToActiveFile}
		<SettingItem name={t("choiceBuilder.captureForm.createFileIfMissing")}>
			{#snippet control()}
				<Toggle bind:checked={choice.createFileIfItDoesntExist.enabled} />
			{/snippet}
		</SettingItem>

		{#if choice.createFileIfItDoesntExist.enabled}
			<LabeledField
				name={t("choiceBuilder.captureForm.createWithTemplate")}
				desc={t("choiceBuilder.captureForm.createWithTemplateDesc")}
				bodyVisible={choice.createFileIfItDoesntExist.createWithTemplate}
			>
				{#snippet control()}
					<Toggle
						bind:checked={choice.createFileIfItDoesntExist.createWithTemplate}
					/>
				{/snippet}
				{#snippet children(id)}
					<ValidatedInput
						{id}
						value={choice.createFileIfItDoesntExist.template}
						placeholder={t("choiceBuilder.templateForm.templatePath")}
						{app}
						suggestions={templateFilePaths}
						maxSuggestions={50}
						validator={validateTemplate}
						onChange={(value) =>
							(choice.createFileIfItDoesntExist.template = value.trim())}
					/>
				{/snippet}
			</LabeledField>
		{/if}
	{/if}
</SettingGroup>

<SettingGroup heading={t("choiceBuilder.captureForm.headingPosition")}>
	<WritePositionSetting bind:choice {app} {plugin} />
</SettingGroup>

<SettingGroup heading={t("choiceBuilder.captureForm.headingLinking")}>
	<AppendLinkSetting bind:appendLink={choice.appendLink} fileLabel="captured" {app} />
	<SettingItem
		name={t("choiceBuilder.captureForm.copyLinkToClipboard")}
		desc={t("choiceBuilder.captureForm.copyLinkToClipboardDesc")}
	>
		{#snippet control()}
			<Toggle
				checked={choice.copyLinkToClipboard ?? false}
				onchange={(value) => (choice.copyLinkToClipboard = value)}
			/>
		{/snippet}
	</SettingItem>
</SettingGroup>

<SettingGroup heading={t("choiceBuilder.captureForm.headingContent")}>
	{#if !choice.propertyCapture}
	<SettingItem name={t("choiceBuilder.captureForm.task")} desc={t("choiceBuilder.captureForm.taskDesc")}>
		{#snippet control()}
			<Toggle bind:checked={choice.task} />
		{/snippet}
	</SettingItem>
	<SettingItem
		name={t("choiceBuilder.captureForm.eachLine")}
		desc={t("choiceBuilder.captureForm.eachLineDesc")}
	>
		{#snippet control()}
			<Toggle
				checked={choice.eachLine ?? false}
				onchange={(value) => (choice.eachLine = value)}
			/>
		{/snippet}
	</SettingItem>
	{/if}

	<LabeledField
		name={t("choiceBuilder.captureForm.captureFormat")}
		desc={t("choiceBuilder.captureForm.captureFormatDesc")}
	>
		{#snippet children(id)}
			{#key formatSuggestContext}
				<ValidatedInput
					{id}
					inputKind="textarea"
					bind:value={
						() => captureFormat,
						(value) => (choice.format = { enabled: value.trim() !== "", format: value })
					}
					placeholder={captureFormatPlaceholder}
					makeSuggesters={formatSuggesters}
				/>
			{/key}
			<FormatTokenHint value={captureFormat} />
			<FormatPreviewField value={captureFormat} {app} {plugin} />
		{/snippet}
	</LabeledField>
</SettingGroup>

<SettingGroup heading={t("choiceBuilder.captureForm.headingBehavior")}>
	{#if !choice.captureToActiveFile}
		<OpenFileSetting bind:openFile={choice.openFile} description={t("choiceBuilder.captureForm.openFileDesc")} />
		{#if choice.openFile}
			<FileOpeningSetting bind:fileOpening={choice.fileOpening} contextLabel="captured" />
		{/if}
	{/if}

	<SettingItem
		name={t("choiceBuilder.captureForm.editorSelection")}
		desc={t("choiceBuilder.captureForm.editorSelectionDesc")}
	>
		{#snippet control()}
			<Dropdown
				value={selectionOverride}
				options={selectionOptions}
				onchange={onSelectionChange}
			/>
		{/snippet}
	</SettingItem>

	<!-- Deprecated (#2014): shown only to choices that already have it on, so they
	     can turn it off. -->
	{#if !choice.propertyCapture && choice.templater?.afterCapture === "wholeFile"}
	<SettingItem
		name={t("choiceBuilder.captureForm.templaterAfterCaptureDeprecated")}
		desc={t("choiceBuilder.captureForm.templaterAfterCaptureDeprecatedDesc")}
	>
		{#snippet control()}
			<Toggle
				checked={choice.templater?.afterCapture === "wholeFile"}
				onchange={onTemplaterAfterCaptureChange}
			/>
		{/snippet}
	</SettingItem>
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
</SettingGroup>
