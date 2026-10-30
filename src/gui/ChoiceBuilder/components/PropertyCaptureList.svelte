<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import { setPropertyCaptures } from "../../../types/choices/ICaptureChoice";
import type { PropertyCapture } from "../../../types/choices/ICaptureChoice";
import PropertyCaptureFields from "./PropertyCaptureFields.svelte";
import { t } from "../../../i18n";

let { choice, app, plugin, captureFormat = "" }: {
	choice: ICaptureChoice;
	app: App;
	plugin: QuickAdd;
	/** The format an empty per-row value falls back to (shown as placeholder). */
	captureFormat?: string;
} = $props();

// Rows are read WITHOUT parsing: bind:config deep-writes must land on the very
// objects stored in choice.propertyCapture, and parsePropertyCapture rebuilds
// fresh copies. Validation happens at save/run time (engine + parse); here the
// proxy identity is what makes two-way editing work.
const rows = $derived(
	Array.isArray(choice.propertyCapture)
		? choice.propertyCapture
		: choice.propertyCapture
			? [choice.propertyCapture]
			: ([] as PropertyCapture[]),
);

function addRow() {
	setPropertyCaptures(choice, [
		...rows,
		{
			property: { kind: "named", format: "" },
			action: "set",
			createIfMissing: true,
			sort: "none",
		},
	]);
}

function removeRow(index: number) {
	setPropertyCaptures(choice, rows.filter((_, i) => i !== index));
}
</script>

<p class="qa-property-capture-multi-desc">{t("choiceBuilder.propertyCapture.multiDesc")}</p>

<!-- Keyed by the row object (not its index): PropertyCaptureFields keeps its
	collapsed/open state internally, so the key must travel with the row itself
	or deleting a middle row would shuffle sibling collapse states. -->
{#each rows as row, i (row)}
	<div class="qa-property-capture-card">
		<div class="qa-property-capture-card-body">
			<PropertyCaptureFields
				config={row}
				{app}
				{plugin}
				// A lone row keeps the plain "Property" label (legacy single-property
				// semantics and existing tests); multiple rows get numbered labels so
				// getByLabelText stays unique.
				single={rows.length === 1}
				index={rows.length > 1 ? i : undefined}
				fallbackFormat={captureFormat}
				onremove={() => removeRow(i)}
			/>
		</div>
	</div>
{/each}

<div class="qa-property-capture-actions">
	<button type="button" class="mod-cta" onclick={addRow}>
		{t("choiceBuilder.propertyCapture.addRow")}
	</button>
</div>

<style>
	.qa-property-capture-multi-desc {
		margin: 0 0 0.6rem;
		color: var(--text-muted);
		font-size: 0.85em;
	}

	.qa-property-capture-card {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 0.4rem 0.75rem 0.6rem;
		margin-bottom: 0.75rem;
	}

	.qa-property-capture-actions {
		display: flex;
		justify-content: flex-end;
	}

	/* The delete chevron lives on the property row now; tint it toward the
		danger color on hover like the old header button did. */
	.qa-property-capture-card :global(.qa-property-capture-remove:hover) {
		color: var(--text-error);
	}
</style>
