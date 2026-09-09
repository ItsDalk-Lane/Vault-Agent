<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type { PropertyCapture } from "../../../types/choices/ICaptureChoice";
import { FormatSyntaxSuggester } from "../../suggesters/formatSyntaxSuggester";
import IconButton from "../../components/IconButton.svelte";
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import Toggle from "../../components/Toggle.svelte";
import LabeledField from "./LabeledField.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import { t } from "../../../i18n";

// Plain prop, NOT $bindable: the list passes each row's proxy object and this
// component only mutates config's PROPERTIES (kind/action/...) — never
// reassigns config itself — so deep writes land on choice.propertyCapture.
let { config, app, plugin, index, single, fallbackFormat = "", onremove }: {
	config: PropertyCapture;
	app: App;
	plugin: QuickAdd;
	/** 0-based row position in the multi-property list; omit for a single row. */
	index?: number;
	/** Legacy single-row mode: the property label stays exactly "Property". */
	single?: boolean;
	/** Shown as the value-format placeholder: the format this row falls back to. */
	fallbackFormat?: string;
	/** When set, the property row carries a delete button (list-managed rows). */
	onremove?: (() => void) | undefined;
} = $props();

const suggesters = [(el: HTMLInputElement | HTMLTextAreaElement) => new FormatSyntaxSuggester(app, el, plugin)];
let lastNamedFormat = "";

// Collapse state is per-row and intentionally NOT persisted: the list keys each
// card by the row object, so a row keeps its open/closed state across sibling
// add/remove while every fresh choice starts expanded.
let collapsed = $state(false);

// No binding + effect round-trip here: config.valueFormat is undefined for
// legacy rows (empty means "fall back to the capture format"), and an effect
// mirroring draft ↔ config would fight itself — every keystroke resets the
// draft because config.valueFormat is still one flush behind. Instead the
// input is a plain controlled value and onChange is the only writer.
function applyValueFormat(next: string) {
	config.valueFormat = next.trim() === "" ? undefined : next;
}

// Multi-row lists need unique labels (getByLabelText), while the single-row
// card keeps the plain "Property" label the existing tests assert on. A row
// with a typed property name wears THAT name as its title (the collapse
// summary for free); only nameless rows — including "choose when capturing"
// — fall back to the numbered "Property N" label.
const propertyLabel = $derived.by(() => {
	if (config.property.kind === "named" && config.property.format.trim()) {
		return config.property.format.trim();
	}
	return single || index === undefined
		? t("choiceBuilder.propertyCapture.property")
		: `${t("choiceBuilder.propertyCapture.property")} ${index + 1}`;
});

// Clicking anywhere in the name area toggles collapse (preventDefault stops
// the expanded row's `<label for>` from ALSO focusing the property input).
function toggleCollapse(event: MouseEvent) {
	event.preventDefault();
	collapsed = !collapsed;
}
</script>

<LabeledField name={propertyLabel} bodyVisible={config.property.kind === "named" && !collapsed} onNameClick={toggleCollapse}>
	{#snippet control()}
		<IconButton
			iconId={collapsed ? "chevron-right" : "chevron-down"}
			label={collapsed ? t("choiceBuilder.propertyCapture.expandRow") : t("choiceBuilder.propertyCapture.collapseRow")}
			onclick={() => { collapsed = !collapsed; }}
		/>
		<Dropdown value={config.property.kind}
			options={[{ value: "named", label: t("choiceBuilder.propertyCapture.kindNamed") }, { value: "prompt", label: t("choiceBuilder.propertyCapture.kindPrompt") }]}
			onchange={(value) => {
				if (config.property.kind === "named") lastNamedFormat = config.property.format;
				config.property = value === "prompt" ? { kind: "prompt" } : { kind: "named", format: lastNamedFormat };
			}} />
		{#if onremove}
			<IconButton
				iconId="trash-2"
				label={t("choiceBuilder.propertyCapture.removeRow")}
				onclick={onremove}
				extraClass="qa-property-capture-remove"
			/>
		{/if}
	{/snippet}
	{#snippet children(id)}
		{#if config.property.kind === "named"}
			<ValidatedInput {id} bind:value={config.property.format} placeholder={t("choiceBuilder.placeholder.propertyName")}
				required requiredMessage={t("choiceBuilder.propertyCapture.propertyNameRequired")} makeSuggesters={suggesters} />
		{/if}
	{/snippet}
</LabeledField>

{#if !collapsed}
	<LabeledField name={t("choiceBuilder.propertyCapture.valueFormat")} bodyVisible={true}>
		{#snippet children(id)}
			<ValidatedInput {id} value={config.valueFormat ?? ""} placeholder={fallbackFormat}
				onChange={applyValueFormat} makeSuggesters={suggesters} />
		{/snippet}
	</LabeledField>
	<p class="qa-property-capture-value-format-desc">{t("choiceBuilder.propertyCapture.valueFormatDesc")}</p>

	<SettingItem name={t("choiceBuilder.propertyCapture.action")} desc={config.action === "addToList"
		? t("choiceBuilder.propertyCapture.actionDescAddToList")
		: t("choiceBuilder.propertyCapture.actionDescSet")}>
		{#snippet control()}
			<Dropdown value={config.action}
				options={[{ value: "set", label: t("choiceBuilder.propertyCapture.actionSet") }, { value: "addToList", label: t("choiceBuilder.propertyCapture.actionAddToList") }]}
				onchange={(value) => { config.action = value === "addToList" ? "addToList" : "set"; }} />
		{/snippet}
	</SettingItem>

	<SettingItem name={t("choiceBuilder.propertyCapture.createIfMissing")}>
		{#snippet control()}
			<Toggle bind:checked={config.createIfMissing} />
		{/snippet}
	</SettingItem>
{/if}

<style>
	.qa-property-capture-value-format-desc {
		margin: -0.4rem 0 0.6rem;
		color: var(--text-muted);
		font-size: 0.85em;
	}
</style>
