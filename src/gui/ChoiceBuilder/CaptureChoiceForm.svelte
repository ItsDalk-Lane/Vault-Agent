<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { hasPropertyCapture } from "../../types/choices/ICaptureChoice";
import { getTemplateFile } from "../../utilityObsidian";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { t } from "../../i18n";
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
const formatSuggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin),
];

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

<ChoiceNameHeader bind:name={choice.name} {app} />

<SettingItem name={t("choiceBuilder.captureForm.headingLocation")} heading />
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
					placeholder={t("choiceBuilder.placeholder.templatePath")}
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

<SettingItem name={t("choiceBuilder.captureForm.headingPosition")} heading />
<WritePositionSetting bind:choice {app} {plugin} />

<SettingItem name={t("choiceBuilder.captureForm.headingLinking")} heading />
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

<SettingItem name={t("choiceBuilder.captureForm.headingContent")} heading />
{#if !hasPropertyCapture(choice)}
<SettingItem name={t("choiceBuilder.captureForm.task")} desc={t("choiceBuilder.captureForm.taskDesc")}>
	{#snippet control()}
		<Toggle bind:checked={choice.task} />
	{/snippet}
</SettingItem>
{/if}

<LabeledField
	name={t("choiceBuilder.captureForm.captureFormat")}
	desc={t("choiceBuilder.captureForm.captureFormatDesc")}
	bodyVisible={choice.format.enabled}
>
	{#snippet control()}
		<Toggle bind:checked={choice.format.enabled} />
	{/snippet}
	{#snippet children(id)}
		<ValidatedInput
			{id}
			inputKind="textarea"
			bind:value={choice.format.format}
			placeholder={t("choiceBuilder.placeholder.format")}
			required
			requiredMessage={t("choiceBuilder.captureForm.captureFormatRequired")}
			makeSuggesters={formatSuggesters}
		/>
		<FormatTokenHint value={choice.format.format} />
		<FormatPreviewField value={choice.format.format} {app} {plugin} />
	{/snippet}
</LabeledField>

<SettingItem name={t("choiceBuilder.captureForm.headingBehavior")} heading />
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

{#if !hasPropertyCapture(choice)}
<SettingItem
	name={t("choiceBuilder.captureForm.templaterAfterCapture")}
	desc={t("choiceBuilder.captureForm.templaterAfterCaptureDesc")}
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
