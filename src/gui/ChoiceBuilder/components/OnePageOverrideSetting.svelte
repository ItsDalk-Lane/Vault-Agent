<script lang="ts">
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import { t } from "../../../i18n";

/** Replaces ChoiceBuilder.addOnePageOverrideSetting. */
let {
	onePageInput = $bindable(),
}: {
	onePageInput: "always" | "never" | undefined;
} = $props();

const options = [
	{ value: "", label: t("macro.onePageInputFollow") },
	{ value: "always", label: t("macro.onePageInputAlways") },
	{ value: "never", label: t("macro.onePageInputNever") },
];

const selected = $derived((onePageInput ?? "") as string);

function onChange(value: string) {
	onePageInput =
		value === "always" || value === "never" ? value : undefined;
}
</script>

<SettingItem
	name={t("macro.onePageInputOverride")}
	desc={t("choiceBuilder.onePageOverride.desc")}
>
	{#snippet control()}
		<Dropdown value={selected} {options} onchange={onChange} />
	{/snippet}
</SettingItem>
