<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type { PropertyCapture } from "../../../types/choices/ICaptureChoice";
import { FormatSyntaxSuggester } from "../../suggesters/formatSyntaxSuggester";
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import Toggle from "../../components/Toggle.svelte";
import LabeledField from "./LabeledField.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import { t } from "../../../i18n";

// Plain prop, NOT $bindable: the list passes each row's proxy object and this
// component only mutates config's PROPERTIES (kind/action/...) — never
// reassigns config itself — so deep writes land on choice.propertyCapture.
let { config, app, plugin, index, single, fallbackFormat = "" }: {
	config: PropertyCapture;
	app: App;
	plugin: QuickAdd;
	/** 0-based row position in the multi-property list; omit for a single row. */
	index?: number;
	/** Legacy single-row mode: the property label stays exactly "Property". */
	single?: boolean;
	/** Shown as the value-format placeholder: the format this row falls back to. */
	fallbackFormat?: string;
} = $props();

const suggesters = [(el: HTMLInputElement | HTMLTextAreaElement) => new FormatSyntaxSuggester(app, el, plugin)];
let lastNamedFormat = "";

// Local mirror for the optional valueFormat: ValidatedInput binds a string, but
// config.valueFormat is undefined for legacy rows (empty means "fall back to
// the capture format"), and binding undefined to a $bindable("") throws.
let valueFormatDraft = $state("");
$effect(() => {
	const stored = config.valueFormat;
	if ((stored ?? "") !== valueFormatDraft) valueFormatDraft = stored ?? "";
});
$effect(() => {
	config.valueFormat = valueFormatDraft.trim() === "" ? undefined : valueFormatDraft;
});

// Multi-row lists need unique labels (getByLabelText), while the single-row
// card keeps the plain "Property" label the existing tests assert on.
const propertyLabel = $derived(
	single || index === undefined
		? t("choiceBuilder.propertyCapture.property")
		: `${t("choiceBuilder.propertyCapture.property")} ${index + 1}`,
);
</script>

<LabeledField name={propertyLabel} bodyVisible={config.property.kind === "named"}>
	{#snippet control()}
		<Dropdown value={config.property.kind}
			options={[{ value: "named", label: t("choiceBuilder.propertyCapture.kindNamed") }, { value: "prompt", label: t("choiceBuilder.propertyCapture.kindPrompt") }]}
			onchange={(value) => {
				if (config.property.kind === "named") lastNamedFormat = config.property.format;
				config.property = value === "prompt" ? { kind: "prompt" } : { kind: "named", format: lastNamedFormat };
			}} />
	{/snippet}
	{#snippet children(id)}
		{#if config.property.kind === "named"}
			<ValidatedInput {id} bind:value={config.property.format} placeholder={t("choiceBuilder.placeholder.propertyName")}
				required requiredMessage={t("choiceBuilder.propertyCapture.propertyNameRequired")} makeSuggesters={suggesters} />
		{/if}
	{/snippet}
</LabeledField>

<LabeledField name={t("choiceBuilder.propertyCapture.valueFormat")} bodyVisible={true}>
	{#snippet children(id)}
		<ValidatedInput {id} bind:value={valueFormatDraft} placeholder={fallbackFormat}
			makeSuggesters={suggesters} />
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

<style>
	.qa-property-capture-value-format-desc {
		margin: -0.4rem 0 0.6rem;
		color: var(--text-muted);
		font-size: 0.85em;
	}
</style>
