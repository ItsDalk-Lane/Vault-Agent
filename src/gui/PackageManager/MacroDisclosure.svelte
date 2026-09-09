<script lang="ts">
	import CapabilityTag from "./CapabilityTag.svelte";
	import type { PreviewCommand } from "../../services/packagePreview";
	import { t } from "../../i18n";

	let { commands }: { commands: PreviewCommand[] } = $props();

	// Resolved at call time so the label follows the locale active when the
	// modal opens — a module-level record would freeze the import-time locale.
	function humanCommandType(type: string): string {
		const mapped = COMMAND_TYPE_KEY[type];
		return mapped ? t(`packageManager.commandType.${mapped}`) : type;
	}

	const COMMAND_TYPE_KEY: Record<string, string> = {
		UserScript: "userScript",
		Conditional: "conditional",
		NestedChoice: "nestedChoice",
		Obsidian: "obsidian",
		Choice: "choice",
		Wait: "wait",
		EditorCommand: "editorCommand",
		AIAssistant: "aiAssistant",
		OpenFile: "openFile",
	};
</script>

<ul class="macroCommands">
	{#each commands as command, index (index)}
		<li style={`padding-left:${command.depth * 1}rem`}>
			<span class="macroCommandName">{command.name}</span>
			{#if command.flag}
				<CapabilityTag flag={command.flag} />
			{:else}
				<span class="macroCommandType"
					>{humanCommandType(command.type)}</span
				>
			{/if}
			{#if command.scriptPath}
				<code>{command.scriptPath}</code>
			{:else if command.summary}
				<span class="macroCommandSummary">{command.summary}</span>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.macroCommands {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.macroCommands li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--font-ui-smaller, 0.85rem);
	}

	.macroCommandName {
		font-weight: 500;
	}

	.macroCommandType {
		color: var(--text-muted);
		font-size: 0.72rem;
	}

	.macroCommandSummary {
		color: var(--text-muted);
	}
</style>
