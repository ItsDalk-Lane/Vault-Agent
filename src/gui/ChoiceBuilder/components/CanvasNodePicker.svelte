<script lang="ts">
import type { App } from "obsidian";
import { Notice } from "obsidian";
import { onMount } from "svelte";
import { t } from "../../../i18n";
import {
	getActiveCanvasSelectionNodeIdForPath,
	readCanvasNodeOptions,
	resolveStaticCanvasTargetFile,
	type CanvasNodeOption,
} from "../canvasNodes";

/**
 * Reactive port of captureChoiceBuilder.renderCanvasNodePicker. The imperative
 * renderList() rebuild is now a reactive {#each}; selecting a node mutates
 * `nodeId` and the list re-derives automatically.
 */
let {
	nodeId = $bindable(),
	canvasTargetPath,
	app,
}: {
	nodeId: string | undefined;
	canvasTargetPath: string;
	app: App;
} = $props();

let nodeOptions = $state<CanvasNodeOption[]>([]);
let phase = $state<"loading" | "empty" | "ready">("loading");
let emptyMessage = $state("");
let filterQuery = $state("");

const filteredOptions = $derived.by(() => {
	const query = filterQuery.trim().toLowerCase();
	return query.length
		? nodeOptions.filter((option) => option.searchText.includes(query))
		: nodeOptions;
});

const selectedNodeId = $derived((nodeId ?? "").trim());

const statusText = $derived(
	phase === "ready"
		? t("choiceBuilder.canvasPicker.statusShowing", {
				filtered: filteredOptions.length,
				total: nodeOptions.length,
			})
		: phase === "empty"
			? emptyMessage
			: t("choiceBuilder.canvasPicker.statusLoading"),
);

onMount(() => {
	void (async () => {
		const canvasFile = resolveStaticCanvasTargetFile(app, canvasTargetPath);
		if (!canvasFile) {
			emptyMessage = t("choiceBuilder.canvasPicker.emptyFormatPath");
			phase = "empty";
			return;
		}
		nodeOptions = await readCanvasNodeOptions(app, canvasFile);
		if (nodeOptions.length === 0) {
			emptyMessage = t("choiceBuilder.canvasPicker.emptyNoNodes");
			phase = "empty";
			return;
		}
		phase = "ready";
	})();
});

function applyNodeId(id: string) {
	nodeId = id;
}

function openCanvas() {
	const canvasFile = resolveStaticCanvasTargetFile(app, canvasTargetPath);
	if (!canvasFile) {
		new Notice(t("choiceBuilder.canvasPicker.targetNotFound"));
		return;
	}
	void app.workspace
		.getLeaf(true)
		.openFile(canvasFile)
		.catch(() => new Notice(t("choiceBuilder.canvasPicker.couldNotOpen")));
}

function useActiveSelection() {
	const activeSelectionNodeId = getActiveCanvasSelectionNodeIdForPath(
		app,
		canvasTargetPath,
	);
	if (!activeSelectionNodeId) {
		new Notice(t("choiceBuilder.canvasPicker.noticeSelectOneCard"));
		return;
	}
	const selectedOption = nodeOptions.find(
		(option) => option.id === activeSelectionNodeId,
	);
	if (!selectedOption) {
		new Notice(
			phase === "ready"
				? t("choiceBuilder.canvasPicker.noticeNodeNotFound")
				: t("choiceBuilder.canvasPicker.noticeStillLoading"),
		);
		return;
	}
	if (!selectedOption.capturable) {
		new Notice(selectedOption.capturableReason);
		return;
	}
	applyNodeId(activeSelectionNodeId);
}

function copyNodeId(id: string) {
	void (async () => {
		try {
			await navigator.clipboard.writeText(id);
			new Notice(t("choiceBuilder.canvasPicker.noticeCopiedNodeId", { id }));
		} catch {
			new Notice(t("choiceBuilder.canvasPicker.copyNodeFailed"));
		}
	})();
}

function typeLabel(type: CanvasNodeOption["type"]): string {
	return type === "text"
		? t("choiceBuilder.canvasPicker.typeText")
		: type === "file"
			? t("choiceBuilder.canvasPicker.typeFile")
			: t("choiceBuilder.canvasPicker.typeNode");
}
</script>

<div class="qa-canvas-node-picker">
	<div class="qa-canvas-node-actions">
		<button type="button" onclick={openCanvas}>{t("choiceBuilder.canvasPicker.openCanvas")}</button>
		<button type="button" onclick={useActiveSelection}>
			{t("choiceBuilder.canvasPicker.useSelected")}
		</button>
		<button type="button" onclick={() => applyNodeId("")}>{t("common.clear")}</button>
	</div>

	<div class="qa-canvas-node-filter">
		<input
			type="text"
			placeholder={t("choiceBuilder.canvasPicker.filterPlaceholder")}
			aria-label={t("choiceBuilder.canvasPicker.filterAria")}
			bind:value={filterQuery}
		/>
	</div>

	<div class="qa-canvas-node-status">{statusText}</div>

	<div class="qa-canvas-node-list">
		{#if phase === "empty"}
			<div class="qa-canvas-node-empty">{emptyMessage}</div>
		{:else if phase === "ready" && filteredOptions.length === 0}
			<div class="qa-canvas-node-empty">{t("choiceBuilder.canvasPicker.noMatch")}</div>
		{:else}
			{#each filteredOptions as option (option.id)}
				{@const isSelected = selectedNodeId === option.id}
				<div class="qa-canvas-node-item" class:is-selected={isSelected}>
					<div class="qa-canvas-node-item-header">
						<span class="qa-canvas-node-type is-{option.type}">
							{typeLabel(option.type)}
						</span>
						<span class="qa-canvas-node-title">{option.title}</span>
					</div>
					<div class="qa-canvas-node-subtitle">{option.subtitle}</div>
					<div class="qa-canvas-node-meta"><code>{option.id}</code></div>
					<div class="qa-canvas-node-item-actions">
						{#if option.capturable}
							<button
								type="button"
								class:mod-cta={isSelected}
								onclick={() => applyNodeId(option.id)}
							>
								{isSelected
									? t("choiceBuilder.canvasPicker.selected")
									: t("choiceBuilder.canvasPicker.useNode")}
							</button>
						{:else}
							<button type="button" disabled title={option.capturableReason}>
								{t("choiceBuilder.canvasPicker.unavailable")}
							</button>
						{/if}
						<button type="button" onclick={() => copyNodeId(option.id)}>
							{t("choiceBuilder.canvasPicker.copyId")}
						</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
