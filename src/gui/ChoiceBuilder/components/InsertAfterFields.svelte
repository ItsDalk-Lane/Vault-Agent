<script lang="ts">
import type { App } from "obsidian";
import { Notice } from "obsidian";
import type QuickAdd from "../../../main";
import { t } from "../../../i18n";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import type { SectionOrdering } from "../../../types/choices/ICaptureChoice";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_ORDERED,
	CREATE_IF_NOT_FOUND_TOP,
} from "../../../constants";
import {
	FormatSyntaxSuggester,
} from "../../suggesters/formatSyntaxSuggester";
import { detectDateFormatFromAfter } from "../../../utils/insertAfterDateFormat";
import { FormatDisplayFormatter } from "../../../formatters/formatDisplayFormatter";
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import LabeledField from "./LabeledField.svelte";
import FormatPreviewField from "./FormatPreviewField.svelte";

/** Reactive port of captureChoiceBuilder.addInsertAfterFields. */
let {
	insertAfter = $bindable(),
	app,
	plugin,
}: {
	insertAfter: ICaptureChoice["insertAfter"];
	app: App;
	plugin: QuickAdd;
} = $props();

// Defaults the imperative builder set when this section rendered (insertAfter
// enabled). Applied synchronously at init — before the template's bind:checked
// reads them — and kept section-local, so the persisted shape only changes for
// choices whose write position actually reaches "After line…" (parity with the
// imperative addInsertAfterFields).
if (insertAfter.inline === undefined) insertAfter.inline = false;
if (insertAfter.replaceExisting === undefined)
	insertAfter.replaceExisting = false;
if (insertAfter.promptHeading === undefined) insertAfter.promptHeading = false;
// insertAtEnd (2021) and considerSubsections (2023) postdate insertAfter itself,
// so choices saved before then legitimately lack them (#1497).
if (insertAfter.insertAtEnd === undefined) insertAfter.insertAtEnd = false;
if (insertAfter.considerSubsections === undefined)
	insertAfter.considerSubsections = false;
if (!insertAfter.blankLineAfterMatchMode)
	insertAfter.blankLineAfterMatchMode = "auto";
if (!insertAfter.createIfNotFound) insertAfter.createIfNotFound = false;
if (!insertAfter.createIfNotFoundLocation)
	insertAfter.createIfNotFoundLocation = CREATE_IF_NOT_FOUND_TOP;

const suggesters = [
	// Line-target field: the "lineTarget" context withholds the tokens
	// formatLocationString deliberately leaves literal in selectors (notably
	// {{FOLDERCURRENT}}, whose legitimate "" resolution would match the first
	// line), so nothing is suggested here that cannot resolve here.
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, "lineTarget"),
];

const blankLineOptions = [
	{ value: "auto", label: t("choiceBuilder.insertAfter.blankLineAuto") },
	{ value: "skip", label: t("choiceBuilder.insertAfter.blankLineSkip") },
	{ value: "none", label: t("choiceBuilder.insertAfter.blankLineNone") },
];

// Inline same-line insertion and ordered section placement are mutually
// exclusive (ordered always creates a heading on its own line). Omit "Ordered"
// while inline is on so it can never be selected into a crashing combination.
const createLocationOptions = $derived(
	insertAfter.inline
		? [
				{ value: CREATE_IF_NOT_FOUND_TOP, label: t("choiceBuilder.insertAfter.locationTop") },
				{ value: CREATE_IF_NOT_FOUND_BOTTOM, label: t("choiceBuilder.insertAfter.locationBottom") },
				{ value: CREATE_IF_NOT_FOUND_CURSOR, label: t("choiceBuilder.insertAfter.locationCursor") },
			]
		: [
				{ value: CREATE_IF_NOT_FOUND_TOP, label: t("choiceBuilder.insertAfter.locationTop") },
				{ value: CREATE_IF_NOT_FOUND_BOTTOM, label: t("choiceBuilder.insertAfter.locationBottom") },
				{ value: CREATE_IF_NOT_FOUND_CURSOR, label: t("choiceBuilder.insertAfter.locationCursor") },
				{
					value: CREATE_IF_NOT_FOUND_ORDERED,
					label: t("choiceBuilder.insertAfter.locationOrdered"),
				},
			],
);

const orderByOptions = [
	{ value: "insertion", label: t("choiceBuilder.insertAfter.orderByInsertion") },
	{ value: "lexical", label: t("choiceBuilder.insertAfter.orderByLexical") },
	{ value: "numeric", label: t("choiceBuilder.insertAfter.orderByNumeric") },
	{ value: "date", label: t("choiceBuilder.insertAfter.orderByDate") },
	{ value: "semver", label: t("choiceBuilder.insertAfter.orderBySemver") },
];
const orderDirectionOptions = [
	{ value: "desc", label: t("choiceBuilder.insertAfter.directionDesc") },
	{ value: "asc", label: t("choiceBuilder.insertAfter.directionAsc") },
];
const unparseableOptions = [
	{ value: "bottom", label: t("choiceBuilder.insertAfter.unparseableToBottom") },
	{ value: "top", label: t("choiceBuilder.insertAfter.unparseableToTop") },
];

// Tracks whether the ordering descriptor is "pinned" — either the user explicitly
// chose a sort key / date format, or the choice arrived already carrying an
// orderBy (a saved/imported ordered choice). When pinned, the reactive seed never
// auto-rewrites `by`/`dateFormat` from the `after` text, so opening or editing an
// existing choice can't silently clobber its saved sort config.
let userPickedBy = $state(!!insertAfter.orderBy);

// Ordered placement is selected (regardless of whether "Create line if not found"
// is currently on). Used to gate the mutually-exclusive Inline toggle so the
// invalid inline+ordered combo can't be assembled via a toggle sequence.
const orderedSelected = $derived(
	insertAfter.createIfNotFoundLocation === CREATE_IF_NOT_FOUND_ORDERED,
);
// Ordered placement is ACTIVE (will run): location is ordered AND creation is on.
// Drives the ordered sub-panel + warnings.
const isOrdered = $derived(
	insertAfter.createIfNotFound && orderedSelected,
);

// Inline same-line insertion can only match a single line, but the live preview
// above expands `\n`, so a multi-line target looks valid while the capture
// silently never lands. Warn when inline mode is on and the target RESOLVES to
// more than one line (issue #468). We resolve with the same FormatDisplayFormatter
// the preview/runtime use — not a raw regex — so an escaped `\\n` (stays a literal
// backslash-n, single line) does not false-warn and a token/global-var that
// expands to a real newline is not missed.
const inlinePreviewFormatter = $derived(new FormatDisplayFormatter(app, plugin));
let inlineTargetHasLinebreak = $state(false);
$effect(() => {
	const raw = insertAfter.after ?? "";
	const formatter = inlinePreviewFormatter;
	if (!insertAfter.inline || raw === "") {
		inlineTargetHasLinebreak = false;
		return;
	}
	let cancelled = false;
	void formatter
		.format(raw)
		.then((resolved) => {
			if (!cancelled) inlineTargetHasLinebreak = /[\n\r]/.test(resolved);
		})
		.catch(() => {
			if (!cancelled) inlineTargetHasLinebreak = false;
		});
	return () => {
		cancelled = true;
	};
});

// Non-optional read view for the ordered sub-panel: the panel only renders when
// `insertAfter.orderBy` is present, but its `{#snippet}` closures lose the
// truthiness narrowing, so reads go through this guaranteed-present derived.
// Writes still target `insertAfter.orderBy` through guarded handlers.
const ordering = $derived<SectionOrdering>(
	insertAfter.orderBy ?? { by: "insertion", direction: "desc", unparseable: "bottom" },
);


const afterHasDateToken = $derived(/\{\{V?DATE\b/i.test(insertAfter.after ?? ""));
const showInsertionFallbackWarning = $derived(
	isOrdered &&
		insertAfter.orderBy?.by === "insertion" &&
		afterHasDateToken &&
		!detectDateFormatFromAfter(insertAfter.after ?? ""),
);

// Single seeder (builder-owned): seed orderBy when "ordered" is first selected,
// and while the user hasn't pinned a key, keep the date/insertion choice in sync
// with the `after` text. Resolves the Load-vs-builder two-seeder divergence.
$effect(() => {
	// Only seed when ordered placement is actually active (location ordered AND
	// creation on), so a merely-selected-but-inert ordered location never persists
	// dead orderBy config.
	if (!isOrdered) return;
	const fmt = detectDateFormatFromAfter(insertAfter.after ?? "");
	if (!insertAfter.orderBy) {
		insertAfter.orderBy = {
			by: fmt ? "date" : "insertion",
			direction: "desc",
			dateFormat: fmt,
			unparseable: "bottom",
		};
		return;
	}
	if (
		!userPickedBy &&
		(insertAfter.orderBy.by === "insertion" || insertAfter.orderBy.by === "date")
	) {
		insertAfter.orderBy.by = fmt ? "date" : "insertion";
		insertAfter.orderBy.dateFormat = fmt;
	}
});

function onCreateLocationChange(value: string) {
	insertAfter.createIfNotFoundLocation = value;
	if (value === CREATE_IF_NOT_FOUND_ORDERED) {
		// Ordered always creates a heading on its own line.
		insertAfter.inline = false;
	} else {
		// Leaving ordered: drop the now-irrelevant descriptor so stale config
		// never persists on a non-ordered choice.
		insertAfter.orderBy = undefined;
		userPickedBy = false;
	}
}

function onOrderByChange(value: string) {
	userPickedBy = true;
	if (!insertAfter.orderBy) return;
	insertAfter.orderBy.by = value as SectionOrdering["by"];
}

function onConsiderSubsectionsToggle(value: boolean) {
	// In heading mode the runtime target is always a heading, so the
	// "starts with #" guard would misfire against the empty/hidden `after` text.
	if (insertAfter.promptHeading) return;
	if (value && !insertAfter.after.startsWith("#")) {
		// Two-way bind syncs the toggle back to off when the target isn't a heading.
		insertAfter.considerSubsections = false;
		new Notice(
			t("choiceBuilder.insertAfter.considerSubsectionsNotice"),
		);
	}
}

function onPromptHeadingToggle(value: boolean) {
	// Heading mode always inserts on its own line under the picked heading (the block
	// path), so clear the inline same-line flags when it's switched on.
	if (value) {
		insertAfter.inline = false;
		insertAfter.replaceExisting = false;
	}
}
</script>

<SettingItem
	name={t("choiceBuilder.insertAfter.chooseHeading")}
	desc={t("choiceBuilder.insertAfter.chooseHeadingDesc")}
>
	{#snippet control()}
		<Toggle
			bind:checked={insertAfter.promptHeading}
			onchange={onPromptHeadingToggle}
		/>
	{/snippet}
</SettingItem>

{#if insertAfter.promptHeading}
	<div class="setting-item-description">
		{t("choiceBuilder.insertAfter.chooseHeadingHint")}
	</div>
{:else}
	<LabeledField
		name={t("choiceBuilder.insertAfter.label")}
		desc={t("choiceBuilder.insertAfter.labelDesc")}
	>
		{#snippet children(id)}
			<ValidatedInput
				{id}
				bind:value={insertAfter.after}
				placeholder={t("choiceBuilder.placeholder.insertAfter")}
				required
				requiredMessage={t("choiceBuilder.insertAfter.required")}
				makeSuggesters={suggesters}
			/>
			<FormatPreviewField value={insertAfter.after} formatterKind="lineTarget" {app} {plugin} />
		{/snippet}
	</LabeledField>

	<SettingItem
		name={t("choiceBuilder.insertAfter.inline")}
		desc={orderedSelected
			? t("choiceBuilder.insertAfter.inlineDescOrdered")
			: t("choiceBuilder.insertAfter.inlineDesc")}
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.inline} disabled={orderedSelected} />
		{/snippet}
	</SettingItem>

	{#if inlineTargetHasLinebreak}
		<div class="setting-item-description">
			{t("choiceBuilder.insertAfter.inlineLinebreakWarning")}
		</div>
	{/if}
{/if}

{#if insertAfter.inline}
	<SettingItem
		name={t("choiceBuilder.insertAfter.replaceExisting")}
		desc={t("choiceBuilder.insertAfter.replaceExistingDesc")}
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.replaceExisting} />
		{/snippet}
	</SettingItem>
{:else}
	<SettingItem
		name={t("choiceBuilder.insertAfter.insertAtEnd")}
		desc={t("choiceBuilder.insertAfter.insertAtEndDesc")}
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.insertAtEnd} />
		{/snippet}
	</SettingItem>

	<SettingItem
		name={t("choiceBuilder.insertAfter.blankLines")}
		desc={insertAfter.insertAtEnd
			? t("choiceBuilder.insertAfter.blankLinesDescUnused")
			: t("choiceBuilder.insertAfter.blankLinesDesc")}
	>
		{#snippet control()}
			<Dropdown
				value={insertAfter.blankLineAfterMatchMode ?? "auto"}
				options={blankLineOptions}
				disabled={insertAfter.insertAtEnd}
				onchange={(value) =>
					(insertAfter.blankLineAfterMatchMode = value as
						| "auto"
						| "skip"
						| "none")}
			/>
		{/snippet}
	</SettingItem>

	<SettingItem
		name={t("choiceBuilder.insertAfter.considerSubsections")}
		desc={!insertAfter.insertAtEnd
			? t("choiceBuilder.insertAfter.considerSubsectionsDescInactive")
			: insertAfter.promptHeading
				? t("choiceBuilder.insertAfter.considerSubsectionsDescHeading")
				: t("choiceBuilder.insertAfter.considerSubsectionsDesc")}
	>
		{#snippet control()}
			<Toggle
				bind:checked={insertAfter.considerSubsections}
				disabled={!insertAfter.insertAtEnd}
				onchange={onConsiderSubsectionsToggle}
			/>
		{/snippet}
	</SettingItem>
{/if}

<SettingItem
	name={t("choiceBuilder.insertAfter.createLine")}
	desc={t("choiceBuilder.insertAfter.createLineDesc")}
>
	{#snippet control()}
		<Toggle bind:checked={insertAfter.createIfNotFound} />
		<Dropdown
			value={insertAfter.createIfNotFoundLocation || CREATE_IF_NOT_FOUND_TOP}
			options={createLocationOptions}
			ariaLabel={t("choiceBuilder.insertAfter.createLine")}
			onchange={onCreateLocationChange}
		/>
	{/snippet}
</SettingItem>

{#if isOrdered && insertAfter.orderBy}
	<div class="setting-item-description">
		{t("choiceBuilder.insertAfter.orderedHint")}
	</div>

	<SettingItem name={t("choiceBuilder.insertAfter.sortBy")}>
		{#snippet control()}
			<Dropdown
				value={ordering.by}
				options={orderByOptions}
				onchange={onOrderByChange}
			/>
		{/snippet}
	</SettingItem>

	<SettingItem name={t("choiceBuilder.insertAfter.sectionOrder")}>
		{#snippet control()}
			<Dropdown
				value={ordering.direction}
				options={orderDirectionOptions}
				onchange={(value) => {
					if (insertAfter.orderBy)
						insertAfter.orderBy.direction =
							value as SectionOrdering["direction"];
				}}
			/>
		{/snippet}
	</SettingItem>

	{#if ordering.by === "date"}
		<SettingItem
			name={t("choiceBuilder.insertAfter.dateFormat")}
			desc={t("choiceBuilder.insertAfter.dateFormatDesc")}
		>
			{#snippet control()}
				<ValidatedInput
					value={ordering.dateFormat ?? ""}
					placeholder="YYYY-MM-DD"
					ariaLabel={t("choiceBuilder.insertAfter.dateFormat")}
					onChange={(value) => {
						// A deliberate format edit pins the descriptor so the after-keyed
						// seeder stops re-deriving dateFormat from the token.
						userPickedBy = true;
						if (insertAfter.orderBy) insertAfter.orderBy.dateFormat = value;
					}}
				/>
			{/snippet}
		</SettingItem>
	{/if}

	{#if ordering.by === "date" || ordering.by === "numeric" || ordering.by === "semver"}
		<SettingItem
			name={t("choiceBuilder.insertAfter.unparseable")}
			desc={t("choiceBuilder.insertAfter.unparseableDesc")}
		>
			{#snippet control()}
				<Dropdown
					value={ordering.unparseable ?? "bottom"}
					options={unparseableOptions}
					ariaLabel={t("choiceBuilder.insertAfter.unparseable")}
					onchange={(value) => {
						if (insertAfter.orderBy)
							insertAfter.orderBy.unparseable =
								value as NonNullable<SectionOrdering["unparseable"]>;
					}}
				/>
			{/snippet}
		</SettingItem>
	{/if}

	{#if ordering.by === "insertion"}
		<div class="setting-item-description">
			{t("choiceBuilder.insertAfter.insertionHint")}
		</div>
	{/if}

	{#if showInsertionFallbackWarning}
		<div class="setting-item-description">
			{t("choiceBuilder.insertAfter.insertionFallbackWarning")}
		</div>
	{/if}
{/if}
