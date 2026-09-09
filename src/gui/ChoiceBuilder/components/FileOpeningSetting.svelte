<script lang="ts">
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import Toggle from "../../components/Toggle.svelte";
import { t } from "../../../i18n";
import {
	normalizeFileOpening,
	type FileOpeningSettings,
} from "../../../utils/fileOpeningDefaults";
import type { FileViewMode2, OpenLocation } from "../../../types/fileOpening";

/**
 * Replaces ChoiceBuilder.addFileOpeningSetting. Conditional rows (split
 * direction, focus toggle) are reactive `{#if}` blocks instead of `reload()`.
 */
let {
	fileOpening = $bindable(),
	contextLabel,
}: {
	fileOpening: FileOpeningSettings;
	contextLabel: "captured" | "created";
} = $props();

// This section only mounts when Open is enabled. An imported/legacy choice can
// reach here with a missing/partial fileOpening (toggling Open true after mount),
// so normalize at init — before the template dereferences .location/.mode — the
// same point the imperative addFileOpeningSetting normalized. (#1130 review)
fileOpening = normalizeFileOpening(fileOpening);

const contextText = $derived(
	contextLabel === "captured"
		? t("choiceBuilder.fileOpening.contextCaptured")
		: t("choiceBuilder.fileOpening.contextCreated"),
);

const locationOptions = [
	{ value: "reuse", label: t("openFile.whereToOpen.reuse") },
	{ value: "tab", label: t("openFile.whereToOpen.tab") },
	{ value: "split", label: t("openFile.whereToOpen.split") },
	{ value: "window", label: t("openFile.whereToOpen.window") },
	{ value: "left-sidebar", label: t("openFile.whereToOpen.leftSidebar") },
	{ value: "right-sidebar", label: t("openFile.whereToOpen.rightSidebar") },
];

const directionOptions = [
	{ value: "vertical", label: t("openFile.splitDirection.right") },
	{ value: "horizontal", label: t("openFile.splitDirection.down") },
];

const modeOptions = [
	{ value: "source", label: t("choiceBuilder.fileOpening.viewModeSource") },
	{ value: "preview", label: t("choiceBuilder.fileOpening.viewModePreview") },
	{ value: "live", label: t("choiceBuilder.fileOpening.viewModeLivePreview") },
	{ value: "default", label: t("choiceBuilder.fileOpening.viewModeDefault") },
];

const modeValue = $derived(
	typeof fileOpening.mode === "string" ? (fileOpening.mode as string) : "default",
);
</script>

<SettingItem
	name={t("choiceBuilder.fileOpening.location")}
	desc={t("choiceBuilder.fileOpening.locationDesc", { context: contextText })}
>
	{#snippet control()}
		<Dropdown
			value={fileOpening.location}
			options={locationOptions}
			onchange={(value) => (fileOpening.location = value as OpenLocation)}
		/>
	{/snippet}
</SettingItem>

{#if fileOpening.location === "split"}
	<SettingItem
		name={t("macro.splitDirection.name")}
		desc={t("macro.splitDirection.desc")}
	>
		{#snippet control()}
			<Dropdown
				value={fileOpening.direction}
				options={directionOptions}
				onchange={(value) =>
					(fileOpening.direction = value as FileOpeningSettings["direction"])}
			/>
		{/snippet}
	</SettingItem>
{/if}

<SettingItem
	name={t("choiceBuilder.fileOpening.viewMode")}
	desc={t("choiceBuilder.fileOpening.viewModeDesc")}
>
	{#snippet control()}
		<Dropdown
			value={modeValue}
			options={modeOptions}
			onchange={(value) => (fileOpening.mode = value as FileViewMode2)}
		/>
	{/snippet}
</SettingItem>

{#if fileOpening.location !== "reuse"}
	<SettingItem
		name={t("choiceBuilder.fileOpening.focus")}
		desc={t("choiceBuilder.fileOpening.focusDesc")}
	>
		{#snippet control()}
			<Toggle bind:checked={fileOpening.focus} />
		{/snippet}
	</SettingItem>
{/if}
