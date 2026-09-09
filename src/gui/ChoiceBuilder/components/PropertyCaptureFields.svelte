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

let { config = $bindable(), app, plugin }: {
	config: PropertyCapture;
	app: App;
	plugin: QuickAdd;
} = $props();

const suggesters = [(el: HTMLInputElement | HTMLTextAreaElement) => new FormatSyntaxSuggester(app, el, plugin)];
let lastNamedFormat = "";
</script>

<LabeledField name={t("choiceBuilder.propertyCapture.property")} bodyVisible={config.property.kind === "named"}>
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
