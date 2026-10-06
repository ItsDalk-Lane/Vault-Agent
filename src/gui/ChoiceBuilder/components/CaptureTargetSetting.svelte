<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import { getAllFolderPathsInVault } from "../../../utils/vaultQueries";
import { sortFolderPathsByTree } from "../../../utils/folder-sorting";
import { FormatSyntaxSuggester } from "../../suggesters/formatSyntaxSuggester";
import { isCanvasTargetPath, normalizeVaultPath } from "../canvasNodes";
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import LabeledField from "./LabeledField.svelte";
import { t } from "../../../i18n";
import FormatPreviewField from "./FormatPreviewField.svelte";
import FormatTokenHint from "./FormatTokenHint.svelte";
import CanvasNodePicker from "./CanvasNodePicker.svelte";
import { getCaptureTargetFeedback } from "./captureTargetFeedback";

/** Reactive port of captureChoiceBuilder.addCapturedToSetting. */
let {
	choice = $bindable(),
	app,
	plugin,
}: {
	choice: ICaptureChoice;
	app: App;
	plugin: QuickAdd;
} = $props();

const captureTargetSuggestions = $derived.by(() => {
	const folderPaths = sortFolderPathsByTree(getAllFolderPathsInVault(app))
		.filter((folderPath) => folderPath.length > 0)
		.map((folderPath) =>
			folderPath.endsWith("/") ? folderPath : folderPath + "/",
		);
	const markdownPaths = app.vault.getMarkdownFiles().map((file) => file.path);
	const canvasPaths = app.vault
		.getFiles()
		.filter((file) => file.extension === "canvas")
		.map((file) => file.path);
	// Paths only. Format tokens used to be mixed in here too, which put a second
	// suggester's undescribed, differently-cased copy of the token list on the
	// same input as FormatSyntaxSuggester: two stacked popups for one language,
	// and the generic one replaces the whole field on accept (#1542).
	return Array.from(new Set([...folderPaths, ...markdownPaths, ...canvasPaths]));
});

const suggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, "captureTarget"),
];

const captureTargetFeedback = $derived.by(() =>
	getCaptureTargetFeedback(choice.captureTo ?? ""),
);
// Filter/property targets are not paths, so showing the file-name format preview
// would render a misleading fake path.
const usesPickerTargetSyntax = $derived(captureTargetFeedback !== null);
// The same question, asked of the RESOLVED text. The gate above reads the raw
// field, but the run resolves the target's format tokens BEFORE parsing it
// (CaptureChoiceEngine formats captureTo, then resolveCaptureTarget), so a
// target written as `{{GLOBAL_VAR:inbox}}` that expands to `property:type=draft`
// passes the raw gate and then gets previewed as a path - complete with #1578's
// "cannot contain a colon" error for a capture that runs perfectly well.
const isPickerTargetSyntax = (resolved: string) =>
	getCaptureTargetFeedback(resolved) !== null;
// Exclude picker syntax from canvas detection so a contrived value like
// `property:type=foo.canvas` never offers the (meaningless) canvas-node picker.
const isCanvasTarget = $derived(
	!usesPickerTargetSyntax && isCanvasTargetPath(choice.captureTo),
);

function onCaptureToActiveFileChange(value: boolean) {
	// Read the prior state BEFORE mutating (one-way toggle, not bind).
	const wasActiveBottomMode =
		!!choice.captureToActiveFile &&
		choice.activeFileWritePosition === "bottom";

	choice.captureToActiveFile = value;

	if (!value && wasActiveBottomMode) {
		choice.prepend = true;
	}
	// New-line capture is only valid for active-file capture.
	if (!value && choice.newLineCapture?.enabled) {
		choice.newLineCapture.enabled = false;
	}
}

function onCaptureToChange(value: string) {
	const previousCanvasPath = normalizeVaultPath(choice.captureTo);
	const wasCanvasTarget = isCanvasTargetPath(choice.captureTo);
	const nextUsesPickerTargetSyntax = getCaptureTargetFeedback(value) !== null;
	choice.captureTo = value;
	const nextCanvasPath = normalizeVaultPath(value);
	const nextIsCanvasTarget = isCanvasTargetPath(value);
	const canvasPathChanged =
		wasCanvasTarget &&
		nextIsCanvasTarget &&
		previousCanvasPath !== nextCanvasPath;

	if (nextUsesPickerTargetSyntax || !nextIsCanvasTarget || canvasPathChanged) {
		choice.captureToCanvasNodeId = "";
	}
}

const DAILY_NOTE_TARGET = "{{DAILY}}";

// Shortcut for the most common target (#2023): the daily note, created from
// the daily notes template when it doesn't exist yet.
function useDailyNote() {
	onCaptureToChange(DAILY_NOTE_TARGET);
	choice.createFileIfItDoesntExist = {
		...choice.createFileIfItDoesntExist,
		enabled: true,
		createWithTemplate: false,
	};
}

function validateCaptureTo(value: string) {
	const feedback = getCaptureTargetFeedback(value);
	if (!feedback) {
		// An empty target is a supported mode, not an omission: it resolves to the
		// vault-wide note picker at run time (resolveCaptureTarget -> "vault"). Say
		// so, rather than leaving a blank field looking unfinished.
		if (!value.trim()) {
			return {
				valid: true,
				message: t("choiceBuilder.captureTarget.emptyTargetHint"),
			};
		}
		return true;
	}

	return {
		valid: feedback.valid,
		message: feedback.message,
		variant: feedback.valid ? ("success" as const) : undefined,
	};
}
</script>

<SettingItem
	name={t("choiceBuilder.captureTarget.toActiveFile")}
	desc={t("choiceBuilder.captureTarget.toActiveFileDesc")}
>
	{#snippet control()}
		<Toggle
			checked={choice.captureToActiveFile}
			onchange={onCaptureToActiveFileChange}
		/>
	{/snippet}
</SettingItem>

{#if !choice.captureToActiveFile}
	<LabeledField
		name={t("choiceBuilder.captureTarget.captureTo")}
		desc={t("choiceBuilder.captureTarget.captureToDesc")}
	>
		{#snippet control()}
			{#if (choice.captureTo ?? "").trim() !== DAILY_NOTE_TARGET}
				<button type="button" onclick={useDailyNote}>{t("choiceBuilder.captureTarget.dailyNoteButton")}</button>
			{/if}
		{/snippet}
		{#snippet children(id)}
			<ValidatedInput
				{id}
				value={choice.captureTo}
				placeholder={"Daily/{{DATE}}.md"}
				{app}
				suggestions={captureTargetSuggestions}
				maxSuggestions={50}
				makeSuggesters={suggesters}
				validator={validateCaptureTo}
				onChange={onCaptureToChange}
			/>
			<FormatTokenHint value={choice.captureTo} />
			{#if !usesPickerTargetSyntax}
				<FormatPreviewField
					value={choice.captureTo}
					formatterKind="fileName"
					{app}
					{plugin}
					hideWhen={isPickerTargetSyntax}
				/>
			{/if}
		{/snippet}
	</LabeledField>

	{#if isCanvasTarget}
		<SettingItem
			name={t("choiceBuilder.captureTarget.targetCanvasNode")}
			desc={t("choiceBuilder.captureTarget.targetCanvasNodeDesc")}
		>
			{#snippet control()}
				<ValidatedInput
					value={choice.captureToCanvasNodeId ?? ""}
					placeholder={t("choiceBuilder.placeholder.canvasNodeId")}
					ariaLabel={t("choiceBuilder.placeholder.canvasNodeId")}
					required
					requiredMessage={t("choiceBuilder.captureTarget.canvasNodeIdRequired")}
					onChange={(value) => (choice.captureToCanvasNodeId = value.trim())}
				/>
			{/snippet}
		</SettingItem>

		<div class="qa-canvas-node-helper">
			{t("choiceBuilder.captureTarget.canvasTip")}
		</div>

		{#key choice.captureTo}
			<CanvasNodePicker
				bind:nodeId={choice.captureToCanvasNodeId}
				canvasTargetPath={choice.captureTo}
				{app}
			/>
		{/key}
	{/if}
{/if}
