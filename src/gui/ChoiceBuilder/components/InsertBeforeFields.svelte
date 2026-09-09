<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import { t } from "../../../i18n";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_TOP,
} from "../../../constants";
import {
	FormatSyntaxSuggester,
} from "../../suggesters/formatSyntaxSuggester";
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import LabeledField from "./LabeledField.svelte";
import FormatPreviewField from "./FormatPreviewField.svelte";

/** Reactive port of captureChoiceBuilder.addInsertBeforeFields. */
let {
	insertBefore = $bindable(),
	app,
	plugin,
}: {
	insertBefore: NonNullable<ICaptureChoice["insertBefore"]>;
	app: App;
	plugin: QuickAdd;
} = $props();

// Default the create-line fields synchronously at init (before bind:checked /
// the dropdown read them), matching the imperative addInsertBeforeFields. Without
// this, a legacy/imported insertBefore missing these keys would persist `undefined`
// and throw "Unknown createIfNotFoundLocation" in the capture formatter.
if (insertBefore.createIfNotFound === undefined)
	insertBefore.createIfNotFound = false;
if (!insertBefore.createIfNotFoundLocation)
	insertBefore.createIfNotFoundLocation = CREATE_IF_NOT_FOUND_TOP;

const suggesters = [
	// Line-target field: the "lineTarget" context withholds the tokens
	// formatLocationString deliberately leaves literal in selectors (notably
	// {{FOLDERCURRENT}}, whose legitimate "" resolution would match the first
	// line), so nothing is suggested here that cannot resolve here.
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, "lineTarget"),
];

const createLocationOptions = [
	{ value: CREATE_IF_NOT_FOUND_TOP, label: t("choiceBuilder.insertBefore.locationTop") },
	{ value: CREATE_IF_NOT_FOUND_BOTTOM, label: t("choiceBuilder.insertBefore.locationBottom") },
	{ value: CREATE_IF_NOT_FOUND_CURSOR, label: t("choiceBuilder.insertBefore.locationCursor") },
];
</script>

<LabeledField
	name={t("choiceBuilder.insertBefore.label")}
	desc={t("choiceBuilder.insertBefore.labelDesc")}
>
	{#snippet children(id)}
		<ValidatedInput
			{id}
			bind:value={insertBefore.before}
			placeholder={t("choiceBuilder.placeholder.insertBefore")}
			required
			requiredMessage={t("choiceBuilder.insertBefore.required")}
			makeSuggesters={suggesters}
		/>
		<FormatPreviewField value={insertBefore.before} formatterKind="lineTarget" {app} {plugin} />
	{/snippet}
</LabeledField>

<SettingItem
	name={t("choiceBuilder.insertBefore.createLine")}
	desc={t("choiceBuilder.insertBefore.createLineDesc")}
>
	{#snippet control()}
		<Toggle bind:checked={insertBefore.createIfNotFound} />
		<Dropdown
			value={insertBefore.createIfNotFoundLocation || CREATE_IF_NOT_FOUND_TOP}
			options={createLocationOptions}
			onchange={(value) => (insertBefore.createIfNotFoundLocation = value)}
		/>
	{/snippet}
</SettingItem>
