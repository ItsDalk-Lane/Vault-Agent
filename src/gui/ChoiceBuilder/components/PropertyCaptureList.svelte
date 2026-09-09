<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import { setPropertyCaptures } from "../../../types/choices/ICaptureChoice";
import type { PropertyCapture } from "../../../types/choices/ICaptureChoice";
import ObsidianIcon from "../../components/ObsidianIcon.svelte";
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
		},
	]);
}

function removeRow(index: number) {
	setPropertyCaptures(choice, rows.filter((_, i) => i !== index));
}
</script>

<p class="qa-property-capture-multi-desc">{t("choiceBuilder.propertyCapture.multiDesc")}</p>

{#each rows as row, i (i)}
	<div class="qa-property-capture-card">
		<div class="qa-property-capture-card-head">
			<span class="qa-property-capture-card-title">
				{t("choiceBuilder.propertyCapture.property")} {i + 1}
			</span>
			<button
				type="button"
				class="qa-property-capture-remove"
				aria-label={t("choiceBuilder.propertyCapture.removeRow")}
				onclick={() => removeRow(i)}
			>
				<ObsidianIcon iconId="trash-2" size={14} />
			</button>
		</div>
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

	.qa-property-capture-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-top: 0.35rem;
	}

	.qa-property-capture-card-title {
		font-weight: 600;
		color: var(--text-muted);
	}

	.qa-property-capture-remove {
		display: inline-flex;
		align-items: center;
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: var(--radius-s);
	}

	.qa-property-capture-remove:hover {
		color: var(--text-error);
		background: var(--background-modifier-hover);
	}

	.qa-property-capture-actions {
		display: flex;
		justify-content: flex-end;
	}
</style>
