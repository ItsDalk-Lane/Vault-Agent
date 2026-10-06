<script lang="ts">
import { TFile, type App } from "obsidian";
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import { t } from "../../../i18n";
import type {
	AppendLinkOptions,
	FrontmatterHandling,
	LinkDisplayText,
	LinkPlacement,
	LinkType,
} from "../../../types/linkPlacement";
import {
	DEFAULT_FRONTMATTER_HANDLING,
	normalizeAppendLinkOptions,
	placementSupportsEmbed,
	placementSupportsFrontmatter,
	placementSupportsSelectionAlias,
} from "../../../types/linkPlacement";
import { normalizeAppendLinkDestinationPath } from "../../../utils/fileLinks";

/**
 * Shared append-link configuration — collapses the near-identical
 * addAppendLinkSetting from captureChoiceBuilder and templateChoiceBuilder.
 * Conditional placement / link-type rows are reactive `{#if}` blocks; the old
 * `reload()` calls are gone (whole-value reassignment drives re-render).
 */
let {
	appendLink = $bindable(),
	fileLabel,
	app = undefined,
}: {
	appendLink: boolean | AppendLinkOptions;
	fileLabel: "captured" | "created";
	app?: App | undefined;
} = $props();

type AppendLinkMode = "required" | "optional" | "disabled";
type AppendLinkDestinationMode = "activeFile" | "specifiedFile";

const normalized = $derived(normalizeAppendLinkOptions(appendLink));
const normalizedLinkType = $derived(normalized.linkType ?? "link");
const normalizedDisplayText = $derived(normalized.displayText);
const normalizedFrontmatterHandling = $derived(
	normalized.frontmatterHandling ?? DEFAULT_FRONTMATTER_HANDLING,
);
const destinationPath = $derived(
	normalized.destination.type === "specifiedFile"
		? normalized.destination.path
		: "",
);
const currentMode = $derived(
	normalized.enabled
		? normalized.requireActiveFile
			? "required"
			: "optional"
		: "disabled",
);
const destinationMode = $derived(normalized.destination.type);
const markdownFilePaths = $derived(
	app ? app.vault.getMarkdownFiles().map((file) => file.path) : [],
);
const fileLabelText = $derived(
	fileLabel === "captured"
		? t("choiceBuilder.appendLink.fileLabelCaptured")
		: t("choiceBuilder.appendLink.fileLabelCreated"),
);

const modeOptions = [
	{ value: "required", label: t("choiceBuilder.appendLink.modeRequired") },
	{ value: "optional", label: t("choiceBuilder.appendLink.modeOptional") },
	{ value: "disabled", label: t("choiceBuilder.appendLink.modeDisabled") },
];
const destinationOptions = [
	{
		value: "activeFile",
		label: t("choiceBuilder.appendLink.destinationCurrentNote"),
	},
	{
		value: "specifiedFile",
		label: t("choiceBuilder.appendLink.destinationSpecifiedNote"),
	},
];
const placementOptions = [
	{
		value: "replaceSelection",
		label: t("choiceBuilder.appendLink.placementReplaceSelection"),
	},
	{
		value: "afterSelection",
		label: t("choiceBuilder.appendLink.placementAfterSelection"),
	},
	{
		value: "endOfLine",
		label: t("choiceBuilder.appendLink.placementEndOfLine"),
	},
	{ value: "newLine", label: t("choiceBuilder.appendLink.placementNewLine") },
	{
		value: "inFrontmatter",
		label: t("choiceBuilder.appendLink.placementInFrontmatter"),
	},
];
const linkTypeOptions = [
	{ value: "link", label: t("choiceBuilder.appendLink.linkTypeLink") },
	{ value: "embed", label: t("choiceBuilder.appendLink.linkTypeEmbed") },
];
const displayTextOptions = [
	{ value: "none", label: t("choiceBuilder.appendLink.displayTextDefault") },
	{
		value: "selection",
		label: t("choiceBuilder.appendLink.displayTextSelection"),
	},
];
const frontmatterHandlingOptions = [
	{
		value: "alwaysAppend",
		label: t("choiceBuilder.appendLink.handlingAlwaysAppend"),
	},
	{
		value: "createProperty",
		label: t("choiceBuilder.appendLink.handlingCreateProperty"),
	},
	{ value: "error", label: t("choiceBuilder.appendLink.handlingError") },
];

function nextOptions(overrides: Partial<AppendLinkOptions>): AppendLinkOptions {
	const current = appendLink;
	const currentOptions =
		typeof current === "boolean" ? normalized : current;
	const placement = overrides.placement ?? currentOptions.placement;
	const destination =
		overrides.destination ?? currentOptions.destination ?? normalized.destination;
	const linkType =
		destination.type === "activeFile" && placementSupportsEmbed(placement)
			? overrides.linkType ?? currentOptions.linkType ?? normalizedLinkType
			: "link";
	// Forced back to "none" when the conditions no longer hold — intentionally
	// as lossy as the linkType reset above (switching placement away and back
	// discards the stored preference).
	// Falls back to the NORMALIZED value (not the raw stored one) so a
	// malformed/unknown stored displayText is not written back on unrelated
	// dropdown changes — the UI persists what it displays.
	const displayText =
		destination.type === "activeFile" &&
		placementSupportsSelectionAlias(placement) &&
		linkType === "link"
			? overrides.displayText ?? normalizedDisplayText
			: "none";

	return {
		enabled: overrides.enabled ?? true,
		placement,
		requireActiveFile:
			overrides.requireActiveFile ??
			currentOptions.requireActiveFile ??
			normalized.requireActiveFile,
		linkType,
		displayText,
		destination,
		frontmatterProperty:
			overrides.frontmatterProperty ?? currentOptions.frontmatterProperty,
		frontmatterHandling:
			overrides.frontmatterHandling ?? currentOptions.frontmatterHandling,
	};
}

function onModeChange(value: string) {
	switch (value as AppendLinkMode) {
		case "disabled":
			appendLink = nextOptions({ enabled: false });
			break;
		case "required":
			appendLink = nextOptions({ requireActiveFile: true });
			break;
		case "optional":
			appendLink = nextOptions({ requireActiveFile: false });
			break;
	}
}

function onPlacementChange(value: string) {
	appendLink = nextOptions({
		placement: value as LinkPlacement,
	});
}

function onLinkTypeChange(value: string) {
	appendLink = nextOptions({
		linkType: value as LinkType,
	});
}

function onDisplayTextChange(value: string) {
	appendLink = nextOptions({
		displayText: value as LinkDisplayText,
	});
}

function onFrontmatterPropertyInput(event: Event) {
	appendLink = nextOptions({
		frontmatterProperty: (event.currentTarget as HTMLInputElement).value,
	});
}

function onFrontmatterHandlingChange(value: string) {
	appendLink = nextOptions({
		frontmatterHandling: value as FrontmatterHandling,
	});
}

function onDestinationChange(value: string) {
	const destination =
		(value as AppendLinkDestinationMode) === "specifiedFile"
			? { type: "specifiedFile" as const, path: destinationPath }
			: { type: "activeFile" as const };
	appendLink = nextOptions({ destination });
}

function onDestinationPathChange(value: string) {
	appendLink = nextOptions({
		destination: { type: "specifiedFile", path: value.trim() },
	});
}

function validateDestinationFile(raw: string) {
	const value = raw.trim();
	if (!value) return t("choiceBuilder.appendLink.destinationFileRequired");
	if (!app) return true;

	const target = app.vault.getAbstractFileByPath(
		normalizeAppendLinkDestinationPath(value),
	);
	return target instanceof TFile && target.extension === "md"
		? true
		: t("choiceBuilder.appendLink.destinationFileNotFound");
}
</script>

<SettingItem
	name={t("choiceBuilder.appendLink.linkTo.name", { file: fileLabelText })}
	desc={t("choiceBuilder.appendLink.linkTo.desc", { file: fileLabelText })}
>
	{#snippet control()}
		<Dropdown value={currentMode} options={modeOptions} onchange={onModeChange} />
	{/snippet}
</SettingItem>

{#if currentMode !== "disabled"}
	<SettingItem
		name={t("choiceBuilder.appendLink.destination.name")}
		desc={t("choiceBuilder.appendLink.destination.desc", {
			file: fileLabelText,
		})}
	>
		{#snippet control()}
			<Dropdown
				value={destinationMode}
				options={destinationOptions}
				onchange={onDestinationChange}
			/>
		{/snippet}
	</SettingItem>

	{#if destinationMode === "activeFile"}
		<SettingItem
			name={t("choiceBuilder.appendLink.placement.name")}
			desc={t("choiceBuilder.appendLink.placement.desc")}
		>
			{#snippet control()}
				<Dropdown
					value={normalized.placement}
					options={placementOptions}
					onchange={onPlacementChange}
				/>
			{/snippet}
		</SettingItem>

		{#if placementSupportsEmbed(normalized.placement)}
			<SettingItem
				name={t("choiceBuilder.appendLink.linkType.name")}
				desc={t("choiceBuilder.appendLink.linkType.desc")}
			>
				{#snippet control()}
					<Dropdown
						value={normalizedLinkType}
						options={linkTypeOptions}
						onchange={onLinkTypeChange}
					/>
				{/snippet}
			</SettingItem>
		{/if}

		{#if placementSupportsSelectionAlias(normalized.placement) && normalizedLinkType === "link"}
			<SettingItem
				name={t("choiceBuilder.appendLink.displayText.name")}
				desc={t("choiceBuilder.appendLink.displayText.desc")}
			>
				{#snippet control()}
					<Dropdown
						value={normalizedDisplayText}
						options={displayTextOptions}
						onchange={onDisplayTextChange}
					/>
				{/snippet}
			</SettingItem>
		{/if}

		{#if placementSupportsFrontmatter(normalized.placement)}
			<SettingItem
				name={t("choiceBuilder.appendLink.frontmatterProperty.name")}
				desc={t("choiceBuilder.appendLink.frontmatterProperty.desc")}
			>
				{#snippet control()}
					<input
						type="text"
						class="text-input"
						value={normalized.frontmatterProperty ?? ""}
						aria-label={t("choiceBuilder.placeholder.frontmatterPropertyAria")}
						aria-invalid={!(normalized.frontmatterProperty?.trim())}
						placeholder={t("choiceBuilder.appendLink.relatedPlaceholder")}
						required
						oninput={onFrontmatterPropertyInput}
					/>
				{/snippet}
			</SettingItem>

			<SettingItem
				name={t("choiceBuilder.appendLink.propertyHandling.name")}
				desc={t("choiceBuilder.appendLink.propertyHandling.desc")}
			>
				{#snippet control()}
					<Dropdown
						value={normalizedFrontmatterHandling}
						options={frontmatterHandlingOptions}
						onchange={onFrontmatterHandlingChange}
					/>
				{/snippet}
			</SettingItem>
		{/if}
	{:else}
		<SettingItem
			name={t("choiceBuilder.appendLink.destinationFile.name")}
			desc={t("choiceBuilder.appendLink.destinationFile.desc")}
		>
			{#snippet control()}
				<ValidatedInput
					value={destinationPath}
					placeholder={t("choiceBuilder.appendLink.indexPlaceholder")}
					{app}
					suggestions={markdownFilePaths}
					maxSuggestions={50}
					required
					requiredMessage={t(
						"choiceBuilder.appendLink.destinationFileRequired",
					)}
					validator={validateDestinationFile}
					ariaLabel={t("choiceBuilder.appendLink.destinationFileAria")}
					onChange={onDestinationPathChange}
				/>
			{/snippet}
		</SettingItem>
	{/if}
{/if}
