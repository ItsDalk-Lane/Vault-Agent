<script lang="ts">
import type { App } from "obsidian";
import { FileView } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import { isCanvasTargetPath } from "../canvasNodes";
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import InsertAfterFields from "./InsertAfterFields.svelte";
import InsertBeforeFields from "./InsertBeforeFields.svelte";
import PropertyCaptureList from "./PropertyCaptureList.svelte";
import { hasPropertyCapture, setPropertyCaptures } from "../../../types/choices/ICaptureChoice";
import { getWritePosition } from "../../../engine/captureAction";
import { t } from "../../../i18n";

/**
 * Reactive port of captureChoiceBuilder.addWritePositionSetting. The write-position
 * dropdown derives its value from the precedence ladder and, on change, zeroes all
 * mutually-exclusive position flags before setting the chosen one — exactly as the
 * imperative onChange did, but the dependent fields render via {#if} (no reload()).
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

const isActiveFile = $derived(!!choice.captureToActiveFile);

const current = $derived(getWritePosition(choice));

const options = $derived([
	{ value: "top", label: isActiveFile ? t("choiceBuilder.writePosition.optionCursor") : t("choiceBuilder.writePosition.optionTop") },
	...(isActiveFile
		? [
				{ value: "activeTop", label: t("choiceBuilder.writePosition.optionActiveTop") },
				{ value: "newLineAbove", label: t("choiceBuilder.writePosition.optionNewLineAbove") },
				{ value: "newLineBelow", label: t("choiceBuilder.writePosition.optionNewLineBelow") },
			]
		: []),
	{ value: "after", label: t("choiceBuilder.writePosition.optionAfter") },
	{ value: "before", label: t("choiceBuilder.writePosition.optionBefore") },
	{ value: "bottom", label: t("choiceBuilder.writePosition.optionBottom") },
	{ value: "property", label: t("choiceBuilder.writePosition.optionProperty") },
]);

function onWritePositionChange(value: string) {
	if (value === "property") {
		if (!hasPropertyCapture(choice)) {
			// A fresh property capture starts as a single canonical row; the
			// per-row value falls back to the capture format until a valueFormat
			// is typed (no valueFormat on the persisted object).
			setPropertyCaptures(choice, [
				{
					property: { kind: "named", format: "" },
					action: "set",
					createIfMissing: true,
					sort: "none",
				},
			]);
		}
		return;
	}
	setPropertyCaptures(choice, []);
	// Reset every mutually-exclusive position flag, then set the chosen one
	// (verbatim order from the imperative builder, captureChoiceBuilder.ts:941-999).
	choice.prepend = false;
	choice.insertAfter.enabled = false;
	// Leaving insert-after mode clears its sub-flags so the persisted config stays
	// clean. promptHeading (the "Choose heading when capturing" toggle) and
	// inline/replaceExisting are properties of "After line…"; re-selecting it starts
	// from the plain typed-target default and the user opts back into heading mode via
	// the toggle. Existing heading-mode choices load as "After line…" with the toggle on
	// (this handler only runs on an explicit dropdown change, not on load).
	choice.insertAfter.promptHeading = false;
	choice.insertAfter.inline = false;
	choice.insertAfter.replaceExisting = false;
	if (!choice.insertBefore)
		choice.insertBefore = {
			enabled: false,
			before: "",
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
		};
	choice.insertBefore.enabled = false;
	if (!choice.newLineCapture)
		choice.newLineCapture = { enabled: false, direction: "below" };
	choice.newLineCapture.enabled = false;
	choice.activeFileWritePosition = "cursor";

	if (value === "top") {
		if (!isActiveFile) choice.prepend = false;
		return;
	}
	if (value === "activeTop") {
		if (isActiveFile) choice.activeFileWritePosition = "top";
		return;
	}
	if (value === "bottom") {
		if (isActiveFile) choice.activeFileWritePosition = "bottom";
		else choice.prepend = true;
		return;
	}
	if (value === "newLineAbove") {
		choice.newLineCapture.enabled = true;
		choice.newLineCapture.direction = "above";
		return;
	}
	if (value === "newLineBelow") {
		choice.newLineCapture.enabled = true;
		choice.newLineCapture.direction = "below";
		return;
	}
	if (value === "before") {
		choice.insertBefore.enabled = true;
		return;
	}
	choice.insertAfter.enabled = true;
}

const showCanvasNotice = $derived.by(() => {
	if (hasPropertyCapture(choice)) return false;
	const obviousCanvasTarget =
		typeof choice.captureTo === "string" && isCanvasTargetPath(choice.captureTo);
	const hasActiveCanvasView =
		app.workspace.getActiveViewOfType(FileView)?.getViewType() === "canvas";
	const usesCursorMode =
		isActiveFile &&
		!choice.insertAfter.enabled &&
		!choice.insertBefore?.enabled &&
		!choice.newLineCapture?.enabled &&
		(choice.activeFileWritePosition ?? "cursor") === "cursor" &&
		!choice.prepend;
	const usesUnsupportedCanvasMode =
		choice.newLineCapture?.enabled || usesCursorMode;
	if (!usesUnsupportedCanvasMode) return false;
	if (isActiveFile ? !hasActiveCanvasView : !obviousCanvasTarget) return false;
	return true;
});
</script>

<SettingItem
	name={t("choiceBuilder.writePosition.label")}
	desc={isActiveFile
		? t("choiceBuilder.writePosition.descActiveFile")
		: t("choiceBuilder.writePosition.descTargetFile")}
>
	{#snippet control()}
		<Dropdown value={current} {options} onchange={onWritePositionChange} />
	{/snippet}
</SettingItem>

{#if hasPropertyCapture(choice)}
	<PropertyCaptureList {choice} {app} {plugin} captureFormat={choice.format.enabled ? choice.format.format : ""} />
{/if}

{#if !hasPropertyCapture(choice) && choice.insertAfter.enabled}
	<InsertAfterFields bind:insertAfter={choice.insertAfter} {app} {plugin} />
{/if}

{#if !hasPropertyCapture(choice) && choice.insertBefore?.enabled}
	<InsertBeforeFields bind:insertBefore={choice.insertBefore} {app} {plugin} />
{/if}

{#if showCanvasNotice}
	<div class="setting-item-description">
		{t("choiceBuilder.writePosition.canvasNotice")}
	</div>
{/if}
