<script lang="ts">
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import { t } from "../../../i18n";

/**
 * Replaces ChoiceBuilder.addOpenFileSetting. The former `reload()` is gone —
 * the parent reveals <FileOpeningSetting> reactively via `{#if openFile}`.
 */
let {
	openFile = $bindable(),
	description,
}: {
	openFile: boolean;
	description: string;
} = $props();
</script>

<SettingItem name={t("choiceBuilder.openFileSetting.name")} desc={description}>
	{#snippet control()}
		<Toggle bind:checked={openFile} />
	{/snippet}
</SettingItem>
